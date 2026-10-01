import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { createServer, type Server } from 'node:http';
import { runnerTarget, inspectRemoteRuntime, openRemoteProcess } from './remote-runtime';

describe('tenant-bound remote runtime', () => {
  let dir: string;
  let server: Server | undefined;
  const original = { mode: process.env.AGENT_RUNTIME_MODE, file: process.env.AGENT_RUNNERS_FILE };
  const token = 'a'.repeat(48);
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'pulsar-remote-'));
    process.env.AGENT_RUNTIME_MODE = 'remote';
    process.env.AGENT_RUNNERS_FILE = path.join(dir, 'runners.json');
    writeFileSync(path.join(dir, 'token'), token);
  });
  afterEach(async () => {
    if (server) {
      server.closeAllConnections();
      await new Promise<void>((r) => server!.close(() => r()));
      server = undefined;
    }
    rmSync(dir, { recursive: true });
    if (original.mode === undefined) delete process.env.AGENT_RUNTIME_MODE;
    else process.env.AGENT_RUNTIME_MODE = original.mode;
    if (original.file === undefined) delete process.env.AGENT_RUNNERS_FILE;
    else process.env.AGENT_RUNNERS_FILE = original.file;
  });
  const configure = (dir: string, url: string) =>
    writeFileSync(
      path.join(dir, 'runners.json'),
      JSON.stringify([{ tenantId: 'a', url, tokenFile: path.join(dir, 'token') }]),
    );
  it('does not fall back to another tenant or accept ambiguous mappings', () => {
    configure(dir, 'http://runner:3001');
    expect(runnerTarget('a')?.token).toBe(token);
    expect(runnerTarget('b')).toBeNull();
    writeFileSync(
      process.env.AGENT_RUNNERS_FILE!,
      JSON.stringify([{ tenantId: 'a' }, { tenantId: 'a' }]),
    );
    expect(runnerTarget('a')).toBeNull();
  });
  it('fails closed on URL credentials, missing routing and invalid tokens', () => {
    expect(runnerTarget('a')).toBeNull();
    configure(dir, 'http://user:pass@runner');
    expect(runnerTarget('a')).toBeNull();
    configure(dir, 'http://runner');
    writeFileSync(path.join(dir, 'token'), 'short');
    expect(runnerTarget('a')).toBeNull();
  });
  it('checks runner identity before using metadata', async () => {
    server = createServer((req, res) => {
      expect(req.headers.authorization).toBe(`Bearer ${token}`);
      res.end(JSON.stringify({ protocol: 1, tenantId: 'b', installed: true }));
    });
    await new Promise<void>((r) => server!.listen(0, '127.0.0.1', r));
    configure(dir, `http://127.0.0.1:${(server.address() as { port: number }).port}`);
    expect(await inspectRemoteRuntime('a')).toBeNull();
  });
  it('streams ACP, closes on kill, never retries a broken connection', async () => {
    let requests = 0;
    let received = '';
    server = createServer((req, res) => {
      requests++;
      res.writeHead(200);
      res.flushHeaders();
      req.on('data', (chunk) => {
        received += chunk;
        if (received.includes('initialize')) res.write('{"id":1,"result":{}}\n');
      });
    });
    await new Promise<void>((r) => server!.listen(0, '127.0.0.1', r));
    configure(dir, `http://127.0.0.1:${(server.address() as { port: number }).port}`);
    const child = await openRemoteProcess(
      'a',
      'acp',
      { tenantId: 'a', provider: 'openrouter', authMode: 'apiKey' },
      'provider-test-key',
    );
    const data = new Promise<string>((r) =>
      child.stdout.once('data', (chunk) => r(chunk.toString())),
    );
    child.stdin.write('{"id":1,"method":"initialize"}\n');
    expect(await data).toContain('result');
    const closed = jest.fn();
    child.on('close', closed);
    child.kill();
    child.kill();
    expect(closed).toHaveBeenCalledTimes(1);
    expect(requests).toBe(1);
    expect(received).toContain('provider-test-key');
    expect(received).not.toContain('DATABASE_URL');
  });
});
