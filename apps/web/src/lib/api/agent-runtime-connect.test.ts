import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('$lib/stores/auth', () => ({ getAccessToken: () => 'fixture-token' }));
import { streamRuntimeConnect, type RuntimeConnectOptions } from './agent-runtime-connect';

async function collect(options?: RuntimeConnectOptions) {
  const events = [];
  for await (const event of streamRuntimeConnect(options)) events.push(event);
  return events;
}
function serve(chunks: string[], close = true) {
  let streamController: ReadableStreamDefaultController<Uint8Array>;
  const cancelled = vi.fn();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      streamController = controller;
      for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
      if (close) controller.close();
    },
    cancel: cancelled,
  });
  const fetch = vi
    .fn()
    .mockResolvedValue(new Response(stream, { headers: { 'content-type': 'text/event-stream' } }));
  vi.stubGlobal('fetch', fetch);
  return {
    fetch,
    cancelled,
    emit: (value: string) => streamController.enqueue(new TextEncoder().encode(value)),
  };
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('bounded runtime login stream', () => {
  it('accepts split CRLF, status and ANSI-free text then a confirmed end', async () => {
    serve([
      'event: status\r',
      '\ndata: {"phase":"STARTING","message":"Préparation"}\r\n\r\n',
      'event: text\ndata: {"text":"\\u001b[94mCODE\\u001b[0m"}\n\n',
      'event: end\ndata: {}\n\n',
    ]);
    expect(await collect()).toEqual([
      { type: 'status', phase: 'STARTING', message: 'Préparation' },
      { type: 'text', text: 'CODE' },
      { type: 'end' },
    ]);
  });
  it('preserves platform path, token, body and cancels transport on early consumer exit', async () => {
    const f = serve(['event: text\ndata: {"text":"instruction"}\n\n'], false);
    for await (const _ of streamRuntimeConnect({
      path: '/platform/fixture/connect',
      token: 'platform-fixture',
      body: { confirmed: true },
    }))
      break;
    expect(f.fetch).toHaveBeenCalledWith(
      '/api/v1/platform/fixture/connect',
      expect.objectContaining({
        body: '{"confirmed":true}',
        headers: expect.objectContaining({ Authorization: 'Bearer platform-fixture' }),
      }),
    );
    expect(f.fetch.mock.calls[0][1].signal.aborted).toBe(true);
    expect(f.cancelled).toHaveBeenCalled();
  });
  it('does not mistake clean EOF or a heartbeat for authentication success', async () => {
    serve([': heartbeat\n\n', 'event: text\ndata: {"text":"En attente"}\n\n']);
    const events = await collect();
    expect(events.at(-1)).toMatchObject({
      type: 'error',
      message: expect.stringContaining('sans confirmation'),
    });
    expect(events.some((e) => e.type === 'end')).toBe(false);
  });
  it.each(['event: end\ndata: null\n\n', 'event: status\ndata: {"phase":"FAKE_SUCCESS"}\n\n'])(
    'fails closed on malformed protocol: %s',
    async (frame) => {
      serve([frame]);
      expect((await collect())[0].type).toBe('error');
    },
  );
  it('accepts a final complete frame without a trailing separator', async () => {
    serve(['event: end\ndata: {}']);
    expect(await collect()).toEqual([{ type: 'end' }]);
  });
  it('never prints HTML or low-level connection details', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('<html>private upstream</html>', { status: 502 })),
    );
    expect(JSON.stringify(await collect())).not.toContain('private upstream');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('secret-network-detail')));
    expect(JSON.stringify(await collect())).not.toContain('secret-network-detail');
  });
  it('refuses a proxy returning HTML with HTTP 200', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response('private page', { headers: { 'content-type': 'text/html' } }),
        ),
    );
    expect(await collect()).toEqual([
      { type: 'error', message: expect.stringContaining('flux de connexion est absent') },
    ]);
  });
  it('bounds initial headers even when fetch ignores abort', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise(() => {})),
    );
    const pending = collect();
    await vi.advanceTimersByTimeAsync(15_001);
    expect(await pending).toEqual([
      { type: 'error', message: expect.stringContaining('ne répond pas') },
    ]);
  });
  it('bounds silence after headers and releases the reader', async () => {
    vi.useFakeTimers();
    const f = serve([], false);
    const pending = collect();
    await vi.advanceTimersByTimeAsync(45_001);
    expect(await pending).toEqual([
      { type: 'error', message: expect.stringContaining('45 secondes') },
    ]);
    expect(f.cancelled).toHaveBeenCalled();
  });
  it('heartbeats postpone silence but never the overall deadline', async () => {
    vi.useFakeTimers();
    const f = serve([], false);
    const pending = collect();
    for (let i = 0; i < 19; i++) {
      await vi.advanceTimersByTimeAsync(30_000);
      f.emit(': heartbeat\n\n');
    }
    await vi.advanceTimersByTimeAsync(30_001);
    expect((await pending).at(-1)).toMatchObject({
      type: 'error',
      message: expect.stringContaining('10 minutes'),
    });
  });
  it('cancellation does not emit success or automatically relaunch', async () => {
    const controller = new AbortController();
    const f = serve([], false);
    const pending = collect({ signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(f.fetch).toHaveBeenCalledTimes(1);
  });
  it('refuses unbounded or repetitive output', async () => {
    serve(['event: text\ndata: {"text":"' + 'x'.repeat(66_000) + '"}\n\n']);
    expect((await collect()).at(-1)).toMatchObject({
      type: 'error',
      message: expect.stringContaining('volumineuse'),
    });
  });
  it('a terminal error prevents later success frames from overriding it', async () => {
    serve(['event: error\ndata: {"message":"Accès refusé"}\n\nevent: end\ndata: {}\n\n']);
    expect(await collect()).toEqual([{ type: 'error', message: 'Accès refusé' }]);
  });
});
