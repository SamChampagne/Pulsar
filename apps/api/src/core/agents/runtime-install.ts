import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Repo root resolved from the API's cwd. The NestJS API runs from `apps/api`,
 * so the monorepo root is two levels up. Override via `PULSAR_REPO_ROOT` for
 * non-standard launch dirs (e.g. compiled-dist runs from a different cwd).
 */
export function repoRoot(): string {
  return process.env.PULSAR_REPO_ROOT ?? path.resolve(process.cwd(), '..', '..');
}

/**
 * Absolute path to the vendored Hermes venv interpreter.
 * win32: `hermes-agent/.venv/Scripts/python.exe`; POSIX: `.venv/bin/python`.
 * (docs/agents-runtime-notes.md — Install section.)
 */
export function venvPython(): string {
  const venv = path.join(repoRoot(), 'hermes-agent', '.venv');
  return process.platform === 'win32'
    ? path.join(venv, 'Scripts', 'python.exe')
    : path.join(venv, 'bin', 'python');
}

/** True when the Hermes runtime has been installed (`pnpm agents:setup`). */
export function isInstalled(): boolean {
  return fs.existsSync(venvPython());
}
