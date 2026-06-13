#!/usr/bin/env node
/**
 * setup-agents.mjs — provision the vendored Hermes agent runtime.
 *
 * Creates a Python virtualenv at hermes-agent/.venv and installs the vendored
 * `hermes-agent` package with the `acp` extra (agent-client-protocol), so that
 * Pulsar's AgentRuntimeService can spawn the ACP adapter
 * (`<venv-python> -m acp_adapter`).
 *
 * Hermes pins `requires-python = ">=3.11,<3.14"` (Rust-backed transitives like
 * pydantic-core have no cp314 wheels yet), so this script PREFERS an older
 * stable interpreter (3.12/3.11) over a newer one if both exist.
 *
 * Idempotent: skips venv creation if present, always re-runs pip install.
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const hermesDir = path.join(repoRoot, 'hermes-agent');
const venvDir = path.join(hermesDir, '.venv');
const isWin = process.platform === 'win32';

const venvPython = isWin
  ? path.join(venvDir, 'Scripts', 'python.exe')
  : path.join(venvDir, 'bin', 'python');

function fail(msg) {
  console.error(`\n[setup-agents] ERROR: ${msg}\n`);
  process.exit(1);
}

function run(cmd, args, opts = {}) {
  console.log(`[setup-agents] $ ${cmd} ${args.join(' ')}`);
  const res = spawnSync(cmd, args, { stdio: 'inherit', shell: false, ...opts });
  return res;
}

/**
 * Probe a candidate Python launcher; returns { cmd, args, version } if it runs
 * and reports a version, else null. `candidate` may carry leading args (e.g.
 * the Windows `py -3.12` launcher).
 */
function probePython(candidate) {
  const [cmd, ...prefixArgs] = candidate;
  const res = spawnSync(cmd, [...prefixArgs, '--version'], {
    encoding: 'utf8',
    shell: false,
  });
  if (res.error || res.status !== 0) return null;
  const out = `${res.stdout || ''}${res.stderr || ''}`.trim();
  const m = out.match(/Python\s+(\d+)\.(\d+)\.(\d+)/i);
  if (!m) return null;
  return {
    cmd,
    prefixArgs,
    version: `${m[1]}.${m[2]}.${m[3]}`,
    major: Number(m[1]),
    minor: Number(m[2]),
  };
}

function detectPython() {
  // Preference order: older stable interpreters first (Hermes caps at <3.14),
  // then generic launchers as a fallback.
  const candidates = [
    ['python3.12'],
    ['python3.11'],
    ['py', '-3.12'],
    ['py', '-3.11'],
    ['python3'],
    ['python'],
    ['py'],
  ];
  let firstFound = null;
  for (const c of candidates) {
    const p = probePython(c);
    if (!p) continue;
    if (!firstFound) firstFound = p;
    // Hermes requires >=3.11,<3.14 — take the first compatible interpreter.
    if (p.major === 3 && p.minor >= 11 && p.minor < 14) {
      return { ...p, compatible: true };
    }
  }
  // No interpreter in the supported range; return whatever we found (caller
  // will warn that the pinned deps probably won't build).
  return firstFound ? { ...firstFound, compatible: false } : null;
}

function main() {
  if (!existsSync(hermesDir)) {
    fail(`vendored Hermes not found at ${hermesDir}. Did you init the submodule/copy?`);
  }

  console.log('[setup-agents] Detecting a Python interpreter (Hermes needs >=3.11,<3.14)...');
  const py = detectPython();
  if (!py) {
    fail(
      'No Python interpreter found on PATH. Install Python 3.12 (recommended) ' +
        'or 3.11 and re-run `pnpm agents:setup`.',
    );
  }
  const pyCmd = [py.cmd, ...py.prefixArgs];
  console.log(`[setup-agents] Using Python ${py.version} (${pyCmd.join(' ')})`);
  if (!py.compatible) {
    console.warn(
      `[setup-agents] WARNING: Python ${py.version} is OUTSIDE Hermes' supported range ` +
        '(>=3.11,<3.14). Rust-backed deps (pydantic-core, etc.) likely have no matching ' +
        'wheel and the install will probably fail on a source build. Install Python 3.12/3.11.',
    );
  }

  // 1. Create the venv (idempotent).
  if (existsSync(venvPython)) {
    console.log(`[setup-agents] venv already exists at ${venvDir} — skipping creation.`);
  } else {
    console.log(`[setup-agents] Creating venv at ${venvDir} ...`);
    const venvRes = run(py.cmd, [...py.prefixArgs, '-m', 'venv', venvDir]);
    if (venvRes.status !== 0) {
      fail(`failed to create venv (exit ${venvRes.status}). Is the \`venv\` module available?`);
    }
  }
  if (!existsSync(venvPython)) {
    fail(`venv python not found at ${venvPython} after creation.`);
  }

  // 2. Upgrade pip.
  console.log('[setup-agents] Upgrading pip ...');
  const pipUp = run(venvPython, ['-m', 'pip', 'install', '--upgrade', 'pip']);
  if (pipUp.status !== 0) {
    fail(`pip upgrade failed (exit ${pipUp.status}).`);
  }

  // 3. Install the vendored package with the acp extra.
  // Use a relative spec so the editable path is portable.
  const editableSpec = `${'.' + path.sep}${path.relative(repoRoot, hermesDir)}[acp]`;
  console.log(`[setup-agents] Installing ${editableSpec} (this can take several minutes) ...`);
  const pipInstall = run(venvPython, ['-m', 'pip', 'install', '-e', editableSpec], {
    cwd: repoRoot,
  });
  if (pipInstall.status !== 0) {
    fail(
      `pip install failed (exit ${pipInstall.status}). See the pip output above for the ` +
        'failing dependency. If a Rust build (pydantic-core/maturin) failed, you are likely ' +
        'on Python 3.14 — install Python 3.12/3.11 and re-run.',
    );
  }

  console.log('\n[setup-agents] SUCCESS.');
  console.log(`[setup-agents] venv python: ${venvPython}`);
  console.log('[setup-agents] Next steps:');
  console.log(`  - Verify ACP imports:  "${venvPython}" -c "import acp_adapter, acp; print('ACP_OK')"`);
  console.log(`  - Launch ACP adapter:  "${venvPython}" -m acp_adapter`);
  console.log('  - Configure a provider in HERMES_HOME/cli-config.yaml (see docs/agents-runtime-notes.md).');
}

main();
