#!/usr/bin/env node
/**
 * setup-aps.mjs — provision the vendored PlaniAdvance APS engine (turnkey).
 *
 * Mirrors scripts/setup-agents.mjs (the Hermes runtime provisioner). Creates a
 * Python virtualenv at services/aps/.venv and installs the vendored
 * `planiadvance_v2` package with the `cpsat` extra (OR-Tools CP-SAT — the exact
 * solver) so Pulsar's ApsRuntimeService can launch the engine
 * (`<venv-python> -m uvicorn planiadvance_v2.api.main:app`).
 *
 * The engine pins `requires-python = ">=3.11"`. To stay TURNKEY (no manual
 * Python install) we drive everything through `uv`: uv fetches a standalone
 * CPython 3.12 (no system change, no admin), creates the venv, and installs the
 * engine into it. OR-Tools wheels are large — the install can take a few minutes.
 *
 * Beyond the venv, this also (best-effort):
 *   - creates a dedicated `planiadvance` database inside the running pulsar-db
 *     Postgres container (the engine runs its own Alembic migrations on startup),
 *   - writes services/aps/.env with DATABASE_URL / API_PORT / a generated
 *     INTEGRATION_API_KEY so the engine boots headless and Pulsar can call it.
 *
 * Idempotent: skips venv creation if present, always re-runs pip install, never
 * overwrites an existing services/aps/.env or an existing database.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, writeFileSync, readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const apsDir = path.join(repoRoot, 'services', 'aps');
const apsManifest = path.join(apsDir, 'pyproject.toml');
const apsLock = path.join(apsDir, 'requirements-ci.lock');
const venvDir = path.join(apsDir, '.venv');
const apsEnv = path.join(apsDir, '.env');
const isWin = process.platform === 'win32';

const venvPython = isWin
  ? path.join(venvDir, 'Scripts', 'python.exe')
  : path.join(venvDir, 'bin', 'python');

const TARGET_PY = '3.12';

// Engine runtime defaults (kept in sync with core/aps and .env.example).
const APS_PORT = process.env.APS_PORT || '8099';
const APS_DB_NAME = 'planiadvance';
const APS_DB_USER = process.env.APS_DB_USER || 'pulsar';
const APS_DB_PASSWORD = process.env.APS_DB_PASSWORD || 'pulsar';
const APS_DB_HOST = process.env.APS_DB_HOST || 'localhost';
const APS_DB_PORT = process.env.APS_DB_PORT || '5432';
const PULSAR_DB_CONTAINER = process.env.PULSAR_DB_CONTAINER || 'pulsar-db';

function fail(msg) {
  console.error(`\n[setup-aps] ERROR: ${msg}\n`);
  process.exit(1);
}

function run(cmd, args, opts = {}) {
  console.log(`[setup-aps] $ ${cmd} ${args.join(' ')}`);
  return spawnSync(cmd, args, { stdio: 'inherit', shell: false, ...opts });
}

function capture(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, { encoding: 'utf8', shell: false, ...opts });
  const out = `${res.stdout || ''}${res.stderr || ''}`.trim();
  return { ok: !res.error && res.status === 0, status: res.status, out, error: res.error };
}

function uvVersion() {
  const res = capture('uv', ['--version']);
  return res.ok ? res.out : null;
}

function probePython(candidate) {
  const [cmd, ...prefixArgs] = candidate;
  const res = spawnSync(cmd, [...prefixArgs, '--version'], { encoding: 'utf8', shell: false });
  if (res.error || res.status !== 0) return null;
  const out = `${res.stdout || ''}${res.stderr || ''}`.trim();
  const m = out.match(/Python\s+(\d+)\.(\d+)\.(\d+)/i);
  if (!m) return null;
  return { cmd, prefixArgs, version: `${m[1]}.${m[2]}.${m[3]}`, major: Number(m[1]), minor: Number(m[2]) };
}

function detectAnyPython() {
  for (const c of [['python3'], ['python'], ['py']]) {
    const p = probePython(c);
    if (p) return p;
  }
  return null;
}

function detectCompatiblePython() {
  const candidates = [['python3.12'], ['python3.11'], ['py', '-3.12'], ['py', '-3.11'], ['python3'], ['python'], ['py']];
  for (const c of candidates) {
    const p = probePython(c);
    if (p && p.major === 3 && p.minor >= 11) return p;
  }
  return null;
}

function ensureUv() {
  let v = uvVersion();
  if (v) {
    console.log(`[setup-aps] uv present: ${v}`);
    return true;
  }
  console.log('[setup-aps] uv not found on PATH — attempting non-interactive bootstrap...');
  const anyPy = detectAnyPython();
  if (anyPy) {
    console.log(`[setup-aps] Bootstrapping uv via ${anyPy.cmd} -m pip install --user uv ...`);
    const r = run(anyPy.cmd, [...anyPy.prefixArgs, '-m', 'pip', 'install', '--user', '--upgrade', 'uv']);
    if (r.status === 0) {
      v = uvVersion();
      if (v) {
        console.log(`[setup-aps] uv installed: ${v}`);
        return true;
      }
      console.warn('[setup-aps] uv installed via pip --user but not yet on PATH (restart shell or add user Scripts/bin to PATH).');
    } else {
      console.warn(`[setup-aps] pip --user uv failed (exit ${r.status}).`);
    }
  }
  const pipx = capture('pipx', ['--version']);
  if (pipx.ok) {
    console.log('[setup-aps] Trying `pipx install uv` ...');
    const r = run('pipx', ['install', 'uv']);
    if (r.status === 0 && uvVersion()) {
      console.log('[setup-aps] uv installed via pipx.');
      return true;
    }
  }
  return false;
}

function installViaUv() {
  console.log(`[setup-aps] Provisioning CPython ${TARGET_PY} via uv (download, no admin) ...`);
  const pyInstall = run('uv', ['python', 'install', TARGET_PY]);
  if (pyInstall.status !== 0) {
    fail(
      `\`uv python install ${TARGET_PY}\` failed (exit ${pyInstall.status}). Usually no network / a ` +
        'blocked download host. uv fetches a standalone CPython from github.com/astral-sh/python-build-standalone.',
    );
  }
  if (existsSync(venvPython)) {
    console.log(`[setup-aps] venv already exists at ${venvDir} — skipping creation.`);
  } else {
    console.log(`[setup-aps] Creating venv at ${venvDir} with Python ${TARGET_PY} ...`);
    const venvRes = run('uv', ['venv', venvDir, '--python', TARGET_PY]);
    if (venvRes.status !== 0) fail(`\`uv venv\` failed (exit ${venvRes.status}).`);
  }
  if (!existsSync(venvPython)) fail(`venv python not found at ${venvPython} after creation.`);

  const editableSpec = `${'.' + path.sep}${path.relative(repoRoot, apsDir)}[cpsat]`;
  console.log(`[setup-aps] Installing ${editableSpec} into the venv (OR-Tools is large — several minutes) ...`);
  const locked = run('uv', ['pip', 'install', '--python', venvPython, '--require-hashes', '-r', apsLock], { cwd: repoRoot });
  if (locked.status !== 0) fail('Locked APS dependencies could not be installed. Use the supported Python 3.12 runtime.');
  const pipInstall = run('uv', ['pip', 'install', '--python', venvPython, '--no-deps', '-e', editableSpec], { cwd: repoRoot });
  if (pipInstall.status !== 0) fail(`\`uv pip install\` failed (exit ${pipInstall.status}). See output above.`);
  return true;
}

function installViaSystemPython(py) {
  console.log(`[setup-aps] FALLBACK: system Python ${py.version} (${[py.cmd, ...py.prefixArgs].join(' ')}) — uv unavailable.`);
  if (existsSync(venvPython)) {
    console.log(`[setup-aps] venv already exists at ${venvDir} — skipping creation.`);
  } else {
    const venvRes = run(py.cmd, [...py.prefixArgs, '-m', 'venv', venvDir]);
    if (venvRes.status !== 0) fail(`failed to create venv (exit ${venvRes.status}).`);
  }
  if (!existsSync(venvPython)) fail(`venv python not found at ${venvPython} after creation.`);
  run(venvPython, ['-m', 'pip', 'install', '--upgrade', 'pip']);
  const editableSpec = `${'.' + path.sep}${path.relative(repoRoot, apsDir)}[cpsat]`;
  console.log(`[setup-aps] Installing ${editableSpec} (several minutes) ...`);
  const locked = run(venvPython, ['-m', 'pip', 'install', '--require-hashes', '-r', apsLock], { cwd: repoRoot });
  if (locked.status !== 0) fail('Locked APS dependencies could not be installed. Use the supported Python 3.12 runtime.');
  const pipInstall = run(venvPython, ['-m', 'pip', 'install', '--no-deps', '-e', editableSpec], { cwd: repoRoot });
  if (pipInstall.status !== 0) fail(`pip install failed (exit ${pipInstall.status}).`);
  return true;
}

/**
 * Best-effort: create the engine's dedicated database inside the pulsar-db
 * container. The engine runs its own Alembic migrations on startup, so we only
 * need the empty database to exist. Never fails the setup — a missing DB just
 * surfaces later as the engine's /health reporting db_ready=false.
 */
function ensureDatabase() {
  const docker = capture('docker', ['--version']);
  if (!docker.ok) {
    console.warn('[setup-aps] docker not found — skipping DB provisioning. Create the `planiadvance` DB yourself.');
    return;
  }
  const running = capture('docker', ['ps', '--filter', `name=${PULSAR_DB_CONTAINER}`, '--format', '{{.Names}}']);
  if (!running.ok || !running.out.includes(PULSAR_DB_CONTAINER)) {
    console.warn(`[setup-aps] container ${PULSAR_DB_CONTAINER} not running — run \`pnpm db:up\` then re-run. Skipping DB.`);
    return;
  }
  const exists = capture('docker', [
    'exec', PULSAR_DB_CONTAINER, 'psql', '-U', APS_DB_USER, '-tAc',
    `SELECT 1 FROM pg_database WHERE datname='${APS_DB_NAME}'`,
  ]);
  if (exists.ok && exists.out.includes('1')) {
    console.log(`[setup-aps] database ${APS_DB_NAME} already exists.`);
    return;
  }
  console.log(`[setup-aps] creating database ${APS_DB_NAME} in ${PULSAR_DB_CONTAINER} ...`);
  const created = run('docker', ['exec', PULSAR_DB_CONTAINER, 'createdb', '-U', APS_DB_USER, APS_DB_NAME]);
  if (created.status !== 0) {
    console.warn(`[setup-aps] createdb failed (exit ${created.status}). Create \`${APS_DB_NAME}\` manually if needed.`);
  }
}

/**
 * Write services/aps/.env so the engine boots headless. Never overwrites an
 * existing .env (preserves a hand-tuned key). Generates a random integration key.
 */
function ensureEnv() {
  if (existsSync(apsEnv)) {
    console.log('[setup-aps] services/aps/.env already exists — leaving it untouched.');
    return readKey(apsEnv);
  }
  const key = randomBytes(24).toString('base64url');
  const databaseUrl = `postgresql+psycopg://${APS_DB_USER}:${APS_DB_PASSWORD}@${APS_DB_HOST}:${APS_DB_PORT}/${APS_DB_NAME}`;
  const body = [
    '# Generated by `pnpm aps:setup`. Headless config for the managed APS engine.',
    `DATABASE_URL=${databaseUrl}`,
    `API_HOST=127.0.0.1`,
    `API_PORT=${APS_PORT}`,
    `INTEGRATION_API_KEY=${key}`,
    'AUTH_ALLOW_HEADER_IDENTITY=true',
    'AUTH_REQUIRE_PASSWORD=false',
    'SEED_RESET=false',
    'LOG_LEVEL=INFO',
    '',
  ].join('\n');
  writeFileSync(apsEnv, body, 'utf8');
  console.log(`[setup-aps] wrote ${apsEnv} (INTEGRATION_API_KEY generated).`);
  return key;
}

function readKey(file) {
  try {
    const m = readFileSync(file, 'utf8').match(/^INTEGRATION_API_KEY=(.+)$/m);
    return m ? m[1].trim() : null;
  } catch {
    return null;
  }
}

function main() {
  if (!existsSync(apsManifest)) {
    fail(`vendored APS engine not found at ${apsDir} (pyproject.toml missing). The engine is copied into services/aps.`);
  }
  console.log('[setup-aps] Turnkey APS engine setup (uv-driven; Python >=3.11; OR-Tools via [cpsat]).');

  if (ensureUv()) {
    installViaUv();
  } else {
    console.warn('[setup-aps] Could not obtain uv. Falling back to a system 3.11/3.12 interpreter.');
    const py = detectCompatiblePython();
    if (!py) {
      fail(
        'Could not install `uv` AND no compatible system Python (>=3.11) is on PATH.\n' +
          '  Install uv (recommended): https://docs.astral.sh/uv/  then re-run `pnpm aps:setup`.',
      );
    }
    installViaSystemPython(py);
  }

  ensureDatabase();
  const key = ensureEnv();

  console.log('\n[setup-aps] SUCCESS.');
  console.log(`[setup-aps] venv python: ${venvPython}`);
  console.log('[setup-aps] Next steps:');
  console.log(`  - Add APS_API_KEY=${key || '<see services/aps/.env>'} to the repo-root .env (Pulsar reads it).`);
  console.log(`  - Set APS_PORT=${APS_PORT} and APS_DATABASE_URL in the repo-root .env (see .env.example).`);
  console.log('  - Start Pulsar (`pnpm dev`): core/aps boots the engine on loopback automatically.');
  console.log(`  - Verify: GET http://localhost:<api>/api/v1/aps/status`);
}

main();
