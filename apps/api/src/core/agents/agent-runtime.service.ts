import {
  BadRequestException,
  forwardRef,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { spawn, type ChildProcess, type ChildProcessWithoutNullStreams } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { getRuntimeProvider, AGENT_SYSTEM_PREAMBLE } from '@pulsar/shared';
import { HermesAcpClient, type AcpEvent, type AcpModelOption } from './hermes-acp.client';
import { AgentsService } from './agents.service';
import { RuntimeConfigService } from './runtime-config.service';
import { buildRuntimeEnv, renderCliConfig } from './agent-runtime-env';
import { isInstalled, repoRoot, venvPython } from './runtime-install';

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
  child: ChildProcessWithoutNullStreams;
  persona: string | null;
  firstTurnDone: boolean;
}

export interface LoginEvent {
  type: 'text' | 'error' | 'end';
  text?: string;
  message?: string;
}

@Injectable()
export class AgentRuntimeService {
  /** One Hermes process PER conversation (isolation — spike finding). Keyed by hermes sessionId. */
  private readonly live = new Map<string, LiveSession>();

  constructor(
    @Inject(forwardRef(() => AgentsService))
    private readonly agents: AgentsService,
    private readonly runtimeConfig: RuntimeConfigService,
  ) {}

  /**
   * Prepares a tenant's HERMES_HOME and spawns the ACP adapter under the
   * vendored venv python with the per-tenant config + provider env. Returns the
   * spawned child and the live HermesAcpClient (post-`initialize`).
   */
  private async spawnRuntime(tenantId: string): Promise<{
    child: ChildProcessWithoutNullStreams;
    client: HermesAcpClient;
    defaultModel: string | null;
  }> {
    if (!isInstalled()) {
      throw new BadRequestException('Agent runtime not installed — run `pnpm agents:setup`');
    }
    const { config, decryptedKey } = await this.runtimeConfig.resolveForSpawn(tenantId);
    const { env, homeDir } = buildRuntimeEnv(config, decryptedKey, this.runtimeConfig.hermesHomeRoot());

    // Provision the managed HERMES_HOME with the provider/model config. The Hermes
    // adapter reads HERMES_HOME/config.yaml (hermes_cli.config.load_config →
    // get_config_path() = HERMES_HOME/"config.yaml"). Writing "cli-config.yaml" here
    // meant the per-tenant provider/model was NEVER loaded, so the agent ran with no
    // model and produced no tool calls. Schema is identical (model.provider/default/base_url).
    fs.mkdirSync(homeDir, { recursive: true });
    fs.writeFileSync(path.join(homeDir, 'config.yaml'), renderCliConfig(config));

    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(venvPython(), ['-m', 'acp_adapter'], {
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd: path.join(repoRoot(), 'hermes-agent'),
        env: { ...process.env, ...env },
      }) as ChildProcessWithoutNullStreams;
    } catch {
      throw new ServiceUnavailableException('Agent runtime (Hermes) unavailable');
    }
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
        () => { child.kill(); },
        'Agent runtime did not start in time',
      );
      return { child, client, defaultModel: config.defaultModel };
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
    const { child, client, defaultModel } = await this.spawnRuntime(input.tenantId);
    try {
      const token = this.agents.mintSessionToken(input.agent.id, 300, input.triggeredByRef);
      const { sessionId } = await client.newSession({
        cwd: process.cwd(),
        mcpServers: [
          { type: 'http', name: 'pulsar', url: input.pulsarMcpUrl, headers: [{ name: 'X-Agent-Key', value: token }] },
        ],
      });
      // Always pin the model via session/set_model (which correctly splits the
      // `provider:model` form). Fall back to the tenant's runtime defaultModel when
      // the agent has none — otherwise Hermes uses the cli-config default raw and
      // a `provider:model` value 404s at the provider (prefix not stripped).
      const effectiveModel = input.agent.model || defaultModel;
      if (effectiveModel) {
        await client.setModel(sessionId, effectiveModel).catch(() => undefined);
      }
      this.live.set(sessionId, { agentId: input.agent.id, client, child, persona: input.agent.persona, firstTurnDone: false });
      return sessionId;
    } catch (err) {
      child.kill();
      const detail = err instanceof Error ? err.message : String(err);
      console.error('[agent-runtime] openSession failed:', detail);
      throw new ServiceUnavailableException(`Session Hermes échouée : ${detail}`);
    }
  }

  /** True when a Hermes session is currently live in this process. */
  isLive(sessionId: string | null | undefined): boolean {
    return !!sessionId && this.live.has(sessionId);
  }

  /**
   * Re-attaches to an existing conversation whose in-memory session died (e.g. a
   * runtime restart). Spawns a fresh Hermes process, resumes the persisted
   * session by id (Hermes replays the transcript into the agent's context), and
   * registers it live. Returns the effective sessionId (usually the same one).
   * `firstTurnDone` is set true so the persona isn't re-sent — the resumed
   * transcript already carries it.
   */
  async resumeSession(input: OpenSessionInput & { existingSessionId?: string | null }): Promise<string> {
    // No prior session id to resume → behave like a fresh open.
    if (!input.existingSessionId) return this.openSession(input);

    const { child, client, defaultModel } = await this.spawnRuntime(input.tenantId);
    try {
      const token = this.agents.mintSessionToken(input.agent.id, 300, input.triggeredByRef);
      const { sessionId } = await client.resumeSession(
        {
          cwd: process.cwd(),
          mcpServers: [
            { type: 'http', name: 'pulsar', url: input.pulsarMcpUrl, headers: [{ name: 'X-Agent-Key', value: token }] },
          ],
        },
        input.existingSessionId,
      );
      const effectiveModel = input.agent.model || defaultModel;
      if (effectiveModel) {
        await client.setModel(sessionId, effectiveModel).catch(() => undefined);
      }
      this.live.set(sessionId, { agentId: input.agent.id, client, child, persona: input.agent.persona, firstTurnDone: true });
      return sessionId;
    } catch (err) {
      child.kill();
      const detail = err instanceof Error ? err.message : String(err);
      console.error('[agent-runtime] resumeSession failed:', detail);
      throw new ServiceUnavailableException(`Reprise de session Hermes échouée : ${detail}`);
    }
  }

  /** Streams normalized events for one user turn. Prepends the persona on the first turn. */
  async *sendTurn(sessionId: string, text: string): AsyncGenerator<AcpEvent> {
    const live = this.live.get(sessionId);
    if (!live) throw new ServiceUnavailableException('Conversation session not live');
    // First turn carries the system grounding (keep the agent on Pulsar tools, off
    // the filesystem/terminal) + the agent's persona, before the user's text.
    const prompt = live.firstTurnDone
      ? text
      : [AGENT_SYSTEM_PREAMBLE, live.persona, '---', text].filter(Boolean).join('\n\n');
    live.firstTurnDone = true;
    yield* live.client.prompt(sessionId, prompt);
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
   * Best-effort connectivity probe: spawns a throwaway runtime, initializes and
   * opens a bare session (no MCP), records the result via `markTested`, and tears
   * the process down. Never throws — failures are returned as `{ ok:false, error }`.
   */
  async testConnection(
    tenantId: string,
  ): Promise<{ ok: boolean; models?: AcpModelOption[]; error?: string }> {
    let child: ChildProcessWithoutNullStreams | undefined;
    try {
      const spawned = await this.spawnRuntime(tenantId);
      child = spawned.child;
      const { sessionId, models } = await spawned.client.newSession({
        cwd: process.cwd(),
        mcpServers: [],
      });
      await spawned.client.closeSession(sessionId).catch(() => undefined);
      // Cache the provider's real model list so the agent create/edit dropdown
      // only ever offers valid ids (no free-text typos → no 404s).
      await this.runtimeConfig.markTested(tenantId, true, models);
      return { ok: true, models };
    } catch (err) {
      await this.runtimeConfig.markTested(tenantId, false).catch(() => undefined);
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
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
  async *connectLogin(tenantId: string): AsyncGenerator<LoginEvent> {
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

    const { env, homeDir } = buildRuntimeEnv(config, decryptedKey, this.runtimeConfig.hermesHomeRoot());
    fs.mkdirSync(homeDir, { recursive: true });

    // e.g. "login" → [-m, hermes_cli.main, login]; "auth add openai-codex" → [..., auth, add, openai-codex]
    const loginArgs = ['-m', 'hermes_cli.main', ...provider.loginCommand.split(/\s+/)];

    let child: ChildProcess;
    try {
      child = spawn(venvPython(), loginArgs, {
        stdio: ['ignore', 'pipe', 'pipe'],
        cwd: path.join(repoRoot(), 'hermes-agent'),
        env: { ...process.env, ...env, HERMES_HOME: homeDir },
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
        await this.runtimeConfig.markConnected(tenantId);
        yield { type: 'end' };
      } else {
        yield { type: 'error', message: `Login exited with code ${exitCode}` };
      }
    } finally {
      child.kill();
    }
  }
}
