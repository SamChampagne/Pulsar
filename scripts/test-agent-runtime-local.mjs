/** Smoke test of the real pinned wrapper: initialize only, no session/prompt/network. */
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { isolatedRuntimeEnv } = require(
  path.join(root, 'apps/api/dist/core/agents/agent-runtime-env.js'),
);
const home = mkdtempSync(path.join(tmpdir(), 'pulsar-acp-smoke-'));
const python = path.join(
  root,
  'hermes-agent',
  '.venv',
  process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python',
);
const child = spawn(python, ['-I', path.join(root, 'scripts/pulsar-hermes-acp.py')], {
  cwd: home,
  env: isolatedRuntimeEnv({ HERMES_HOME: home }),
  windowsHide: true,
  stdio: ['pipe', 'pipe', 'pipe'],
});
let complete = false,
  buffer = '';
const timer = setTimeout(() => finish(false), 15000);
function finish(ok) {
  if (complete) return;
  complete = true;
  clearTimeout(timer);
  child.kill();
  console.log(
    ok
      ? 'ACP_INITIALIZE_OK (protocol 1, no prompt, no provider key)'
      : 'ACP_INITIALIZE_FAILED (inspect the local runtime)',
  );
  process.exitCode = ok ? 0 : 1;
}
child.on('error', () => finish(false));
child.on('close', () => {
  if (!complete) finish(false);
});
child.stderr.resume(); // Never print arbitrary dependency logs/secrets.
child.stdout.on('data', (chunk) => {
  buffer += chunk.toString();
  if (buffer.length > 32768) return finish(false);
  let nl;
  while ((nl = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, nl);
    buffer = buffer.slice(nl + 1);
    try {
      const message = JSON.parse(line);
      if (message.id === 1) finish(message.result?.protocolVersion === 1 && !message.error);
    } catch {
      /* Startup chatter is not a protocol response. */
    }
  }
});
child.stdin.on('error', () => finish(false));
child.stdin.write(
  JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: 1,
      clientCapabilities: {},
      clientInfo: { name: 'pulsar-smoke', version: '1' },
    },
  }) + '\n',
);
