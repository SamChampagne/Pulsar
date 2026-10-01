import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { EventEmitter, once } from 'node:events';
import { PassThrough } from 'node:stream';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRunner, validateBoot, constrainFrame, prepareRuntime } from './server.mjs';

const token = 'a'.repeat(48);
const providers = [
  {
    id: 'test',
    authMode: 'apiKey',
    providerKey: 'custom',
    keyEnvVar: 'OPENAI_API_KEY',
    needsBaseUrl: true,
  },
  { id: 'login', authMode: 'login', providerKey: 'nous', loginCommand: 'login' },
];
const config = {
  tenantId: 'tenant-a',
  provider: 'test',
  authMode: 'apiKey',
  defaultModel: 'custom:model',
  baseUrl: 'https://example.com/v1',
};
const boot = { config, apiKey: 'only-this-tenant' };
const headers = { authorization: `Bearer ${token}`, 'x-pulsar-tenant': 'tenant-a' };

async function fixture(t, maxConcurrent = 4) {
  const children = [];
  const preparations = [];
  const runner = createRunner({
    tenantId: 'tenant-a',
    token,
    maxConcurrent,
    providers,
    mcpUrl: 'http://api:3000/api/v1/mcp',
    proxyUrl: 'http://egress:3128',
    metadata: { version: '0.16.0' },
    prepare: (_boot, options) => {
      preparations.push(options.writeConfig);
      return { cwd: '/tenant/work', env: {} };
    },
    spawn: () => {
      const child = new EventEmitter();
      child.stdin = new PassThrough();
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      child.killed = false;
      child.kill = () => {
        if (!child.killed) {
          child.killed = true;
          setImmediate(() => child.emit('close', null));
        }
        return true;
      };
      children.push(child);
      return child;
    },
  });
  runner.listen(0, '127.0.0.1');
  await once(runner, 'listening');
  t.after(() => {
    runner.closeAllConnections();
    runner.stopChildren();
    runner.close();
  });
  const url = `http://127.0.0.1:${runner.address().port}`;
  const start = async (payload = boot, route = 'acp') => {
    const req = http.request(`${url}/v1/${route}`, { method: 'POST', headers });
    req.on('error', () => {});
    t.after(() => req.destroy());
    const response = once(req, 'response');
    req.write(JSON.stringify(payload) + '\n');
    const [res] = await response;
    return { req, res, child: children.at(-1) };
  };
  return { url, start, children, preparations };
}

test('authenticated metadata is bound to exactly one tenant', async (t) => {
  const f = await fixture(t);
  assert.equal((await fetch(`${f.url}/v1/health`)).status, 401);
  assert.equal(
    (await fetch(`${f.url}/v1/health`, { headers: { ...headers, 'x-pulsar-tenant': 'tenant-b' } }))
      .status,
    401,
  );
  const health = await (await fetch(`${f.url}/v1/health`, { headers })).json();
  assert.equal(health.tenantId, 'tenant-a');
  assert.equal(health.installed, true);
  assert.equal(JSON.stringify(health).includes(token), false);
});

test('wrong tenant in boot never spawns a process', async (t) => {
  const f = await fixture(t);
  const { res } = await f.start({ ...boot, config: { ...config, tenantId: 'tenant-b' } });
  assert.equal(res.statusCode, 503);
  assert.equal(f.children.length, 0);
  res.resume();
});

test('ACP uses only Pulsar MCP and server workspace; client disconnect kills the process', async (t) => {
  const f = await fixture(t);
  const { req, res, child } = await f.start();
  assert.equal(res.statusCode, 200);
  res.resume();
  const written = once(child.stdin, 'data');
  req.write(
    JSON.stringify({
      id: 1,
      method: 'session/new',
      params: {
        cwd: '/etc',
        mcpServers: [
          {
            type: 'http',
            name: 'pulsar',
            url: 'https://attacker',
            headers: [{ name: 'X-Agent-Key', value: 'short-session-token' }],
          },
        ],
      },
    }) + '\n',
  );
  const frame = JSON.parse((await written)[0].toString());
  assert.equal(frame.params.cwd, '/tenant/work');
  assert.equal(frame.params.mcpServers[0].url, 'http://api:3000/api/v1/mcp');
  const closed = once(child, 'close');
  req.destroy();
  await closed;
  assert.equal(child.killed, true);
});

test('capacity is bounded and releases on exit', async (t) => {
  const f = await fixture(t, 1);
  const first = await f.start();
  first.res.resume();
  const second = await f.start();
  assert.equal(second.res.statusCode, 409);
  second.res.resume();
  const closed = once(first.child, 'close');
  first.req.destroy();
  await closed;
  const third = await f.start();
  assert.equal(third.res.statusCode, 200);
  third.res.resume();
});

test('four conversations run independently, overflow and configuration changes are refused', async (t) => {
  const f = await fixture(t);
  const running = await Promise.all([f.start(), f.start(), f.start(), f.start()]);
  for (const item of running) {
    assert.equal(item.res.statusCode, 200);
    item.res.resume();
  }
  const health = await (await fetch(`${f.url}/v1/health`, { headers })).json();
  assert.equal(health.activeProcesses, 4);
  assert.equal(health.maxConcurrent, 4);
  assert.deepEqual(f.preparations, [true, false, false, false]);
  const overflow = await f.start();
  assert.equal(overflow.res.statusCode, 409);
  overflow.res.resume();
  const closed = once(f.children[0], 'close');
  running[0].req.destroy();
  await closed;
  assert.equal(f.children[1].killed, false);
  const changed = await f.start({ ...boot, apiKey: 'rotated' });
  assert.equal(changed.res.statusCode, 409);
  changed.res.resume();
  const replacement = await f.start();
  assert.equal(replacement.res.statusCode, 200);
  replacement.res.resume();
});

test('OAuth login is exclusive in both directions', async (t) => {
  const f = await fixture(t);
  const oauth = { config: { ...config, provider: 'login', authMode: 'login', baseUrl: null } };
  const first = await f.start();
  first.res.resume();
  const blockedLogin = await f.start(oauth, 'login');
  assert.equal(blockedLogin.res.statusCode, 409);
  blockedLogin.res.resume();
  const closed = once(first.child, 'close');
  first.req.destroy();
  await closed;
  const login = await f.start(oauth, 'login');
  login.res.resume();
  const blockedChat = await f.start();
  assert.equal(blockedChat.res.statusCode, 409);
  blockedChat.res.resume();
});

test('stdio MCP and malformed frames stop rather than execute', async (t) => {
  const f = await fixture(t);
  const { req, res, child } = await f.start();
  res.resume();
  const closed = once(child, 'close');
  req.write(
    JSON.stringify({
      method: 'session/new',
      params: { mcpServers: [{ type: 'stdio', command: 'sh' }] },
    }) + '\n',
  );
  await closed;
  assert.equal(child.killed, true);
});

test('OAuth streams completion only for exit zero', async (t) => {
  const f = await fixture(t);
  const { res, child } = await f.start(
    { config: { ...config, provider: 'login', authMode: 'login', baseUrl: null }, apiKey: null },
    'login',
  );
  let body = '';
  res.setEncoding('utf8');
  res.on('data', (c) => (body += c));
  const ended = once(res, 'end');
  child.stdout.write('Use device code ABC');
  child.emit('close', 0);
  await ended;
  assert.deepEqual(body.trim().split('\n').map(JSON.parse), [
    { type: 'text', text: 'Use device code ABC' },
    { type: 'end' },
  ]);
});

test('provider input is closed; no HTTP private endpoint or multiline credential', () => {
  assert.throws(() => validateBoot({ ...boot, apiKey: 'a\nb' }, 'tenant-a', providers));
  assert.throws(() =>
    validateBoot(
      { ...boot, config: { ...config, baseUrl: 'http://127.0.0.1' } },
      'tenant-a',
      providers,
    ),
  );
  assert.throws(() =>
    validateBoot({ ...boot, config: { ...config, authMode: 'login' } }, 'tenant-a', providers),
  );
  assert.throws(() =>
    constrainFrame(
      { method: 'session/load', params: { mcpServers: [{ type: 'http', name: 'other' }] } },
      '/w',
      'http://api/mcp',
    ),
  );
});

test('persistent provider homes and closed child environment contain no platform secrets', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'pulsar-runner-test-'));
  try {
    const options = {
      dataDir: dir,
      proxyUrl: 'http://egress:3128',
      mcpUrl: 'http://api:3000/api/v1/mcp',
    };
    const prepared = prepareRuntime(validateBoot(boot, 'tenant-a', providers), options);
    assert.equal(prepared.env.OPENAI_API_KEY, boot.apiKey);
    assert.equal(prepared.env.DATABASE_URL, undefined);
    assert.equal(prepared.env.JWT_SECRET, undefined);
    assert.equal(prepared.env.HOME, prepared.env.HERMES_HOME);
    const yaml = readFileSync(path.join(prepared.env.HOME, 'config.yaml'), 'utf8');
    assert.ok(yaml.includes('default: "model"'));
    assert.ok(!yaml.includes(boot.apiKey));
    const different = prepareRuntime(
      validateBoot(
        { ...boot, config: { ...config, baseUrl: 'https://other.example/v1' } },
        'tenant-a',
        providers,
      ),
      options,
    );
    assert.notEqual(prepared.env.HOME, different.env.HOME);
  } finally {
    rmSync(dir, { recursive: true });
  }
});
