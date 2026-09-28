/**
 * HermesAcpClient — Pulsar's CLIENT-side implementation of the Agent Client
 * Protocol (ACP) used to drive a Hermes ACP sidecar process.
 *
 * Source of truth for the wire contract: docs/agents-acp-notes.md (Task 1 spike).
 * Cross-checked against the published ACP schema (`@zed-industries/agent-client-protocol`
 * v0.4.5 / `agent-client-protocol` PyPI 0.9.0):
 *  - Transport: newline-delimited JSON-RPC 2.0 over the sidecar's stdio
 *    (stdout = protocol, stderr = logs). One JSON message per line.
 *  - Wire fields are camelCase (`sessionId`, `sessionUpdate`, `protocolVersion`);
 *    method names are snake-cased paths (`session/new`, `session/set_model`,
 *    `session/prompt`, `session/update`, `session/request_permission`).
 *  - PROTOCOL_VERSION = 1.
 *
 * We hand-roll the (trivial) framing rather than depend on the official TS lib
 * because that package is deprecated and pinned to a different protocol minor
 * than the Hermes Python runtime; a focused client over our 5 methods is smaller
 * and keeps the normalized surface below stable regardless of upstream churn.
 */

import {
  agentTurnMessage,
  failedAgentTurn,
  parseAgentTurnResult,
  type AgentTurnEvent,
} from '@pulsar/shared';

const PROTOCOL_VERSION = 1;

const METHODS = {
  initialize: 'initialize',
  sessionNew: 'session/new',
  sessionPrompt: 'session/prompt',
  sessionSetModel: 'session/set_model',
  // reverse calls (agent -> client)
  sessionUpdate: 'session/update',
  sessionRequestPermission: 'session/request_permission',
} as const;

// ---------------------------------------------------------------------------
// Normalized public surface (the rest of Pulsar depends on these — keep stable)
// ---------------------------------------------------------------------------

export interface AcpMcpServer {
  // ACP uses a discriminated union for MCP servers: an HTTP server MUST carry
  // type:"http" (acp.schema.HttpMcpServer) or session/new rejects with "Invalid params".
  type: 'http';
  name: string;
  url: string;
  headers?: { name: string; value: string }[];
}

export interface AcpNewSession {
  cwd: string;
  mcpServers?: AcpMcpServer[];
}

/** A selectable model: `value` is the id `session/set_model` accepts, `label` is the display name. */
export interface AcpModelOption {
  value: string;
  label: string;
}

export type AcpEvent = AgentTurnEvent;

/**
 * Minimal injectable duplex transport. Tests inject a fake; `stdioTransport`
 * adapts a real spawned child. Messages are already-parsed JSON-RPC objects;
 * the transport owns the newline-delimited (de)serialization.
 */
export interface AcpTransport {
  send(msg: object): void;
  messages: AsyncIterable<object>;
}

// ---------------------------------------------------------------------------
// JSON-RPC wire types (internal)
// ---------------------------------------------------------------------------

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number | string;
  method: string;
  params?: unknown;
}
interface JsonRpcNotification {
  jsonrpc: '2.0';
  method: string;
  params?: unknown;
}
interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number | string;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

function isResponse(m: any): m is JsonRpcResponse {
  return m && m.jsonrpc === '2.0' && m.id !== undefined && m.method === undefined;
}
function isRequest(m: any): m is JsonRpcRequest {
  return m && m.jsonrpc === '2.0' && m.id !== undefined && typeof m.method === 'string';
}
function isNotification(m: any): m is JsonRpcNotification {
  return m && m.jsonrpc === '2.0' && m.id === undefined && typeof m.method === 'string';
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export class HermesAcpClient {
  private nextId = 1;
  private readonly pending = new Map<
    number | string,
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
  >();

  /**
   * Per-session queues of inbound `session/update` notifications, drained by
   * the `prompt()` async generator. Keyed by sessionId.
   */
  private readonly updateQueues = new Map<string, AsyncQueue<object>>();

  private started = false;
  private pumpError: Error | null = null;

  constructor(private readonly transport: AcpTransport) {}

  /**
   * Build a transport from a spawned child's stdio. Adapts newline-delimited
   * JSON over the child's stdin (write) / stdout (read). Used by
   * AgentRuntimeService (Task 8); not exercised by unit tests.
   */
  static stdioTransport(child: {
    stdin: NodeJS.WritableStream;
    stdout: NodeJS.ReadableStream;
  }): AcpTransport {
    const send = (msg: object) => {
      child.stdin.write(JSON.stringify(msg) + '\n');
    };

    async function* readLines(): AsyncIterable<object> {
      let buffer = '';
      // Node readable streams are async-iterable; chunks are Buffers/strings.
      for await (const chunk of child.stdout as any as AsyncIterable<Buffer | string>) {
        buffer += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
        let nl: number;
        while ((nl = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (!line) continue;
          try {
            yield JSON.parse(line) as object;
          } catch {
            // Non-JSON line on stdout — ignore (stderr carries logs, but be defensive).
          }
        }
      }
      const tail = buffer.trim();
      if (tail) {
        try {
          yield JSON.parse(tail) as object;
        } catch {
          /* ignore trailing non-JSON */
        }
      }
    }

    return { send, messages: readLines() };
  }

  // -- lifecycle ------------------------------------------------------------

  private ensurePump(): void {
    if (this.started) return;
    this.started = true;
    void this.pump();
  }

  private async pump(): Promise<void> {
    try {
      for await (const msg of this.transport.messages) {
        this.dispatch(msg);
      }
    } catch (err) {
      this.pumpError = err instanceof Error ? err : new Error(String(err));
    } finally {
      // Transport closed: fail anything still in flight.
      const closeErr = (this.pumpError ??= new Error('ACP transport closed'));
      for (const { reject } of this.pending.values()) reject(closeErr);
      this.pending.clear();
      for (const q of this.updateQueues.values()) q.close();
    }
  }

  private dispatch(msg: object): void {
    if (isResponse(msg)) {
      const entry = this.pending.get(msg.id);
      if (!entry) return;
      this.pending.delete(msg.id);
      if (msg.error) {
        entry.reject(new AcpRpcError(msg.error.message, msg.error.code, msg.error.data));
      } else {
        entry.resolve(msg.result);
      }
      return;
    }

    if (isRequest(msg)) {
      // Reverse call from the agent (e.g. session/request_permission).
      this.handleReverseRequest(msg);
      return;
    }

    if (isNotification(msg)) {
      if (msg.method === METHODS.sessionUpdate) {
        const params = (msg.params ?? {}) as { sessionId?: string };
        const sid = params.sessionId;
        if (sid && this.updateQueues.has(sid)) {
          this.updateQueues.get(sid)!.push(msg.params as object);
        }
      }
      // Other notifications (usage, etc.) are ignored at this layer.
    }
  }

  private handleReverseRequest(req: JsonRpcRequest): void {
    if (req.method === METHODS.sessionRequestPermission) {
      const params = (req.params ?? {}) as {
        options?: { optionId?: string; kind?: string; name?: string }[];
      };
      // ACP permissions are host/file/terminal privileges, NOT a Pulsar business
      // approval. The latter is exclusively handled by ProposedActionsService.
      const optionId = params.options?.find(
        (o) => o.kind === 'reject_once' && o.optionId,
      )?.optionId;
      const response: JsonRpcResponse = {
        jsonrpc: '2.0',
        id: req.id,
        result: {
          outcome: optionId ? { outcome: 'selected', optionId } : { outcome: 'cancelled' },
        },
      };
      this.transport.send(response);
      return;
    }

    // Unknown reverse method → JSON-RPC "method not found". Benign for the
    // server (it treats -32601 on probes as liveness; see spike §1).
    const response: JsonRpcResponse = {
      jsonrpc: '2.0',
      id: req.id,
      error: { code: -32601, message: `Method not found: ${req.method}` },
    };
    this.transport.send(response);
  }

  private call<T = unknown>(method: string, params?: unknown): Promise<T> {
    this.ensurePump();
    if (this.pumpError) return Promise.reject(this.pumpError);
    const id = this.nextId++;
    const req: JsonRpcRequest = { jsonrpc: '2.0', id, method, params };
    const promise = new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
    });
    try {
      this.transport.send(req);
    } catch (err) {
      this.pending.get(id)?.reject(err instanceof Error ? err : new Error(String(err)));
      this.pending.delete(id);
    }
    return promise;
  }

  // -- protocol methods -----------------------------------------------------

  async initialize(): Promise<void> {
    const result = await this.call<{ protocolVersion?: number }>(METHODS.initialize, {
      protocolVersion: PROTOCOL_VERSION,
      clientCapabilities: {},
      clientInfo: { name: 'pulsar', version: '1.0.0' },
    });
    if (result?.protocolVersion !== PROTOCOL_VERSION) {
      throw new Error('ACP protocol version incompatible with Pulsar');
    }
  }

  async newSession(cfg: AcpNewSession): Promise<{ sessionId: string; models: AcpModelOption[] }> {
    const result = (await this.call(METHODS.sessionNew, {
      cwd: cfg.cwd,
      mcpServers: cfg.mcpServers ?? [],
    })) as {
      sessionId: string;
      models?: { availableModels?: { modelId?: unknown; name?: unknown }[] };
    };
    if (!result || typeof result.sessionId !== 'string') {
      throw new Error('session/new did not return a sessionId');
    }
    return { sessionId: result.sessionId, models: normalizeModels(result.models?.availableModels) };
  }

  /**
   * Re-attach using strict `session/load`, never Hermes' permissive resume:
   * resume creates a new session for an unknown id but its ACP response carries
   * no effective id. Treating that as success loses both identity and persona.
   * Load instead returns an object for the requested history, or null/error.
   */
  async resumeSession(cfg: AcpNewSession, sessionId: string): Promise<{ sessionId: string }> {
    const result = await this.call('session/load', {
      cwd: cfg.cwd,
      sessionId,
      mcpServers: cfg.mcpServers ?? [],
    });
    if (!result || typeof result !== 'object' || Array.isArray(result)) {
      throw new Error('ACP session history unavailable; cannot resume this conversation');
    }
    return { sessionId };
  }

  /** ACP cancellation is a notification, not a request awaiting a response.
   * Best effort only: the owner must still kill the process on a turn timeout.
   */
  cancel(sessionId: string): void {
    if (this.pumpError) throw this.pumpError;
    this.transport.send({ jsonrpc: '2.0', method: 'session/cancel', params: { sessionId } });
  }

  async setModel(sessionId: string, modelId: string): Promise<void> {
    await this.call(METHODS.sessionSetModel, { sessionId, modelId });
  }

  /**
   * Send a user turn and stream the agent's reply. Maps `session/update`
   * notifications to AcpEvents, rejects every host `session/request_permission`
   * reverse call (handled in dispatch), and requires a typed Pulsar outcome
   * from the wrapper. A normal RPC return alone is NOT success. Every completed
   * stream emits exactly one result, then end; failures also emit a safe error.
   */
  async *prompt(sessionId: string, text: string): AsyncGenerator<AcpEvent> {
    this.ensurePump();
    if (this.updateQueues.has(sessionId))
      throw new Error('A turn is already running in this conversation');
    const queue = new AsyncQueue<object>();
    this.updateQueues.set(sessionId, queue);

    const box: { error: Error | null } = { error: null };
    const promptPromise = this.call(METHODS.sessionPrompt, {
      sessionId,
      prompt: [{ type: 'text', text }],
    })
      .then((res) => res as { stopReason?: string; _meta?: { pulsarTurn?: unknown } })
      .catch((err: unknown) => {
        box.error = err instanceof Error ? err : new Error(String(err));
        return undefined;
      })
      .finally(() => {
        // Unblock the drain loop once the turn is over.
        queue.close();
      });

    try {
      for await (const update of queue.drain()) {
        const ev = mapUpdate(update);
        if (ev) yield ev;
      }

      const result = await promptPromise;

      let outcome = box.error
        ? failedAgentTurn('TRANSPORT_CLOSED')
        : parseAgentTurnResult(result?._meta?.pulsarTurn);
      if (!box.error && result?.stopReason === 'cancelled')
        outcome = { ...outcome, status: 'cancelled', code: 'CANCELLED' };
      else if (!box.error && result?.stopReason !== 'end_turn' && outcome.status === 'succeeded')
        outcome = failedAgentTurn('INCOMPLETE');
      if (outcome.status === 'failed') yield { type: 'error', message: agentTurnMessage(outcome) };
      yield { type: 'result', result: outcome };
      yield { type: 'end' };
    } finally {
      this.updateQueues.delete(sessionId);
    }
  }

  /**
   * No-op at the ACP level: there is no `session/close` in the protocol. Sidecar
   * teardown (process kill) is owned by AgentRuntimeService. Kept on the surface
   * so callers have a stable lifecycle hook; we just stop tracking the session's
   * update queue here.
   */
  async closeSession(sessionId: string): Promise<void> {
    const q = this.updateQueues.get(sessionId);
    if (q) {
      q.close();
      this.updateQueues.delete(sessionId);
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export class AcpRpcError extends Error {
  constructor(
    message: string,
    readonly code: number,
    readonly data?: unknown,
  ) {
    super(message);
    this.name = 'AcpRpcError';
  }
}

/**
 * Normalize `session/new`'s `models.availableModels` into clean {value,label}
 * options. Drops the synthetic "current" entry Hermes re-qualifies with a doubled
 * provider prefix (its `name` itself contains a ":"), and dedupes by value so the
 * UI never offers a model id that would 404.
 */
function normalizeModels(
  raw: { modelId?: unknown; name?: unknown }[] | undefined,
): AcpModelOption[] {
  if (!Array.isArray(raw)) return [];
  const out: AcpModelOption[] = [];
  const seen = new Set<string>();
  for (const m of raw) {
    const value = typeof m?.modelId === 'string' ? m.modelId : '';
    const label = typeof m?.name === 'string' && m.name ? m.name : value;
    if (!value || label.includes(':') || seen.has(value)) continue;
    seen.add(value);
    out.push({ value, label });
  }
  return out;
}

/**
 * Map a single `session/update` notification's params to an AcpEvent (or null
 * to drop it). Discriminated by the `sessionUpdate` tag (spike §5).
 *
 * ACP wire shape is `SessionNotification = { sessionId, update: SessionUpdate }`:
 * the `sessionUpdate` discriminator and its payload (`content`, `title`,
 * `rawInput`, …) live UNDER `update`, not at the top level. We unwrap it here
 * (tolerating a flat shape too, for older sidecars / the unit fake).
 */
function mapUpdate(params: any): AcpEvent | null {
  const u = params?.update ?? params;
  const tag = u?.sessionUpdate;
  switch (tag) {
    case 'agent_message_chunk': {
      const text = u?.content?.text;
      if (typeof text === 'string' && text.length) return { type: 'text', text };
      return null;
    }
    case 'tool_call': {
      // Tool call started. `title` is the human label; `rawInput` is the args.
      const name: string =
        typeof u?.title === 'string' && u.title ? u.title : (u?.kind ?? 'tool_call');
      return { type: 'tool_call', name, args: u?.rawInput };
    }
    // tool_call_update (completed/failed), plan, thought, user echo: not
    // surfaced as discrete events at this layer.
    default:
      return null;
  }
}

/**
 * Tiny async queue: producers `push`, a single consumer `drain()`s until
 * `close()`. Used to bridge notification callbacks into the prompt generator.
 */
class AsyncQueue<T> {
  private readonly items: T[] = [];
  private resolveNext: (() => void) | null = null;
  private closed = false;

  push(item: T): void {
    if (this.closed) return;
    this.items.push(item);
    this.wake();
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.wake();
  }

  private wake(): void {
    if (this.resolveNext) {
      const r = this.resolveNext;
      this.resolveNext = null;
      r();
    }
  }

  async *drain(): AsyncGenerator<T> {
    while (true) {
      while (this.items.length) {
        yield this.items.shift()!;
      }
      if (this.closed) return;
      await new Promise<void>((resolve) => {
        this.resolveNext = resolve;
      });
    }
  }
}
