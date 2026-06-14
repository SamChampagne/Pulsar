#!/usr/bin/env node
/**
 * setup-agents.mjs — provision the vendored Hermes agent runtime (turnkey).
 *
 * Creates a Python virtualenv at hermes-agent/.venv and installs the vendored
 * `hermes-agent` package with the `acp` extra (agent-client-protocol), so that
 * Pulsar's AgentRuntimeService can spawn the ACP adapter
 * (`<venv-python> -m acp_adapter`).
 *
 * Hermes pins `requires-python = ">=3.11,<3.14"` (Rust-backed transitives like
 * pydantic-core have no cp314 wheels yet, so the project deliberately refuses
 * 3.14 — see hermes-agent/pyproject.toml). Many machines (incl. this one) ship
 * ONLY Python 3.14, which can't host Hermes.
 *
 * To stay TURNKEY (no manual Python install by the user) we drive everything
 * through `uv` (https://docs.astral.sh/uv/): uv fetches a standalone CPython
 * 3.12 (no system change, no admin), creates the venv with it, and installs
 * Hermes into that 3.12 venv — satisfying the <3.14 cap.
 *
 * Primary path:
 *   1. ensure `uv` is available (bootstrap via `python -m pip install --user uv`
 *      or `pipx` if missing — 3.14 can RUN uv even though it can't HOST Hermes),
 *   2. `uv python install 3.12`,
 *   3. `uv venv hermes-agent/.venv --python 3.12`,
 *   4. `uv pip install --python hermes-agent/.venv -e "./hermes-agent[acp]"`.
 *
 * Fallback (only if uv truly can't be obtained): a system 3.11/3.12 already on
 * PATH via the classic `python -m venv` + `pip` flow.
 *
 * Idempotent: skips venv creation if present, always re-runs pip install.
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const hermesDir = path.join(repoRoot, 'hermes-agent');
const hermesManifest = path.join(hermesDir, 'pyproject.toml');
const venvDir = path.join(hermesDir, '.venv');
const isWin = process.platform === 'win32';

const venvPython = isWin
  ? path.join(venvDir, 'Scripts', 'python.exe')
  : path.join(venvDir, 'bin', 'python');

// The pinned, turnkey interpreter version uv will provision.
const TARGET_PY = '3.12';

function fail(msg) {
  console.error(`\n[setup-agents] ERROR: ${msg}\n`);
  process.exit(1);
}

function run(cmd, args, opts = {}) {
  console.log(`[setup-agents] $ ${cmd} ${args.join(' ')}`);
  const res = spawnSync(cmd, args, { stdio: 'inherit', shell: false, ...opts });
  return res;
}

/** Run a command capturing output; returns { ok, status, out }. */
function capture(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, { encoding: 'utf8', shell: false, ...opts });
  const out = `${res.stdout || ''}${res.stderr || ''}`.trim();
  return { ok: !res.error && res.status === 0, status: res.status, out, error: res.error };
}

/** Is `uv` on PATH and runnable? Returns its version string or null. */
function uvVersion() {
  const res = capture('uv', ['--version']);
  return res.ok ? res.out : null;
}

/**
 * Probe a candidate Python launcher; returns { cmd, prefixArgs, version, ... }
 * if it runs and reports a version, else null.
 */
function probePython(candidate) {
  const [cmd, ...prefixArgs] = candidate;
  const res = spawnSync(cmd, [...prefixArgs, '--version'], { encoding: 'utf8', shell: false });
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

/** Find any runnable python launcher (used only to bootstrap uv). */
function detectAnyPython() {
  const candidates = [['python3'], ['python'], ['py']];
  for (const c of candidates) {
    const p = probePython(c);
    if (p) return p;
  }
  return null;
}

/**
 * Find a *Hermes-compatible* (>=3.11,<3.14) system interpreter, for the
 * fallback path only. Prefers older stable interpreters.
 */
function detectCompatiblePython() {
  const candidates = [
    ['python3.12'],
    ['python3.11'],
    ['py', '-3.12'],
    ['py', '-3.11'],
    ['python3'],
    ['python'],
    ['py'],
  ];
  for (const c of candidates) {
    const p = probePython(c);
    if (!p) continue;
    if (p.major === 3 && p.minor >= 11 && p.minor < 14) return p;
  }
  return null;
}

/**
 * Try hard to make `uv` available. Returns true if uv is usable afterward.
 * Strategy: (1) already present, (2) `python -m pip install --user uv`,
 * (3) `pipx install uv`. Non-interactive throughout.
 */
function ensureUv() {
  let v = uvVersion();
  if (v) {
    console.log(`[setup-agents] uv present: ${v}`);
    return true;
  }

  console.log('[setup-agents] uv not found on PATH — attempting non-interactive bootstrap...');

  // (2) pip --user uv via any python (3.14 can RUN uv even if it can't host Hermes).
  const anyPy = detectAnyPython();
  if (anyPy) {
    console.log(
      `[setup-agents] Bootstrapping uv via ${anyPy.cmd} ${anyPy.prefixArgs.join(' ')} ` +
        `(Python ${anyPy.version}) -m pip install --user uv ...`,
    );
    const r = run(anyPy.cmd, [...anyPy.prefixArgs, '-m', 'pip', 'install', '--user', '--upgrade', 'uv']);
    if (r.status === 0) {
      v = uvVersion();
      if (v) {
        console.log(`[setup-agents] uv installed: ${v}`);
        return true;
      }
      // Installed but not on PATH — try `python -m uv` as a shim is not enough;
      // warn and continue to next strategy.
      console.warn(
        '[setup-agents] uv installed via pip --user but not yet on PATH ' +
          '(restart your shell, or add the user Scripts/bin dir to PATH).',
      );
    } else {
      console.warn(`[setup-agents] pip --user uv failed (exit ${r.status}).`);
    }
  } else {
    console.warn('[setup-agents] No python found to bootstrap uv via pip.');
  }

  // (3) pipx fallback.
  const pipx = capture('pipx', ['--version']);
  if (pipx.ok) {
    console.log('[setup-agents] Trying `pipx install uv` ...');
    const r = run('pipx', ['install', 'uv']);
    if (r.status === 0) {
      v = uvVersion();
      if (v) {
        console.log(`[setup-agents] uv installed via pipx: ${v}`);
        return true;
      }
    }
  }

  return false;
}

/** uv-driven turnkey install. Returns true on success. */
function installViaUv() {
  // 2. Provision a standalone CPython 3.12 (no system change, no admin).
  console.log(`[setup-agents] Provisioning CPython ${TARGET_PY} via uv (download, no admin) ...`);
  const pyInstall = run('uv', ['python', 'install', TARGET_PY]);
  if (pyInstall.status !== 0) {
    fail(
      `\`uv python install ${TARGET_PY}\` failed (exit ${pyInstall.status}). ` +
        'This usually means no network / a blocked download host. uv needs to fetch a ' +
        'standalone CPython build. Check connectivity to github.com/astral-sh/python-build-standalone.',
    );
  }

  // 3. Create the venv with that 3.12 (idempotent).
  if (existsSync(venvPython)) {
    console.log(`[setup-agents] venv already exists at ${venvDir} — skipping creation.`);
  } else {
    console.log(`[setup-agents] Creating venv at ${venvDir} with Python ${TARGET_PY} ...`);
    const venvRes = run('uv', ['venv', venvDir, '--python', TARGET_PY]);
    if (venvRes.status !== 0) {
      fail(`\`uv venv\` failed (exit ${venvRes.status}).`);
    }
  }
  if (!existsSync(venvPython)) {
    fail(`venv python not found at ${venvPython} after creation.`);
  }

  // 4. Install the vendored package with the acp extra INTO the 3.12 venv.
  // uv pip install --python <venv> respects the venv's interpreter, so the
  // <3.14 cap is satisfied even though the host shell may be on 3.14.
  const editableSpec = `${'.' + path.sep}${path.relative(repoRoot, hermesDir)}[acp]`;
  console.log(`[setup-agents] Installing ${editableSpec} into the venv (this can take several minutes) ...`);
  const pipInstall = run(
    'uv',
    ['pip', 'install', '--python', venvPython, '-e', editableSpec],
    { cwd: repoRoot },
  );
  if (pipInstall.status !== 0) {
    fail(
      `\`uv pip install\` failed (exit ${pipInstall.status}). See the output above for the ` +
        'failing dependency.',
    );
  }
  return true;
}

/**
 * Fallback: classic `python -m venv` + `pip` using a system 3.11/3.12.
 * Only reached if uv could not be obtained. Returns true on success.
 */
function installViaSystemPython(py) {
  console.log(
    `[setup-agents] FALLBACK: using system Python ${py.version} ` +
      `(${[py.cmd, ...py.prefixArgs].join(' ')}) — uv unavailable.`,
  );

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

  console.log('[setup-agents] Upgrading pip ...');
  const pipUp = run(venvPython, ['-m', 'pip', 'install', '--upgrade', 'pip']);
  if (pipUp.status !== 0) {
    fail(`pip upgrade failed (exit ${pipUp.status}).`);
  }

  const editableSpec = `${'.' + path.sep}${path.relative(repoRoot, hermesDir)}[acp]`;
  console.log(`[setup-agents] Installing ${editableSpec} (this can take several minutes) ...`);
  const pipInstall = run(venvPython, ['-m', 'pip', 'install', '-e', editableSpec], { cwd: repoRoot });
  if (pipInstall.status !== 0) {
    fail(
      `pip install failed (exit ${pipInstall.status}). See the pip output above for the ` +
        'failing dependency.',
    );
  }
  return true;
}

/**
 * `hermes-agent` ships as a git submodule. A fresh `git clone` (without
 * --recurse-submodules) leaves the directory empty, so self-heal by running
 * `git submodule update --init --recursive` before anything else. Best-effort:
 * if we're not inside a git checkout (e.g. a tarball) or git is unavailable,
 * log a clear message and continue — the existence check below decides if we
 * can proceed.
 */
function ensureSubmodule() {
  if (existsSync(hermesManifest)) return; // already populated
  console.log(
    '[setup-agents] hermes-agent/pyproject.toml missing — initializing git submodule ...',
  );
  const res = run('git', ['submodule', 'update', '--init', '--recursive'], { cwd: repoRoot });
  if (res.error || res.status !== 0) {
    console.warn(
      '[setup-agents] `git submodule update --init --recursive` did not succeed ' +
        `(${res.error ? res.error.message : `exit ${res.status}`}). ` +
        'If this is a git checkout, run it manually; otherwise vendor hermes-agent/ yourself. ' +
        'Continuing — will fail below if the runtime is still missing.',
    );
  }
}

function main() {
  ensureSubmodule();

  if (!existsSync(hermesDir) || !existsSync(hermesManifest)) {
    fail(
      `vendored Hermes not found at ${hermesDir} (pyproject.toml missing). ` +
        'Initialize the submodule: `git submodule update --init --recursive` ' +
        '(or clone with `git clone --recurse-submodules`).',
    );
  }

  console.log('[setup-agents] Turnkey Hermes runtime setup (uv-driven; Hermes needs >=3.11,<3.14).');

  // PRIMARY PATH: uv provisions CPython 3.12 and installs into the venv.
  if (ensureUv()) {
    installViaUv();
  } else {
    // FALLBACK: uv could not be obtained. Try a compatible system interpreter.
    console.warn('[setup-agents] Could not obtain uv. Falling back to a system 3.11/3.12 interpreter.');
    const py = detectCompatiblePython();
    if (!py) {
      fail(
        'Could not install `uv` AND no compatible system Python (>=3.11,<3.14) is on PATH.\n' +
          '  Fix EITHER:\n' +
          '    - install uv (recommended, turnkey): https://docs.astral.sh/uv/  then re-run `pnpm agents:setup`\n' +
          `    - or install Python ${TARGET_PY}/3.11 and re-run.\n` +
          '  Note: Python 3.14 alone is NOT enough — Hermes caps at <3.14.',
      );
    }
    installViaSystemPython(py);
  }

  console.log('\n[setup-agents] SUCCESS.');
  console.log(`[setup-agents] venv python: ${venvPython}`);
  console.log('[setup-agents] Next steps:');
  console.log(`  - Verify ACP imports:  "${venvPython}" -c "import acp_adapter, acp; print('ACP_OK')"`);
  console.log(`  - Launch ACP adapter:  "${venvPython}" -m acp_adapter`);
  console.log('  - Configure a provider in HERMES_HOME/cli-config.yaml (see docs/agents-runtime-notes.md).');
}

main();
