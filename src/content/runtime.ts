import { browser } from 'wxt/browser';
import { adapterFor } from '../adapters';
import type { Adapter, Binding } from '../adapters/types';
import { fingerprint } from '../shared/fingerprint';
import {
  DEFAULT_SETTINGS,
  parseSettings,
  type Result,
  type Settings,
  type Snapshot,
  type Verdict,
} from '../shared/types';
import { LocalClassifier } from '../classifier/client';
import { ChromePromptProvider } from '../providers/chrome-prompt';
import { compose, PROVIDER_VERSION } from '../providers/compose';
import { CLASSIFIER_VERSION } from '../shared/types';
import { Renderer } from '../rendering/renderer';
import { AdapterHealth, type AdapterFailure } from './adapter-health';
import {
  aggregate,
  presentations,
  type ScoredItem,
} from '../scoring/presentation';

interface Entry {
  binding: Binding;
  key: string;
  fingerprint: string;
  result: Result | undefined;
  verdict: Verdict | undefined;
  renderer: Renderer;
  generation: number;
}
export class Runtime {
  private settings: Settings = DEFAULT_SETTINGS;
  private adapter: Adapter | undefined;
  private route = '';
  private pausedRoute: string | undefined;
  private health = new AdapterHealth();
  private sampled = new WeakSet<HTMLElement>();
  private generation = 0;
  private worker: LocalClassifier | undefined;
  private mutation: MutationObserver | undefined;
  private roots: HTMLElement[] = [];
  private intersection: IntersectionObserver | undefined;
  private visibleObserver: IntersectionObserver | undefined;
  private visible = new Set<HTMLElement>();
  private entries = new Map<HTMLElement, Entry>();
  private candidates = new Set<HTMLElement>();
  private eligible = new Set<HTMLElement>();
  private queue = new Set<HTMLElement>();
  private history = new Map<string, ScoredItem>();
  private dirty: Node[] = [];
  private discoveryTimer: ReturnType<typeof setTimeout> | undefined;
  private scan: TreeWalker | undefined;
  private sweepTimer: ReturnType<typeof setTimeout> | undefined;
  private scrollTimer: ReturnType<typeof setTimeout> | undefined;
  private batchTimer: ReturnType<typeof setTimeout> | undefined;
  private routeTimer: ReturnType<typeof setInterval> | undefined;
  private busy = false;
  private sequence = 0;
  private renderFrame = 0;
  private classifiedCount = 0;
  private provider: ChromePromptProvider | undefined;
  private providerQueue = new Set<Entry>();
  private providerBusy = false;
  private providerAbort = new AbortController();
  async start(): Promise<void> {
    try {
      this.settings = parseSettings(
        await browser.runtime.sendMessage({ type: 'SETTINGS_GET' }),
      );
    } catch {
      /* local defaults */
    }
    browser.runtime.onMessage.addListener(this.onMessage);
    window.addEventListener('popstate', this.checkRoute);
    window.addEventListener('hashchange', this.checkRoute);
    window.addEventListener('pagehide', this.stop);
    window.addEventListener('scroll', this.onScroll, { passive: true });
    this.routeTimer = setInterval(this.checkRoute, 1000);
    this.checkRoute();
  }
  private onMessage = (
    message: { type?: string; settings?: unknown },
    sender: { id?: string; url?: string },
    sendResponse: (response: unknown) => void,
  ): boolean => {
    if (sender.id !== browser.runtime.id) return false;
    if (message.type === 'RETRY_ADAPTER') {
      // Only an extension page can explicitly resume a paused route.
      if (!sender.url?.startsWith(browser.runtime.getURL('/'))) return false;
      this.cleanupRoute();
      this.pausedRoute = undefined;
      this.health = new AdapterHealth();
      this.sampled = new WeakSet();
      this.checkRoute();
      sendResponse({ ok: true });
    } else if (message.type === 'SETTINGS_CHANGED') {
      const previous = this.settings;
      this.settings = parseSettings(message.settings);
      if (
        previous.enabled !== this.settings.enabled ||
        previous.onDevice !== this.settings.onDevice ||
        JSON.stringify(previous.sites) !== JSON.stringify(this.settings.sites)
      ) {
        this.cleanupRoute();
        this.adapter = undefined;
        this.checkRoute();
      } else this.render();
      sendResponse({ ok: true });
    } else if (message.type === 'SNAPSHOT')
      sendResponse({
        supported: !!this.adapter,
        platform: this.adapter?.platform,
        settings: this.settings,
        aggregate: this.snapshot(),
        health: this.health.snapshot(),
        stats: {
          bound: this.entries.size,
          candidates: this.candidates.size,
          classifications: this.classifiedCount,
        },
      });
    return false;
  };
  private checkRoute = (): void => {
    if (document.visibilityState === 'hidden') return;
    const url = new URL(location.href);
    const adapter = adapterFor(url);
    const route = adapter?.routeKey(url) ?? `${url.origin}${url.pathname}`;
    if (
      route === this.route &&
      this.mutation &&
      this.roots.every((root) => root.isConnected)
    )
      return;
    if (this.mutation && !this.roots.every((root) => root.isConnected))
      this.cleanupRoute();
    if (route !== this.route) {
      this.cleanupRoute();
      this.route = route;
      this.pausedRoute = undefined;
      this.health = new AdapterHealth();
      this.sampled = new WeakSet();
    }
    if (
      !this.settings.enabled ||
      !adapter ||
      (adapter.platform !== 'synthetic' &&
        !this.settings.sites[adapter.platform])
    ) {
      this.adapter = undefined;
      return;
    }
    this.adapter = adapter;
    if (this.pausedRoute === route) return;
    const roots = Array.from(
      document.querySelectorAll<HTMLElement>(adapter.roots),
    ).filter(
      (node, _, all) =>
        !all.some((other) => other !== node && other.contains(node)),
    );
    if (!roots.length) return;
    this.roots = roots;
    this.adapter = adapter;
    this.worker = new LocalClassifier();
    this.provider = this.settings.onDevice
      ? new ChromePromptProvider()
      : undefined;
    this.providerAbort = new AbortController();
    this.visibleObserver = new IntersectionObserver((changes) => {
      for (const change of changes) {
        const node = change.target as HTMLElement;
        if (change.isIntersecting) this.visible.add(node);
        else this.visible.delete(node);
      }
    });
    this.intersection = new IntersectionObserver(
      (changes) => {
        for (const change of changes) {
          const node = change.target as HTMLElement;
          if (change.isIntersecting) {
            this.eligible.add(node);
            this.queue.add(node);
          } else {
            this.eligible.delete(node);
            this.queue.delete(node);
          }
        }
        this.scheduleBatch();
      },
      { rootMargin: '100% 0px 150% 0px' },
    );
    this.mutation = new MutationObserver((records) => {
      for (const record of records) {
        const target =
          record.target.nodeType === Node.ELEMENT_NODE
            ? (record.target as Element)
            : record.target.parentElement;
        if (target && adapter.isSensitive(target)) continue;
        if (
          [...record.removedNodes].some(
            (node) =>
              !(node instanceof Element && node.matches('[data-slopzap-ui]')),
          ) &&
          this.sweepTimer === undefined
        )
          this.sweepTimer = setTimeout(() => {
            this.sweepTimer = undefined;
            this.sweep();
          }, 0);
        for (const added of record.addedNodes)
          if (!(added instanceof Element && added.matches('[data-slopzap-ui]')))
            this.dirty.push(added);
        const nativeChange =
          record.type !== 'childList' ||
          [...record.addedNodes, ...record.removedNodes].some(
            (node) =>
              !(node instanceof Element && node.matches('[data-slopzap-ui]')),
          );
        if (nativeChange) {
          const candidate = target?.closest<HTMLElement>(adapter.candidates);
          if (candidate && this.eligible.has(candidate)) {
            this.queue.add(candidate);
            for (const [node, entry] of this.entries)
              if (
                entry.binding.parentContainer === candidate &&
                this.eligible.has(node)
              )
                this.queue.add(node);
          }
        }
      }
      if (this.dirty.length) this.scheduleDiscovery();
      this.scheduleBatch();
    });
    for (const root of roots) {
      this.mutation.observe(root, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true,
        attributeFilter: ['thingid', 'data-urn', 'data-id', 'data-tweet-id'],
      });
      this.dirty.push(root);
    }
    this.scheduleDiscovery();
  };
  private scheduleDiscovery(): void {
    if (this.discoveryTimer !== undefined) return;
    this.discoveryTimer = setTimeout(() => {
      this.discoveryTimer = undefined;
      const start = performance.now();
      let traversed = 0;
      while (
        (this.dirty.length || this.scan) &&
        performance.now() - start < 5 &&
        traversed++ < 200
      ) {
        if (!this.scan) {
          const root = this.dirty.shift();
          if (!(root instanceof HTMLElement) || !root.isConnected) continue;
          if (this.adapter?.isSensitive(root)) continue;
          this.registerCandidate(root);
          this.scan = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, {
            acceptNode: (node) =>
              node instanceof Element &&
              (this.adapter?.isSensitive(node) ||
                node.matches(
                  'form,[contenteditable]:not([contenteditable="false"]),[data-slopzap-ui],script,style',
                ))
                ? NodeFilter.FILTER_REJECT
                : NodeFilter.FILTER_ACCEPT,
          });
        }
        const node = this.scan.nextNode();
        if (node instanceof HTMLElement) this.registerCandidate(node);
        else this.scan = undefined;
      }
      if (this.dirty.length || this.scan) this.scheduleDiscovery();
    }, 0);
  }
  private registerCandidate(node: HTMLElement): void {
    if (
      !this.adapter ||
      !node.matches(this.adapter.candidates) ||
      this.adapter.isSensitive(node) ||
      this.candidates.has(node) ||
      node.closest(
        'form,[contenteditable]:not([contenteditable="false"]),[data-slopzap-ui]',
      )
    )
      return;
    if (this.candidates.size >= 1000) {
      const stale = [...this.candidates].find(
        (candidate) => !this.eligible.has(candidate),
      );
      if (!stale) return;
      this.release(stale);
    }
    this.candidates.add(node);
    this.intersection?.observe(node);
    this.visibleObserver?.observe(node);
  }
  private onScroll = (): void => {
    if (this.scrollTimer !== undefined) return;
    this.scrollTimer = setTimeout(() => {
      this.scrollTimer = undefined;
      if (!this.adapter) return;
      // Rediscover visible nodes dropped from the bounded observation window.
      for (const x of [innerWidth * 0.25, innerWidth * 0.75])
        for (const y of [1, innerHeight * 0.5, innerHeight - 1]) {
          for (const element of document.elementsFromPoint(x, y)) {
            const candidate = element.closest<HTMLElement>(
              this.adapter.candidates,
            );
            if (
              candidate &&
              this.roots.some((root) => root.contains(candidate))
            )
              this.registerCandidate(candidate);
          }
        }
      this.sweep();
    }, 100);
  };
  private scheduleBatch(): void {
    if (
      !this.queue.size ||
      this.busy ||
      this.batchTimer !== undefined ||
      !this.worker
    )
      return;
    this.batchTimer = setTimeout(() => {
      this.batchTimer = undefined;
      void this.process();
    }, 20);
  }
  private async process(): Promise<void> {
    if (!this.adapter || !this.worker) return;
    this.busy = true;
    const generation = this.generation;
    const batch = Array.from(this.queue)
      .sort((a, b) => Number(this.visible.has(b)) - Number(this.visible.has(a)))
      .slice(0, 16);
    batch.forEach((node) => this.queue.delete(node));
    try {
      const work: Entry[] = [];
      for (const node of batch) {
        if (!node.isConnected || !this.eligible.has(node)) continue;
        const old = this.entries.get(node);
        old?.renderer.cleanup();
        let binding: Binding | null;
        try {
          binding = this.adapter.parse(node);
        } catch {
          this.pauseAdapter('adapter_parse_exception');
          return;
        }
        if (!this.sampled.has(node)) {
          this.sampled.add(node);
          const failure = this.health.record(!!binding);
          if (failure) {
            this.pauseAdapter(failure);
            return;
          }
        }
        if (!binding) {
          if (old) this.history.delete(old.fingerprint);
          if (old) this.providerQueue.delete(old);
          this.entries.delete(node);
          continue;
        }
        const parentEntry = binding.parentContainer
          ? this.entries.get(binding.parentContainer)
          : undefined;
        if (parentEntry)
          binding.unit.parentText = parentEntry.binding.unit.text.slice(0, 800);
        const key = await fingerprint(binding.unit, this.route);
        if (generation !== this.generation) return;
        if (old?.fingerprint === key && old.result) {
          work.push(old);
          continue;
        }
        if (old) this.history.delete(old.fingerprint);
        const entry: Entry = {
          binding,
          key: `unit-${++this.sequence}`,
          fingerprint: key,
          result: undefined,
          verdict: undefined,
          renderer: new Renderer(binding, (verdict) => {
            void this.feedback(node, verdict);
          }),
          generation,
        };
        this.entries.set(node, entry);
        work.push(entry);
      }
      const missing = work.filter((entry) => !entry.result);
      let cached: { results: Result[]; overrides: Record<string, Verdict> } = {
        results: [],
        overrides: {},
      };
      if (missing.length) {
        try {
          const value = await browser.runtime.sendMessage({
            type: 'CACHE_GET',
            version: this.settings.onDevice
              ? PROVIDER_VERSION
              : CLASSIFIER_VERSION,
            keys: [...new Set(missing.map((entry) => entry.fingerprint))],
          });
          if (value?.results) cached = value;
        } catch {
          /* cache failure does not stop local processing */
        }
        if (generation !== this.generation) return;
        for (const entry of missing) {
          entry.result = cached.results.find(
            (result) => result.fingerprint === entry.fingerprint,
          );
          entry.verdict = cached.overrides[entry.fingerprint];
        }
        const inputs = [
          ...new Map(
            missing
              .filter((entry) => !entry.result)
              .map((entry) => [entry.fingerprint, entry]),
          ).values(),
        ];
        if (inputs.length) {
          const results = await this.worker.classify(
            inputs.map((entry) => ({
              unit: entry.binding.unit,
              fingerprint: entry.fingerprint,
            })),
          );
          if (generation !== this.generation) return;
          this.classifiedCount += results.length;
          for (const entry of missing)
            entry.result =
              results.find(
                (result) => result.fingerprint === entry.fingerprint,
              ) ?? entry.result;
          void browser.runtime
            .sendMessage({ type: 'CACHE_SAVE', results })
            .catch(() => {});
        }
      }
      if (generation !== this.generation) return;
      for (const entry of work)
        if (this.queue.has(entry.binding.container)) entry.renderer.cleanup();
        else if (
          entry.binding.container.isConnected &&
          this.entries.get(entry.binding.container) === entry
        )
          this.history.set(entry.fingerprint, this.scored(entry));
      // History holds numeric results, never DOM nodes or raw text.
      if (this.history.size > 10_000)
        this.history.delete(this.history.keys().next().value!);
      this.render();
      if (this.provider) {
        for (const entry of work)
          if (
            entry.result?.version === CLASSIFIER_VERSION &&
            entry.result.status === 'classified' &&
            !entry.verdict &&
            this.providerQueue.size < 60
          )
            this.providerQueue.add(entry);
        void this.processProvider();
      }
      if (this.entries.size > 300)
        for (const node of this.entries.keys()) {
          if (this.entries.size <= 250) break;
          if (!this.eligible.has(node)) this.release(node);
        }
    } catch {
      /* fail open; restore all presentation for this failed batch */
      for (const node of batch) {
        this.entries.get(node)?.renderer.cleanup();
      }
    } finally {
      if (generation === this.generation) {
        this.busy = false;
        this.scheduleBatch();
      }
    }
  }
  private async processProvider(): Promise<void> {
    if (!this.provider || this.providerBusy || !this.providerQueue.size) return;
    this.providerBusy = true;
    const generation = this.generation;
    const provider = this.provider;
    const batch = [...this.providerQueue].slice(0, 12);
    batch.forEach((entry) => this.providerQueue.delete(entry));
    const active = batch.filter(
      (entry) =>
        this.entries.get(entry.binding.container) === entry &&
        this.eligible.has(entry.binding.container) &&
        !entry.verdict,
    );
    try {
      const results = await provider.classify(
        active.map((entry) => ({
          id: entry.key,
          unit: {
            text: entry.binding.unit.text.slice(0, 6000),
            parentText: entry.binding.unit.parentText,
            rootText: entry.binding.unit.rootText,
            quotedText: entry.binding.unit.quotedText,
            kind: entry.binding.unit.kind,
            platform: entry.binding.unit.platform,
          },
        })),
        AbortSignal.any([this.providerAbort.signal, AbortSignal.timeout(8000)]),
      );
      if (generation !== this.generation) return;
      const saved: Result[] = [];
      for (const item of results) {
        const entry = active.find((entry) => entry.key === item.id);
        if (
          !entry?.result ||
          entry.verdict ||
          this.entries.get(entry.binding.container) !== entry ||
          this.queue.has(entry.binding.container)
        )
          continue;
        entry.result = compose(entry.result, item);
        saved.push(entry.result);
        this.history.set(entry.fingerprint, this.scored(entry));
      }
      if (saved.length) {
        void browser.runtime
          .sendMessage({ type: 'CACHE_SAVE', results: saved })
          .catch(() => {});
        this.render();
      }
    } catch {
      /* retain the already-rendered local result */
    } finally {
      if (generation === this.generation) {
        this.providerBusy = false;
        if (this.providerQueue.size) void this.processProvider();
      }
    }
  }
  private async feedback(node: HTMLElement, verdict: Verdict): Promise<void> {
    const entry = this.entries.get(node);
    if (!entry) return;
    entry.verdict = verdict;
    entry.renderer.resetReveal();
    this.history.set(entry.fingerprint, this.scored(entry));
    this.render();
    try {
      await browser.runtime.sendMessage({
        type: 'OVERRIDE',
        key: entry.fingerprint,
        verdict,
      });
    } catch {
      /* correction still works for this session */
    }
  }
  private scored(entry: Entry): ScoredItem {
    const parent = entry.binding.parentContainer;
    return {
      key: entry.key,
      parent: parent ? (this.entries.get(parent)?.key ?? null) : null,
      result: entry.result,
      verdict: entry.verdict,
    };
  }
  private render(): void {
    if (this.renderFrame) cancelAnimationFrame(this.renderFrame);
    const entries = Array.from(this.entries.values());
    const mode = this.settings.enabled ? this.settings.mode : 'normal';
    const map = presentations(
      entries.map((entry) => this.scored(entry)),
      mode,
      this.settings,
    );
    const generation = this.generation;
    let index = 0;
    const drain = () => {
      if (generation !== this.generation) return;
      const start = performance.now();
      while (index < entries.length && performance.now() - start < 5) {
        const entry = entries[index++]!;
        if (this.queue.has(entry.binding.container)) entry.renderer.cleanup();
        else if (
          entry.binding.container.isConnected &&
          this.entries.get(entry.binding.container) === entry
        )
          entry.renderer.render(
            map.get(entry.key) ?? 'visible',
            mode,
            entry.result,
            entry.verdict,
          );
      }
      this.renderFrame =
        index < entries.length ? requestAnimationFrame(drain) : 0;
    };
    this.renderFrame = requestAnimationFrame(drain);
  }
  private snapshot(): Snapshot {
    return aggregate(
      [...this.history.values()],
      this.queue.size + (this.busy ? 1 : 0),
    );
  }
  private sweep(): void {
    for (const node of this.candidates)
      if (!node.isConnected) this.release(node);
  }
  private release(node: HTMLElement): void {
    this.candidates.delete(node);
    this.eligible.delete(node);
    this.visible.delete(node);
    this.queue.delete(node);
    this.intersection?.unobserve(node);
    this.visibleObserver?.unobserve(node);
    const entry = this.entries.get(node);
    entry?.renderer.cleanup();
    if (entry) this.providerQueue.delete(entry);
    this.entries.delete(node);
  }
  private pauseAdapter(code: AdapterFailure): void {
    this.health.pause(code);
    this.pausedRoute = this.route;
    // Invalidate all in-flight work before restoring the host page.
    this.cleanupRoute();
  }
  private cleanupRoute(): void {
    this.generation++;
    this.mutation?.disconnect();
    this.intersection?.disconnect();
    this.visibleObserver?.disconnect();
    this.worker?.close();
    this.providerAbort.abort();
    this.provider?.close();
    this.provider = undefined;
    this.providerQueue.clear();
    this.providerBusy = false;
    this.mutation = undefined;
    this.roots = [];
    this.intersection = undefined;
    this.visibleObserver = undefined;
    this.worker = undefined;
    if (this.discoveryTimer !== undefined) clearTimeout(this.discoveryTimer);
    if (this.batchTimer !== undefined) clearTimeout(this.batchTimer);
    if (this.sweepTimer !== undefined) clearTimeout(this.sweepTimer);
    if (this.scrollTimer !== undefined) clearTimeout(this.scrollTimer);
    if (this.renderFrame) cancelAnimationFrame(this.renderFrame);
    this.discoveryTimer = undefined;
    this.batchTimer = undefined;
    this.sweepTimer = undefined;
    this.scrollTimer = undefined;
    this.scan = undefined;
    this.renderFrame = 0;
    for (const entry of this.entries.values()) entry.renderer.cleanup();
    this.entries.clear();
    this.candidates.clear();
    this.eligible.clear();
    this.visible.clear();
    this.queue.clear();
    this.history.clear();
    this.dirty = [];
    this.busy = false;
  }
  stop = (): void => {
    this.cleanupRoute();
    if (this.routeTimer !== undefined) clearInterval(this.routeTimer);
    browser.runtime.onMessage.removeListener(this.onMessage);
    window.removeEventListener('popstate', this.checkRoute);
    window.removeEventListener('hashchange', this.checkRoute);
    window.removeEventListener('pagehide', this.stop);
    window.removeEventListener('scroll', this.onScroll);
  };
}
