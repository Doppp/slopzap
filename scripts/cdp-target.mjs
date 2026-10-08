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
    if (message.error) request.reject(new Error('Popup command failed'));
    else request.resolve(message.result);
  };
  return {
    async connect() {
      if (closed || sessionId) throw new Error('Popup session unavailable');
      ({ sessionId } = await browser.send('Target.attachToTarget', {
        targetId,
        flatten: false,
      }));
      browser.on('Target.receivedMessageFromTarget', receive);
    },
    send(method, params = {}) {
      if (closed || !sessionId)
        return Promise.reject(new Error('Popup session unavailable'));
      return new Promise((resolve, reject) => {
        const id = ++sequence;
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error('Popup command timed out'));
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
            reject(new Error('Popup transport failed'));
          });
      });
    },
    async close() {
      closed = true;
      browser.off('Target.receivedMessageFromTarget', receive);
      for (const request of pending.values()) {
        clearTimeout(request.timer);
        request.reject(new Error('Popup session closed'));
      }
      pending.clear();
      if (sessionId)
        await browser
          .send('Target.detachFromTarget', { sessionId })
          .catch(() => {});
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
