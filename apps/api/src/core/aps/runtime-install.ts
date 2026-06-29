import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Repo root resolved from the API's cwd. The NestJS API runs from `apps/api`,
 * so the monorepo root is two levels up. Override via `PULSAR_REPO_ROOT` for
 * non-standard launch dirs (e.g. compiled-dist runs from a different cwd).
 * (Mirrors core/agents/runtime-install.ts.)
 */
export function repoRoot(): string {
  return process.env.PULSAR_REPO_ROOT ?? path.resolve(process.cwd(), '..', '..');
}

/** Absolute path to the vendored APS engine directory (`services/aps`). */
export function apsDir(): string {
  return path.join(repoRoot(), 'services', 'aps');
}

/**
 * Absolute path to the vendored APS venv interpreter.
 * win32: `services/aps/.venv/Scripts/python.exe`; POSIX: `.venv/bin/python`.
 */
export function venvPython(): string {
  const venv = path.join(apsDir(), '.venv');
  return process.platform === 'win32'
    ? path.join(venv, 'Scripts', 'python.exe')
    : path.join(venv, 'bin', 'python');
}

/** True when the APS runtime has been installed (`pnpm aps:setup`). */
export function isInstalled(): boolean {
  return fs.existsSync(venvPython()) && fs.existsSync(path.join(apsDir(), 'pyproject.toml'));
}
