import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { runtimeReference, verifyRuntimeSource } from './runtime-source-manifest.mjs';

function fixture(t) {
  const root = mkdtempSync(path.join(tmpdir(), 'pulsar-manifest-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const files = {};
  for (let i = 0; i < 11; i++) {
    const name = `source-${i}.txt`;
    const content = `fixture ${i}`;
    writeFileSync(path.join(root, name), content);
    files[name] = createHash('sha256').update(content).digest('hex');
  }
  return { root, manifest: { version: 1, commit: runtimeReference, files } };
}

test('verifies every recorded source and rejects later modification', (t) => {
  const { root, manifest } = fixture(t);
  verifyRuntimeSource(root, manifest);
  writeFileSync(path.join(root, 'source-7.txt'), 'changed');
  assert.throws(() => verifyRuntimeSource(root, manifest), /Source changed/);
});

test('rejects an unknown reference, format or missing inventory', (t) => {
  const { root, manifest } = fixture(t);
  assert.throws(() => verifyRuntimeSource(root, { ...manifest, commit: 'unknown' }));
  assert.throws(() => verifyRuntimeSource(root, { ...manifest, version: 2 }));
  assert.throws(() => verifyRuntimeSource(root, { ...manifest, files: {} }));
});

test('rejects traversal and absolute paths before reading outside the source', (t) => {
  const { root, manifest } = fixture(t);
  for (const name of ['../escape', '..\\escape', path.resolve(root, 'absolute')]) {
    assert.throws(
      () =>
        verifyRuntimeSource(root, {
          ...manifest,
          files: { [name]: 'bad', ...manifest.files },
        }),
      /Invalid source path/,
    );
  }
});

test('missing sources fail qualification', (t) => {
  const { root, manifest } = fixture(t);
  rmSync(path.join(root, 'source-3.txt'));
  assert.throws(() => verifyRuntimeSource(root, manifest), /ENOENT/);
});
