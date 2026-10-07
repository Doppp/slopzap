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
import { Renderer } from '../rendering/renderer';
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
  private generation = 0;
  private worker: LocalClassifier | undefined;
  private mutation: MutationObserver | undefined;
  private roots: HTMLElement[] = [];
  private intersection: IntersectionObserver | undefined;
  private entries = new Map<HTMLElement, Entry>();
  private candidates = new Set<HTMLElement>();
  private eligible = new Set<HTMLElement>();
  private queue = new Set<HTMLElement>();
  private history = new Map<string, ScoredItem>();
  private dirty: Node[] = [];
  private discoveryTimer: ReturnType<typeof setTimeout> | undefined;
  private batchTimer: ReturnType<typeof setTimeout> | undefined;
  private routeTimer: ReturnType<typeof setInterval> | undefined;
  private busy = false;
  private sequence = 0;
  private renderFrame = 0;
  private classifiedCount = 0;
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
    this.routeTimer = setInterval(this.checkRoute, 1000);
    this.checkRoute();
  }
  private onMessage = (
    message: { type?: string; settings?: unknown },
    sender: { id?: string },
    sendResponse: (response: unknown) => void,
  ): boolean => {
    if (sender.id !== browser.runtime.id) return false;
    if (message.type === 'SETTINGS_CHANGED') {
      const previous = this.settings;
      this.settings = parseSettings(message.settings);
      if (
        previous.enabled !== this.settings.enabled ||
        JSON.stringify(previous.sites) !== JSON.stringify(this.settings.sites)
      ) {
        this.route = '';
        this.checkRoute();
      } else this.render();
      sendResponse({ ok: true });
    } else if (message.type === 'SNAPSHOT')
      sendResponse({
        supported: !!this.adapter,
        platform: this.adapter?.platform,
        settings: this.settings,
        aggregate: this.snapshot(),
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
        if (target?.closest('[data-slopzap-ui]')) continue;
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
      this.sweep();
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
      while (this.dirty.length && performance.now() - start < 5) {
        const node = this.dirty.shift();
        if (
          !(node instanceof HTMLElement) ||
          !node.isConnected ||
          !this.adapter
        )
          continue;
        const nodes = [
          ...(node.matches(this.adapter.candidates) ? [node] : []),
          ...node.querySelectorAll<HTMLElement>(this.adapter.candidates),
        ];
        for (const candidate of nodes)
          if (
            !this.candidates.has(candidate) &&
            !candidate.closest(
              'form,[contenteditable="true"],[data-slopzap-ui]',
            )
          ) {
            this.candidates.add(candidate);
            this.intersection?.observe(candidate);
          }
      }
      if (this.dirty.length) this.scheduleDiscovery();
    }, 0);
  }
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
    const batch = Array.from(this.queue).slice(0, 16);
    batch.forEach((node) => this.queue.delete(node));
    try {
      const work: Entry[] = [];
      for (const node of batch) {
        if (!node.isConnected || !this.eligible.has(node)) continue;
        const old = this.entries.get(node);
        old?.renderer.cleanup();
        const binding = this.adapter.parse(node);
        if (!binding) {
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
            keys: missing.map((entry) => entry.fingerprint),
          });
          if (value?.results) cached = value;
        } catch {
          /* cache failure does not stop local processing */
        }
        for (const entry of missing) {
          entry.result = cached.results.find(
            (result) => result.fingerprint === entry.fingerprint,
          );
          entry.verdict = cached.overrides[entry.fingerprint];
        }
        const inputs = missing.filter((entry) => !entry.result);
        if (inputs.length) {
          const results = await this.worker.classify(
            inputs.map((entry) => ({
              unit: entry.binding.unit,
              fingerprint: entry.fingerprint,
            })),
          );
          this.classifiedCount += results.length;
          for (const entry of inputs)
            entry.result = results.find(
              (result) => result.fingerprint === entry.fingerprint,
            );
          void browser.runtime
            .sendMessage({ type: 'CACHE_SAVE', results })
            .catch(() => {});
        }
      }
      if (generation !== this.generation) return;
      for (const entry of work)
        if (entry.binding.container.isConnected)
          this.history.set(entry.fingerprint, this.scored(entry));
      // History holds numeric results, never DOM nodes or raw text.
      if (this.history.size > 10_000)
        this.history.delete(this.history.keys().next().value!);
      this.render();
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
        if (entry.binding.container.isConnected)
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
      if (!node.isConnected) {
        this.candidates.delete(node);
        this.eligible.delete(node);
        this.queue.delete(node);
        this.intersection?.unobserve(node);
        this.entries.get(node)?.renderer.cleanup();
        this.entries.delete(node);
      }
  }
  private cleanupRoute(): void {
    this.generation++;
    this.mutation?.disconnect();
    this.intersection?.disconnect();
    this.worker?.close();
    this.mutation = undefined;
    this.roots = [];
    this.intersection = undefined;
    this.worker = undefined;
    if (this.discoveryTimer !== undefined) clearTimeout(this.discoveryTimer);
    if (this.batchTimer !== undefined) clearTimeout(this.batchTimer);
    if (this.renderFrame) cancelAnimationFrame(this.renderFrame);
    this.discoveryTimer = undefined;
    this.batchTimer = undefined;
    this.renderFrame = 0;
    for (const entry of this.entries.values()) entry.renderer.cleanup();
    this.entries.clear();
    this.candidates.clear();
    this.eligible.clear();
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
  };
}
