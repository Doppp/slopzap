import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { browser } from 'wxt/browser';
import {
  DEFAULT_SETTINGS,
  parseSettings,
  type Mode,
  type Settings,
} from '../shared/types';
import { parseOnboarding } from '../state/onboarding';
import './styles.css';
import './onboarding.css';

const VIEWS: { mode: Mode; label: string; description: string }[] = [
  {
    mode: 'goggles',
    label: 'Slop Goggles',
    description:
      'Keep content visible and add a Slop Score. Recommended for getting started.',
  },
  {
    mode: 'blocker',
    label: 'Slop Blocker',
    description:
      'Hide items with a reversible Show control. In this alpha, only items you mark locally as slop are hidden.',
  },
  {
    mode: 'only',
    label: 'Slop Only',
    description:
      'Inspect suspected slop while keeping parent context. Uncertain items stay visible.',
  },
  {
    mode: 'normal',
    label: 'Normal',
    description:
      'Keep the page free of SlopZap annotations. You can change your view at any time.',
  },
];
export const SITE_LABELS: Record<keyof Settings['sites'], string> = {
  linkedin: 'LinkedIn',
  x: 'X / Twitter',
  youtube: 'YouTube',
  reddit: 'Reddit',
  medium: 'Medium',
};

export function Onboarding() {
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [step, setStep] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [review, setReview] = useState(false);
  const [error, setError] = useState('');
  const heading = useRef<HTMLHeadingElement>(null);
  const load = async () => {
    setError('');
    try {
      const [preferences, state] = await Promise.all([
        browser.runtime.sendMessage({ type: 'SETTINGS_GET' }),
        browser.runtime.sendMessage({ type: 'ONBOARDING_GET' }),
      ]);
      if (!preferences || preferences.error || !state || state.error)
        throw new Error('Storage unavailable');
      setSettings(parseSettings(preferences));
      setReview(parseOnboarding(state).completed);
      setLoaded(true);
    } catch {
      setError(
        'Your preferences could not be loaded. Retry before continuing.',
      );
    }
  };
  useEffect(() => {
    void load();
  }, []);
  useLayoutEffect(() => {
    if (loaded) heading.current?.focus();
  }, [step, loaded]);
  const finish = async (useCurrent = false) => {
    setSaving(true);
    setError('');
    try {
      const result = await browser.runtime.sendMessage(
        useCurrent
          ? { type: 'ONBOARDING_COMPLETE' }
          : {
              type: 'ONBOARDING_COMPLETE',
              choices: { mode: settings.mode, sites: settings.sites },
            },
      );
      if (!result?.ok) throw new Error('Settings unavailable');
      setSettings(parseSettings(result.settings));
      setStep(3);
    } catch {
      setError(
        'Setup could not be confirmed. Please retry saving your choices.',
      );
    } finally {
      setSaving(false);
    }
  };
  const demo = async () => {
    try {
      const tab = await browser.tabs.getCurrent();
      if (tab?.id)
        await browser.tabs.update(tab.id, {
          url: browser.runtime.getURL('/harness.html'),
        });
    } catch {
      setError(
        'The demo could not open. You can find it in Settings & privacy.',
      );
    }
  };
  const close = async () => {
    try {
      const tab = await browser.tabs.getCurrent();
      if (tab?.id) await browser.tabs.remove(tab.id);
    } catch {
      setError('You can close this tab and start browsing.');
    }
  };
  return (
    <div className="app onboarding">
      <header>
        <h1 className="brand">⚡ SlopZap</h1>
        <span className="pill">LOCAL FIRST</span>
      </header>
      {step < 3 && (
        <ol className="setup-progress" aria-label="Setup progress">
          {['Meet SlopZap', 'Choose a view', 'Choose sites'].map(
            (label, index) => (
              <li
                key={label}
                aria-current={step === index ? 'step' : undefined}
              >
                <span aria-hidden="true">{index + 1}</span>
                {label}
              </li>
            ),
          )}
        </ol>
      )}
      <section className="setup-panel" aria-busy={saving}>
        {step === 0 && (
          <>
            <h2 ref={heading} tabIndex={-1}>
              {review
                ? 'Review your quick setup'
                : 'A little less slop. A lot more signal.'}
            </h2>
            <p>
              SlopZap helps you inspect formulaic, low-information posts and
              replies. Choose a view, then decide where it runs.
            </p>
            <div className="setup-facts">
              <div>
                <h3>Signals, not proof</h3>
                <p>
                  Slop Scores are provisional estimates. They can be wrong and
                  cannot prove that someone used AI.
                </p>
              </div>
              <div>
                <h3>Your browser, your data</h3>
                <p>
                  Local analysis stays on your device. No accounts, telemetry,
                  or cloud inference. Messages and compose fields are excluded.
                </p>
              </div>
            </div>
            <p className="notice">
              This is a development alpha. Live-site compatibility and
              classifier accuracy are still being tested. Optional Chrome
              on-device AI can be enabled later in Settings; setup downloads no
              model.
            </p>
          </>
        )}
        {step === 1 && (
          <>
            <h2 ref={heading} tabIndex={-1}>
              How do you want to browse?
            </h2>
            <p>You can switch views instantly from the toolbar popup.</p>
            <fieldset disabled={!loaded || saving} className="view-choices">
              <legend className="sr-only">Default browsing view</legend>
              {VIEWS.map((view) => (
                <label
                  key={view.mode}
                  className={`view-choice ${settings.mode === view.mode ? 'chosen' : ''}`}
                >
                  <input
                    type="radio"
                    name="view"
                    value={view.mode}
                    checked={settings.mode === view.mode}
                    onChange={() =>
                      setSettings({ ...settings, mode: view.mode })
                    }
                  />
                  <span>
                    <strong>
                      {view.label}
                      {view.mode === 'goggles' && <small> Recommended</small>}
                    </strong>
                    <span>{view.description}</span>
                  </span>
                </label>
              ))}
            </fieldset>
            <p className="notice">
              The Slopometer lives in the popup in every view. It shows an
              average score and how many items were analysed, not a verified
              percentage of AI authors.
            </p>
          </>
        )}
        {step === 2 && (
          <>
            <h2 ref={heading} tabIndex={-1}>
              Choose where SlopZap runs
            </h2>
            <p>
              Enable the sites you use. You can change these choices in
              Settings.
            </p>
            <fieldset disabled={!loaded || saving} className="site-choices">
              <legend className="sr-only">Enabled sites</legend>
              {(Object.keys(SITE_LABELS) as (keyof Settings['sites'])[]).map(
                (site) => (
                  <label className="toggle" key={site}>
                    <span>{SITE_LABELS[site]}</span>
                    <input
                      type="checkbox"
                      checked={settings.sites[site]}
                      onChange={(event) =>
                        setSettings({
                          ...settings,
                          sites: {
                            ...settings.sites,
                            [site]: event.currentTarget.checked,
                          },
                        })
                      }
                    />
                  </label>
                ),
              )}
            </fieldset>
            {!Object.values(settings.sites).some(Boolean) && (
              <p className="notice">
                All sites are off. Setup can still finish, and the demo works
                without enabling a website.
              </p>
            )}
            <p className="notice">
              No page text is sent to a server. Only derived scores and your
              exact-item corrections are stored locally. You can clear them in
              Settings.
            </p>
          </>
        )}
        {step === 3 && (
          <>
            <h2 ref={heading} tabIndex={-1}>
              You’re ready to zap.
            </h2>
            <p>
              Your choices are saved. Pin SlopZap to your toolbar using Chrome’s
              Extensions menu, then open a supported discussion.
            </p>
            <div className="setup-summary">
              <span>Default view</span>
              <strong>
                {VIEWS.find((view) => view.mode === settings.mode)?.label}
              </strong>
              <span>Enabled sites</span>
              <strong>
                {Object.values(settings.sites).filter(Boolean).length} of 5
              </strong>
            </div>
            {!settings.enabled && (
              <p className="notice">
                SlopZap is currently paused. Your existing pause setting has
                been kept; enable it from the popup when you’re ready.
              </p>
            )}
            <p>
              Want a quick practice run? The demo contains invented comments and
              replies. Try a view, mark an item as Slop, and use Show to reveal
              it.
            </p>
            <div className="setup-actions">
              <button className="primary" onClick={() => void demo()}>
                Try the demo feed
              </button>
              <button onClick={() => void close()}>Start browsing</button>
              <button onClick={() => void browser.runtime.openOptionsPage()}>
                Open settings
              </button>
            </div>
          </>
        )}
        {error && (
          <div className="setup-error">
            <p role="alert">{error}</p>
            {!loaded && (
              <button onClick={() => void load()}>Retry loading</button>
            )}
          </div>
        )}
        {step < 3 && (
          <div className="setup-actions">
            <button
              className="primary"
              disabled={!loaded || saving}
              onClick={() => (step === 2 ? void finish() : setStep(step + 1))}
            >
              {saving
                ? 'Saving…'
                : step === 0
                  ? 'Let’s set it up'
                  : step === 1
                    ? 'Choose sites'
                    : 'Save setup'}
            </button>
            {step > 0 && (
              <button disabled={saving} onClick={() => setStep(step - 1)}>
                Back
              </button>
            )}
            <button
              className="quiet"
              disabled={!loaded || saving}
              onClick={() => void finish(true)}
            >
              Use current defaults
            </button>
          </div>
        )}
      </section>
      <p className="setup-footer">
        {step === 3
          ? 'You can review quick setup from Settings at any time.'
          : 'Just a few choices. No sign-in or AI download required.'}
      </p>
    </div>
  );
}
