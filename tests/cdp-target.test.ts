import { expect, test } from 'vitest';
import { EventEmitter } from 'node:events';
import {
  keyEvents,
  targetSession,
  targetCommand,
} from '../scripts/cdp-target.mjs';

class Transport extends EventEmitter {
  reply: 'ok' | 'error' | 'silent' | 'reject' = 'ok';
  async send(
    method: string,
    params: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    if (method === 'Target.attachToTarget')
      return { sessionId: 'invented-session' };
    if (method === 'Target.sendMessageToTarget') {
      if (this.reply === 'reject') throw new Error('invented private detail');
      const message = JSON.parse(String(params.message));
      this.emit('Target.receivedMessageFromTarget', {
        sessionId: 'unrelated-session',
        message: JSON.stringify({ id: message.id, result: 'must-ignore' }),
      });
      this.emit('Target.receivedMessageFromTarget', {
        sessionId: 'invented-session',
        message: 'malformed invented packet',
      });
      if (this.reply !== 'silent')
        this.emit('Target.receivedMessageFromTarget', {
          sessionId: 'invented-session',
          message: JSON.stringify({
            id: message.id,
            ...(this.reply === 'error'
              ? { error: { message: 'invented private detail' } }
              : { result: { verified: true } }),
          }),
        });
    }
    return {};
  }
}
test('target response matching ignores other sessions and malformed packets', async () => {
  const transport = new Transport();
  const session = targetSession(transport, 'invented-target');
  await session.connect();
  for (const event of [
    undefined,
    null,
    {},
    { sessionId: 'invented-session', message: 42 },
  ]) {
    expect(() =>
      transport.emit('Target.receivedMessageFromTarget', event),
    ).not.toThrow();
  }
  expect(await session.send('Runtime.evaluate')).toEqual({ verified: true });
  await session.close();
  expect(transport.listenerCount('Target.receivedMessageFromTarget')).toBe(0);
});
test.each(['error', 'reject'] as const)(
  'target %s exposes only controlled failures',
  async (reply) => {
    const transport = new Transport();
    transport.reply = reply;
    const session = targetSession(transport, 'invented-target');
    await session.connect();
    await expect(session.send('Runtime.evaluate')).rejects.toThrow(
      reply === 'error' ? 'Target command failed' : 'Target transport failed',
    );
    await session.close();
  },
);
test('unanswered commands expire with a bounded deadline', async () => {
  const transport = new Transport();
  transport.reply = 'silent';
  const session = targetSession(transport, 'invented-target', 10);
  await session.connect();
  await expect(session.send('Runtime.evaluate')).rejects.toThrow(
    'Target command timed out',
  );
  await session.close();
});
test('closing rejects pending commands and prevents later use', async () => {
  const transport = new Transport();
  transport.reply = 'silent';
  const session = targetSession(transport, 'invented-target');
  await session.connect();
  const pending = expect(session.send('Runtime.evaluate')).rejects.toThrow(
    'Target session closed',
  );
  await session.close();
  await pending;
  await expect(session.send('Runtime.evaluate')).rejects.toThrow(
    'Target session unavailable',
  );
});
test('keyboard Enter carries its character while Tab stays non-textual', () => {
  expect(keyEvents('Enter', 'Enter', 13)[0]).toMatchObject({
    type: 'keyDown',
    text: '\r',
    unmodifiedText: '\r',
  });
  expect(keyEvents('Tab', 'Tab', 9)[0]).not.toHaveProperty('text');
  expect(keyEvents('Enter', 'Enter', 13)[1]).toMatchObject({ type: 'keyUp' });
});
test.each(['reject', 'silent'] as const)(
  'detach %s reports failure within its deadline and releases listeners',
  async (mode) => {
    class FailingDetach extends Transport {
      override async send(
        method: string,
        params: Record<string, unknown>,
      ): Promise<Record<string, unknown>> {
        if (method === 'Target.detachFromTarget') {
          if (mode === 'reject') throw new Error('invented private detail');
          return new Promise(() => undefined);
        }
        return super.send(method, params);
      }
    }
    const transport = new FailingDetach();
    const session = targetSession(transport, 'invented-target', 10);
    await session.connect();
    expect(await session.close()).toBe(false);
    expect(transport.listenerCount('Target.receivedMessageFromTarget')).toBe(0);
  },
);

function deferredAttach() {
  let resolve!: (value: Record<string, unknown>) => void;
  const attachment = new Promise<Record<string, unknown>>((done) => {
    resolve = done;
  });
  class DeferredTransport extends Transport {
    methods: string[] = [];
    override async send(method: string, params: Record<string, unknown>) {
      this.methods.push(method);
      if (method === 'Target.attachToTarget') return attachment;
      return super.send(method, params);
    }
  }
  return { transport: new DeferredTransport(), resolve };
}
test('attachment timeout is terminal and late replies cannot resurrect a session', async () => {
  const { transport, resolve } = deferredAttach();
  const session = targetSession(transport, 'invented-target', 5);
  await expect(session.connect()).rejects.toThrow('Target command timed out');
  expect(await session.close()).toBe(false);
  resolve({ sessionId: 'late-invented-session' });
  await Promise.resolve();
  await Promise.resolve();
  expect(await session.close()).toBe(false);
  await expect(session.connect()).rejects.toThrow('Target session unavailable');
  await expect(session.send('Runtime.evaluate')).rejects.toThrow(
    'Target session unavailable',
  );
  expect(transport.listenerCount('Target.receivedMessageFromTarget')).toBe(0);
  expect(transport.methods).toEqual(['Target.attachToTarget']);
});
test('closing during attachment reports uncertainty and rejects the later connection', async () => {
  const { transport, resolve } = deferredAttach();
  const session = targetSession(transport, 'invented-target');
  const connected = expect(session.connect()).rejects.toThrow(
    'Target session unavailable',
  );
  expect(await session.close()).toBe(false);
  resolve({ sessionId: 'late-invented-session' });
  await connected;
  expect(transport.listenerCount('Target.receivedMessageFromTarget')).toBe(0);
  expect(await session.close()).toBe(false);
});
test('concurrent connection attempts issue only one attachment', async () => {
  const { transport, resolve } = deferredAttach();
  const session = targetSession(transport, 'invented-target');
  const first = session.connect();
  await expect(session.connect()).rejects.toThrow('Target session unavailable');
  resolve({ sessionId: 'invented-session' });
  await first;
  expect(transport.methods).toEqual(['Target.attachToTarget']);
  expect(await session.close()).toBe(true);
  expect(await session.close()).toBe(true);
  expect(
    transport.methods.filter((method) => method === 'Target.detachFromTarget'),
  ).toHaveLength(1);
});
test.each([
  {},
  { sessionId: '' },
  { sessionId: 42 },
  { sessionId: 'x'.repeat(2049) },
])(
  'malformed attachment cannot become a connected session %#',
  async (result) => {
    const { transport, resolve } = deferredAttach();
    const session = targetSession(transport, 'invented-target');
    const connected = expect(session.connect()).rejects.toThrow(
      'Target session unavailable',
    );
    resolve(result);
    await connected;
    expect(await session.close()).toBe(false);
    expect(transport.listenerCount('Target.receivedMessageFromTarget')).toBe(0);
  },
);
test('attachment rejection never exposes browser error text or permits reconnection', async () => {
  const transport = new Transport();
  transport.send = async () => {
    throw new Error('invented private detail');
  };
  const session = targetSession(transport, 'invented-target');
  await expect(session.connect()).rejects.toThrow('Target transport failed');
  expect(await session.close()).toBe(false);
  await expect(session.connect()).rejects.toThrow('Target session unavailable');
});
test.each([0, -1, 1.5, NaN, Infinity, 60_001])(
  'invalid deadline %s fails before sending commands',
  async (deadline) => {
    const { transport } = deferredAttach();
    expect(() => targetSession(transport, 'invented-target', deadline)).toThrow(
      'Probe deadline unavailable',
    );
    await expect(
      targetCommand(transport, 'Target.getTargets', {}, deadline),
    ).rejects.toThrow('Probe deadline unavailable');
    expect(transport.methods).toHaveLength(0);
  },
);
test.each(['', 'x'.repeat(2049)])(
  'invalid target identity fails before sending commands %#',
  (targetId) => {
    const { transport } = deferredAttach();
    expect(() => targetSession(transport, targetId)).toThrow(
      'Target identity unavailable',
    );
    expect(transport.methods).toHaveLength(0);
  },
);
test('synchronous direct-command rejection exposes only controlled text', async () => {
  const transport = {
    send: () => {
      throw new Error('invented private detail');
    },
  };
  await expect(
    targetCommand(transport, 'Target.getTargets', {}),
  ).rejects.toThrow('Target transport failed');
});
test('closing a new session is idempotent and prevents attachment', async () => {
  const { transport } = deferredAttach();
  const session = targetSession(transport, 'invented-target');
  expect(await session.close()).toBe(true);
  expect(await session.close()).toBe(true);
  await expect(session.connect()).rejects.toThrow('Target session unavailable');
  expect(transport.methods).toHaveLength(0);
});
test('listener-registration failure is terminal and detaches the known session', async () => {
  const transport = new Transport();
  transport.on = () => {
    throw new Error('invented private detail');
  };
  const session = targetSession(transport, 'invented-target');
  await expect(session.connect()).rejects.toThrow('Target session unavailable');
  await expect(session.send('Runtime.evaluate')).rejects.toThrow(
    'Target session unavailable',
  );
  expect(await session.close()).toBe(true);
});
