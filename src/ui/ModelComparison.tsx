import { useEffect, useRef, useState } from 'preact/hooks';
import { browser } from 'wxt/browser';
import { availability } from '../providers/chrome-prompt';
import { abortable } from '../shared/async';
import { COMPARISON_CASES } from '../evaluation/comparison-cases';
import {
  chromeArm,
  modelComparison,
  type ComparisonReport,
} from '../evaluation/model-comparison';
import './styles.css';
import './comparison.css';

export function ModelComparison() {
  const [capability, setCapability] = useState('checking');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [report, setReport] = useState<ComparisonReport>();
  const [message, setMessage] = useState('');
  const operation = useRef<AbortController | undefined>(undefined);
  const alive = useRef(true);
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    void abortable(availability(), controller.signal)
      .then((value) => {
        if (alive.current) setCapability(value);
      })
      .catch(() => {
        if (alive.current) setCapability('check_failed');
      })
      .finally(() => clearTimeout(timer));
    const stop = () => operation.current?.abort();
    window.addEventListener('pagehide', stop);
    return () => {
      alive.current = false;
      controller.abort();
      stop();
      window.removeEventListener('pagehide', stop);
    };
  }, []);
  const run = async () => {
    if (operation.current || capability !== 'available') return;
    const controller = new AbortController();
    operation.current = controller;
    setBusy(true);
    setReport(undefined);
    setProgress(0);
    setMessage('Comparing invented examples. No browsing content is read.');
    try {
      const result = await modelComparison(
        chromeArm,
        controller.signal,
        (done) => {
          if (alive.current && operation.current === controller)
            setProgress(done);
        },
      );
      if (alive.current && operation.current === controller) {
        setReport(result);
        setMessage(
          `${result.status === 'complete' ? 'Comparison complete' : result.status === 'cancelled' ? 'Comparison cancelled' : 'Comparison incomplete'} · ${result.pairedCases} of ${result.plannedCases} valid pairs. This is not release approval.`,
        );
      }
    } catch {
      if (alive.current)
        setMessage('Comparison failed. No model or page text was saved.');
    } finally {
      if (operation.current === controller) {
        operation.current = undefined;
        if (alive.current) setBusy(false);
      }
    }
  };
  const exportReport = () => {
    if (!report || busy) return;
    const data = {
      ...report,
      extensionVersion: browser.runtime.getManifest().version,
      chromeMajorVersion:
        navigator.userAgent.match(/Chrom(?:e|ium)\/(\d+)/)?.[1] ?? 'unknown',
    };
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = 'slopzap-reference-comparison.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setMessage(
      'Local numeric report download requested. Nothing was uploaded. Invented labels are not independent validation.',
    );
  };
  const percent = (value: number | null) =>
    value === null ? '—' : `${Math.round(value * 100)}%`;
  const rawOutcome = (value: {
    status: string;
    score: number | null;
    evidence: number | null;
  }) =>
    value.status !== 'ok'
      ? value.status
      : value.evidence !== null && value.evidence >= 0.6
        ? percent(value.score)
        : 'Low evidence';
  return (
    <main className="app options comparison">
      <h1>Reference guide comparison</h1>
      <p>
        Compare Chrome on-device AI with and without paired references on 12
        invented examples. Neither condition changes browsing preferences, the
        cache or automatic hiding.
      </p>
      <p>Model availability: {capability}</p>
      {capability !== 'available' && (
        <p>
          Prepare the optional model in{' '}
          <a
            href={browser.runtime.getURL('/options.html')}
            target="_blank"
            rel="noreferrer"
          >
            Settings
          </a>{' '}
          on supported hardware, then reopen this page. This page never starts a
          model download.
        </p>
      )}
      <div className="actions">
        <button
          disabled={busy || capability !== 'available'}
          onClick={(event) => {
            if (event.isTrusted) void run();
          }}
        >
          Run paired comparison
        </button>
        <button disabled={!busy} onClick={() => operation.current?.abort()}>
          Cancel comparison
        </button>
        <button disabled={!report || busy} onClick={exportReport}>
          Export numeric comparison
        </button>
      </div>
      {busy && (
        <progress max={24} value={progress} aria-label="Comparison progress" />
      )}
      <p role="status">{message}</p>
      <p className="notice">
        Invented labels reflect the author’s intended low-information/useful
        distinction, not AI authorship. Each arm has an eight-second deadline
        and a fresh session; arm order alternates. Only valid pairs enter the
        paired metrics. Missing results and abstentions are not evidence of
        accuracy. Chrome model versions are not pinned.
      </p>
      {report && (
        <section aria-label="Comparison results">
          <h2>
            {report.status === 'complete'
              ? 'Paired results'
              : 'Partial results'}{' '}
            · {report.pairedCases}/{report.plannedCases}
          </h2>
          {report.metrics.map((group) => (
            <div
              className="table-scroll"
              key={group.threshold}
              tabIndex={0}
              role="region"
              aria-label={`Metrics at ${Math.round(group.threshold * 100)} threshold`}
            >
              <table>
                <caption>
                  Invented paired examples · threshold{' '}
                  {Math.round(group.threshold * 100)}
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Condition</th>
                    <th scope="col">Precision</th>
                    <th scope="col">Recall</th>
                    <th scope="col">False positives</th>
                    <th scope="col">Coverage</th>
                  </tr>
                </thead>
                <tbody>
                  {(['baseline', 'guided'] as const).flatMap((arm) =>
                    (['raw', 'composed'] as const).map((kind) => {
                      const value = group[arm][kind];
                      return (
                        <tr key={`${arm}-${kind}`}>
                          <th scope="row">
                            {arm === 'baseline'
                              ? 'Without references'
                              : 'With references'}{' '}
                            · {kind === 'raw' ? 'model' : 'application policy'}
                          </th>
                          <td>{percent(value.precision)}</td>
                          <td>{percent(value.recall)}</td>
                          <td>
                            {value.fp}/{value.fp + value.tn}
                          </td>
                          <td>{percent(value.coverage)}</td>
                        </tr>
                      );
                    }),
                  )}
                </tbody>
              </table>
            </div>
          ))}
          <div
            className="table-scroll"
            tabIndex={0}
            role="region"
            aria-label="Per example outcomes"
          >
            <table>
              <caption>Per-example raw scores and failure codes</caption>
              <thead>
                <tr>
                  <th scope="col">Example</th>
                  <th scope="col">Without references</th>
                  <th scope="col">With references</th>
                </tr>
              </thead>
              <tbody>
                {report.rows.map((row) => (
                  <tr key={row.caseId}>
                    <th scope="row">{row.caseId}</th>
                    <td>{rawOutcome(row.baseline)}</td>
                    <td>{rawOutcome(row.guided)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      <details>
        <summary>Review the 12 invented examples</summary>
        {COMPARISON_CASES.map((item) => (
          <article key={item.id}>
            <h2>
              {item.id} · intended{' '}
              {item.label ? 'low information' : 'useful/contextual'}
            </h2>
            <p>Parent: {item.unit.parentText}</p>
            <p>Target: {item.unit.text}</p>
          </article>
        ))}
      </details>
    </main>
  );
}
