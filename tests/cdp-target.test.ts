import { expect, test } from 'vitest';
import { EventEmitter } from 'node:events';
import { keyEvents, targetSession } from '../scripts/cdp-target.mjs';

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
      reply === 'error' ? 'Popup command failed' : 'Popup transport failed',
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
    'Popup command timed out',
  );
  await session.close();
});
test('closing rejects pending commands and prevents later use', async () => {
  const transport = new Transport();
  transport.reply = 'silent';
  const session = targetSession(transport, 'invented-target');
  await session.connect();
  const pending = expect(session.send('Runtime.evaluate')).rejects.toThrow(
    'Popup session closed',
  );
  await session.close();
  await pending;
  await expect(session.send('Runtime.evaluate')).rejects.toThrow(
    'Popup session unavailable',
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
