import http from 'node:http';
import { spawn } from 'node:child_process';
import { timingSafeEqual, createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

// Four 512 KiB images encoded as base64 + text/persona/protocol overhead.
const FRAME_LIMIT = 4 * 1024 * 1024;
const tokenEqual = (a, b) =>
  typeof a === 'string' &&
  Buffer.byteLength(a) === Buffer.byteLength(b) &&
  timingSafeEqual(Buffer.from(a), Buffer.from(b));

export function validateBoot(input, tenantId, providers) {
  const cfg = input?.config;
  const provider = providers.find((p) => p.id === cfg?.provider);
  if (!cfg || cfg.tenantId !== tenantId || !provider || cfg.authMode !== provider.authMode)
    throw new Error('Invalid configuration');
  for (const value of [cfg.defaultModel, cfg.baseUrl, input.apiKey]) {
    if (
      value != null &&
      (typeof value !== 'string' || value.length > 512 || /[\r\n\0]/.test(value))
    )
      throw new Error('Invalid value');
  }
  if (cfg.baseUrl) {
    const url = new URL(cfg.baseUrl);
    if (
      !provider.needsBaseUrl ||
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      (url.port && url.port !== '443')
    )
      throw new Error('HTTPS provider required');
  }
  if (cfg.authMode === 'login' && input.apiKey) throw new Error('OAuth cannot accept API keys');
  return { config: cfg, apiKey: input.apiKey, provider };
}

export function prepareRuntime(boot, options) {
  const { config: cfg, provider, apiKey } = boot;
  // Provider identity has its own OAuth/history store. Never load another provider's tokens.
  const identity = createHash('sha256')
    .update(JSON.stringify([cfg.provider, cfg.authMode, cfg.baseUrl]))
    .digest('hex');
  const home = path.join(options.dataDir, identity);
  const cwd = path.join(home, 'workspace');
  mkdirSync(cwd, { recursive: true, mode: 0o700 });
  let model = cfg.defaultModel || '';
  if (model.startsWith(`${provider.providerKey}:`))
    model = model.slice(provider.providerKey.length + 1);
  if (options.writeConfig !== false)
    writeFileSync(
      path.join(home, 'config.yaml'),
      `model:\n  provider: ${JSON.stringify(provider.providerKey)}\n  default: ${JSON.stringify(model)}\n${cfg.baseUrl ? `  base_url: ${JSON.stringify(cfg.baseUrl)}\n` : ''}`,
      { mode: 0o600 },
    );
  const env = {
    PATH: '/usr/local/bin:/usr/bin:/bin',
    LANG: 'C.UTF-8',
    PYTHONUTF8: '1',
    PYTHONUNBUFFERED: '1',
    PYTHONDONTWRITEBYTECODE: '1',
    HERMES_DISABLE_LAZY_INSTALLS: '1',
    HOME: home,
    HERMES_HOME: home,
    USERPROFILE: home,
    APPDATA: path.join(home, '.config'),
    LOCALAPPDATA: path.join(home, '.local'),
    TMPDIR: '/tmp',
    HTTP_PROXY: options.proxyUrl,
    HTTPS_PROXY: options.proxyUrl,
    ALL_PROXY: options.proxyUrl,
    http_proxy: options.proxyUrl,
    https_proxy: options.proxyUrl,
    NO_PROXY: new URL(options.mcpUrl).hostname,
    no_proxy: new URL(options.mcpUrl).hostname,
  };
  if (apiKey && provider.keyEnvVar) env[provider.keyEnvVar] = apiKey;
  if (cfg.baseUrl) env.OPENAI_BASE_URL = cfg.baseUrl;
  return { cwd, env };
}

/** Enforce one governed HTTP MCP endpoint; no stdio servers, paths, or extra headers. */
export function constrainFrame(frame, cwd, mcpUrl) {
  if (!frame || typeof frame !== 'object') throw new Error('Invalid ACP frame');
  if (['session/new', 'session/load'].includes(frame.method)) {
    const servers = frame.params?.mcpServers;
    if (!Array.isArray(servers) || servers.length > 1) throw new Error('Invalid MCP');
    frame.params.cwd = cwd;
    frame.params.mcpServers = servers.map((server) => {
      if (
        server.type !== 'http' ||
        server.name !== 'pulsar' ||
        !Array.isArray(server.headers) ||
        server.headers.length !== 1
      )
        throw new Error('Invalid MCP');
      const header = server.headers[0];
      if (
        header.name !== 'X-Agent-Key' ||
        typeof header.value !== 'string' ||
        !header.value ||
        header.value.length > 4096 ||
        /[\r\n]/.test(header.value)
      )
        throw new Error('Invalid MCP credential');
      return { type: 'http', name: 'pulsar', url: mcpUrl, headers: [header] };
    });
  }
  return frame;
}

export function createRunner(options) {
  if (!/^[A-Za-z0-9_-]+$/.test(options.tenantId) || !/^[A-Za-z0-9_-]{43,128}$/.test(options.token))
    throw new Error('Runner identity required');
  const mcp = new URL(options.mcpUrl);
  const proxy = new URL(options.proxyUrl);
  if (
    !['http:', 'https:'].includes(mcp.protocol) ||
    mcp.pathname !== '/api/v1/mcp' ||
    mcp.username ||
    mcp.password ||
    mcp.search ||
    mcp.hash ||
    proxy.protocol !== 'http:' ||
    proxy.pathname !== '/' ||
    proxy.username ||
    proxy.password ||
    proxy.search ||
    proxy.hash
  )
    throw new Error('Invalid private endpoints');
  const maxConcurrent = options.maxConcurrent ?? 4;
  if (!Number.isInteger(maxConcurrent) || maxConcurrent < 1 || maxConcurrent > 8)
    throw new Error('Runner concurrency must be an integer between 1 and 8');
  let active = 0;
  let exclusive = false;
  // A configuration generation is immutable while any child is alive. The pinned
  // runtime locks OAuth refreshes cross-process and uses SQLite WAL for history.
  let generation;
  const children = new Set();
  const server = http.createServer((req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const fail = (status) => {
      res.writeHead(status);
      res.end();
      req.resume();
    };
    if (
      !tokenEqual(req.headers.authorization, `Bearer ${options.token}`) ||
      req.headers['x-pulsar-tenant'] !== options.tenantId
    )
      return fail(401);
    if (req.method === 'GET' && req.url === '/v1/health') {
      res.setHeader('Content-Type', 'application/json');
      return res.end(
        JSON.stringify({
          protocol: 1,
          tenantId: options.tenantId,
          installed: true,
          ...options.metadata,
          busy: active > 0,
          activeProcesses: active,
          maxConcurrent,
          loginActive: exclusive,
        }),
      );
    }
    if (req.method !== 'POST' || !['/v1/acp', '/v1/login'].includes(req.url)) return fail(404);
    const login = req.url === '/v1/login';
    if (exclusive || active >= maxConcurrent || (login && active > 0)) return fail(409);
    active++;
    if (login) exclusive = true;
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      active--;
      if (login) exclusive = false;
      if (active === 0) generation = undefined;
    };
    let child,
      cwd,
      buffered = '',
      booted = false,
      stopped = false,
      outputBytes = 0;
    let idle = setTimeout(() => stop(), 5000);
    const lifetime = setTimeout(() => stop('LOGIN_TIMEOUT'), login ? 600_000 : 3_600_000);
    const stop = (code) => {
      if (stopped) return;
      stopped = true;
      clearTimeout(idle);
      clearTimeout(lifetime);
      if (
        login &&
        res.headersSent &&
        !res.destroyed &&
        !res.writableEnded &&
        ['LOGIN_TIMEOUT', 'LOGIN_OUTPUT_LIMIT', 'LOGIN_PROCESS'].includes(code)
      )
        sendLogin({ type: 'error', code });
      if (child) {
        child.kill('SIGTERM');
        const force = setTimeout(() => child.kill('SIGKILL'), 2000);
        force.unref();
        // Do not release the lease until the process actually exits.
        child.once('close', () => {
          clearTimeout(force);
          release();
          children.delete(child);
        });
      } else release();
      if (!res.headersSent) res.writeHead(503);
      res.end();
    };
    res.on('close', stop);
    req.on('aborted', stop);
    req.on('error', stop);
    const sendLogin = (event) => {
      if (!res.destroyed && !res.writableEnded) res.write(JSON.stringify(event) + '\n');
    };
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      if (stopped) return;
      buffered += chunk;
      if (Buffer.byteLength(buffered) > FRAME_LIMIT) return stop();
      try {
        let newline;
        while ((newline = buffered.indexOf('\n')) !== -1) {
          const line = buffered.slice(0, newline);
          buffered = buffered.slice(newline + 1);
          const frame = JSON.parse(line);
          if (!booted) {
            const boot = validateBoot(frame, options.tenantId, options.providers);
            if (login && !boot.provider.loginCommand) throw new Error('Login unavailable');
            const fingerprint = createHash('sha256')
              .update(
                JSON.stringify([
                  boot.config.provider,
                  boot.config.authMode,
                  boot.config.baseUrl ?? null,
                  boot.config.defaultModel ?? null,
                  boot.apiKey ?? null,
                ]),
              )
              .digest('hex');
            if (generation && generation !== fingerprint) {
              res.writeHead(409);
              return stop();
            }
            const writeConfig = !generation;
            const prepared = (options.prepare ?? prepareRuntime)(boot, { ...options, writeConfig });
            generation = fingerprint;
            cwd = prepared.cwd;
            // -I ignores PYTHONUNBUFFERED/PYTHONUTF8: use explicit flags so the
            // device code is visible during polling, with the API's UTF-8 encoding.
            const args = login
              ? [
                  '-I',
                  '-u',
                  '-X',
                  'utf8',
                  options.loginWrapper,
                  ...boot.provider.loginCommand.split(/\s+/),
                ]
              : ['-I', options.wrapper];
            child = (options.spawn ?? spawn)(options.python, args, {
              cwd,
              env: prepared.env,
              windowsHide: true,
              stdio: ['pipe', 'pipe', 'pipe'],
            });
            children.add(child);
            booted = true;
            clearTimeout(idle);
            idle = setTimeout(() => stop('LOGIN_TIMEOUT'), login ? 600_000 : 300_000);
            child.on('error', () => stop('LOGIN_PROCESS'));
            child.stdin.on('error', () => stop('LOGIN_PROCESS'));
            child.stdout.on('error', () => stop('LOGIN_PROCESS'));
            child.stderr.on('error', () => stop('LOGIN_PROCESS'));
            child.on('close', (code) => {
              children.delete(child);
              release();
              if (login && !stopped)
                sendLogin(code === 0 ? { type: 'end' } : { type: 'error', code: 'LOGIN_EXIT' });
              clearTimeout(idle);
              clearTimeout(lifetime);
              stopped = true;
              res.end();
            });
            res.writeHead(200, {
              'content-type': 'application/x-ndjson',
              'x-accel-buffering': 'no',
            });
            res.flushHeaders();
            if (login) {
              child.stdout.setEncoding('utf8');
              child.stderr.setEncoding('utf8');
              const emit = (chunk) => {
                outputBytes += Buffer.byteLength(chunk);
                if (outputBytes > 65536) return stop('LOGIN_OUTPUT_LIMIT');
                sendLogin({ type: 'text', text: chunk.toString('utf8') });
              };
              child.stdout.on('data', emit);
              child.stderr.on('data', emit);
            } else {
              child.stderr.resume(); // Never leak raw runtime/provider diagnostics to the API or logs.
              child.stdout.pipe(res, { end: false });
            }
          } else {
            if (login) throw new Error('No login stdin');
            clearTimeout(idle);
            idle = setTimeout(stop, 300_000);
            const payload = JSON.stringify(constrainFrame(frame, cwd, options.mcpUrl)) + '\n';
            if (!child.stdin.write(payload)) {
              req.pause();
              child.stdin.once('drain', () => req.resume());
            }
          }
        }
      } catch {
        stop();
      }
    });
    req.on('end', stop); // A duplex ACP request stays open for the lifetime of its process.
  });
  server.requestTimeout = 0;
  server.headersTimeout = 10_000;
  server.maxConnections = 32;
  server.on('close', () => {
    for (const child of children) child.kill('SIGKILL');
  });
  server.stopChildren = () => {
    for (const child of children) child.kill('SIGTERM');
  };
  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const require = createRequire(import.meta.url);
  const { RUNTIME_PROVIDERS } = require('./providers.cjs');
  const server = createRunner({
    tenantId: process.env.RUNNER_TENANT_ID,
    token: readFileSync(process.env.RUNNER_TOKEN_FILE, 'utf8').trim(),
    providers: RUNTIME_PROVIDERS,
    dataDir: '/data',
    python: '/app/hermes-agent/.venv/bin/python',
    wrapper: '/app/scripts/pulsar-hermes-acp.py',
    loginWrapper: '/app/scripts/pulsar-hermes-login.py',
    mcpUrl: process.env.RUNNER_MCP_URL,
    proxyUrl: process.env.RUNNER_PROXY_URL,
    maxConcurrent: Number(process.env.RUNNER_MAX_CONCURRENT ?? 4),
    metadata: JSON.parse(readFileSync('/app/runner/metadata.json', 'utf8')),
  });
  server.listen(3001, '0.0.0.0');
  for (const signal of ['SIGTERM', 'SIGINT'])
    process.on(signal, () => {
      server.stopChildren();
      server.close();
      server.closeAllConnections();
    });
}
