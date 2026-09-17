// Pure, browser-safe. No Node imports.
//
// Outbound webhook body formatting. One delivery row (the outbox) can be shipped
// in several wire formats so a tenant can point an integration straight at a
// Slack/Teams "incoming webhook" or an EDI endpoint without any middleware.

export const WEBHOOK_FORMATS = ['json', 'slack', 'teams', 'x12'] as const;
export type WebhookFormat = (typeof WEBHOOK_FORMATS)[number];

export function isWebhookFormat(value: unknown): value is WebhookFormat {
  return typeof value === 'string' && (WEBHOOK_FORMATS as readonly string[]).includes(value);
}

/** Normalise an arbitrary `config.format` value; anything unknown falls back to `json`. */
export function resolveWebhookFormat(value: unknown): WebhookFormat {
  return isWebhookFormat(value) ? value : 'json';
}

export interface WebhookFormatMeta {
  deliveryId: string;
  occurredAt: string;
  tenantSlug?: string;
}

export interface FormattedWebhookBody {
  body: string;
  contentType: string;
}

/** Max scalar fields rendered in the human-readable one-line summary. */
const SUMMARY_FIELDS = 6;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function isScalar(value: unknown): value is string | number | boolean {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
}

/** `clé: valeur` pairs for the first N scalar fields of the payload (stable order). */
export function summaryFields(data: unknown): Array<{ key: string; value: string }> {
  return Object.entries(asRecord(data))
    .filter(([, v]) => isScalar(v))
    .slice(0, SUMMARY_FIELDS)
    .map(([key, value]) => ({ key, value: String(value) }));
}

/** One-line human summary: `clé: valeur · clé: valeur …` (empty string when nothing scalar). */
export function summarizeWebhookData(data: unknown): string {
  return summaryFields(data)
    .map((f) => `${f.key}: ${f.value}`)
    .join(' · ');
}

/**
 * Build the HTTP body for one delivery attempt.
 *
 * - `json`  — the canonical Pulsar envelope (what every existing consumer reads).
 * - `slack` — Slack incoming-webhook message (`text` + one mrkdwn section block).
 * - `teams` — Microsoft Teams legacy MessageCard (accepted by Teams connectors).
 * - `x12`   — raw EDI interchange taken from `data.x12`, shipped as `text/plain`.
 */
export function formatWebhookBody(
  event: string,
  data: unknown,
  format: WebhookFormat,
  meta: WebhookFormatMeta,
): FormattedWebhookBody {
  const summary = summarizeWebhookData(data);
  const title = summary ? `${event} — ${summary}` : event;

  if (format === 'slack') {
    const fields = summaryFields(data);
    const lines = fields.map((f) => `*${f.key}*: ${f.value}`);
    return {
      contentType: 'application/json',
      body: JSON.stringify({
        text: title,
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: lines.length ? `*${event}*\n${lines.join('\n')}` : `*${event}*`,
            },
          },
        ],
      }),
    };
  }

  if (format === 'teams') {
    return {
      contentType: 'application/json',
      body: JSON.stringify({
        '@type': 'MessageCard',
        '@context': 'https://schema.org/extensions',
        summary: event,
        title: event,
        text: summary || event,
      }),
    };
  }

  if (format === 'x12') {
    const raw = asRecord(data).x12;
    return {
      contentType: 'text/plain',
      // No interchange in the payload: ship the readable summary rather than an
      // empty body, so the endpoint always gets something diagnosable.
      body: typeof raw === 'string' && raw.length > 0 ? raw : title,
    };
  }

  return {
    contentType: 'application/json',
    body: JSON.stringify({
      event,
      deliveryId: meta.deliveryId,
      occurredAt: meta.occurredAt,
      ...(meta.tenantSlug ? { tenantSlug: meta.tenantSlug } : {}),
      data,
    }),
  };
}
