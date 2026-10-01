import { Injectable } from '@nestjs/common';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import * as path from 'node:path';
import { isolatedRuntimeEnv } from './agent-runtime-env';
import { isInstalled, repoRoot, venvPython } from './runtime-install';
import { remoteRuntimeEnabled, inspectRemoteRuntime, runnerTarget } from './remote-runtime';

export const RUNTIME_REFERENCE = {
  version: '0.16.0',
  commit: '740ea2ff502ebce5365f565b4b9973ae958c6541',
  upstreamVersion: '0.21.5',
  upstreamCheckedAt: '2026-09-27',
  upstreamUrl: 'https://github.com/NousResearch/hermes-agent/releases/tag/v2026.9.24',
} as const;

export interface RuntimeHealth {
  checkedAt: string;
  installed: boolean;
  declaredVersion: string | null;
  installedVersion: string | null;
  pythonVersion: string | null;
  acpVersion: string | null;
  mcpVersion: string | null;
  sourceCommit: string | null;
  sourceModified: boolean | null;
  reference: typeof RUNTIME_REFERENCE;
  assessment: 'not-installed' | 'unknown' | 'reference-match' | 'review-required';
  scope: 'LOCAL_METADATA_ONLY' | 'REMOTE_METADATA_ONLY';
  runtimeMode?: 'local' | 'remote';
  runnerStatus?: 'unassigned' | 'unreachable' | 'ready';
  runnerBusy?: boolean;
}

function localCommand(command: string, args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) =>
    execFile(
      command,
      args,
      {
        cwd,
        timeout: 5_000,
        maxBuffer: 32_768,
        windowsHide: true,
        env: isolatedRuntimeEnv({ HERMES_HOME: path.join(repoRoot(), '.runtime-metadata') }),
      },
      (error, stdout) =>
        error ? reject(new Error('Local metadata unavailable')) : resolve(stdout),
    ),
  );
}

/** Metadata only: never import the runtime, load tenant homes, fetch GitHub or call an LLM. */
@Injectable()
export class RuntimeHealthService {
  private pending: Promise<RuntimeHealth> | undefined;
  private cached: RuntimeHealth | undefined;
  private expiresAt = 0;

  async inspect(tenantId?: string): Promise<RuntimeHealth> {
    if (remoteRuntimeEnabled()) {
      const data = tenantId ? await inspectRemoteRuntime(tenantId) : null;
      const text = (key: string) =>
        typeof data?.[key] === 'string' && /^[a-zA-Z0-9.+_-]{1,64}$/.test(data[key] as string)
          ? (data[key] as string)
          : null;
      const installed = data?.installed === true;
      return {
        checkedAt: new Date().toISOString(),
        installed,
        declaredVersion: text('version'),
        installedVersion: text('version'),
        pythonVersion: text('pythonVersion'),
        acpVersion: text('acpVersion'),
        mcpVersion: text('mcpVersion'),
        sourceCommit: text('sourceCommit'),
        sourceModified: null,
        reference: RUNTIME_REFERENCE,
        assessment:
          installed &&
          text('sourceCommit') === RUNTIME_REFERENCE.commit &&
          text('version') === RUNTIME_REFERENCE.version
            ? 'reference-match'
            : installed
              ? 'review-required'
              : 'not-installed',
        scope: 'REMOTE_METADATA_ONLY',
        runtimeMode: 'remote',
        runnerBusy: data?.busy === true,
        runnerStatus:
          data && installed
            ? 'ready'
            : tenantId && runnerTarget(tenantId)
              ? 'unreachable'
              : 'unassigned',
      };
    }
    if (this.cached && Date.now() < this.expiresAt) return this.cached;
    if (this.pending) return this.pending;
    this.pending = this.collect()
      .then((value) => {
        this.cached = value;
        this.expiresAt = Date.now() + 30_000;
        return value;
      })
      .finally(() => {
        this.pending = undefined;
      });
    return this.pending;
  }

  private async collect(): Promise<RuntimeHealth> {
    const result: RuntimeHealth = {
      checkedAt: new Date().toISOString(),
      installed: isInstalled(),
      declaredVersion: null,
      installedVersion: null,
      pythonVersion: null,
      acpVersion: null,
      mcpVersion: null,
      sourceCommit: null,
      sourceModified: null,
      reference: RUNTIME_REFERENCE,
      assessment: 'unknown',
      scope: 'LOCAL_METADATA_ONLY',
    };
    const source = path.join(repoRoot(), 'hermes-agent');
    await Promise.all([
      readFile(path.join(source, 'pyproject.toml'), 'utf8')
        .then((text) => {
          result.declaredVersion =
            text.match(/^version\s*=\s*"([0-9A-Za-z.+-]{1,60})"/m)?.[1] ?? null;
        })
        .catch(() => undefined),
      localCommand('git', ['-C', source, 'rev-parse', 'HEAD'], repoRoot())
        .then((text) => {
          if (/^[a-f0-9]{40}$/.test(text.trim())) result.sourceCommit = text.trim();
        })
        .catch(() => undefined),
      localCommand(
        'git',
        ['-C', source, 'status', '--porcelain', '--untracked-files=no'],
        repoRoot(),
      )
        .then((text) => {
          result.sourceModified = !!text.trim();
        })
        .catch(() => undefined),
      result.installed
        ? localCommand(
            venvPython(),
            [
              '-I',
              '-c',
              'import sys,json,importlib.metadata as m; names=["hermes-agent","agent-client-protocol","mcp"]; print(json.dumps({"python":sys.version.split()[0],**{n:m.version(n) for n in names}}))',
            ],
            repoRoot(),
          )
            .then((text) => {
              const parsed = JSON.parse(text);
              const safe = (key: string): string | null =>
                typeof parsed[key] === 'string' && /^[0-9A-Za-z.+-]{1,60}$/.test(parsed[key])
                  ? parsed[key]
                  : null;
              result.installedVersion = safe('hermes-agent');
              result.pythonVersion = safe('python');
              result.acpVersion = safe('agent-client-protocol');
              result.mcpVersion = safe('mcp');
            })
            .catch(() => undefined)
        : Promise.resolve(),
    ]);
    if (!result.installed) result.assessment = 'not-installed';
    else if (
      result.installedVersion &&
      result.declaredVersion &&
      result.sourceCommit &&
      result.sourceModified !== null
    ) {
      result.assessment =
        result.installedVersion === RUNTIME_REFERENCE.version &&
        result.declaredVersion === RUNTIME_REFERENCE.version &&
        result.sourceCommit === RUNTIME_REFERENCE.commit &&
        !result.sourceModified &&
        result.acpVersion === '0.9.0' &&
        !!result.mcpVersion
          ? 'reference-match'
          : 'review-required';
    }
    return result;
  }
}
