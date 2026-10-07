import { useEffect, useState } from 'preact/hooks';
import { browser } from 'wxt/browser';
import {
  DEFAULT_SETTINGS,
  type Settings,
  type Snapshot,
  type Platform,
} from '../shared/types';
import './styles.css';

interface PageState {
  supported: boolean;
  platform?: Platform;
  aggregate: Snapshot;
}
export function App({ options = false }: { options?: boolean }) {
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [page, setPage] = useState<PageState | null>(null);
  const [message, setMessage] = useState('');
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    void browser.runtime
      .sendMessage({ type: 'SETTINGS_GET' })
      .then((value) => {
        setSettings(value);
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
        if (tab?.id)
          setPage(await browser.tabs.sendMessage(tab.id, { type: 'SNAPSHOT' }));
      } catch {
        setPage(null);
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
      setSettings(next);
      setMessage('');
    } catch {
      setMessage('Could not save your settings.');
    }
  };
  const clear = async (store: 'results' | 'overrides') => {
    try {
      await browser.runtime.sendMessage({ type: 'CACHE_CLEAR', store });
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
  return (
    <div className={options ? 'app options' : 'app'}>
      <header>
        <div className="brand">⚡ SlopZap</div>
        <span className="pill">LOCAL</span>
      </header>
      <p className="tagline">Zap AI-style social noise.</p>
      {!options && (
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
            <h2>Your data stays here</h2>
            <p>
              Text is analysed in your browser. SlopZap makes no inference
              network requests, collects no telemetry, and stores only derived
              scores and exact-item corrections. Messages and compose fields are
              excluded.
            </p>
            <div className="actions">
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
