import { EventEmitter } from 'node:events';
import { RuntimeConfigController } from './runtime-config.controller';
import { LOGIN_TIMEOUT_MS } from './login-stream';
import { PlatformServicesController } from '../platform/platform-services.controller';

let surface: 'tenant' | 'platform';

function fixture(
  connectLogin: unknown,
  authorizeRuntimeAction = jest.fn().mockResolvedValue(undefined),
) {
  const controller = new RuntimeConfigController(
    {} as never,
    { connectLogin } as never,
    {} as never,
    {} as never,
  );
  const response = Object.assign(new EventEmitter(), {
    destroyed: false,
    writableEnded: false,
    setHeader: jest.fn(),
    flushHeaders: jest.fn(),
    write: jest.fn(),
    end: jest.fn(function (this: { writableEnded: boolean }) {
      this.writableEnded = true;
    }),
  });
  const platform = new PlatformServicesController(
    {
      authorizeRuntimeAction,
      connectRuntime: connectLogin,
    } as never,
    {} as never,
  );
  const run = () =>
    surface === 'tenant'
      ? controller.connect({ tenantId: 'tenant-a' } as never, response as never)
      : platform.connect(
          { user: { id: 'operator' } } as never,
          'tenant-a',
          {} as never,
          response as never,
        );
  return { run, response };
}

describe.each(['tenant', 'platform'] as const)('OAuth SSE response: %s', (kind) => {
  beforeEach(() => {
    surface = kind;
  });
  afterEach(() => jest.useRealTimers());

  it.each(['destroyed', 'writableEnded'] as const)(
    'never starts OAuth when the response is already %s',
    async (state) => {
      jest.useFakeTimers();
      const connect = jest.fn(async function* () {
        yield { type: 'end' };
      });
      const { run, response } = fixture(connect);
      response[state] = true;
      await run();
      expect(connect).not.toHaveBeenCalled();
      expect(response.setHeader).not.toHaveBeenCalled();
      expect(response.listenerCount('close')).toBe(0);
      expect(jest.getTimerCount()).toBe(0);
    },
  );

  it('rechecks a connection closed while flushing the headers before attaching close listener', async () => {
    jest.useFakeTimers();
    const connect = jest.fn(async function* () {
      yield { type: 'end' };
    });
    const { run, response } = fixture(connect);
    response.flushHeaders.mockImplementation(() => {
      response.destroyed = true;
      response.emit('close');
    });
    await run();
    expect(connect).not.toHaveBeenCalled();
    expect(response.listenerCount('close')).toBe(0);
    expect(jest.getTimerCount()).toBe(0);
  });
  it('flushes SSE headers, reports stages, heartbeats and one completion', async () => {
    jest.useFakeTimers();
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const { run, response } = fixture(async function* () {
      yield { type: 'status', phase: 'STARTING', message: 'starting' };
      await pending;
      yield { type: 'text', text: 'Code ABC' };
      yield { type: 'end' };
    });
    const done = run();
    for (let tick = 0; tick < 5; tick++) await Promise.resolve();
    jest.advanceTimersByTime(15000);
    expect(response.setHeader).toHaveBeenCalledWith('X-Accel-Buffering', 'no');
    expect(response.flushHeaders).toHaveBeenCalled();
    expect(response.write).toHaveBeenCalledWith(': heartbeat\n\n');
    finish();
    await done;
    const body = response.write.mock.calls.flat().join('');
    expect(body).toContain('event: status');
    expect(body).toContain('Code ABC');
    expect(body.match(/event: end/g)).toHaveLength(1);
    expect(body).not.toContain('event: error');
    expect(response.end).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('aborts work on client disconnect and sends no further events', async () => {
    let signal!: AbortSignal;
    const { run, response } = fixture(async function* (_tenant: string, incoming: AbortSignal) {
      signal = incoming;
      await new Promise<void>((resolve) => incoming.addEventListener('abort', () => resolve()));
    });
    const done = run();
    for (let tick = 0; tick < 5; tick++) await Promise.resolve();
    response.destroyed = true;
    response.emit('close');
    await done;
    expect(signal.aborted).toBe(true);
    expect(response.write).not.toHaveBeenCalled();
  });

  it('terminates silently hung OAuth after the backend deadline', async () => {
    jest.useFakeTimers();
    const { run, response } = fixture(async function* (_tenant: string, signal: AbortSignal) {
      await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve()));
    });
    const done = run();
    for (let tick = 0; tick < 5; tick++) await Promise.resolve();
    jest.advanceTimersByTime(LOGIN_TIMEOUT_MS);
    await done;
    const errors = response.write.mock.calls
      .flat()
      .filter((value: string) => value.includes('event: error'));
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('LOGIN_TIMEOUT');
    expect(response.end).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  });

  it.each(['eof', 'exception'])(
    'does not claim success for %s or disclose raw errors',
    async (mode) => {
      const { run, response } = fixture(async function* () {
        if (mode === 'exception') throw new Error('secret-api-key in file /private/token');
      });
      await run();
      const body = response.write.mock.calls.flat().join('');
      expect(body).toContain('event: error');
      expect(body).not.toContain('event: end');
      expect(body).not.toContain('secret-api-key');
      expect(body).not.toContain('/private/token');
    },
  );

  it.each(['error', 'end'] as const)('ignores every event after terminal %s', async (terminal) => {
    const { run, response } = fixture(async function* () {
      yield { type: terminal, message: 'first result' };
      yield { type: 'text', text: 'must not leak late device code' };
      yield { type: 'end' };
      throw new Error('late error');
    });
    await run();
    const body = response.write.mock.calls.flat().join('');
    expect(body.match(/event: (end|error)/g)).toHaveLength(1);
    expect(body).not.toContain('must not leak');
    expect(body).not.toContain('late error');
  });
});

describe('platform OAuth authorization boundary', () => {
  it('does not launch a runner when the client disconnects during awaited authorization', async () => {
    surface = 'platform';
    let authorize!: () => void;
    const pending = new Promise<void>((resolve) => {
      authorize = resolve;
    });
    const authorizeRuntimeAction = jest.fn(() => pending);
    const connect = jest.fn(async function* () {
      yield { type: 'end' };
    });
    const { run, response } = fixture(connect, authorizeRuntimeAction);
    const done = run();
    expect(authorizeRuntimeAction).toHaveBeenCalledTimes(1);
    response.destroyed = true;
    response.emit('close');
    authorize();
    await done;
    expect(connect).not.toHaveBeenCalled();
    expect(response.setHeader).not.toHaveBeenCalled();
    expect(response.write).not.toHaveBeenCalled();
    expect(response.listenerCount('close')).toBe(0);
  });
});
