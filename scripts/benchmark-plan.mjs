export function benchmarkPlan(argv) {
  const known = [
    '--long',
    '--paired-long',
    '--chrome',
    '--with-absent',
    '--worker-heap',
  ];
  if (
    argv.some(
      (value) =>
        !known.includes(value) && !/^--duration=\d+(?:\.\d+)?$/.test(value),
    )
  )
    throw new Error('Unknown benchmark argument');
  if (
    new Set(argv).size !== argv.length ||
    argv.filter((value) => value.startsWith('--duration=')).length > 1
  )
    throw new Error('Duplicate benchmark argument');
  if (argv.includes('--long') && argv.includes('--paired-long'))
    throw new Error('Choose one long-run mode');
  const long = argv.includes('--long') || argv.includes('--paired-long');
  const seconds = Number(
    argv.find((value) => value.startsWith('--duration='))?.split('=')[1] ??
      (long ? 1800 : 5),
  );
  if (!Number.isFinite(seconds) || seconds < 1 || seconds > 3600)
    throw new Error('Duration must be 1–3600 seconds');
  const scenarios = argv.includes('--paired-long')
    ? [1, 4].flatMap((throttle) =>
        [false, true].map((enabled) => ({ enabled, throttle, units: 1000 })),
      )
    : long
      ? [{ enabled: true, throttle: 1, units: 1000 }]
      : [1, 4].flatMap((throttle) =>
          [100, 500, 1000].flatMap((units) =>
            [false, true].map((enabled) => ({ enabled, throttle, units })),
          ),
        );
  const controls = scenarios.flatMap((scenario) => [
    ...(argv.includes('--with-absent') && !scenario.enabled
      ? [{ ...scenario, installed: false }]
      : []),
    { ...scenario, installed: true },
  ]);
  // The legacy single enabled run also gets its matching absent control.
  if (argv.includes('--with-absent') && argv.includes('--long'))
    controls.unshift({ ...scenarios[0], enabled: false, installed: false });
  return {
    long,
    seconds,
    chrome: argv.includes('--chrome'),
    workerHeap: argv.includes('--worker-heap'),
    mode: argv.includes('--paired-long')
      ? 'paired-long'
      : long
        ? 'single-long'
        : 'short',
    scenarios: controls,
  };
}
