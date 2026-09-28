/** Offline ACP contract: real Hermes + Pulsar client, synthetic LLM/MCP.
 * No real tenant, key, model, business operation or provider connection.
 * Build the API first. Usage: node scripts/qualify-agent-runtime.mjs <checkout>
 * Candidate dependencies: uv sync --frozen --no-dev --extra acp --extra mcp.
 * --installed-reference tests the pinned active interpreter without installing.
 */
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir, networkInterfaces } from 'node:os';
import { verifyRuntimeSource } from './runtime-source-manifest.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const containerReference = process.argv[2] === '--container-reference';
const installedReference = process.argv[2] === '--installed-reference' || containerReference;
const candidate = installedReference
  ? path.join(root, 'hermes-agent')
  : path.resolve(process.argv[2] || 'MISSING_CANDIDATE');
const reference = installedReference
  ? '740ea2ff502ebce5365f565b4b9973ae958c6541'
  : 'f97608f178d1ffeca59860195ab7da295f7c8e5f';
const git = (...args) =>
  execFileSync('git', ['-C', candidate, ...args], { encoding: 'utf8', windowsHide: true }).trim();
const assertSource = () => {
  if (containerReference) {
    verifyRuntimeSource(
      candidate,
      JSON.parse(
        readFileSync(path.join(root, 'deploy/agents/runtime-manifest.generated.json'), 'utf8'),
      ),
    );
  } else {
    assert.equal(git('rev-parse', 'HEAD'), reference, 'Unexpected candidate commit');
    assert.equal(
      git('status', '--porcelain', '--untracked-files=no'),
      '',
      'Candidate tracked source changed',
    );
  }
};
assertSource();
if (containerReference) {
  assert.equal(process.platform, 'linux');
  assert.notEqual(process.getuid(), 0);
  assert.ok(
    Object.values(networkInterfaces())
      .flat()
      .every((entry) => entry.internal),
    'External network interface present',
  );
  const status = readFileSync('/proc/self/status', 'utf8');
  assert.match(status, /NoNewPrivs:\s+1/);
  assert.match(status, /CapEff:\s+0+\s/);
  assert.throws(() => writeFileSync(path.join(root, 'must-not-write'), 'blocked'));
  console.log(
    'PASS Linux non-root / no external network / read-only / no capabilities or privilege escalation',
  );
}
if (!installedReference)
  assert.notEqual(
    candidate.toLowerCase(),
    path.join(root, 'hermes-agent').toLowerCase(),
    'Never qualify in the active runtime',
  );
const python = path.join(
  candidate,
  '.venv',
  process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python',
);
const require = createRequire(import.meta.url);
const { HermesAcpClient } = require(
  path.join(root, 'apps/api/dist/core/agents/hermes-acp.client.js'),
);
const { isolatedRuntimeEnv } = require(
  path.join(root, 'apps/api/dist/core/agents/agent-runtime-env.js'),
);
const workspace = mkdtempSync(path.join(tmpdir(), 'pulsar-hermes-contract-'));
const inspectDependencies = () =>
  JSON.parse(
    execFileSync(
      python,
      [
        '-I',
        '-c',
        'import json,platform,sqlite3; from importlib.metadata import distributions; print(json.dumps({"python":platform.python_version(),"sqlite":sqlite3.sqlite_version,"packages":sorted((d.metadata["Name"],d.version) for d in distributions())}))',
      ],
      { encoding: 'utf8', windowsHide: true, env: isolatedRuntimeEnv({ HERMES_HOME: workspace }) },
    ),
  );
const dependenciesBefore = inspectDependencies();
const checks = [],
  children = new Set(),
  providerRequests = [],
  mcpCalls = [];
let fixtureFailure, waiting;
const waitStarted = new Promise((resolve) => {
  waiting = resolve;
});
const fixtureTool = installedReference ? 'mcp_pulsar_read_fixture' : 'mcp__pulsar__read_fixture';
const tool = {
  name: 'read_fixture',
  description: 'Read a synthetic qualification marker',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
};

function json(res, body, status = 200) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}
function completion(res, request, message, finishReason) {
  const base = { id: 'fixture-completion', created: 1, model: request.model };
  if (request.stream) {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const delta = message.tool_calls
      ? { role: 'assistant', tool_calls: message.tool_calls.map((t, index) => ({ index, ...t })) }
      : message;
    for (const chunk of [
      {
        ...base,
        object: 'chat.completion.chunk',
        choices: [{ index: 0, delta, finish_reason: null }],
      },
      {
        ...base,
        object: 'chat.completion.chunk',
        choices: [{ index: 0, delta: {}, finish_reason: finishReason }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      },
    ])
      res.write(`data: ${JSON.stringify(chunk)}\n\n`);
    res.end('data: [DONE]\n\n');
  } else
    json(res, {
      ...base,
      object: 'chat.completion',
      choices: [{ index: 0, message, finish_reason: finishReason }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    });
}
const server = createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url === '/v1/models')
      return json(res, {
        object: 'list',
        data: ['fixture-model', 'fixture-model-2'].map((id) => ({
          id,
          object: 'model',
          owned_by: 'fixture',
        })),
      });
    if (req.method !== 'POST') {
      res.writeHead(405);
      return res.end();
    }
    let raw = '';
    for await (const chunk of req) {
      raw += chunk;
      assert.ok(raw.length < 2_000_000, 'Fixture request too large');
    }
    const body = JSON.parse(raw);
    // Optional Ollama metadata probe against an OpenAI-compatible local URL.
    if (req.url === '/api/show') return json(res, { error: 'Not an Ollama server' }, 404);
    if (req.url?.startsWith('/mcp/')) {
      const tenant = req.url.slice('/mcp/'.length);
      assert.equal(req.headers['x-agent-key'], `fixture-${tenant}`);
      if (body.id === undefined) {
        res.writeHead(202);
        return res.end();
      }
      let result;
      if (body.method === 'initialize')
        result = {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'pulsar-fixture', version: '1' },
        };
      else if (body.method === 'tools/list') result = { tools: [tool] };
      else if (body.method === 'tools/call') {
        assert.equal(body.params.name, 'read_fixture');
        mcpCalls.push(tenant);
        result = { content: [{ type: 'text', text: `TENANT_${tenant}` }] };
      } else
        return json(res, {
          jsonrpc: '2.0',
          id: body.id,
          error: { code: -32601, message: 'Fixture method unavailable' },
        });
      return json(res, { jsonrpc: '2.0', id: body.id, result });
    }
    assert.equal(req.url, '/v1/chat/completions', 'Unexpected provider endpoint');
    const names = (body.tools || []).map((t) => t.function.name).sort();
    assert.deepEqual(names, [fixtureTool], 'Host/unrelated tools exposed, or Pulsar MCP missing');
    providerRequests.push({ model: body.model, tools: names });
    const lastUser = body.messages.findLast((m) => m.role === 'user');
    const content = JSON.stringify(lastUser?.content);
    if (content.includes('PROVIDER_ERROR_PROBE'))
      return json(
        res,
        {
          error: { message: 'QUALIFICATION_SYNTHETIC_REJECTION', type: 'invalid_request_error' },
        },
        400,
      );
    if (content.includes('WAIT_FOR_CANCEL')) {
      waiting(); // Parent cancels while the HTTP inference is in flight.
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write(': fixture waiting\n\n');
      return;
    }
    const last = body.messages.at(-1);
    if (last.role === 'tool')
      return completion(
        res,
        body,
        { role: 'assistant', content: `QUALIFIED ${last.content}` },
        'stop',
      );
    return completion(
      res,
      body,
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: `call_${providerRequests.length}`,
            type: 'function',
            function: { name: fixtureTool, arguments: '{}' },
          },
        ],
      },
      'tool_calls',
    );
  } catch (error) {
    fixtureFailure ??= error;
    json(
      res,
      {
        error: {
          message: 'Qualification fixture rejected the request',
          type: 'invalid_request_error',
        },
      },
      400,
    );
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;

async function bounded(promise, label, ms = 35000) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Timeout: ${label}`)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
function homeFor(tenant) {
  const home = path.join(workspace, tenant);
  mkdirSync(path.join(home, 'workspace'), { recursive: true });
  writeFileSync(path.join(home, 'PULSAR_QUALIFICATION_ONLY'), 'Synthetic data only');
  writeFileSync(
    path.join(home, 'config.yaml'),
    `model:\n  provider: custom\n  default: fixture-model\n  base_url: http://127.0.0.1:${port}/v1\n  api_mode: chat_completions\n  context_length: 128000\nsecurity:\n  allow_lazy_installs: false\ntools:\n  tool_search:\n    enabled: "off"\nauxiliary:\n  title_generation:\n    enabled: false\nagent:\n  reasoning_effort: none\ncompression:\n  enabled: false\nmemory:\n  memory_enabled: false\n  user_profile_enabled: false\n`,
  );
  return home;
}
const homes = { A: homeFor('A'), B: homeFor('B') };
function start(tenant) {
  const home = homes[tenant];
  const child = spawn(
    python,
    ['-I', path.join(root, 'scripts/fixtures/hermes-qualification-entry.py'), candidate],
    {
      cwd: path.join(home, 'workspace'),
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...isolatedRuntimeEnv({
          HERMES_HOME: home,
          OPENAI_API_KEY: 'fixture-not-a-real-key',
          OPENAI_BASE_URL: `http://127.0.0.1:${port}/v1`,
        }),
        PULSAR_FIXTURE_PORT: String(port),
        HERMES_DISABLE_LAZY_INSTALLS: '1',
        HERMES_ACP_SKIP_CONFIGURED_MCP: '1',
      },
    },
  );
  children.add(child);
  let stderr = '';
  child.stderr.on('data', (chunk) => {
    stderr = (stderr + chunk).slice(-100000);
  });
  child.on('error', (error) => {
    fixtureFailure ??= error;
  });
  child.stdin.on('error', () => {});
  child.on('close', () => {
    children.delete(child);
    writeFileSync(path.join(home, 'runtime-stderr.log'), stderr);
  });
  const client = new HermesAcpClient(HermesAcpClient.stdioTransport(child));
  return {
    child,
    client,
    cfg: {
      cwd: path.join(home, 'workspace'),
      mcpServers: [
        {
          type: 'http',
          name: 'pulsar',
          url: `http://127.0.0.1:${port}/mcp/${tenant}`,
          headers: [{ name: 'X-Agent-Key', value: `fixture-${tenant}` }],
        },
      ],
    },
  };
}
async function stop(runtime) {
  if (runtime.child.exitCode !== null || runtime.child.signalCode !== null) return;
  const closed = new Promise((resolve) => runtime.child.once('close', resolve));
  runtime.child.kill();
  await bounded(closed, 'child shutdown', 5000);
}
async function turn(client, sessionId, prompt, expected = 'succeeded') {
  const events = [];
  for await (const event of client.prompt(sessionId, prompt)) events.push(event);
  assert.ok(!events.some((e) => e.type === 'error'), JSON.stringify(events));
  const results = events.filter((e) => e.type === 'result');
  assert.equal(results.length, 1);
  assert.equal(results[0].result.status, expected);
  return events
    .filter((e) => e.type === 'text')
    .map((e) => e.text)
    .join('');
}
function passed(name) {
  checks.push(name);
  console.log(`PASS ${name}`);
}

try {
  let a = start('A');
  await bounded(a.client.initialize(), 'initialize');
  passed('real ACP initialize / protocol 1');
  const { sessionId } = await bounded(a.client.newSession(a.cfg), 'new session');
  await bounded(a.client.setModel(sessionId, 'fixture-model-2'), 'set model');
  passed('real new session + model rebuild');
  assert.match(
    await bounded(turn(a.client, sessionId, 'QUALIFY A'), 'first prompt'),
    /QUALIFIED.*TENANT_A/s,
  );
  assert.equal(providerRequests.at(-1).model, 'fixture-model-2');
  passed('prompt + governed MCP tool round-trip after model rebuild');
  await stop(a);
  a = start('A');
  await bounded(a.client.initialize(), 'restart');
  assert.equal(
    (await bounded(a.client.resumeSession(a.cfg, sessionId), 'load persisted history')).sessionId,
    sessionId,
  );
  assert.match(
    await bounded(turn(a.client, sessionId, 'QUALIFY A again'), 'resumed prompt'),
    /QUALIFIED.*TENANT_A/s,
  );
  passed('persisted history reload in a fresh process + MCP preserved');
  const b = start('B');
  await bounded(b.client.initialize(), 'tenant B initialize');
  await assert.rejects(
    bounded(b.client.resumeSession(b.cfg, sessionId), 'cross-home load'),
    /history unavailable|not found|Invalid/i,
  );
  const bSession = await bounded(b.client.newSession(b.cfg), 'tenant B session');
  assert.match(
    await bounded(turn(b.client, bSession.sessionId, 'QUALIFY B'), 'tenant B prompt'),
    /QUALIFIED.*TENANT_B/s,
  );
  passed('separate homes/processes: foreign history refused, own MCP marker only');
  // Provider rejection must be typed and sanitized, never assistant prose.
  const errorEvents = [];
  await bounded(
    (async () => {
      for await (const event of b.client.prompt(bSession.sessionId, 'PROVIDER_ERROR_PROBE'))
        errorEvents.push(event);
    })(),
    'provider rejection',
  );
  const rejection = errorEvents
    .filter((event) => event.type === 'text')
    .map((event) => event.text)
    .join('');
  assert.ok(!rejection.includes('QUALIFICATION_SYNTHETIC_REJECTION'));
  assert.ok(
    errorEvents.some((event) => event.type === 'error'),
    'Provider failure was not signalled',
  );
  assert.equal(errorEvents.find((e) => e.type === 'result')?.result.status, 'failed');
  passed('provider HTTP 400 is a typed failure, raw diagnostic suppressed');
  const knownGaps = [
    'Production runner isolation/egress/tenant credentials and authorized business-model evaluation still required.',
    'Offline qualification image is not a deployable Pulsar AI service.',
  ];
  await stop(b);
  const cancelled = turn(a.client, sessionId, 'WAIT_FOR_CANCEL', 'cancelled');
  await bounded(waitStarted, 'cancellable inference start');
  a.client.cancel(sessionId);
  await bounded(cancelled, 'ACP cancellation', 10000);
  passed('ACP cancel settles in-flight prompt (synthetic streaming provider)');
  await stop(a);
  await assert.rejects(a.client.newSession(a.cfg), /transport closed/);
  passed('closed transport fails immediately');
  if (fixtureFailure) throw fixtureFailure;
  assert.ok(mcpCalls.includes('A') && mcpCalls.includes('B'));
  assert.deepEqual(inspectDependencies(), dependenciesBefore, 'Dependencies mutated at runtime');
  assertSource();
  passed('dependency inventory and tracked candidate source unchanged');
  console.log(
    JSON.stringify(
      {
        scope: 'OFFLINE_CONTRACT_ONLY',
        operatingSystem: process.platform,
        containment: containerReference ? 'OFFLINE_CONTAINER_ONLY' : 'PROCESS_TEST_ONLY',
        productionPromotion: 'BLOCKED',
        knownGaps,
        candidate: reference,
        lockSha256: createHash('sha256')
          .update(readFileSync(path.join(candidate, 'uv.lock')))
          .digest('hex'),
        checks,
        providerRequests: providerRequests.length,
        liveProviderCalls: 0,
        productionRuntimeChanged: false,
        python: dependenciesBefore.python,
        sqlite: dependenciesBefore.sqlite,
        runtimePackages: dependenciesBefore.packages.filter(([name]) =>
          ['hermes-agent', 'agent-client-protocol', 'mcp'].includes(name),
        ),
        dependencyInventorySha256: createHash('sha256')
          .update(JSON.stringify(dependenciesBefore))
          .digest('hex'),
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.error(`FAIL ${error.message}`);
  if (error.data) console.error(JSON.stringify(error.data)); // synthetic runtime only
  if (fixtureFailure) console.error(`Fixture: ${fixtureFailure.message}`);
  process.exitCode = 1;
} finally {
  await Promise.all([...children].map((child) => stop({ child }).catch(() => {})));
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  console.log(`Disposable diagnostics: ${workspace}`);
}
