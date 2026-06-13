import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { HermesAcpClient, type AcpEvent } from './hermes-acp.client';
import { AgentsService } from './agents.service';

interface OpenSessionInput {
  agent: { id: string; model: string | null; persona: string | null };
  pulsarMcpUrl: string;
}

interface LiveSession {
  client: HermesAcpClient;
  child: ChildProcessWithoutNullStreams;
  persona: string | null;
  firstTurnDone: boolean;
}

@Injectable()
export class AgentRuntimeService {
  /** One Hermes process PER conversation (isolation — spike finding). Keyed by hermes sessionId. */
  private readonly live = new Map<string, LiveSession>();

  constructor(private readonly agents: AgentsService) {}

  /** Spawns a dedicated Hermes ACP process, opens a session scoped to this agent. Returns the hermes sessionId. */
  async openSession(input: OpenSessionInput): Promise<string> {
    let child: ChildProcessWithoutNullStreams;
    try {
      const cmd = process.env.HERMES_ACP_CMD ?? 'python';
      const args = (process.env.HERMES_ACP_ARGS ?? '-m acp_adapter').split(' ');
      child = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'], cwd: process.env.HERMES_ACP_CWD });
    } catch {
      throw new ServiceUnavailableException('Agent runtime (Hermes) unavailable');
    }
    try {
      const client = new HermesAcpClient(HermesAcpClient.stdioTransport(child));
      await client.initialize();
      const token = this.agents.mintSessionToken(input.agent.id, 300);
      const { sessionId } = await client.newSession({
        cwd: process.cwd(),
        mcpServers: [
          { name: 'pulsar', url: input.pulsarMcpUrl, headers: [{ name: 'X-Agent-Key', value: token }] },
        ],
      });
      if (input.agent.model) {
        await client.setModel(sessionId, input.agent.model).catch(() => undefined);
      }
      this.live.set(sessionId, { client, child, persona: input.agent.persona, firstTurnDone: false });
      return sessionId;
    } catch {
      child.kill();
      throw new ServiceUnavailableException('Agent runtime (Hermes) session failed');
    }
  }

  /** Streams normalized events for one user turn. Prepends the persona on the first turn. */
  async *sendTurn(sessionId: string, text: string): AsyncGenerator<AcpEvent> {
    const live = this.live.get(sessionId);
    if (!live) throw new ServiceUnavailableException('Conversation session not live');
    const prompt = !live.firstTurnDone && live.persona ? `${live.persona}\n\n---\n\n${text}` : text;
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
}
