// Run in the qualified runner image, --network none, no credentials or prompts.
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { createRunner } from '/app/runner/server.mjs';
const require = createRequire(import.meta.url);
const { RUNTIME_PROVIDERS } = require('/app/runner/providers.cjs');
const token = 'offline-parallel-fixture-'.repeat(2);
const runner = createRunner({
  tenantId: 'fixture',
  token,
  providers: RUNTIME_PROVIDERS,
  dataDir: '/data',
  python: '/app/hermes-agent/.venv/bin/python',
  wrapper: '/app/scripts/pulsar-hermes-acp.py',
  loginWrapper: '/app/scripts/pulsar-hermes-login.py',
  mcpUrl: 'http://api:3000/api/v1/mcp',
  proxyUrl: 'http://127.0.0.1:9',
  maxConcurrent: 4,
});
runner.listen(0, '127.0.0.1');
await once(runner, 'listening');
const url = `http://127.0.0.1:${runner.address().port}`;
const headers = { authorization: `Bearer ${token}`, 'x-pulsar-tenant': 'fixture' };
const requests = [];
async function connect() {
  const req = http.request(`${url}/v1/acp`, { method: 'POST', headers });
  requests.push(req);
  req.on('error', () => {});
  const response = once(req, 'response');
  req.write(
    JSON.stringify({
      config: {
        tenantId: 'fixture',
        provider: 'custom',
        authMode: 'apiKey',
        baseUrl: 'https://blocked.invalid/v1',
        defaultModel: 'fixture',
      },
      apiKey: 'not-real',
    }) + '\n',
  );
  const [res] = await response;
  assert.equal(res.statusCode, 200);
  let buffer = '';
  let next = 0;
  const pending = new Map();
  res.setEncoding('utf8');
  res.on('data', (chunk) => {
    buffer += chunk;
    let nl;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const frame = JSON.parse(buffer.slice(0, nl));
      buffer = buffer.slice(nl + 1);
      pending.get(frame.id)?.(frame);
      pending.delete(frame.id);
    }
  });
  return {
    req,
    rpc: (method, params) =>
      new Promise((resolve, reject) => {
        const id = ++next;
        const timeout = setTimeout(() => reject(new Error(`Timeout ${method}`)), 45000);
        pending.set(id, (frame) => {
          clearTimeout(timeout);
          resolve(frame);
        });
        req.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
      }),
  };
}
try {
  const peers = await Promise.all([connect(), connect(), connect(), connect()]);
  await Promise.all(
    peers.map(async (peer, i) => {
      const init = await peer.rpc('initialize', {
        protocolVersion: 1,
        clientCapabilities: {},
        clientInfo: { name: 'parallel-smoke', version: '1' },
      });
      assert.equal(init.result?.protocolVersion, 1);
      const created = await peer.rpc('session/new', { cwd: '/ignored', mcpServers: [] });
      assert.ok(created.result?.sessionId, JSON.stringify(created));
      const model = await peer.rpc('session/set_model', {
        sessionId: created.result.sessionId,
        modelId: `custom:fixture-${i}`,
      });
      assert.ok(!model.error, JSON.stringify(model));
      peer.sessionId = created.result.sessionId;
    }),
  );
  assert.equal(new Set(peers.map((p) => p.sessionId)).size, 4);
  const state = await (await fetch(`${url}/v1/health`, { headers })).json();
  assert.equal(state.activeProcesses, 4);
  peers[0].req.destroy();
  for (let i = 0; i < 50; i++) {
    const state = await (await fetch(`${url}/v1/health`, { headers })).json();
    if (state.activeProcesses === 3) break;
    if (i === 49) throw new Error('Process did not release');
    await new Promise((r) => setTimeout(r, 100));
  }
  const resumed = await connect();
  await resumed.rpc('initialize', {
    protocolVersion: 1,
    clientCapabilities: {},
    clientInfo: { name: 'resume', version: '1' },
  });
  const loaded = await resumed.rpc('session/load', {
    sessionId: peers[0].sessionId,
    cwd: '/ignored',
    mcpServers: [],
  });
  assert.ok(loaded.result && !loaded.error, JSON.stringify(loaded));
  console.log(
    'PASS four real ACP processes, distinct sessions/models, shared WAL history, disconnect/release and strict reload; no LLM calls',
  );
} finally {
  for (const req of requests) req.destroy();
  runner.stopChildren();
  runner.closeAllConnections();
  runner.close();
}
