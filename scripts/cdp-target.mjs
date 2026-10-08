// Test/probe transport only. Attach to one explicitly selected target over the
// existing private debugging pipe; never discover or export unrelated content.
export function targetSession(browser, targetId, deadlineMs = 5000) {
  const pending = new Map();
  let sequence = 0,
    sessionId,
    closed = false;
  const receive = (event) => {
    if (event.sessionId !== sessionId) return;
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
      if (closed || sessionId) throw new Error('Target session unavailable');
      ({ sessionId } = await browser.send('Target.attachToTarget', {
        targetId,
        flatten: false,
      }));
      browser.on('Target.receivedMessageFromTarget', receive);
    },
    send(method, params = {}) {
      if (closed || !sessionId)
        return Promise.reject(new Error('Target session unavailable'));
      return new Promise((resolve, reject) => {
        const id = ++sequence;
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error('Target command timed out'));
        }, deadlineMs);
        pending.set(id, { resolve, reject, timer });
        void browser
          .send('Target.sendMessageToTarget', {
            sessionId,
            message: JSON.stringify({ id, method, params }),
          })
          .catch(() => {
            clearTimeout(timer);
            pending.delete(id);
            reject(new Error('Target transport failed'));
          });
      });
    },
    async close() {
      closed = true;
      browser.off('Target.receivedMessageFromTarget', receive);
      for (const request of pending.values()) {
        clearTimeout(request.timer);
        request.reject(new Error('Target session closed'));
      }
      pending.clear();
      if (!sessionId) return true;
      let timer;
      try {
        return await Promise.race([
          browser.send('Target.detachFromTarget', { sessionId }).then(
            () => true,
            () => false,
          ),
          new Promise((resolve) => {
            timer = setTimeout(() => resolve(false), deadlineMs);
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
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
