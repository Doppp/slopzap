// Self-contained so Playwright can serialize this into the invented fixture.
// Fixed 0.1 ms histogram, not a rolling tail or an ever-growing frame array.
export function installFrameProbe() {
  const histogram = new Uint32Array(10_001);
  let count = 0,
    over33ms = 0,
    maximum = 0,
    longTasks = 0,
    longestTask = 0;
  let last = performance.now(),
    running = true,
    handle;
  const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      longTasks++;
      longestTask = Math.max(longestTask, entry.duration);
    }
  });
  observer.observe({ type: 'longtask', buffered: false });
  const frame = (now) => {
    if (!running) return;
    const duration = now - last;
    last = now;
    if (Number.isFinite(duration) && duration >= 0) {
      count++;
      histogram[Math.min(10_000, Math.floor(duration * 10))]++;
      if (duration > 33) over33ms++;
      maximum = Math.max(maximum, duration);
    }
    handle = requestAnimationFrame(frame);
  };
  handle = requestAnimationFrame(frame);
  let summary;
  globalThis.benchmark = {
    stop() {
      if (summary) return summary;
      running = false;
      cancelAnimationFrame(handle);
      for (const entry of observer.takeRecords()) {
        longTasks++;
        longestTask = Math.max(longestTask, entry.duration);
      }
      observer.disconnect();
      const rank = Math.ceil(count * 0.95);
      let cumulative = 0,
        bucket = -1;
      for (let index = 0; count && index < histogram.length; index++) {
        cumulative += histogram[index];
        if (cumulative >= rank) {
          bucket = index;
          break;
        }
      }
      const bounded = bucket >= 0 && bucket < 10_000;
      summary = {
        samples: count,
        coverage: 'entire scripted-scroll observation interval',
        histogramBinMs: 0.1,
        histogramBytes: histogram.byteLength,
        p95Ms: bounded ? (bucket + 1) / 10 : null,
        p95LowerBoundMs: bounded ? bucket / 10 : null,
        p95UpperBoundMs: bounded ? (bucket + 1) / 10 : null,
        p95Overflow: bucket === 10_000,
        overflowSamples: histogram[10_000],
        maxMs: count ? maximum : null,
        over33msRatio: count ? over33ms / count : null,
        over33msIsDroppedFrameProxy: true,
        longTasks,
        longestTaskMs: longestTask,
      };
      return summary;
    },
  };
}
