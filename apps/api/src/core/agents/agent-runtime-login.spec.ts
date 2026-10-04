import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { BadRequestException } from '@nestjs/common';
import { AgentRuntimeService } from './agent-runtime.service';
import { openRemoteProcess, remoteRuntimeEnabled } from './remote-runtime';
import type { LoginEvent } from './login-stream';
import { spawn } from 'node:child_process';
import * as path from 'node:path';

jest.mock('node:child_process', () => ({
  ...jest.requireActual('node:child_process'),
  spawn: jest.fn(),
}));
jest.mock('./runtime-install', () => ({
  isInstalled: () => true,
  repoRoot: () => '/pulsar',
  venvPython: () => '/pulsar/venv/python',
}));

jest.mock('./remote-runtime', () => ({
  remoteRuntimeEnabled: jest.fn(() => true),
  openRemoteProcess: jest.fn(),
  inspectRemoteRuntime: jest.fn(),
}));

function fixture() {
  const child = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: jest.fn(() => true),
  });
  const cfg = {
    resolveForSpawn: jest.fn().mockResolvedValue({
      config: {
        tenantId: 'a',
        provider: 'openai-codex',
        authMode: 'login',
        updatedAt: new Date(0),
      },
      decryptedKey: null,
    }),
    markConnected: jest.fn().mockResolvedValue(undefined),
    hermesHomeRoot: jest.fn(() => '/tenant-homes'),
  };
  (openRemoteProcess as jest.Mock).mockResolvedValue(child);
  (remoteRuntimeEnabled as jest.Mock).mockReturnValue(true);
  const svc = new AgentRuntimeService({} as never, cfg as never);
  return { svc, cfg, child };
}
async function collect(stream: AsyncGenerator<LoginEvent>) {
  const events: LoginEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

describe('tenant OAuth completion contract', () => {
  beforeEach(() => jest.clearAllMocks());
  afterEach(() => jest.restoreAllMocks());

  it('uses the pinned wrapper, isolation, unbuffered UTF-8 and tenant workspace locally', async () => {
    const { svc, child } = fixture();
    (remoteRuntimeEnabled as jest.Mock).mockReturnValue(false);
    (spawn as jest.Mock).mockReturnValue(child);
    jest.spyOn(require('node:fs'), 'mkdirSync').mockReturnValue(undefined);
    const result = collect(svc.connectLogin('a'));
    await new Promise<void>((resolve) => setImmediate(resolve));
    child.emit('close', 0);
    expect((await result).at(-1)).toEqual({ type: 'end' });
    expect(spawn).toHaveBeenCalledWith(
      '/pulsar/venv/python',
      [
        '-I',
        '-u',
        '-X',
        'utf8',
        path.join('/pulsar', 'scripts', 'pulsar-hermes-login.py'),
        'auth',
        'add',
        'openai-codex',
      ],
      expect.objectContaining({
        cwd: path.join('/tenant-homes', 'a', 'workspace'),
        windowsHide: true,
        env: expect.objectContaining({ HERMES_HOME: path.join('/tenant-homes', 'a') }),
      }),
    );
    expect((spawn as jest.Mock).mock.calls[0][2].env).not.toHaveProperty('DATABASE_URL');
    expect(openRemoteProcess).not.toHaveBeenCalled();
  });
  it('only marks the captured configuration connected after explicit runner success', async () => {
    const { svc, child, cfg } = fixture();
    const stream = svc.connectLogin('a');
    expect((await stream.next()).value).toMatchObject({ type: 'status', phase: 'STARTING' });
    const result = collect(stream);
    await new Promise<void>((resolve) => setImmediate(resolve));
    child.stdout.write('{"type":"end"}\n');
    expect(await result).toEqual([
      expect.objectContaining({ type: 'status', phase: 'VERIFYING' }),
      { type: 'end' },
    ]);
    expect(cfg.markConnected).toHaveBeenCalledWith('a', new Date(0));
    expect(openRemoteProcess).toHaveBeenCalledWith(
      'a',
      'login',
      expect.any(Object),
      null,
      expect.any(AbortSignal),
    );
  });

  it.each(['disconnect', 'refused', 'cancel'] as const)(
    'does not mark connected after %s',
    async (mode) => {
      const { svc, child, cfg } = fixture();
      const abort = new AbortController();
      const result = collect(svc.connectLogin('a', abort.signal));
      await new Promise<void>((resolve) => setImmediate(resolve));
      if (mode === 'disconnect') child.stdout.end();
      if (mode === 'refused') child.stdout.write('{"type":"error","code":"LOGIN_EXIT"}\n');
      if (mode === 'cancel') abort.abort();
      const events = await result;
      expect(events.some((event) => event.type === 'end')).toBe(false);
      expect(events.some((event) => event.type === 'error')).toBe(true);
      expect(cfg.markConnected).not.toHaveBeenCalled();
      expect(child.kill).toHaveBeenCalled();
    },
  );

  it('refuses a stale configuration without publishing successful completion', async () => {
    const { svc, child, cfg } = fixture();
    cfg.markConnected.mockRejectedValue(new BadRequestException('La configuration a changé'));
    const result = collect(svc.connectLogin('a'));
    const rejected = expect(result).rejects.toThrow('configuration a changé');
    await new Promise<void>((resolve) => setImmediate(resolve));
    child.stdout.write('{"type":"end"}\n');
    await rejected;
    expect(child.kill).toHaveBeenCalled();
  });

  it('serializes same-tenant logins and aborts the login on application shutdown', async () => {
    const { svc, child, cfg } = fixture();
    const first = collect(svc.connectLogin('a'));
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(await collect(svc.connectLogin('a'))).toEqual([
      expect.objectContaining({ type: 'error', code: 'LOGIN_BUSY' }),
    ]);
    expect(openRemoteProcess).toHaveBeenCalledTimes(1);
    svc.onModuleDestroy();
    expect((await first).some((event) => event.type === 'end')).toBe(false);
    expect(cfg.markConnected).not.toHaveBeenCalled();
    expect(child.kill).toHaveBeenCalled();
  });
});
