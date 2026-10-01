import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { verifyRuntimeSource } from '../../scripts/runtime-source-manifest.mjs';
const manifest = JSON.parse(readFileSync('/app/runner/manifest.json', 'utf8'));
verifyRuntimeSource('/app/hermes-agent', manifest);
const metadata = JSON.parse(
  execFileSync(
    '/app/hermes-agent/.venv/bin/python',
    [
      '-I',
      '-c',
      'import json,platform,importlib.metadata as m; print(json.dumps(dict(version=m.version("hermes-agent"),pythonVersion=platform.python_version(),acpVersion=m.version("agent-client-protocol"),mcpVersion=m.version("mcp"))))',
    ],
    { encoding: 'utf8' },
  ),
);
if (metadata.version !== '0.16.0') throw new Error('Unqualified runtime');
writeFileSync(
  '/app/runner/metadata.json',
  JSON.stringify({ ...metadata, sourceCommit: manifest.commit }),
);
