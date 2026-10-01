/** Build context contains tracked, verified runtime sources only, never homes/.env/venvs. */
import { copyFileSync, mkdirSync, writeFileSync, existsSync, rmSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRuntimeManifest, verifyRuntimeSource } from './runtime-source-manifest.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, 'hermes-agent');
const target = path.join(root, 'deploy/agent-runner/.generated');
const manifest = createRuntimeManifest(source);
verifyRuntimeSource(source, manifest);
const providers = path.join(root, 'packages/shared/dist/agents/runtime-providers.js');
if (!existsSync(providers)) throw new Error('Build @pulsar/shared first');
if (existsSync(target)) {
  if (readFileSync(path.join(target, '.pulsar-generated'), 'utf8') !== 'runner-build-v1')
    throw new Error('Refusing to replace unknown directory');
  // Constant workspace-contained generation directory, never supplied by user/env.
  rmSync(target, { recursive: true });
}
mkdirSync(target, { recursive: true });
writeFileSync(path.join(target, '.pulsar-generated'), 'runner-build-v1');
for (const name of Object.keys(manifest.files)) {
  const destination = path.join(target, 'hermes-agent', name);
  mkdirSync(path.dirname(destination), { recursive: true });
  copyFileSync(path.join(source, name), destination);
}
verifyRuntimeSource(path.join(target, 'hermes-agent'), manifest);
copyFileSync(providers, path.join(target, 'providers.cjs'));
writeFileSync(path.join(target, 'manifest.json'), JSON.stringify(manifest));
console.log(
  `Runner context prepared: ${manifest.commit}, ${Object.keys(manifest.files).length} tracked files. No tenant data.`,
);
