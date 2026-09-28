/** Runtime outcome, not proof that a business operation succeeded or was undone. */
export type AgentTurnStatus = 'succeeded' | 'failed' | 'cancelled';
export type AgentTurnCode =
  | 'RUNTIME_FAILURE'
  | 'INCOMPLETE'
  | 'CANCELLED'
  | 'PROTOCOL_ERROR'
  | 'TRANSPORT_CLOSED'
  | 'TIMEOUT';
export interface AgentTurnResult {
  version: 1;
  status: AgentTurnStatus;
  code?: AgentTurnCode;
  /** Observed cumulative counters of this runtime instance; never an invoice. */
  usage?: {
    scope: 'runtime_session';
    inputTokens: number | null;
    outputTokens: number | null;
    totalTokens: number | null;
  };
}
export type AgentTurnEvent =
  | { type: 'text'; text: string }
  | { type: 'tool_call'; name: string; args: unknown }
  | { type: 'error'; message: string }
  | { type: 'result'; result: AgentTurnResult }
  | { type: 'end' };

export function failedAgentTurn(code: AgentTurnCode = 'PROTOCOL_ERROR'): AgentTurnResult {
  return { version: 1, status: 'failed', code };
}

/** Closed projection: no raw provider errors, URLs, keys, or text-based inference. */
export function parseAgentTurnResult(value: unknown): AgentTurnResult {
  if (!value || typeof value !== 'object') return failedAgentTurn();
  const data = value as Record<string, unknown>;
  if (data.version !== 1 || !['succeeded', 'failed', 'cancelled'].includes(String(data.status)))
    return failedAgentTurn();
  const status = data.status as AgentTurnStatus;
  const codes: AgentTurnCode[] = [
    'RUNTIME_FAILURE',
    'INCOMPLETE',
    'CANCELLED',
    'PROTOCOL_ERROR',
    'TRANSPORT_CLOSED',
    'TIMEOUT',
  ];
  const result: AgentTurnResult = { version: 1, status };
  if (status === 'cancelled') result.code = 'CANCELLED';
  else if (status === 'failed')
    result.code = codes.includes(data.code as AgentTurnCode)
      ? (data.code as AgentTurnCode)
      : 'RUNTIME_FAILURE';
  const raw = data.usage as Record<string, unknown> | undefined;
  const count = (n: unknown) =>
    typeof n === 'number' && Number.isSafeInteger(n) && n >= 0 ? n : null;
  if (raw?.scope === 'runtime_session')
    result.usage = {
      scope: 'runtime_session',
      inputTokens: count(raw.inputTokens),
      outputTokens: count(raw.outputTokens),
      totalTokens: count(raw.totalTokens),
    };
  return result;
}

export function agentTurnMessage(result: AgentTurnResult): string {
  if (result.status === 'cancelled')
    return 'Réponse interrompue. Les actions déjà engagées ne sont pas annulées; vérifiez le journal avant de relancer.';
  if (result.code === 'TIMEOUT')
    return 'Le délai de réponse IA est dépassé. Vérifiez le journal des actions avant de relancer.';
  if (result.code === 'INCOMPLETE')
    return 'La réponse IA est incomplète. La mission n’est pas considérée comme réussie.';
  if (result.code === 'PROTOCOL_ERROR')
    return 'Le moteur IA n’a pas confirmé un résultat valide. Vérifiez le runtime avant de relancer.';
  return 'Le moteur ou le fournisseur IA a échoué. Vérifiez la connexion et le journal des actions avant de relancer.';
}
