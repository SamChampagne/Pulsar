import { createPublicKey, verify } from 'node:crypto';
import { z } from 'zod';
import { E164_PATTERN, SmsDeliveryStatus } from '@pulsar/shared';

export function verifyTelnyxWebhook(
  raw: Buffer,
  timestamp: string,
  signature: string,
  publicKey: string,
  now = Date.now(),
): boolean {
  if (
    !/^\d{10}$/.test(timestamp) ||
    Math.abs(now / 1000 - Number(timestamp)) > 300 ||
    raw.length > 65536
  )
    return false;
  if (!/^[A-Za-z0-9+/]{43}=$/.test(publicKey) || !/^[A-Za-z0-9+/]{86}==$/.test(signature))
    return false;
  try {
    const key = createPublicKey({
      key: Buffer.concat([
        Buffer.from('302a300506032b6570032100', 'hex'),
        Buffer.from(publicKey, 'base64'),
      ]),
      format: 'der',
      type: 'spki',
    });
    return verify(
      null,
      Buffer.concat([Buffer.from(`${timestamp}|`), raw]),
      key,
      Buffer.from(signature, 'base64'),
    );
  } catch {
    return false;
  }
}

const id = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[a-zA-Z0-9-]+$/);
const phone = z.string().regex(E164_PATTERN);
const eventSchema = z.object({
  data: z.object({
    id,
    event_type: z.enum(['message.received', 'message.finalized']),
    occurred_at: z.string().datetime({ offset: true }),
    payload: z.object({
      id,
      messaging_profile_id: z.string().uuid(),
      type: z.literal('SMS'),
      direction: z.enum(['inbound', 'outbound']),
      from: z.object({ phone_number: phone }),
      to: z.array(z.object({ phone_number: phone, status: z.string().max(80) })).length(1),
      text: z.string().max(10000).optional(),
    }),
  }),
});
export function parseTelnyxEvent(raw: Buffer) {
  const { data } = eventSchema.parse(JSON.parse(raw.toString('utf8')));
  const p = data.payload;
  const inbound = data.event_type === 'message.received';
  if (p.direction !== (inbound ? 'inbound' : 'outbound')) throw new Error('DIRECTION_MISMATCH');
  const status = p.to[0].status;
  return {
    eventId: data.id,
    eventType: data.event_type,
    providerMessageId: p.id,
    messagingProfileId: p.messaging_profile_id,
    fromNumber: p.from.phone_number,
    toNumber: p.to[0].phone_number,
    text: inbound ? (p.text ?? '') : null,
    occurredAt: new Date(data.occurred_at),
    deliveryStatus: inbound
      ? null
      : status === 'delivered'
        ? SmsDeliveryStatus.DELIVERED
        : ['delivery_failed', 'sending_failed', 'failed'].includes(status)
          ? SmsDeliveryStatus.FAILED
          : SmsDeliveryStatus.UNCONFIRMED,
  };
}
