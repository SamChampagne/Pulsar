import { getAccessToken } from '$lib/stores/auth';

const BASE = '/api/v1';

/** Parsed frames from the agent-runtime /connect SSE stream. */
export type RuntimeConnectEvent =
  | { type: 'text'; text: string }
  | { type: 'error'; message: string }
  | { type: 'end' };

/**
 * POST /agent-runtime/connect (empty body) and yield parsed SSE events.
 *
 * Login providers (e.g. Codex) stream a device-code URL via this endpoint.
 * Mirrors agent-stream.ts: same Bearer token source, same fetch+reader+`\n\n`
 * frame parsing, same `event:`/`data:` extraction.
 */
export async function* streamRuntimeConnect(): AsyncGenerator<RuntimeConnectEvent> {
  const token = getAccessToken();
  const response = await fetch(`${BASE}/agent-runtime/connect`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({}),
  });

  if (!response.ok || !response.body) {
    let message = response.statusText || 'Connect request failed';
    try {
      const payload = (await response.json()) as { message?: string | string[] };
      message = Array.isArray(payload?.message)
        ? payload.message.join(', ')
        : (payload?.message ?? message);
    } catch {
      // non-JSON body — keep the status text
    }
    yield { type: 'error', message };
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // Frames are separated by a blank line. Keep the trailing partial.
      let sep: number;
      while ((sep = buffer.indexOf('\n\n')) !== -1) {
        const frame = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        const parsed = parseConnectFrame(frame);
        if (parsed) yield parsed;
      }
    }
    // Flush any final frame left without a trailing blank line.
    const tail = parseConnectFrame(buffer);
    if (tail) yield tail;
  } finally {
    reader.releaseLock();
  }
}

function parseConnectFrame(frame: string): RuntimeConnectEvent | null {
  let event = '';
  const dataLines: string[] = [];
  for (const rawLine of frame.split('\n')) {
    const line = rawLine.replace(/\r$/, '');
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).replace(/^ /, ''));
  }
  if (!event) return null;

  const dataText = dataLines.join('\n');
  let data: Record<string, unknown> = {};
  if (dataText.trim()) {
    try {
      data = JSON.parse(dataText) as Record<string, unknown>;
    } catch {
      data = {};
    }
  }

  switch (event) {
    case 'text':
      return { type: 'text', text: typeof data.text === 'string' ? data.text : '' };
    case 'error':
      return {
        type: 'error',
        message: typeof data.message === 'string' ? data.message : 'Connect error',
      };
    case 'end':
      return { type: 'end' };
    default:
      return null;
  }
}
