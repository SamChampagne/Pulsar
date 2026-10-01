import {
  BadRequestException,
  forwardRef,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
  type OnModuleDestroy,
} from '@nestjs/common';
import { spawn, type ChildProcess, type ChildProcessWithoutNullStreams } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import {
  getRuntimeProvider,
  AGENT_SYSTEM_PREAMBLE,
  deriveRuntimeReadiness,
  type RuntimeAuthMode,
  type RuntimeReadiness,
  agentTurnMessage,
  failedAgentTurn,
} from '@pulsar/shared';
import { HermesAcpClient, type AcpEvent, type AcpModelOption } from './hermes-acp.client';
import { AgentsService } from './agents.service';
import { RuntimeConfigService } from './runtime-config.service';
import { buildRuntimeEnv, isolatedRuntimeEnv, renderCliConfig } from './agent-runtime-env';
import { isInstalled, repoRoot, venvPython } from './runtime-install';
import {
  remoteRuntimeEnabled,
  openRemoteProcess,
  inspectRemoteRuntime,
  type RuntimeProcess,
} from './remote-runtime';

/**
 * Races `promise` against a deadline. If the deadline fires first, `onTimeout`
 * is called (use it to kill the child), then a ServiceUnavailableException is
 * thrown with `message`.
 */
async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  onTimeout: () => void,
  message: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      onTimeout();
      reject(new ServiceUnavailableException(message));
    }, ms);
  });
  try {
    return await Promise.race([promise, deadline]);
  } finally {
    clearTimeout(timer!);
  }
}

interface OpenSessionInput {
  tenantId: string;
  agent: { id: string; model: string | null; persona: string | null };
  pulsarMcpUrl: string;
  triggeredByRef?: string;
}

interface LiveSession {
  agentId: string;
  client: HermesAcpClient;
  child: RuntimeProcess;
  persona: string | null;
  firstTurnDone: boolean;
}

export interface LoginEvent {
  type: 'text' | 'error' | 'end';
  text?: string;
  message?: string;
}

@Injectable()
export class AgentRuntimeService implements OnModuleDestroy {
  private readonly turnTimeoutMs = 120_000;
  private readonly logger = new Logger(AgentRuntimeService.name);
  /** One Hermes process PER conversation (isolation — spike finding). Keyed by hermes sessionId. */
  private readonly live = new Map<string, LiveSession>();

  constructor(
    @Inject(forwardRef(() => AgentsService))
    private readonly agents: AgentsService,
    private readonly runtimeConfig: RuntimeConfigService,
  ) {}

  /**
   * Nest lifecycle hook (requires `app.enableShutdownHooks()` in main.ts): on
   * SIGTERM/SIGINT (container stop/redeploy) kill every still-live Hermes child
   * process so none survive as orphans/zombies. Best-effort and non-throwing —
   * mirrors the posture of `killAgentSessions` (rule 24: the agent runtime is
   * best-effort and isolated, never allowed to block or crash teardown).
   */
  onModuleDestroy(): void {
    const count = this.live.size;
    if (count === 0) return;
    for (const [sessionId, session] of this.live) {
      try {
        session.child.kill();
      } catch (err) {
        this.logger.warn(
          `Failed to kill Hermes child for session ${sessionId}: ${err instanceof Error ? err.message : err}`,
        );
      }
    }
    this.live.clear();
    this.logger.log(`Shutdown: killed ${count} live Hermes agent session(s).`);
  }

  /**
   * Prepares a tenant's HERMES_HOME and spawns the ACP adapter under the
   * vendored venv python with the per-tenant config + provider env. Returns the
   * spawned child and the live HermesAcpClient (post-`initialize`).
   */
  private async spawnRuntime(
    tenantId: string,
    requireAuth = false,
  ): Promise<{
    child: RuntimeProcess;
    client: HermesAcpClient;
    defaultModel: string | null;
    cwd: string;
    configVersion: Date;
  }> {
    if (remoteRuntimeEnabled()) {
      const { config, decryptedKey } = await this.runtimeConfig.resolveForSpawn(tenantId);
      if (
        requireAuth &&
        ((config.authMode === 'login' && !config.connectedAt) ||
          (config.authMode === 'apiKey' && !decryptedKey))
      ) {
        throw new ServiceUnavailableException(
          'Connectez d’abord le fournisseur dans Connexion IA.',
        );
      }
      const child = await openRemoteProcess(tenantId, 'acp', config, decryptedKey);
      try {
        const client = new HermesAcpClient(HermesAcpClient.stdioTransport(child));
        await withTimeout(
          client.initialize(),
          10_000,
          () => {
            child.kill();
          },
          'Runner IA trop lent',
        );
        return {
          child,
          client,
          defaultModel: config.defaultModel,
          cwd: '/data/workspace',
          configVersion: config.updatedAt,
        };
      } catch (error) {
        child.kill();
        throw error;
      }
    }
    if (!isInstalled()) {
      throw new BadRequestException('Agent runtime not installed — run `pnpm agents:setup`');
    }
    const { config, decryptedKey } = await this.runtimeConfig.resolveForSpawn(tenantId);
    const { env, homeDir } = buildRuntimeEnv(
      config,
      decryptedKey,
      this.runtimeConfig.hermesHomeRoot(),
    );

    // Provision the managed HERMES_HOME with the provider/model config. The Hermes
    // adapter reads HERMES_HOME/config.yaml (hermes_cli.config.load_config →
    // get_config_path() = HERMES_HOME/"config.yaml"). Writing "cli-config.yaml" here
    // meant the per-tenant provider/model was NEVER loaded, so the agent ran with no
    // model and produced no tool calls. Schema is identical (model.provider/default/base_url).
    fs.mkdirSync(homeDir, { recursive: true });
    fs.writeFileSync(path.join(homeDir, 'config.yaml'), renderCliConfig(config));
    const cwd = path.join(homeDir, 'workspace');
    fs.mkdirSync(cwd, { recursive: true });

    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(
        venvPython(),
        ['-I', path.join(repoRoot(), 'scripts', 'pulsar-hermes-acp.py')],
        {
          stdio: ['pipe', 'pipe', 'pipe'],
          cwd,
          env: isolatedRuntimeEnv(env),
          windowsHide: true,
        },
      ) as ChildProcessWithoutNullStreams;
    } catch {
      throw new ServiceUnavailableException('Agent runtime (Hermes) unavailable');
    }
    // spawn() failures can arrive asynchronously; never let EventEmitter crash Nest.
    child.on('error', () => this.logger.warn('Hermes process could not start.'));
    // Capture the child's stderr (logs) and exit so a fast crash is diagnosable
    // instead of surfacing only the opaque "ACP transport closed" from stdout EOF.
    const stderrTail: string[] = [];
    child.stderr.on('data', (c: Buffer | string) => {
      const s = typeof c === 'string' ? c : c.toString('utf8');
      stderrTail.push(s);
      if (stderrTail.length > 50) stderrTail.shift();
    });
    let exitInfo: string | null = null;
    child.on('exit', (code, signal) => {
      exitInfo = `code=${code} signal=${signal}`;
      // SIGTERM is our own intentional teardown (closeSession / killAgentSessions /
      // timeout). Only shout about an UNEXPECTED self-exit (a real crash).
      if (signal !== 'SIGTERM' && code !== 0) {
        console.error(
          `[agent-runtime] hermes child crashed (${exitInfo}). stderr tail:\n` +
            stderrTail.join('').split(/\r?\n/).filter(Boolean).slice(-25).join('\n'),
        );
      }
    });
    // Any failure after a successful spawn must kill the child to avoid zombie processes.
    try {
      const client = new HermesAcpClient(HermesAcpClient.stdioTransport(child));
      await withTimeout(
        client.initialize(),
        10_000,
        () => {
          child.kill();
        },
        'Agent runtime did not start in time',
      );
      return {
        child,
        client,
        defaultModel: config.defaultModel,
        cwd,
        configVersion: config.updatedAt,
      };
    } catch (e) {
      child.kill();
      const tail = stderrTail.join('').split(/\r?\n/).filter(Boolean).slice(-25).join('\n');
      console.error(
        `[agent-runtime] spawnRuntime failed (${exitInfo ?? 'still running'}): ` +
          (e instanceof Error ? e.message : String(e)) +
          (tail ? `\n--- hermes stderr ---\n${tail}` : ' (no stderr captured)'),
      );
      throw e;
    }
  }

  /** Spawns a dedicated Hermes ACP process, opens a session scoped to this agent. Returns the hermes sessionId. */
  async openSession(input: OpenSessionInput): Promise<string> {
    const { child, client, defaultModel, cwd } = await this.spawnRuntime(input.tenantId, true);
    try {
      const token = this.agents.mintSessionToken(input.agent.id, 300, input.triggeredByRef);
      const { sessionId } = await client.newSession({
        cwd,
        mcpServers: [
          {
            type: 'http',
            name: 'pulsar',
            url: input.pulsarMcpUrl,
            headers: [{ name: 'X-Agent-Key', value: token }],
          },
        ],
      });
      // Always pin the model via session/set_model (which correctly splits the
      // `provider:model` form). Fall back to the tenant's runtime defaultModel when
      // the agent has none — otherwise Hermes uses the cli-config default raw and
      // a `provider:model` value 404s at the provider (prefix not stripped).
      const effectiveModel = input.agent.model || defaultModel;
      if (effectiveModel) {
        await client.setModel(sessionId, effectiveModel);
      }
      this.rememberSession(sessionId, {
        agentId: input.agent.id,
        client,
        child,
        persona: input.agent.persona,
        firstTurnDone: false,
      });
      return sessionId;
    } catch (err) {
      child.kill();
      this.logger.warn('Agent session could not be opened; runtime/model check required.');
      throw new ServiceUnavailableException(
        'Session Hermes indisponible; vérifiez le runtime et le modèle choisi.',
      );
    }
  }

  /** True when a Hermes session is currently live in this process. */
  isLive(sessionId: string | null | undefined): boolean {
    return !!sessionId && this.live.has(sessionId);
  }

  private rememberSession(id: string, session: LiveSession): void {
    this.live.set(id, session);
    session.child.once('close', () => {
      if (this.live.get(id)?.child === session.child) this.live.delete(id);
    });
  }

  /**
   * Re-attaches to an existing conversation whose in-memory session died (e.g. a
   * runtime restart). Spawns a fresh Hermes process, resumes the persisted
   * session by id (Hermes replays the transcript into the agent's context), and
   * registers it live. Returns the effective sessionId (usually the same one).
   * `firstTurnDone` is set true so the persona isn't re-sent — the resumed
   * transcript already carries it.
   */
  async resumeSession(
    input: OpenSessionInput & { existingSessionId?: string | null },
  ): Promise<string> {
    // No prior session id to resume → behave like a fresh open.
    if (!input.existingSessionId) return this.openSession(input);

    const { child, client, defaultModel, cwd } = await this.spawnRuntime(input.tenantId, true);
    try {
      const token = this.agents.mintSessionToken(input.agent.id, 300, input.triggeredByRef);
      const { sessionId } = await client.resumeSession(
        {
          cwd,
          mcpServers: [
            {
              type: 'http',
              name: 'pulsar',
              url: input.pulsarMcpUrl,
              headers: [{ name: 'X-Agent-Key', value: token }],
            },
          ],
        },
        input.existingSessionId,
      );
      const effectiveModel = input.agent.model || defaultModel;
      if (effectiveModel) {
        await client.setModel(sessionId, effectiveModel);
      }
      this.rememberSession(sessionId, {
        agentId: input.agent.id,
        client,
        child,
        persona: input.agent.persona,
        firstTurnDone: true,
      });
      return sessionId;
    } catch (err) {
      child.kill();
      this.logger.warn('Agent session could not be resumed; runtime/history check required.');
      throw new ServiceUnavailableException(
        'Reprise Hermes indisponible; vérifiez le runtime et le modèle choisi.',
      );
    }
  }

  /** Streams normalized events for one user turn. Prepends the persona on the first turn. */
  async *sendTurn(
    sessionId: string,
    text: string,
    images: import('./hermes-acp.client').AcpImage[] = [],
  ): AsyncGenerator<AcpEvent> {
    const live = this.live.get(sessionId);
    if (!live) throw new ServiceUnavailableException('Conversation session not live');
    // First turn carries the system grounding (keep the agent on Pulsar tools, off
    // the filesystem/terminal) + the agent's persona, before the user's text.
    const prompt = live.firstTurnDone
      ? text
      : [AGENT_SYSTEM_PREAMBLE, live.persona, '---', text].filter(Boolean).join('\n\n');
    live.firstTurnDone = true;
    const iterator = live.client.prompt(sessionId, prompt, images);
    const timedOut = Symbol('turn-timeout');
    let timer: ReturnType<typeof setTimeout>;
    const deadline = new Promise<typeof timedOut>((resolve) => {
      timer = setTimeout(() => resolve(timedOut), this.turnTimeoutMs);
    });
    try {
      while (true) {
        const next = await Promise.race([iterator.next(), deadline]);
        if (next === timedOut) {
          try {
            live.client.cancel(sessionId);
          } catch {
            /* child may already be gone */
          }
          await this.closeSession(sessionId);
          const result = failedAgentTurn('TIMEOUT');
          yield { type: 'error', message: agentTurnMessage(result) };
          yield { type: 'result', result };
          yield { type: 'end' };
          return;
        }
        if (next.done) return;
        yield next.value;
      }
    } finally {
      clearTimeout(timer!);
      // A dead transport may not settle immediately; do not keep the caller stuck.
      void iterator.return?.(undefined).catch(() => undefined);
      // Release the tenant runner between turns. The next turn strictly loads the
      // persisted history; no speculative replay or fresh-session fallback.
      if (remoteRuntimeEnabled()) await this.closeSession(sessionId);
    }
  }

  async closeSession(sessionId: string): Promise<void> {
    const live = this.live.get(sessionId);
    if (!live) return;
    this.live.delete(sessionId);
    await live.client.closeSession(sessionId).catch(() => undefined);
    live.child.kill();
  }

  /**
   * Hot kill switch (phase 13): closes and kills every live Hermes session for an
   * agent. Best-effort — never throws. Returns the number of sessions killed.
   */
  async killAgentSessions(agentId: string): Promise<number> {
    const victims = [...this.live.entries()].filter(([, s]) => s.agentId === agentId);
    for (const [sessionId, session] of victims) {
      this.live.delete(sessionId);
      await session.client.closeSession(sessionId).catch(() => undefined);
      session.child.kill();
    }
    return victims.length;
  }

  /**
   * Cheap readiness probe (NO spawn): can the runtime actually run an agent right now?
   * Checks install → config → auth (apiKey stored / login connected) → model → last probe,
   * via the pure {@link deriveRuntimeReadiness} so the first failing precondition is
   * surfaced honestly. Used by manual "Run now" to avoid claiming a fake success. Pass the
   * agent's model override so an agent-level model satisfies the model precondition even
   * when the tenant config has no default. For a real connectivity check use
   * {@link testConnection}.
   */
  async readiness(tenantId: string, agentModel?: string | null): Promise<RuntimeReadiness> {
    const config = await this.runtimeConfig.get(tenantId);
    // Prefer the provider catalog's auth mode; fall back to the stored config value.
    const authMode: RuntimeAuthMode | null = config
      ? (getRuntimeProvider(config.provider)?.authMode ?? (config.authMode as RuntimeAuthMode))
      : null;
    return deriveRuntimeReadiness({
      installed: await this.installedForTenant(tenantId),
      configured: !!config,
      authMode,
      hasApiKey: !!config?.apiKeyEnc,
      connected: !!config?.connectedAt,
      hasModel: !!(agentModel ?? config?.defaultModel),
      lastTestOk: config?.lastTestOk ?? null,
    });
  }

  /**
   * Best-effort connectivity probe: spawns a throwaway runtime, initializes and
   * opens a bare session (no MCP), records the result via `markTested`, and tears
   * the process down. Never throws — failures are returned as `{ ok:false, error }`.
   */
  async testConnection(
    tenantId: string,
  ): Promise<{ ok: boolean; scope: 'RUNTIME_ONLY'; models?: AcpModelOption[]; error?: string }> {
    let child: RuntimeProcess | undefined;
    let configVersion: Date | undefined;
    try {
      configVersion = (await this.runtimeConfig.get(tenantId))?.updatedAt;
      const spawned = await this.spawnRuntime(tenantId);
      configVersion = spawned.configVersion;
      child = spawned.child;
      const { sessionId, models } = await withTimeout(
        spawned.client.newSession({
          cwd: spawned.cwd,
          mcpServers: [],
        }),
        15_000,
        () => child?.kill(),
        'Runtime check timed out',
      );
      await withTimeout(
        spawned.client.closeSession(sessionId),
        2_000,
        () => child?.kill(),
        'Runtime close timed out',
      ).catch(() => undefined);
      // A runtime catalog, not proof of provider entitlement or model availability.
      await this.runtimeConfig.markTested(tenantId, true, models, spawned.configVersion);
      return { ok: true, scope: 'RUNTIME_ONLY', models };
    } catch (err) {
      if (configVersion)
        await this.runtimeConfig
          .markTested(tenantId, false, undefined, configVersion)
          .catch(() => undefined);
      // Do not expose stderr or mistake opening an ACP session for provider inference.
      return {
        ok: false,
        scope: 'RUNTIME_ONLY',
        error:
          'Le contrôle du runtime a échoué. Aucun appel au modèle n’a été validé. Consultez le diagnostic Connexion IA.',
      };
    } finally {
      child?.kill();
    }
  }

  /**
   * Drives an interactive login flow (Nous OAuth / Codex device code) for a
   * login-mode provider. Spawns the `hermes` CLI under the venv python with the
   * provider's login subcommand and HERMES_HOME pointed at the tenant's managed
   * home, streaming the CLI's stdout/stderr lines (which carry the device code
   * + verification URL) as `text` events. Exit 0 → `markConnected` + `end`.
   */
  async installedForTenant(tenantId: string): Promise<boolean> {
    return remoteRuntimeEnabled()
      ? (await inspectRemoteRuntime(tenantId))?.installed === true
      : isInstalled();
  }

  async *connectLogin(tenantId: string, signal?: AbortSignal): AsyncGenerator<LoginEvent> {
    if (remoteRuntimeEnabled()) {
      const { config, decryptedKey } = await this.runtimeConfig.resolveForSpawn(tenantId);
      const child = await openRemoteProcess(tenantId, 'login', config, decryptedKey);
      const stop = () => {
        child.kill();
      };
      signal?.addEventListener('abort', stop, { once: true });
      if (signal?.aborted) stop();
      let buffer = '';
      const decoder = new StringDecoder('utf8');
      let finished = false;
      try {
        for await (const chunk of child.stdout) {
          buffer += typeof chunk === 'string' ? chunk : decoder.write(chunk);
          if (buffer.length > 65_536) throw new Error('Login response too large');
          let nl: number;
          while ((nl = buffer.indexOf('\n')) >= 0) {
            const event = JSON.parse(buffer.slice(0, nl));
            buffer = buffer.slice(nl + 1);
            if (event.type === 'text' && typeof event.text === 'string')
              yield { type: 'text', text: event.text };
            else if (event.type === 'end') {
              if (!signal?.aborted)
                await this.runtimeConfig.markConnected(tenantId, config.updatedAt);
              finished = true;
              yield { type: 'end' };
              return;
            } else if (event.type === 'error') {
              finished = true;
              yield { type: 'error', message: 'Connexion fournisseur interrompue ou refusée.' };
              return;
            }
          }
        }
        if (!finished && !signal?.aborted)
          yield {
            type: 'error',
            message: 'Connexion fournisseur interrompue. Relancez la connexion.',
          };
      } finally {
        signal?.removeEventListener('abort', stop);
        child.kill();
      }
      return;
    }
    if (!isInstalled()) {
      yield { type: 'error', message: 'Agent runtime not installed — run `pnpm agents:setup`' };
      return;
    }
    const { config, decryptedKey } = await this.runtimeConfig.resolveForSpawn(tenantId);
    const provider = getRuntimeProvider(config.provider);
    if (!provider || provider.authMode !== 'login' || !provider.loginCommand) {
      yield { type: 'error', message: `Provider "${config.provider}" does not use a login flow` };
      return;
    }

    const { env, homeDir } = buildRuntimeEnv(
      config,
      decryptedKey,
      this.runtimeConfig.hermesHomeRoot(),
    );
    fs.mkdirSync(homeDir, { recursive: true });

    // e.g. "login" → [-m, hermes_cli.main, login]; "auth add openai-codex" → [..., auth, add, openai-codex]
    const loginArgs = ['-m', 'hermes_cli.main', ...provider.loginCommand.split(/\s+/)];

    let child: ChildProcess;
    try {
      child = spawn(venvPython(), loginArgs, {
        stdio: ['ignore', 'pipe', 'pipe'],
        cwd: path.join(repoRoot(), 'hermes-agent'),
        env: isolatedRuntimeEnv(env),
        windowsHide: true,
      });
    } catch (err) {
      yield { type: 'error', message: err instanceof Error ? err.message : String(err) };
      return;
    }

    const queue: LoginEvent[] = [];
    let wake: (() => void) | null = null;
    let exitCode: number | null = null;
    let hasExited = false;
    const push = (ev: LoginEvent) => {
      queue.push(ev);
      wake?.();
    };
    const lineEmitter = () => {
      let buf = '';
      return (chunk: Buffer | string) => {
        buf += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
        let nl: number;
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl).replace(/\r$/, '');
          buf = buf.slice(nl + 1);
          push({ type: 'text', text: line });
        }
      };
    };
    child.stdout?.on('data', lineEmitter());
    child.stderr?.on('data', lineEmitter());
    child.on('error', (err) => push({ type: 'error', message: err.message }));
    child.on('close', (code) => {
      exitCode = code;
      hasExited = true;
      wake?.();
    });

    try {
      while (true) {
        while (queue.length) yield queue.shift()!;
        if (hasExited) break;
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
        wake = null;
      }
      // Drain any final buffered events.
      while (queue.length) yield queue.shift()!;

      if (exitCode === 0) {
        await this.runtimeConfig.markConnected(tenantId, config.updatedAt);
        yield { type: 'end' };
      } else {
        yield { type: 'error', message: `Login exited with code ${exitCode}` };
      }
    } finally {
      child.kill();
    }
  }
}
