// Test/probe transport only. Attach to one explicitly selected target over the
// existing private debugging pipe; never discover or export unrelated content.
export function validateProbeDeadline(deadlineMs) {
  if (
    !Number.isSafeInteger(deadlineMs) ||
    deadlineMs < 1 ||
    deadlineMs > 60_000
  )
    throw new Error('Probe deadline unavailable');
}

export async function targetCommand(
  browser,
  method,
  params,
  deadlineMs = 5000,
) {
  validateProbeDeadline(deadlineMs);
  let timer;
  const timeout = new Error('Target command timed out');
  try {
    const operation = browser.send(method, params);
    return await Promise.race([
      operation,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(timeout), deadlineMs);
      }),
    ]);
  } catch (error) {
    throw error === timeout ? timeout : new Error('Target transport failed');
  } finally {
    clearTimeout(timer);
  }
}

export function targetSession(browser, targetId, deadlineMs = 5000) {
  validateProbeDeadline(deadlineMs);
  if (typeof targetId !== 'string' || !targetId || targetId.length > 2048)
    throw new Error('Target identity unavailable');
  const pending = new Map();
  let sequence = 0,
    sessionId,
    state = 'new',
    closeResult;
  const receive = (event) => {
    if (
      state !== 'connected' ||
      event?.sessionId !== sessionId ||
      typeof event.message !== 'string'
    )
      return;
    let message;
    try {
      message = JSON.parse(event.message);
    } catch {
      return;
    }
    const request = pending.get(message?.id);
    if (!request) return;
    pending.delete(message.id);
    clearTimeout(request.timer);
    if (message.error) request.reject(new Error('Target command failed'));
    else request.resolve(message.result);
  };
  return {
    async connect() {
      if (state !== 'new') throw new Error('Target session unavailable');
      state = 'connecting';
      try {
        const result = await targetCommand(
          browser,
          'Target.attachToTarget',
          {
            targetId,
            flatten: false,
          },
          deadlineMs,
        );
        if (
          typeof result?.sessionId !== 'string' ||
          !result.sessionId ||
          result.sessionId.length > 2048
        )
          throw new Error('Target session unavailable');
        if (state !== 'connecting')
          throw new Error('Target session unavailable');
        sessionId = result.sessionId;
        state = 'connected';
        browser.on('Target.receivedMessageFromTarget', receive);
      } catch (error) {
        if (state !== 'closed') state = 'failed';
        if (
          error instanceof Error &&
          [
            'Target command timed out',
            'Target transport failed',
            'Target session unavailable',
          ].includes(error.message)
        )
          throw error;
        throw new Error('Target session unavailable');
      }
    },
    send(method, params = {}) {
      if (state !== 'connected')
        return Promise.reject(new Error('Target session unavailable'));
      return new Promise((resolve, reject) => {
        const id = ++sequence;
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error('Target command timed out'));
        }, deadlineMs);
        pending.set(id, { resolve, reject, timer });
        void Promise.resolve()
          .then(() => {
            if (state !== 'connected' || !pending.has(id)) return;
            return browser.send('Target.sendMessageToTarget', {
              sessionId,
              message: JSON.stringify({ id, method, params }),
            });
          })
          .catch(() => {
            clearTimeout(timer);
            pending.delete(id);
            reject(new Error('Target transport failed'));
          });
      });
    },
    close() {
      if (closeResult) return closeResult;
      const uncertain = state === 'connecting' || state === 'failed';
      state = 'closed';
      browser.off('Target.receivedMessageFromTarget', receive);
      for (const request of pending.values()) {
        clearTimeout(request.timer);
        request.reject(new Error('Target session closed'));
      }
      pending.clear();
      // An attachment can complete after timeout or close. Never claim cleanup
      // when its outcome is unknown; callers must close the disposable profile.
      closeResult = !sessionId
        ? Promise.resolve(!uncertain)
        : targetCommand(
            browser,
            'Target.detachFromTarget',
            { sessionId },
            deadlineMs,
          ).then(
            () => true,
            () => false,
          );
      return closeResult;
    },
  };
}

export function keyEvents(key, code, windowsVirtualKeyCode) {
  return [
    {
      type: 'keyDown',
      key,
      code,
      windowsVirtualKeyCode,
      ...(key === 'Enter' ? { text: '\r', unmodifiedText: '\r' } : {}),
    },
    { type: 'keyUp', key, code, windowsVirtualKeyCode },
  ];
}
