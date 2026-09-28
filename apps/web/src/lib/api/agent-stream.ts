import { getAccessToken } from '$lib/stores/auth';
import {
  parseAgentTurnResult,
  failedAgentTurn,
  agentTurnMessage,
  type AgentTurnEvent,
} from '@pulsar/shared';

const BASE = '/api/v1';

/** Parsed frames relayed from the agent-conversation SSE stream. */
export type AgentStreamEvent = AgentTurnEvent;

/**
 * POST a conversation turn and yield parsed SSE events as they arrive.
 *
 * SSE over POST can't use EventSource (GET-only), so we drive a `fetch`
 * stream reader manually: buffer chunks, split on the `\n\n` frame
 * delimiter, parse `event:`/`data:` lines, and yield typed events.
 *
 * Reuses the same Bearer token + `/api/v1` base as the `api()` client.
 */
export async function* streamAgentTurn(
  conversationId: string,
  text: string,
): AsyncGenerator<AgentStreamEvent> {
  const token = getAccessToken();
  let response: Response;
  try {
    response = await fetch(`${BASE}/agent-conversations/${conversationId}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ text }),
    });
  } catch {
    yield* disconnectedStream();
    return;
  }

  if (!response.ok || !response.body) {
    let message = response.statusText || 'Stream request failed';
    try {
      const payload = (await response.json()) as { message?: string | string[] };
      message = Array.isArray(payload?.message)
        ? payload.message.join(', ')
        : (payload?.message ?? message);
    } catch {
      // non-JSON body — keep the status text
    }
    yield { type: 'error', message };
    yield { type: 'result', result: failedAgentTurn('RUNTIME_FAILURE') };
    yield { type: 'end' };
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let hasResult = false;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      buffer = buffer.replace(/\r\n/g, '\n');

      // Frames are separated by a blank line. Keep the trailing partial.
      let sep: number;
      while ((sep = buffer.indexOf('\n\n')) !== -1) {
        const frame = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        const parsed = parseFrame(frame);
        if (parsed?.type === 'result') hasResult = true;
        if (parsed?.type === 'end' && !hasResult) break;
        if (parsed) yield parsed;
      }
    }
    // Flush any final frame left without a trailing blank line.
    const tail = parseFrame(buffer + decoder.decode());
    if (tail?.type === 'result') hasResult = true;
    if (tail && (tail.type !== 'end' || hasResult)) yield tail;
    if (!hasResult) {
      const result = failedAgentTurn('TRANSPORT_CLOSED');
      yield { type: 'error', message: agentTurnMessage(result) };
      yield { type: 'result', result };
      yield { type: 'end' };
    }
  } catch {
    yield* disconnectedStream();
  } finally {
    reader.releaseLock();
  }
}

function* disconnectedStream(): Generator<AgentStreamEvent> {
  const result = failedAgentTurn('TRANSPORT_CLOSED');
  yield { type: 'error', message: agentTurnMessage(result) };
  yield { type: 'result', result };
  yield { type: 'end' };
}

function parseFrame(frame: string): AgentStreamEvent | null {
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
      const value: unknown = JSON.parse(dataText);
      data =
        value && typeof value === 'object' && !Array.isArray(value)
          ? (value as Record<string, unknown>)
          : {};
    } catch {
      data = {};
    }
  }

  switch (event) {
    case 'text':
      return { type: 'text', text: typeof data.text === 'string' ? data.text : '' };
    case 'tool_call':
      return {
        type: 'tool_call',
        name: typeof data.name === 'string' ? data.name : 'tool',
        args: data.args,
      };
    case 'error':
      return {
        type: 'error',
        message: typeof data.message === 'string' ? data.message : 'Agent error',
      };
    case 'end':
      return { type: 'end' };
    case 'result':
      return { type: 'result', result: parseAgentTurnResult(data.result) };
    default:
      return null;
  }
}
