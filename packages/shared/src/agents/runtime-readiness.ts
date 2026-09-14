import type { RuntimeAuthMode } from './runtime-providers';

/**
 * Why a runtime is not ready to run an agent, in priority order. `null` means ready.
 * The order matters: the first failing precondition is the one surfaced to the user.
 */
export type RuntimeBlockReason =
  | 'not-installed' // Hermes venv is not provisioned (`pnpm agents:setup`)
  | 'not-configured' // no AgentRuntimeConfig for the tenant
  | 'auth-missing' // apiKey provider without a stored key, or login provider not connected
  | 'model-missing' // no model available (config default nor agent override)
  | 'test-failed'; // the last connectivity probe explicitly failed

export interface RuntimeReadinessInput {
  installed: boolean;
  configured: boolean;
  /** Provider auth mode (from the provider catalog, fallback to the stored config). */
  authMode: RuntimeAuthMode | null;
  /** apiKey providers: an encrypted key is stored. */
  hasApiKey: boolean;
  /** login providers: an OAuth/device-code login has completed (tokens in HERMES_HOME). */
  connected: boolean;
  /** A model is available — config default OR an agent-level override. */
  hasModel: boolean;
  /** Result of the last connectivity probe, if any (null = never tested). */
  lastTestOk: boolean | null;
}

export interface RuntimeReadiness {
  installed: boolean;
  configured: boolean;
  /** Provider auth mode carried through so callers can word the auth-missing message. */
  authMode: RuntimeAuthMode | null;
  authReady: boolean;
  modelReady: boolean;
  lastTestOk: boolean | null;
  /** True only when the runtime can actually run an agent right now. */
  ready: boolean;
  /** First failing precondition, or null when ready. */
  blockReason: RuntimeBlockReason | null;
}

/**
 * Pure readiness decision for the agent runtime. Distinguishes install / config / auth /
 * model / last-probe so callers (e.g. "Run now") can give an actionable, honest message
 * instead of a fake success. Auth is validated per provider type:
 *   - apiKey providers  → an encrypted key must be stored;
 *   - login  providers  → an OAuth/device-code login must have completed.
 */
export function deriveRuntimeReadiness(input: RuntimeReadinessInput): RuntimeReadiness {
  const authReady =
    input.authMode === 'login' ? input.connected : input.authMode === 'apiKey' ? input.hasApiKey : false;
  const modelReady = input.hasModel;

  let blockReason: RuntimeBlockReason | null = null;
  if (!input.installed) blockReason = 'not-installed';
  else if (!input.configured) blockReason = 'not-configured';
  else if (!authReady) blockReason = 'auth-missing';
  else if (!modelReady) blockReason = 'model-missing';
  else if (input.lastTestOk === false) blockReason = 'test-failed';

  return {
    installed: input.installed,
    configured: input.configured,
    authMode: input.authMode,
    authReady,
    modelReady,
    lastTestOk: input.lastTestOk,
    ready: blockReason === null,
    blockReason,
  };
}

/** Human-facing (French) message for a block reason — used by the Run-now gate. */
export function runtimeBlockMessage(reason: RuntimeBlockReason, authMode: RuntimeAuthMode | null): string {
  switch (reason) {
    case 'not-installed':
      return "Le runtime agent n'est pas installé — exécutez `pnpm agents:setup`.";
    case 'not-configured':
      return "Le runtime agent n'est pas configuré — connectez un fournisseur dans Réglages → Runtime agents.";
    case 'auth-missing':
      return authMode === 'login'
        ? 'Le fournisseur requiert une connexion OAuth — connectez-le dans Réglages → Runtime agents.'
        : "Clé API du fournisseur manquante — ajoutez-la dans Réglages → Runtime agents.";
    case 'model-missing':
      return "Aucun modèle connecté — choisissez un modèle dans le profil de l'agent ou la config runtime.";
    case 'test-failed':
      return 'Le dernier test de connexion au runtime a échoué — retestez dans Réglages → Runtime agents.';
  }
}
