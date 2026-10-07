import { useEffect, useRef, useState } from 'preact/hooks';
import { browser } from 'wxt/browser';
import {
  DEFAULT_SETTINGS,
  parseSettings,
  type Settings,
  type Snapshot,
  type Platform,
} from '../shared/types';
import './styles.css';
import { downloadModel, availability } from '../providers/chrome-prompt';
import { parseOnboarding } from '../state/onboarding';
import type { AdapterHealthSnapshot } from '../content/adapter-health';
import { diagnostics } from '../shared/diagnostics';

interface PageState {
  supported: boolean;
  platform?: Platform;
  aggregate: Snapshot;
  health?: AdapterHealthSnapshot;
}
export function App({ options = false }: { options?: boolean }) {
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [page, setPage] = useState<PageState | null>(null);
  const [pageTab, setPageTab] = useState<number | undefined>();
  const [retrying, setRetrying] = useState(false);
  const [message, setMessage] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [modelAvailability, setModelAvailability] = useState('checking');
  const modelAbort = useRef<AbortController | undefined>(undefined);
  useEffect(() => () => modelAbort.current?.abort(), []);
  useEffect(() => {
    if (options) void availability().then(setModelAvailability);
  }, []);
  const [needsSetup, setNeedsSetup] = useState(false);
  useEffect(() => {
    void browser.runtime
      .sendMessage({ type: 'ONBOARDING_GET' })
      .then((value) => {
        if (value && !value.error)
          setNeedsSetup(!parseOnboarding(value).completed);
      })
      .catch(() => {});
    void browser.runtime
      .sendMessage({ type: 'SETTINGS_GET' })
      .then((value) => {
        if (!value || value.error) throw new Error('Settings unavailable');
        setSettings(parseSettings(value));
        setLoaded(true);
      })
      .catch(() =>
        setMessage('Settings are unavailable. Reopen SlopZap to retry.'),
      );
    const refresh = async () => {
      try {
        const [tab] = await browser.tabs.query({
          active: true,
          currentWindow: true,
        });
        if (tab?.id) {
          setPage(await browser.tabs.sendMessage(tab.id, { type: 'SNAPSHOT' }));
          setPageTab(tab.id);
        }
      } catch {
        setPage(null);
        setPageTab(undefined);
      }
    };
    if (!options) {
      void refresh();
      const timer = setInterval(() => void refresh(), 1000);
      return () => clearInterval(timer);
    }
  }, []);
  const update = async (patch: Partial<Settings>) => {
    try {
      const next = await browser.runtime.sendMessage({
        type: 'SETTINGS_SET',
        settings: { ...settings, ...patch },
      });
      if (!next || next.error) throw new Error('Settings unavailable');
      setSettings(parseSettings(next));
      setMessage('');
      return true;
    } catch {
      setMessage('Could not save your settings.');
      return false;
    }
  };
  const clear = async (store: 'results' | 'overrides') => {
    try {
      const result = await browser.runtime.sendMessage({
        type: 'CACHE_CLEAR',
        store,
      });
      if (!result?.ok) throw new Error('Storage unavailable');
      setMessage(
        store === 'results'
          ? 'Cache cleared. Existing page scores remain until navigation.'
          : 'Local corrections cleared. Navigate to refresh the page.',
      );
    } catch {
      setMessage('Could not clear storage.');
    }
  };
  const score = page?.aggregate.score;
  const retryAdapter = async () => {
    setRetrying(true);
    try {
      if (!pageTab) throw new Error('No supported tab');
      const result = await browser.tabs.sendMessage(pageTab, {
        type: 'RETRY_ADAPTER',
      });
      if (!result?.ok) throw new Error('Route unavailable');
      setPage(await browser.tabs.sendMessage(pageTab, { type: 'SNAPSHOT' }));
      setMessage(
        'Page check restarted. Content stays visible if parsing fails.',
      );
    } catch {
      setMessage(
        'Could not retry this page. Reload the discussion to try again.',
      );
    } finally {
      setRetrying(false);
    }
  };
  const enableModel = async () => {
    const controller = new AbortController();
    modelAbort.current = controller;
    setDownloading(true);
    setProgress(null);
    setMessage('Preparing Chrome on-device AI. Keep this settings page open.');
    try {
      await downloadModel(controller.signal, setProgress);
      if (controller.signal.aborted) return;
      if (!(await update({ onDevice: true }))) {
        setMessage(
          'Model prepared, but preferences could not be saved. Local analysis continues.',
        );
        return;
      }
      setMessage(
        'Chrome on-device analysis enabled where the API is available.',
      );
    } catch {
      setMessage(
        controller.signal.aborted
          ? 'Preparation cancelled. Local analysis continues.'
          : 'Chrome on-device AI is unavailable or could not be prepared. Local analysis continues.',
      );
    } finally {
      setDownloading(false);
      modelAbort.current = undefined;
    }
  };
  const exportDiagnostics = async () => {
    try {
      const pages = [];
      for (const tab of (
        await browser.tabs.query({ currentWindow: true })
      ).slice(0, 20)) {
        if (!tab.id) continue;
        try {
          const value = await browser.tabs.sendMessage(tab.id, {
            type: 'SNAPSHOT',
          });
          if (value?.supported) pages.push(diagnostics(value));
        } catch {
          /* unsupported tabs are omitted */
        }
      }
      const version = browser.runtime.getManifest().version;
      const chrome =
        navigator.userAgent.match(/Chrom(?:e|ium)\/(\d+)/)?.[1] ?? 'unknown';
      const url = URL.createObjectURL(
        new Blob(
          [
            JSON.stringify(
              {
                schemaVersion: 1,
                extensionVersion: version,
                chromeMajorVersion: chrome,
                pages,
              },
              null,
              2,
            ),
          ],
          { type: 'application/json' },
        ),
      );
      const link = document.createElement('a');
      link.href = url;
      link.download = 'slopzap-diagnostics.json';
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMessage(
        'Local diagnostics exported. Review the file before sharing; nothing was uploaded.',
      );
    } catch {
      setMessage('Diagnostics could not be exported.');
    }
  };
  return (
    <div className={options ? 'app options' : 'app'}>
      <header>
        <h1 className="brand">⚡ SlopZap</h1>
        <span className="pill">LOCAL</span>
      </header>
      <p className="tagline">Zap AI-style social noise.</p>
      {!options && page?.supported && page.health?.code && (
        <section
          className="setup-reminder adapter-warning"
          aria-label="Page compatibility"
        >
          <h2>SlopZap paused on this page</h2>
          <p>
            {page.health.code === 'classifier_unavailable'
              ? 'Local analysis is unavailable.'
              : 'This page could not be read reliably.'}{' '}
            SlopZap has restored its changes and stopped analysis.
          </p>
          <p>
            Local diagnostic: <code>{page.health.code}</code>
          </p>
          <button disabled={retrying} onClick={() => void retryAdapter()}>
            {retrying ? 'Retrying…' : 'Retry page check'}
          </button>
        </section>
      )}
      {!options && needsSetup && !page?.health?.code && (
        <section className="setup-reminder">
          <p>New to SlopZap? Choose your view and sites in quick setup.</p>
          <button
            onClick={() =>
              void browser.tabs.create({
                url: browser.runtime.getURL('/onboarding.html'),
              })
            }
          >
            Open quick setup
          </button>
        </section>
      )}
      {!options && !page?.health?.code && (
        <section className="meter" aria-label="Slopometer">
          <span className="eyebrow">
            {page?.supported ? `${page.platform} · Slopometer` : 'Slopometer'}
          </span>
          <div className="score">
            {score !== null && score !== undefined
              ? `${Math.round(score * 100)}%`
              : '—'}
          </div>
          <p>
            {page?.supported
              ? `${page.aggregate.analysed} items analysed${page.aggregate.analysed < 10 ? ' · small sample' : ''}`
              : 'Open a supported feed or discussion.'}
          </p>
          {!!page?.aggregate.corrected && (
            <p>{page.aggregate.corrected} locally corrected</p>
          )}
        </section>
      )}
      <fieldset disabled={!loaded}>
        <legend>Browsing mode</legend>
        <div className="modes">
          {(['normal', 'goggles', 'blocker', 'only'] as const).map((mode) => (
            <button
              key={mode}
              className={settings.mode === mode ? 'selected' : ''}
              aria-pressed={settings.mode === mode}
              onClick={() => void update({ mode })}
            >
              {
                {
                  normal: 'Normal',
                  goggles: 'Slop Goggles',
                  blocker: 'Slop Blocker',
                  only: 'Slop Only',
                }[mode]
              }
            </button>
          ))}
        </div>
      </fieldset>
      <label className="toggle">
        <span>SlopZap enabled</span>
        <input
          type="checkbox"
          checked={settings.enabled}
          disabled={!loaded}
          onChange={(event) =>
            void update({ enabled: event.currentTarget.checked })
          }
        />
      </label>
      <p className="notice">
        Scores are provisional estimates of formulaic, low-information content.
        They cannot prove AI authorship. Blocker hides only your local
        corrections while classifier evaluation is pending.
      </p>
      {options ? (
        <>
          <section>
            <h2>Optional on-device AI</h2>
            <p>Model availability: {modelAvailability}</p>
            <p>
              Chrome can analyse context using its own local model on supported
              hardware. Enabling it may download a large model. Page text stays
              on your device.
            </p>
            <button
              disabled={
                !loaded ||
                downloading ||
                (!settings.onDevice &&
                  ['checking', 'unavailable'].includes(modelAvailability))
              }
              onClick={() =>
                settings.onDevice
                  ? void update({ onDevice: false })
                  : void enableModel()
              }
            >
              {downloading
                ? 'Preparing model…'
                : settings.onDevice
                  ? 'Disable on-device AI'
                  : 'Enable Chrome on-device AI'}
            </button>
            {downloading && (
              <>
                <p>
                  {progress === null
                    ? 'Preparing model…'
                    : progress < 1
                      ? `Downloading model · ${Math.round(progress * 100)}%`
                      : 'Download complete · loading model…'}
                </p>
                <progress
                  aria-label="Model download progress"
                  max="1"
                  {...(progress === null ? {} : { value: progress })}
                />
                <button onClick={() => modelAbort.current?.abort()}>
                  Cancel preparation
                </button>
              </>
            )}
          </section>
          <section>
            <h2>Supported sites</h2>
            {Object.entries(settings.sites).map(([site, enabled]) => (
              <label className="toggle" key={site}>
                <span>
                  {site === 'x'
                    ? 'X / Twitter'
                    : site.charAt(0).toUpperCase() + site.slice(1)}
                </span>
                <input
                  type="checkbox"
                  checked={enabled}
                  disabled={!loaded}
                  onChange={(event) =>
                    void update({
                      sites: {
                        ...settings.sites,
                        [site]: event.currentTarget.checked,
                      },
                    })
                  }
                />
              </label>
            ))}
          </section>
          <section>
            <h2>Filter thresholds</h2>
            <label>
              Blocker · {Math.round(settings.blockerThreshold * 100)}
              <input
                type="range"
                disabled={!loaded}
                min="75"
                max="95"
                step="5"
                value={settings.blockerThreshold * 100}
                onInput={(event) =>
                  void update({
                    blockerThreshold: Number(event.currentTarget.value) / 100,
                  })
                }
              />
            </label>
            <label>
              Slop Only · {Math.round(settings.onlyThreshold * 100)}
              <input
                type="range"
                disabled={!loaded}
                min="50"
                max="90"
                step="5"
                value={settings.onlyThreshold * 100}
                onInput={(event) =>
                  void update({
                    onlyThreshold: Number(event.currentTarget.value) / 100,
                  })
                }
              />
            </label>
          </section>
          <section>
            <h2>Local diagnostics</h2>
            <label className="toggle">
              <span>Record timing diagnostics</span>
              <input
                type="checkbox"
                checked={settings.debug}
                disabled={!loaded}
                onChange={(event) =>
                  void update({ debug: event.currentTarget.checked })
                }
              />
            </label>
            <p>
              Optional bounded timing samples stay in tab memory. Export
              includes counts, failure codes and preferences for up to 20 open
              supported tabs, never text, identities, fingerprints or URLs.
              Nothing is uploaded.
            </p>
            <button onClick={() => void exportDiagnostics()}>
              Export local diagnostics
            </button>
          </section>
          <section>
            <h2>Your data stays here</h2>
            <p>
              Text is analysed in your browser. SlopZap makes no inference
              network requests, collects no telemetry, and stores only derived
              scores and exact-item corrections. Messages and compose fields are
              excluded.
            </p>
            <div className="actions">
              <button
                onClick={() =>
                  void browser.tabs.create({
                    url: browser.runtime.getURL('/onboarding.html'),
                  })
                }
              >
                Review quick setup
              </button>
              <button
                onClick={() =>
                  void browser.tabs.create({
                    url: browser.runtime.getURL('/harness.html'),
                  })
                }
              >
                Open synthetic test feed
              </button>
              <button onClick={() => void clear('results')}>
                Clear score cache
              </button>
              <button onClick={() => void clear('overrides')}>
                Clear corrections
              </button>
            </div>
          </section>
        </>
      ) : (
        <footer>
          <button onClick={() => void browser.runtime.openOptionsPage()}>
            Settings & privacy
          </button>
          <a
            href="https://github.com/Doppp/slopzap"
            target="_blank"
            rel="noreferrer"
          >
            Source ↗
          </a>
        </footer>
      )}
      <p role="status">{message}</p>
    </div>
  );
}
