import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { streamLoginProcess, type LoginEvent } from './login-stream';

function child() {
  const process = new EventEmitter() as EventEmitter & {
    stdout: PassThrough;
    stderr: PassThrough;
    kill: jest.Mock;
  };
  process.stdout = new PassThrough();
  process.stderr = new PassThrough();
  process.kill = jest.fn(() => {
    process.emit('close', null);
    return true;
  });
  return process;
}
async function collect(stream: AsyncGenerator<LoginEvent>) {
  const events: LoginEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

describe('bounded OAuth login process stream', () => {
  afterEach(() => jest.useRealTimers());

  it('streams an unterminated prompt and split UTF-8 before process exit', async () => {
    const process = child();
    const stream = streamLoginProcess(process, 'text');
    const first = stream.next();
    const prompt = Buffer.from('Code été: ABC');
    process.stdout.write(prompt.subarray(0, 6));
    expect((await first).value).toMatchObject({ type: 'status', phase: 'WAITING_AUTHORIZATION' });
    const events = [(await stream.next()).value as LoginEvent];
    process.stdout.write(prompt.subarray(6));
    events.push((await stream.next()).value as LoginEvent);
    expect(events.map((event) => event.text).join('')).toBe('Code été: ABC');
    process.emit('close', 0);
    expect((await stream.next()).value).toEqual({ type: 'end' });
    expect((await stream.next()).done).toBe(true);
    expect(process.kill).not.toHaveBeenCalled();
  });

  it.each(['abort', 'timeout', 'overflow', 'spawn', 'exit'] as const)(
    'terminates %s without a success event and stops a still-running child',
    async (mode) => {
      jest.useFakeTimers();
      const process = child();
      const abort = new AbortController();
      const result = collect(streamLoginProcess(process, 'text', abort.signal, 100));
      if (mode === 'abort') abort.abort();
      if (mode === 'timeout') jest.advanceTimersByTime(101);
      if (mode === 'overflow') process.stdout.write('é'.repeat(32769));
      if (mode === 'spawn') process.emit('error', new Error('private crash detail'));
      if (mode === 'exit') process.emit('close', 1);
      expect(await result).toEqual([
        expect.objectContaining({
          type: 'error',
          code: {
            abort: 'LOGIN_CANCELLED',
            timeout: 'LOGIN_TIMEOUT',
            overflow: 'LOGIN_OUTPUT_LIMIT',
            spawn: 'LOGIN_PROCESS',
            exit: 'LOGIN_EXIT',
          }[mode],
        }),
      ]);
      if (mode !== 'exit') expect(process.kill).toHaveBeenCalledWith('SIGTERM');
      expect(JSON.stringify(await result)).not.toContain('private crash detail');
      expect(jest.getTimerCount()).toBe(0);
    },
  );

  it('decodes fragmented NDJSON and only accepts explicit completion', async () => {
    const process = child();
    const result = collect(streamLoginProcess(process, 'ndjson'));
    const frame = Buffer.from(JSON.stringify({ type: 'text', text: 'été' }) + '\r\n');
    process.stdout.write(frame.subarray(0, 24));
    process.stdout.write(frame.subarray(24));
    process.stdout.write('{"type":"end"}\n');
    expect(await result).toEqual([
      expect.objectContaining({ type: 'status', phase: 'WAITING_AUTHORIZATION' }),
      { type: 'text', text: 'été' },
      { type: 'end' },
    ]);
  });

  it.each(['eof', 'invalid', 'unknown', 'remote-error'] as const)(
    'rejects %s safely',
    async (mode) => {
      const process = child();
      const result = collect(streamLoginProcess(process, 'ndjson'));
      if (mode === 'eof') process.stdout.end();
      if (mode === 'invalid') process.stdout.write('not-json\n');
      if (mode === 'unknown') process.stdout.write('{"type":"download-secrets"}\n');
      if (mode === 'remote-error')
        process.stdout.write('{"type":"error","code":"LOGIN_TIMEOUT","message":"private-token"}\n');
      const events = await result;
      expect(events).toEqual([
        expect.objectContaining({
          type: 'error',
          code:
            mode === 'eof'
              ? 'LOGIN_INTERRUPTED'
              : mode === 'remote-error'
                ? 'LOGIN_TIMEOUT'
                : 'LOGIN_PROTOCOL',
        }),
      ]);
      expect(JSON.stringify(events)).not.toContain('private-token');
    },
  );

  it('stops the producer when the consumer abandons the stream', async () => {
    const process = child();
    const stream = streamLoginProcess(process, 'text');
    const next = stream.next();
    process.stdout.write('code');
    await next;
    await stream.return(undefined);
    expect(process.kill).toHaveBeenCalledWith('SIGTERM');
  });
});
