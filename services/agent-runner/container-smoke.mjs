// Executed ONLY in an ephemeral --network none container of the production image.
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import net from 'node:net';
import { createRunner } from '/app/runner/server.mjs';
const require = createRequire(import.meta.url);
const { RUNTIME_PROVIDERS } = require('/app/runner/providers.cjs');
assert.equal(process.getuid(), 1000);
const processStatus = readFileSync('/proc/self/status', 'utf8');
assert.match(processStatus, /NoNewPrivs:\s+1/);
assert.match(processStatus, /CapEff:\s+0+\b/);
assert.throws(() => writeFileSync('/app/forbidden', 'no'));
assert.equal(existsSync('/var/run/docker.sock'), false);
assert.equal(process.env.DATABASE_URL, undefined);
if (process.argv.includes('--verify-persistence')) {
  assert.equal(readFileSync('/data/smoke-persistence', 'utf8'), 'fixture-only');
  assert.ok(readdirSync('/data').some((s) => /^[a-f0-9]{64}$/.test(s)));
  console.log('PASS persistent tenant volume survived container recreation');
  process.exit(0);
}
const blocked = await new Promise((resolve) => {
  const socket = net.connect({ host: '1.1.1.1', port: 443 });
  socket.setTimeout(1500);
  socket.on('connect', () => {
    socket.destroy();
    resolve(false);
  });
  socket.on('error', () => resolve(true));
  socket.on('timeout', () => {
    socket.destroy();
    resolve(true);
  });
});
assert.equal(blocked, true);
const token = 'synthetic-validation-token-'.repeat(2);
const metadata = JSON.parse(readFileSync('/app/runner/metadata.json', 'utf8'));
const runner = createRunner({
  tenantId: 'smoke',
  token,
  providers: RUNTIME_PROVIDERS,
  dataDir: '/data',
  python: '/app/hermes-agent/.venv/bin/python',
  wrapper: '/app/scripts/pulsar-hermes-acp.py',
  loginWrapper: '/app/scripts/pulsar-hermes-login.py',
  mcpUrl: 'http://api:3000/api/v1/mcp',
  proxyUrl: 'http://127.0.0.1:9',
  metadata,
});
runner.listen(0, '127.0.0.1');
await once(runner, 'listening');
let req;
try {
  const base = `http://127.0.0.1:${runner.address().port}`;
  const headers = { authorization: `Bearer ${token}`, 'x-pulsar-tenant': 'smoke' };
  const health = await (await fetch(`${base}/v1/health`, { headers })).json();
  assert.equal(health.version, '0.16.0');
  assert.equal(health.pythonVersion, '3.12.13');
  assert.equal(
    (await fetch(`${base}/v1/health`, { headers: { ...headers, 'x-pulsar-tenant': 'other' } }))
      .status,
    401,
  );
  req = http.request(`${base}/v1/acp`, { method: 'POST', headers });
  req.on('error', () => {});
  const response = once(req, 'response');
  req.write(
    JSON.stringify({
      config: {
        tenantId: 'smoke',
        provider: 'custom',
        authMode: 'apiKey',
        baseUrl: 'https://blocked.invalid/v1',
        defaultModel: 'fixture-model',
      },
      apiKey: 'synthetic-not-real',
    }) + '\n',
  );
  const [res] = await response;
  assert.equal(res.statusCode, 200);
  const pending = new Map();
  let buffer = '';
  res.setEncoding('utf8');
  res.on('data', (chunk) => {
    buffer += chunk;
    let nl;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const frame = JSON.parse(buffer.slice(0, nl));
      buffer = buffer.slice(nl + 1);
      if (pending.has(frame.id)) {
        pending.get(frame.id)(frame);
        pending.delete(frame.id);
      }
    }
  });
  let id = 0;
  const rpc = (method, params) =>
    new Promise((resolve, reject) => {
      const rpcId = ++id;
      const timer = setTimeout(() => reject(new Error(`ACP timeout: ${method}`)), 25000);
      pending.set(rpcId, (frame) => {
        clearTimeout(timer);
        resolve(frame);
      });
      req.write(JSON.stringify({ jsonrpc: '2.0', id: rpcId, method, params }) + '\n');
    });
  const initialized = await rpc('initialize', {
    protocolVersion: 1,
    clientCapabilities: {},
    clientInfo: { name: 'pulsar-offline-smoke', version: '1' },
  });
  assert.equal(initialized.result?.protocolVersion, 1);
  const session = await rpc('session/new', { cwd: '/not-used', mcpServers: [] });
  assert.ok(session.result?.sessionId, JSON.stringify(session));
  const foreign = await rpc('session/load', {
    sessionId: 'foreign-session',
    cwd: '/not-used',
    mcpServers: [],
  });
  assert.ok(foreign.error, 'Unknown history must not create a new session');
  req.destroy();
  for (let attempt = 0; attempt < 30; attempt++) {
    const state = await (await fetch(`${base}/v1/health`, { headers })).json();
    if (!state.busy) break;
    if (attempt === 29) throw new Error('Runtime lease did not release');
    await new Promise((r) => setTimeout(r, 100));
  }
  writeFileSync('/data/smoke-persistence', 'fixture-only', { mode: 0o600 });
  console.log(
    'PASS UID, read-only root, no Docker socket, no direct egress, tenant auth, real ACP initialize/new/strict-load/disconnect, persistent home',
  );
} finally {
  req?.destroy();
  runner.stopChildren();
  runner.closeAllConnections();
  runner.close();
}
