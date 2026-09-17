import { describe, it, expect } from 'vitest';
import {
  escapeSlackText,
  formatWebhookBody,
  isWebhookFormat,
  resolveWebhookFormat,
  summarizeWebhookData,
  summaryFields,
  WEBHOOK_FORMATS,
} from './webhook-formats';

const META = { deliveryId: 'dlv_1', occurredAt: '2026-09-17T12:00:00.000Z' };
const DATA = { loadId: 'ld_1', loadNumber: 'LD-000045', carrierId: 'car_1' };

describe('webhook formats', () => {
  it('escapes slack control characters', () => {
    expect(escapeSlackText('a & <b> c')).toBe('a &amp; &lt;b&gt; c');
  });

  it('resolves and validates format values', () => {
    expect(WEBHOOK_FORMATS).toEqual(['json', 'slack', 'teams', 'x12']);
    expect(isWebhookFormat('slack')).toBe(true);
    expect(isWebhookFormat('smoke-signal')).toBe(false);
    expect(resolveWebhookFormat(undefined)).toBe('json');
    expect(resolveWebhookFormat('teams')).toBe('teams');
    expect(resolveWebhookFormat(42)).toBe('json');
  });

  it('summarises only the first 6 scalar fields, in insertion order', () => {
    const data = { a: 1, b: 'two', c: true, nested: { x: 1 }, list: [1], d: 4, e: 5, f: 6, g: 7 };
    expect(summaryFields(data).map((f) => f.key)).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
    expect(summarizeWebhookData(data)).toBe('a: 1 · b: two · c: true · d: 4 · e: 5 · f: 6');
    expect(summarizeWebhookData(null)).toBe('');
    expect(summarizeWebhookData('not an object')).toBe('');
  });

  it('json keeps the historical envelope byte-for-byte', () => {
    const { body, contentType } = formatWebhookBody('load.completed', DATA, 'json', META);
    expect(contentType).toBe('application/json');
    // Exactly what the outbox sent before formats existed — no extra field,
    // same key order (the delivery id lives in the X-Pulsar-Delivery header).
    expect(body).toBe(
      JSON.stringify({ event: 'load.completed', occurredAt: META.occurredAt, data: DATA }),
    );
    expect(JSON.parse(body).deliveryId).toBeUndefined();
  });

  it('slack builds a text line plus one mrkdwn section block', () => {
    const { body, contentType } = formatWebhookBody('load.completed', DATA, 'slack', META);
    expect(contentType).toBe('application/json');
    const parsed = JSON.parse(body);
    expect(parsed.text).toBe(
      'load.completed — loadId: ld_1 · loadNumber: LD-000045 · carrierId: car_1',
    );
    expect(parsed.blocks).toHaveLength(1);
    expect(parsed.blocks[0].type).toBe('section');
    expect(parsed.blocks[0].text.type).toBe('mrkdwn');
    expect(parsed.blocks[0].text.text).toContain('*loadNumber*: LD-000045');
  });

  it('slack degrades to the event name when the payload has no scalar field', () => {
    const parsed = JSON.parse(formatWebhookBody('ping', {}, 'slack', META).body);
    expect(parsed.text).toBe('ping');
    expect(parsed.blocks[0].text.text).toBe('*ping*');
  });

  it('teams builds a minimal MessageCard', () => {
    const { body, contentType } = formatWebhookBody('load.completed', DATA, 'teams', META);
    expect(contentType).toBe('application/json');
    expect(JSON.parse(body)).toEqual({
      '@type': 'MessageCard',
      '@context': 'https://schema.org/extensions',
      summary: 'load.completed',
      title: 'load.completed',
      text: 'loadId: ld_1 · loadNumber: LD-000045 · carrierId: car_1',
    });
  });

  it('x12 ships the raw interchange as text/plain', () => {
    const x12 = 'ISA*00*...~GS*SM*...~ST*214*0001~';
    const { body, contentType } = formatWebhookBody('shipment.status', { x12 }, 'x12', META);
    expect(contentType).toBe('text/plain');
    expect(body).toBe(x12);
  });

  it('slack escapes mrkdwn control characters in the payload', () => {
    const parsed = JSON.parse(
      formatWebhookBody(
        'crm.email.received',
        { from: '<https://evil|x>', note: 'a & b' },
        'slack',
        META,
      ).body,
    );
    expect(parsed.blocks[0].text.text).toContain('&lt;https://evil|x&gt;');
    expect(parsed.blocks[0].text.text).toContain('a &amp; b');
    expect(parsed.blocks[0].text.text).not.toContain('<https://evil');
    expect(parsed.text).not.toContain('<https://evil');
  });

  it('x12 falls back to the readable summary when no interchange is present', () => {
    const { body, contentType } = formatWebhookBody('shipment.status', DATA, 'x12', META);
    expect(contentType).toBe('text/plain');
    expect(body).toContain('shipment.status —');
  });
});
