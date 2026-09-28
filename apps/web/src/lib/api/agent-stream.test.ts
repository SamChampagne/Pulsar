import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('$lib/stores/auth', () => ({ getAccessToken: () => 'fixture-token' }));
import { streamAgentTurn } from './agent-stream';

async function read(chunks: string[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      new Response(
        new ReadableStream({
          start(controller) {
            for (const text of chunks) controller.enqueue(new TextEncoder().encode(text));
            controller.close();
          },
        }),
        { status: 200, headers: { 'content-type': 'text/event-stream' } },
      ),
    ),
  );
  const events = [];
  for await (const event of streamAgentTurn('fixture', 'hello')) events.push(event);
  return events;
}
afterEach(() => vi.unstubAllGlobals());
describe('agent SSE terminal result', () => {
  it('marks a network rejection as a typed failure without exposing the raw error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('private-network-detail')));
    const events = [];
    for await (const event of streamAgentTurn('fixture', 'hello')) events.push(event);
    expect(events).toContainEqual({
      type: 'result',
      result: { version: 1, status: 'failed', code: 'TRANSPORT_CLOSED' },
    });
    expect(JSON.stringify(events)).not.toContain('private-network-detail');
  });
  it('marks an HTTP refusal as a typed failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('{"message":"Forbidden"}', { status: 403 })),
    );
    const events = [];
    for await (const event of streamAgentTurn('fixture', 'hello')) events.push(event);
    expect(events).toContainEqual({
      type: 'result',
      result: { version: 1, status: 'failed', code: 'RUNTIME_FAILURE' },
    });
  });
  it('parses split CRLF frames and cancellation as a result, not success', async () => {
    const events = await read([
      'event: result\r',
      '\ndata: {"result":{"version":1,"status":"cancelled"}}\r\n\r\n',
      'event: end\r\ndata: {}\r\n\r\n',
    ]);
    expect(events).toEqual([
      { type: 'result', result: { version: 1, status: 'cancelled', code: 'CANCELLED' } },
      { type: 'end' },
    ]);
  });
  it.each(['event: text\ndata: {"text":"partial"}\n\n', 'event: end\ndata: {}\n\n'])(
    'rejects a stream with no terminal result',
    async (frame) => {
      const events = await read([frame]);
      expect(events.find((e) => e.type === 'result')).toMatchObject({
        result: { status: 'failed', code: 'TRANSPORT_CLOSED' },
      });
    },
  );
  it('fails closed on a malformed result', async () => {
    const events = await read(['event: result\ndata: null\n\n']);
    expect(events[0]).toMatchObject({ type: 'result', result: { status: 'failed' } });
  });
});
