/** Build provenance for the OFFLINE qualification image, not a runtime installer. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const runtimeReference = '740ea2ff502ebce5365f565b4b9973ae958c6541';
const hash = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');

export function verifyRuntimeSource(root, manifest) {
  assert.equal(manifest.commit, runtimeReference, 'Unknown source commit');
  assert.equal(manifest.version, 1);
  assert.ok(Object.keys(manifest.files).length > 10);
  for (const [name, expected] of Object.entries(manifest.files)) {
    assert.ok(!path.isAbsolute(name) && !name.split(/[\\/]/).includes('..'), 'Invalid source path');
    assert.equal(hash(path.join(root, name)), expected, `Source changed: ${name}`);
  }
}

export function createRuntimeManifest(root) {
  const git = (...args) =>
    execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', windowsHide: true });
  assert.equal(git('rev-parse', 'HEAD').trim(), runtimeReference);
  assert.equal(
    git('status', '--porcelain', '--untracked-files=no').trim(),
    '',
    'Dirty Hermes source',
  );
  const names = git('ls-files', '-z').split('\0').filter(Boolean).sort();
  return {
    version: 1,
    commit: runtimeReference,
    files: Object.fromEntries(names.map((name) => [name, hash(path.join(root, name))])),
  };
}

const normalizePath = (value) =>
  process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);
if (
  process.argv[1] &&
  normalizePath(fileURLToPath(import.meta.url)) === normalizePath(process.argv[1])
) {
  const manifest = createRuntimeManifest(path.resolve('hermes-agent'));
  writeFileSync('deploy/agents/runtime-manifest.generated.json', JSON.stringify(manifest));
  console.log(
    `Pinned runtime manifest: ${Object.keys(manifest.files).length} tracked files; no secrets or tenant homes.`,
  );
}
