import { readFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { ServiceUnavailableException } from '@nestjs/common';
import type { RuntimeConfigInput } from './agent-runtime-env';

export interface RuntimeProcess extends EventEmitter {
  stdin: Writable;
  stdout: NodeJS.ReadableStream;
  stderr: NodeJS.ReadableStream;
  kill(): boolean;
}

interface RunnerTarget {
  url: string;
  token: string;
  tenantId: string;
}
export const remoteRuntimeEnabled = () => process.env.AGENT_RUNTIME_MODE === 'remote';

/** Operator-owned routing only. No endpoint or credential ever comes from a tenant payload. */
export function runnerTarget(tenantId: string): RunnerTarget | null {
  if (!remoteRuntimeEnabled()) return null;
  try {
    const filename = process.env.AGENT_RUNNERS_FILE;
    if (!filename || !/^[A-Za-z0-9_-]+$/.test(tenantId)) return null;
    const entries: unknown = JSON.parse(readFileSync(filename, 'utf8'));
    if (!Array.isArray(entries)) return null;
    const matches = entries.filter((entry) => entry?.tenantId === tenantId);
    if (matches.length !== 1) return null;
    const { url, tokenFile } = matches[0];
    const endpoint = new URL(url);
    if (
      !['http:', 'https:'].includes(endpoint.protocol) ||
      endpoint.username ||
      endpoint.password ||
      endpoint.search ||
      endpoint.hash ||
      endpoint.pathname !== '/'
    )
      return null;
    const token = readFileSync(tokenFile, 'utf8').trim();
    if (!/^[A-Za-z0-9_-]{43,128}$/.test(token)) return null;
    return { url: endpoint.origin, token, tenantId };
  } catch {
    return null;
  }
}

const unavailable = () =>
  new ServiceUnavailableException(
    'Runner IA indisponible pour cette entreprise. Vérifiez le diagnostic Connexion IA.',
  );

/** One duplex HTTP connection owns one child. Disconnect/kill closes it, never reconnects/replays. */
export async function openRemoteProcess(
  tenantId: string,
  kind: 'acp' | 'login',
  config: RuntimeConfigInput,
  apiKey: string | null,
): Promise<RuntimeProcess> {
  const target = runnerTarget(tenantId);
  if (!target) throw unavailable();
  const endpoint = new URL(`/v1/${kind}`, target.url);
  const proc = new EventEmitter() as RuntimeProcess;
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  proc.stdout = stdout;
  proc.stderr = stderr;
  let closed = false;
  const req = (endpoint.protocol === 'https:' ? httpsRequest : httpRequest)(endpoint, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${target.token}`,
      'x-pulsar-tenant': tenantId,
      'content-type': 'application/x-ndjson',
    },
  });
  // Errors are handled here, not allowed to become unhandled EventEmitter failures in Nest.
  const close = () => {
    if (closed) return;
    closed = true;
    req.destroy();
    stdout.end();
    stderr.end();
    proc.emit('close', null, 'SIGTERM');
  };
  proc.kill = () => {
    close();
    return true;
  };
  proc.stdin = new Writable({
    write(chunk, _encoding, callback) {
      if (closed) {
        callback(new Error('Runtime transport closed'));
        return;
      }
      req.write(chunk, callback);
    },
  });
  proc.stdin.on('error', close);
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      close();
      reject(unavailable());
    }, 10_000);
    req.on('error', () => {
      clearTimeout(timer);
      close();
      reject(unavailable());
    });
    req.on('response', (res) => {
      clearTimeout(timer);
      if (res.statusCode !== 200) {
        res.resume();
        close();
        reject(unavailable());
        return;
      }
      res.pipe(stdout);
      res.on('error', close);
      res.on('close', close);
      resolve();
    });
    req.write(
      JSON.stringify({
        config: {
          tenantId,
          provider: config.provider,
          authMode: config.authMode,
          defaultModel: config.defaultModel ?? null,
          baseUrl: config.baseUrl ?? null,
        },
        apiKey,
      }) + '\n',
    );
  });
  return proc;
}

/** Authenticated metadata, bounded and projected by the caller. No provider call. */
export async function inspectRemoteRuntime(
  tenantId: string,
): Promise<Record<string, unknown> | null> {
  const target = runnerTarget(tenantId);
  if (!target) return null;
  try {
    const response = await fetch(`${target.url}/v1/health`, {
      headers: {
        authorization: `Bearer ${target.token}`,
        'x-pulsar-tenant': tenantId,
      },
      signal: AbortSignal.timeout(3000),
      redirect: 'error',
    });
    if (!response.ok || !response.body) return null;
    const reader = response.body.getReader();
    let text = '';
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        text += Buffer.from(part.value).toString('utf8');
        if (text.length > 8192) return null;
      }
      const value = JSON.parse(text);
      return value?.protocol === 1 && value?.tenantId === tenantId ? value : null;
    } finally {
      await reader.cancel();
    }
  } catch {
    return null;
  }
}
