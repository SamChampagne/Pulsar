/**
 * Deterministic in-process fake ACP server for HermesAcpClient unit tests.
 *
 * It stands in for the Hermes ACP sidecar: it speaks the same newline-free,
 * already-parsed JSON-RPC objects the injectable `AcpTransport` carries, and
 * answers the exact method names/shapes from docs/agents-acp-notes.md
 * (cross-checked against the ACP 0.9.0 schema):
 *   - initialize
 *   - session/new           (records cwd + mcpServers, returns a sessionId)
 *   - session/set_model     (records modelId)
 *   - session/prompt        (emits scripted session/update notifications, then
 *                            resolves with { stopReason: 'end_turn' })
 *   - optionally issues a reverse session/request_permission call mid-turn.
 *
 * Wire facts honored: camelCase fields (sessionId, sessionUpdate, rawInput),
 * snake-cased method paths, session/update notifications BEFORE the prompt RPC
 * result resolves.
 */

import type { AcpTransport } from '../../src/core/agents/hermes-acp.client';

const PROTOCOL_VERSION = 1;

export interface FakeAcpScript {
  assistantText?: string;
  toolCall?: { name: string; args: object };
  /** If true, the fake issues a reverse session/request_permission during the turn. */
  requestPermission?: boolean;
}

export interface RecordedNewSession {
  cwd: string;
  mcpServers: unknown;
}

interface JsonRpcAny {
  jsonrpc: '2.0';
  id?: number | string;
  method?: string;
  params?: any;
  result?: any;
  error?: any;
}

/**
 * A linked transport pair. `clientTransport` is handed to HermesAcpClient; the
 * fake server consumes the client's outbound messages and pushes its own
 * outbound messages (responses + notifications + reverse requests) back.
 */
export class FakeAcpServer {
  readonly clientTransport: AcpTransport;

  lastNewSession: RecordedNewSession | null = null;
  lastModel: string | null = null;
  script: FakeAcpScript = {};

  /** Records the outcome of any reverse permission call the client answered. */
  permissionOutcome: { outcome: string; optionId?: string } | null = null;

  private sessionCounter = 0;
  private reversePermissionId: number | null = null;
  private reverseIdCounter = 10_000;

  // Outbound (server -> client) queue, drained as the client's `messages`.
  private readonly toClient: JsonRpcAny[] = [];
  private wakeClient: (() => void) | null = null;
  private clientClosed = false;

  constructor() {
    const self = this;

    async function* messages(): AsyncIterable<object> {
      while (true) {
        while (self.toClient.length) {
          yield self.toClient.shift() as object;
        }
        if (self.clientClosed) return;
        await new Promise<void>((resolve) => {
          self.wakeClient = resolve;
        });
      }
    }

    this.clientTransport = {
      send: (msg: object) => self.onClientMessage(msg as JsonRpcAny),
      messages: messages(),
    };
  }

  /** Stop the client transport's message iterator (simulate sidecar exit). */
  close(): void {
    this.clientClosed = true;
    this.wake();
  }

  private wake(): void {
    if (this.wakeClient) {
      const w = this.wakeClient;
      this.wakeClient = null;
      w();
    }
  }

  private emit(msg: JsonRpcAny): void {
    this.toClient.push(msg);
    this.wake();
  }

  private reply(id: number | string, result: unknown): void {
    this.emit({ jsonrpc: '2.0', id, result });
  }

  private notify(method: string, params: unknown): void {
    this.emit({ jsonrpc: '2.0', method, params });
  }

  private onClientMessage(msg: JsonRpcAny): void {
    // A response to our reverse request (e.g. request_permission)?
    if (msg.method === undefined && msg.id !== undefined) {
      if (this.reversePermissionId !== null && msg.id === this.reversePermissionId) {
        this.permissionOutcome = msg.result?.outcome ?? null;
        this.reversePermissionId = null;
      }
      return;
    }

    if (msg.id === undefined) return; // we don't expect client notifications

    switch (msg.method) {
      case 'initialize':
        this.reply(msg.id!, {
          protocolVersion: PROTOCOL_VERSION,
          agentInfo: { name: 'hermes-agent', version: '0.0.0-fake' },
          agentCapabilities: {
            loadSession: true,
            promptCapabilities: { image: true },
          },
          authMethods: [],
        });
        return;

      case 'session/new': {
        this.lastNewSession = {
          cwd: msg.params?.cwd,
          mcpServers: msg.params?.mcpServers,
        };
        const sessionId = `fake-session-${++this.sessionCounter}`;
        this.reply(msg.id!, {
          sessionId,
          models: {
            availableModels: [
              {
                modelId: 'anthropic:claude-sonnet-4-6',
                name: 'Claude Sonnet 4.6',
                description: 'fake',
              },
            ],
            currentModelId: 'anthropic:claude-sonnet-4-6',
          },
        });
        return;
      }

      case 'session/set_model':
        this.lastModel = msg.params?.modelId ?? null;
        this.reply(msg.id!, null);
        return;

      case 'session/prompt':
        this.runPrompt(msg.id!, msg.params?.sessionId);
        return;

      default:
        this.emit({
          jsonrpc: '2.0',
          id: msg.id!,
          error: { code: -32601, message: `Method not found: ${msg.method}` },
        });
        return;
    }
  }

  /**
   * Emit the scripted notifications (BEFORE resolving the prompt RPC), optionally
   * fire a reverse permission request, then resolve with end_turn.
   */
  private runPrompt(id: number | string, sessionId: string): void {
    if (this.script.requestPermission) {
      this.reversePermissionId = ++this.reverseIdCounter;
      this.emit({
        jsonrpc: '2.0',
        id: this.reversePermissionId,
        method: 'session/request_permission',
        params: {
          sessionId,
          toolCall: {
            toolCallId: 'tc-1',
            title: 'do thing',
            kind: 'execute',
            status: 'pending',
            rawInput: {},
          },
          options: [
            { optionId: 'allow_once', kind: 'allow_once', name: 'Allow once' },
            { optionId: 'deny', kind: 'reject_once', name: 'Deny' },
          ],
        },
      });
    }

    if (typeof this.script.assistantText === 'string') {
      this.notify('session/update', {
        sessionId,
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: this.script.assistantText },
      });
    }

    if (this.script.toolCall) {
      this.notify('session/update', {
        sessionId,
        sessionUpdate: 'tool_call',
        toolCallId: 'tc-1',
        title: this.script.toolCall.name,
        kind: 'other',
        status: 'in_progress',
        rawInput: this.script.toolCall.args,
      });
    }

    // End of turn: the prompt RPC returns after all notifications were emitted.
    this.reply(id, { stopReason: 'end_turn' });
  }
}
