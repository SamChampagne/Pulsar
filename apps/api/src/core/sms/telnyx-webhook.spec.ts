import { generateKeyPairSync, sign } from 'node:crypto';
import { verifyTelnyxWebhook, parseTelnyxEvent } from './telnyx-webhook';

describe('Telnyx webhook signature', () => {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const key = publicKey.export({ type: 'spki', format: 'der' }).subarray(-32).toString('base64');
  const raw = Buffer.from('{ "data": {"event_type":"message.sent"} }');
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = sign(
    null,
    Buffer.concat([Buffer.from(`${timestamp}|`), raw]),
    privateKey,
  ).toString('base64');
  it('verifies exact bytes, not reserialized JSON', () => {
    expect(verifyTelnyxWebhook(raw, timestamp, signature, key)).toBe(true);
    expect(
      verifyTelnyxWebhook(
        Buffer.from(JSON.stringify(JSON.parse(raw.toString()))),
        timestamp,
        signature,
        key,
      ),
    ).toBe(false);
  });
  it('rejects stale/future, malformed and different-key signatures', () => {
    expect(verifyTelnyxWebhook(raw, timestamp, signature, key, Date.now() + 301000)).toBe(false);
    expect(verifyTelnyxWebhook(raw, timestamp, signature, key, Date.now() - 301000)).toBe(false);
    expect(verifyTelnyxWebhook(raw, timestamp, 'bad', key)).toBe(false);
    expect(
      verifyTelnyxWebhook(raw, timestamp, signature, Buffer.alloc(32).toString('base64')),
    ).toBe(false);
    expect(verifyTelnyxWebhook(Buffer.alloc(65537), timestamp, signature, key)).toBe(false);
  });
  it('rejects direction mismatch and multiple recipients instead of guessing', () => {
    const data = {
      event_type: 'message.received',
      id: 'event1',
      occurred_at: new Date().toISOString(),
      payload: {
        id: 'message1',
        messaging_profile_id: '123e4567-e89b-42d3-a456-426614174000',
        type: 'SMS',
        direction: 'outbound',
        from: { phone_number: '+15145550001' },
        to: [{ phone_number: '+15145550002', status: 'delivered' }],
        text: 'STOP',
      },
    };
    expect(() => parseTelnyxEvent(Buffer.from(JSON.stringify({ data })))).toThrow();
    data.payload.direction = 'inbound';
    expect(parseTelnyxEvent(Buffer.from(JSON.stringify({ data }))).text).toBe('STOP');
    data.payload.to.push(data.payload.to[0]);
    expect(() => parseTelnyxEvent(Buffer.from(JSON.stringify({ data })))).toThrow();
  });
});
