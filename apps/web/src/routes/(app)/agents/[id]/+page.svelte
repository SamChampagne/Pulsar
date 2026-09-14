<script lang="ts">
  import { confirmAction } from '$lib/stores/confirmation';
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import {
    PERMISSION_CATALOG,
    RUNTIME_PROVIDERS,
    runtimeBlockMessage,
    effectivePolicies,
    evaluatePolicy,
    RiskTier,
    AgentAutonomy,
    type RuntimeBlockReason,
    type RuntimeAuthMode,
    type PolicyRule,
  } from '@pulsar/shared';
  import type { Paginated } from '@pulsar/shared';
  import { api, ApiError } from '$lib/api/client';
  import { toast } from '$lib/stores/toast';
  import { formatDateTime } from '$lib/format';
  import {
    Badge,
    Button,
    Card,
    Field,
    Input,
    PageHeader,
    Select,
    Skeleton,
    Textarea,
    ErrorNotice,
  } from '$lib/components/ui';
  import Conversation from '$lib/components/agents/Conversation.svelte';

  type AutonomyLevel = 'PROPOSE' | 'ACT_LOW' | 'AUTONOMOUS';

  interface AgentPolicy {
    tool?: string;
    tierMax?: string;
    maxAmount?: number;
    effect: string;
  }

  interface AgentCaps {
    maxAmountPerAction?: number;
    maxActionsPerMinute?: number;
    policies?: AgentPolicy[];
    alwaysOn?: boolean;
    handlesCategories?: string[];
  }

  interface AgentDetail {
    id: string;
    name: string;
    description: string | null;
    role: string | null;
    avatar: string | null;
    model: string | null;
    autonomyLevel: AutonomyLevel;
    persona: string | null;
    permissions: string[];
    caps: AgentCaps;
    status: string;
    prefix: string;
    createdAt: string;
    lastUsedAt: string | null;
    lastSeenAt?: string | null;
    lastRunAt?: string | null;
    breakerTrippedAt?: string | null;
  }

  interface Trust {
    score: number;
    readyForNext: boolean;
    nextLevel: string | null;
    reasons: string[];
    currentLevel: string;
  }

  interface AgentRun {
    id: string;
    agentId: string;
    trigger: string;
    taskId: string | null;
    status: string;
    attempt: number;
    startedAt: string | null;
    finishedAt: string | null;
    error: string | null;
    proposedActionCount: number;
    createdAt: string;
    task: {
      id: string;
      category: string;
      title: string;
      status: string;
      resolutionNote: string | null;
    } | null;
  }

  interface ConversationSummary {
    id: string;
    title: string | null;
    createdAt: string;
    messageCount: number;
  }

  interface ProposedActionSummary {
    id: string;
    tool: string;
    status: string;
    riskTier: string;
    proposedAt: string;
    decidedAt: string | null;
  }

  interface ActivityStats {
    conversations: number;
    pending: number;
    executed: number;
    rejected: number;
  }

  interface AgentActivity {
    conversations: ConversationSummary[];
    proposedActions: ProposedActionSummary[];
    stats: ActivityStats;
  }

  interface ConversationDetail {
    id: string;
    messages: { role: string; content: string; toolCalls?: { name: string; args?: unknown }[] }[];
  }

  type Kpis = {
    actions: {
      total: number;
      executed: number;
      autoApproved: number;
      pending: number;
      rejected: number;
      failed: number;
    };
    approvalRate: number;
    autoApprovalRate: number;
    errorRate: number;
    runs: { total: number; succeeded: number; failed: number; skipped: number; killed: number };
    avgRunLatencyMs: number | null;
    breakerTrips: number;
    tasksResolved: number;
  };
  type TimelineItem = { at: string; kind: string; summary: string; ref?: string };

  // Dispatch-relevant scopes (same set as RegisterAgentModal).
  const DISPATCH_KEYS = [
    'transportation.orders.read',
    'transportation.planning.read',
    'transportation.planning.manage',
    'transportation.analytics.read',
  ];
  const dispatchScopes = DISPATCH_KEYS.map((key) => ({
    key,
    description: PERMISSION_CATALOG.find((p) => p.key === key)?.description ?? key,
  }));

  const AUTONOMY_OPTIONS: { value: AutonomyLevel; label: string; hint: string }[] = [
    {
      value: 'PROPOSE',
      label: 'PROPOSE',
      hint: 'Toute mutation validée par un humain avant exécution.',
    },
    {
      value: 'ACT_LOW',
      label: 'ACT_LOW',
      hint: 'Mutations à faible risque auto-exécutées ; les mutations sensibles restent en file.',
    },
    {
      value: 'AUTONOMOUS',
      label: 'AUTONOMOUS',
      hint: 'Tout auto-exécuté, toujours borné par les plafonds de capacité.',
    },
  ];

  function autonomyTone(level: AutonomyLevel): 'ok' | 'warn' | 'danger' | 'info' | 'neutral' {
    if (level === 'AUTONOMOUS') return 'warn';
    if (level === 'ACT_LOW') return 'info';
    return 'neutral';
  }

  const agentId = $derived(page.params.id as string);

  let agent = $state<AgentDetail | null>(null);
  let notFound = $state(false);
  let loadError = $state('');
  let saving = $state(false);
  let revoking = $state(false);

  // Activity
  let activity = $state<AgentActivity | null>(null);
  let activityError = $state('');

  // Activité 24/7 — run history + controls
  let runs = $state<AgentRun[]>([]);
  let runsError = $state('');
  let busy = $state(false);

  // Autonomie — trust score + circuit breaker
  let trust = $state<Trust | null>(null);

  // KPI panel + activity timeline
  let kpis = $state<Kpis | null>(null);
  let timelineItems = $state<TimelineItem[]>([]);
  const pct = (r: number) => `${Math.round(r * 100)}%`;

  // Chat: active conversation loaded from activity list
  let chatConversationId = $state<string | null>(null);
  let chatInitialMessages = $state<ConversationDetail['messages']>([]);
  let loadingConversation = $state(false);
  // Auto-restore bookkeeping: the agent id we already restored a conversation for,
  // and whether the user explicitly started a fresh one (suppresses auto-restore).
  let autoRestoredFor = $state<string | null>(null);
  let chatReset = $state(false);

  // Editable form fields — synced from agent on load.
  let fName = $state('');
  let fDescription = $state('');
  let fRole = $state('');
  let fAvatar = $state('');
  let fModel = $state('');
  let fPersona = $state('');
  let fAutonomy = $state<AutonomyLevel>('PROPOSE');
  let fPermissions = $state<string[]>([]);
  let fMaxAmount = $state('');
  let fMaxRate = $state('');

  // Real model list for the connected provider (cached at last connection test).
  interface RuntimeModelOption {
    value: string;
    label: string;
  }
  let models = $state<RuntimeModelOption[]>([]);
  let runtimeProvider = $state<string | null>(null);
  let runtimeDefaultModel = $state<string | null>(null);
  async function loadModels() {
    try {
      const rt = await api<{
        availableModels?: RuntimeModelOption[];
        provider?: string;
        defaultModel?: string;
      }>('/agent-runtime');
      models = rt.availableModels ?? [];
      runtimeProvider = rt.provider ?? null;
      runtimeDefaultModel = rt.defaultModel ?? null;
    } catch {
      models = [];
      runtimeProvider = null;
      runtimeDefaultModel = null;
    }
  }

  // Runtime readiness chip — proactive "can this run right now" instead of a toast after a
  // failed "Run now" click. Best-effort: hidden entirely if the call fails.
  interface RuntimeReadiness {
    installed: boolean;
    configured: boolean;
    authMode: RuntimeAuthMode | null;
    authReady: boolean;
    modelReady: boolean;
    lastTestOk: boolean | null;
    ready: boolean;
    blockReason: RuntimeBlockReason | null;
  }
  let runtimeReadiness = $state<RuntimeReadiness | null>(null);
  async function loadRuntimeReadiness() {
    try {
      runtimeReadiness = await api<RuntimeReadiness>('/agent-runtime/readiness');
    } catch {
      runtimeReadiness = null;
    }
  }
  const runtimeProviderLabel = $derived(
    runtimeProvider
      ? (RUNTIME_PROVIDERS.find((p) => p.id === runtimeProvider)?.label ?? runtimeProvider)
      : null,
  );
  const runtimeReasonText = $derived(
    runtimeReadiness && !runtimeReadiness.ready && runtimeReadiness.blockReason
      ? runtimeBlockMessage(runtimeReadiness.blockReason, runtimeReadiness.authMode)
      : '',
  );

  // "Pourquoi en attente" — reuses the exact pure policy engine the backend gate evaluates
  // (rule 29) so the explanation on screen matches the real AUTO/PROPOSE/DENY decision as
  // closely as data available on this page allows (amount is not part of this projection,
  // so amount-based rule downgrades can't be reproduced here — worded accordingly).
  function actionReasonText(action: ProposedActionSummary): string {
    const tier = action.riskTier as RiskTier;
    if (tier !== RiskTier.MUTATING && tier !== RiskTier.SENSITIVE) return '';
    if (!agent) return '';
    const rules = effectivePolicies(
      agent.caps.policies as PolicyRule[] | undefined,
      agent.autonomyLevel as AgentAutonomy,
      undefined,
    );
    const decision = evaluatePolicy(rules, {
      tool: action.tool,
      tier,
      recentExecutions: 0,
      maxAmountPerAction: agent.caps.maxAmountPerAction,
      maxPerMinute: agent.caps.maxActionsPerMinute,
    });
    const tierLabel = tier === RiskTier.SENSITIVE ? 'SENSIBLE' : 'MUTATION';
    if (decision.effect === 'PROPOSE') {
      return `Tier ${tierLabel} + autonomie ${agent.autonomyLevel} → approbation requise.`;
    }
    if (decision.effect === 'DENY') {
      return `Tier ${tierLabel} → aurait été refusée (plafond montant dépassé).`;
    }
    return `Tier ${tierLabel} + autonomie ${agent.autonomyLevel} → normalement auto-exécutée (un plafond a pu s'appliquer selon le montant).`;
  }

  function syncForm(a: AgentDetail) {
    fName = a.name;
    fDescription = a.description ?? '';
    fRole = a.role ?? '';
    fAvatar = a.avatar ?? '';
    fModel = a.model ?? '';
    fPersona = a.persona ?? '';
    fAutonomy = a.autonomyLevel;
    fPermissions = [...a.permissions];
    fMaxAmount = a.caps.maxAmountPerAction != null ? String(a.caps.maxAmountPerAction) : '';
    fMaxRate = a.caps.maxActionsPerMinute != null ? String(a.caps.maxActionsPerMinute) : '';
  }

  async function load() {
    loadError = '';
    notFound = false;
    try {
      const data = await api<AgentDetail>(`/agents/${agentId}`);
      agent = data;
      syncForm(data);
    } catch (e) {
      if (e instanceof ApiError && e.statusCode === 404) {
        notFound = true;
      } else {
        loadError = e instanceof ApiError ? e.message : "Impossible de charger l'agent";
      }
    }
  }

  async function loadActivity(id: string) {
    activityError = '';
    try {
      const data = await api<AgentActivity>(`/agents/${id}/activity`);
      activity = data;
      // Auto-restore the most recent conversation once per agent, so leaving the
      // page (e.g. to Agent actions) and coming back keeps the chat instead of
      // dropping the user on a blank conversation. Skipped if the user already
      // picked/started one, or explicitly hit "Nouvelle conversation".
      if (
        autoRestoredFor !== id &&
        chatConversationId === null &&
        !chatReset &&
        data.conversations.length > 0
      ) {
        autoRestoredFor = id;
        void openConversation(data.conversations[0].id, false);
      }
    } catch (e) {
      activityError = e instanceof ApiError ? e.message : "Impossible de charger l'activité";
    }
  }

  async function loadRuns(id: string) {
    runsError = '';
    try {
      const data = await api<Paginated<AgentRun>>(`/agents/${id}/runs`, {
        query: { pageSize: 25 },
      });
      runs = data.items;
    } catch (e) {
      runsError = e instanceof ApiError ? e.message : 'Impossible de charger les exécutions';
    }
  }

  async function loadTrust(id: string) {
    try {
      trust = await api<Trust>(`/agents/${id}/trust`);
    } catch {
      trust = null;
    }
  }

  async function loadKpis(id: string) {
    try {
      kpis = await api<Kpis>(`/agents/${id}/kpis`);
    } catch {
      kpis = null;
    }
  }

  async function loadTimeline(id: string) {
    try {
      timelineItems = await api<TimelineItem[]>(`/agents/${id}/timeline`, { query: { limit: 50 } });
    } catch {
      timelineItems = [];
    }
  }

  async function resetBreaker() {
    busy = true;
    try {
      await api(`/agents/${agentId}/reset-breaker`, { method: 'POST' });
      toast.success('Circuit breaker réarmé');
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Échec du réarmement');
    } finally {
      busy = false;
    }
  }

  async function promote() {
    if (!trust?.nextLevel) return;
    busy = true;
    try {
      await api(`/agents/${agentId}`, {
        method: 'PATCH',
        body: { autonomyLevel: trust.nextLevel },
      });
      toast.success("Niveau d'autonomie promu");
      await load();
      await loadTrust(agentId);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Échec de la promotion');
    } finally {
      busy = false;
    }
  }

  async function runAction(verb: 'pause' | 'resume', label: string) {
    busy = true;
    try {
      await api(`/agents/${agentId}/${verb}`, { method: 'POST' });
      toast.success(label);
      await load();
      await loadRuns(agentId);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Échec de l'action");
    } finally {
      busy = false;
    }
  }

  // "Run now" is honest: the backend gates on runtime availability + a connected model and
  // returns exactly what happened. We only claim success when a run was actually created,
  // and surface the runtime error otherwise.
  async function runNow() {
    busy = true;
    try {
      const res = await api<{ enqueued: boolean; runId: string | null; reason: string }>(
        `/agents/${agentId}/run-now`,
        { method: 'POST' },
      );
      if (res.enqueued && res.runId) {
        toast.success(`Exécution lancée — run ${res.runId.slice(0, 8)} créé.`);
      } else if (res.reason === 'no-open-task') {
        toast.info('Aucune tâche ouverte à exécuter pour cet agent.');
      } else if (res.reason === 'already-in-flight') {
        toast.info('Une exécution est déjà en cours pour cette tâche.');
      } else {
        toast.info('Rien à exécuter pour le moment.');
      }
      await load();
      await loadRuns(agentId);
    } catch (e) {
      // 503 = runtime not installed/configured/no model — a useful, actionable message.
      toast.error(e instanceof ApiError ? e.message : "Échec de l'exécution");
    } finally {
      busy = false;
    }
  }

  async function openConversation(convId: string, scroll = true) {
    loadingConversation = true;
    try {
      const data = await api<ConversationDetail>(`/agent-conversations/${convId}`);
      chatConversationId = data.id;
      chatInitialMessages = data.messages;
      if (scroll) {
        // Scroll to chat section
        queueMicrotask(() => {
          document.getElementById('chat')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
      }
    } catch (e) {
      if (scroll)
        toast.error(e instanceof ApiError ? e.message : 'Impossible de charger la conversation');
    } finally {
      loadingConversation = false;
    }
  }

  function togglePermission(key: string) {
    fPermissions = fPermissions.includes(key)
      ? fPermissions.filter((p) => p !== key)
      : [...fPermissions, key];
  }

  async function save(event: SubmitEvent) {
    event.preventDefault();
    saving = true;
    try {
      const caps: AgentCaps = {};
      const amount = Number(fMaxAmount);
      const rate = Number(fMaxRate);
      if (String(fMaxAmount ?? '').trim() !== '' && amount > 0) caps.maxAmountPerAction = amount;
      if (String(fMaxRate ?? '').trim() !== '' && rate > 0) caps.maxActionsPerMinute = rate;

      await api(`/agents/${agentId}`, {
        method: 'PATCH',
        body: {
          name: fName,
          description: fDescription.trim() || null,
          role: fRole.trim() || null,
          avatar: fAvatar.trim() || null,
          model: fModel.trim() || null,
          persona: fPersona.trim() || null,
          autonomyLevel: fAutonomy,
          permissions: fPermissions,
          caps,
        },
      });
      toast.success('Agent mis à jour');
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Échec de la mise à jour');
    } finally {
      saving = false;
    }
  }

  async function revoke() {
    if (
      !(await confirmAction(
        `Révoquer l'agent "${agent?.name}" ? Sa clé cessera de fonctionner immédiatement.`,
      ))
    )
      return;
    revoking = true;
    try {
      await api(`/agents/${agentId}`, { method: 'DELETE' });
      toast.success('Agent révoqué');
      await goto('/agents');
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Échec de la révocation');
      revoking = false;
    }
  }

  $effect(() => {
    void load();
    void loadActivity(agentId);
    void loadRuns(agentId);
    void loadTrust(agentId);
    void loadKpis(agentId);
    void loadTimeline(agentId);
    void loadModels();
    void loadRuntimeReadiness();
  });

  function actionStatusTone(status: string): 'ok' | 'warn' | 'danger' | 'info' | 'neutral' {
    if (status === 'EXECUTED') return 'ok';
    if (status === 'PENDING') return 'warn';
    if (status === 'REJECTED' || status === 'FAILED') return 'danger';
    return 'neutral';
  }

  function riskTierTone(tier: string): 'ok' | 'warn' | 'danger' | 'info' | 'neutral' {
    if (tier === 'HIGH') return 'danger';
    if (tier === 'MEDIUM') return 'warn';
    if (tier === 'LOW') return 'ok';
    return 'neutral';
  }

  function runStatusTone(status: string): 'ok' | 'warn' | 'danger' | 'info' | 'neutral' {
    if (status === 'SUCCEEDED' || status === 'COMPLETED') return 'ok';
    if (status === 'RUNNING' || status === 'IN_PROGRESS') return 'info';
    if (status === 'PENDING' || status === 'QUEUED') return 'warn';
    if (status === 'FAILED' || status === 'ERROR') return 'danger';
    return 'neutral';
  }
</script>

{#if notFound}
  <div class="py-16 text-center">
    <p class="text-lg font-semibold text-ink">Agent introuvable</p>
    <p class="mt-2 text-sm text-ink-muted">
      L'identifiant <code class="rounded bg-surface-muted px-1 text-xs">{agentId}</code> ne correspond
      à aucun agent.
    </p>
    <div class="mt-4">
      <Button variant="secondary" onclick={() => goto('/agents')}>Retour aux agents</Button>
    </div>
  </div>
{:else if loadError && !agent}
  <ErrorNotice message={loadError} onretry={load} />
{:else if !agent}
  <div class="space-y-4">
    <Card><Skeleton rows={3} /></Card>
    <Card><Skeleton rows={6} /></Card>
  </div>
{:else}
  <!-- Page header: avatar + name + badges + revoke action -->
  <div class="mb-6 flex flex-wrap items-center justify-between gap-4">
    <div class="flex items-center gap-3">
      <div
        class="flex size-12 shrink-0 items-center justify-center rounded-full bg-accent-soft text-2xl"
      >
        {agent.avatar ?? '🤖'}
      </div>
      <div>
        <h1 class="text-xl font-bold text-ink">{agent.name}</h1>
        {#if agent.role}
          <p class="text-sm text-ink-muted">{agent.role}</p>
        {/if}
      </div>
      <div class="flex gap-2">
        {#if agent.status === 'REVOKED'}
          <Badge tone="danger">Révoqué</Badge>
        {:else if agent.status === 'PAUSED'}
          <Badge tone="warn">En pause</Badge>
        {:else}
          <Badge tone="ok">Actif</Badge>
        {/if}
        <Badge tone={autonomyTone(agent.autonomyLevel)}>{agent.autonomyLevel}</Badge>
        {#if agent.caps?.alwaysOn}
          <Badge tone="info"
            >24/7 · {(agent.caps.handlesCategories ?? []).join(', ') || 'aucune catégorie'}</Badge
          >
        {/if}
      </div>
    </div>
    <Button
      variant="danger"
      onclick={revoke}
      loading={revoking}
      disabled={agent.status === 'REVOKED' || revoking}
    >
      Révoquer
    </Button>
  </div>

  <!-- Profil & config -->
  <div id="profil">
    <h2 class="mb-4 text-base font-semibold text-ink">Profil &amp; configuration</h2>

    <form onsubmit={save}>
      <Card>
        <div class="space-y-4">
          <!-- Name + Avatar -->
          <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Nom">
              <Input bind:value={fName} required placeholder="Dispatch copilot" />
            </Field>
            <Field label="Avatar (emoji)">
              <Input bind:value={fAvatar} placeholder="🚛" />
            </Field>
          </div>

          <!-- Role + Model -->
          <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Rôle">
              <Input bind:value={fRole} placeholder="ex. Répartiteur" />
            </Field>
            <Field label="Modèle">
              <Select bind:value={fModel}>
                <option value="">Défaut du tenant</option>
                {#if fModel && !models.some((m) => m.value === fModel)}
                  <option value={fModel}>{fModel} (actuel)</option>
                {/if}
                {#each models as m (m.value)}
                  <option value={m.value}>{m.label}</option>
                {/each}
              </Select>
              {#if models.length === 0}
                <p class="mt-1 text-xs text-ink-faint">
                  Teste la connexion (Connexion du modèle) pour lister les modèles.
                </p>
              {/if}
            </Field>
          </div>

          <!-- Description -->
          <Field label="Description">
            <Input bind:value={fDescription} placeholder="Ce que fait cet agent…" />
          </Field>

          <!-- Persona -->
          <div>
            <Field label="Persona">
              <Textarea
                bind:value={fPersona}
                rows={4}
                placeholder="Personnalité et instructions système de cet employé…"
              />
            </Field>
            <p class="mt-1 text-xs text-ink-muted">
              Personnalité + instructions système de l'employé. Définit le ton, le style de réponse
              et les règles métier internes.
            </p>
          </div>

          <!-- Autonomy level -->
          <div>
            <span class="mb-2 block text-xs font-semibold tracking-wide text-ink-muted uppercase">
              Niveau d'autonomie
            </span>
            <div class="space-y-2">
              {#each AUTONOMY_OPTIONS as opt (opt.value)}
                <label
                  class="flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition
                    {fAutonomy === opt.value
                    ? 'border-accent bg-accent-soft/30'
                    : 'border-edge hover:border-accent'}"
                >
                  <input
                    type="radio"
                    name="autonomy"
                    value={opt.value}
                    checked={fAutonomy === opt.value}
                    onchange={() => {
                      fAutonomy = opt.value;
                    }}
                    class="mt-0.5 shrink-0"
                  />
                  <div>
                    <p class="text-sm font-semibold text-ink">{opt.label}</p>
                    <p class="text-xs text-ink-muted">{opt.hint}</p>
                  </div>
                </label>
              {/each}
            </div>
          </div>

          <!-- Permissions -->
          <div>
            <span class="mb-2 block text-xs font-semibold tracking-wide text-ink-muted uppercase">
              Permissions
            </span>
            <p class="mb-2 text-xs text-ink-muted">
              Scopes accordés à l'agent. Seules les permissions listées seront disponibles dans les
              outils MCP.
            </p>
            <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {#each dispatchScopes as scope (scope.key)}
                <label
                  class="flex cursor-pointer items-start gap-2 rounded border p-2.5 text-xs transition
                    {fPermissions.includes(scope.key)
                    ? 'border-accent bg-accent-soft/30'
                    : 'border-edge hover:border-accent'}"
                >
                  <input
                    type="checkbox"
                    checked={fPermissions.includes(scope.key)}
                    onchange={() => togglePermission(scope.key)}
                    class="mt-0.5 shrink-0"
                  />
                  <div>
                    <code class="font-mono text-ink">{scope.key}</code>
                    <p class="mt-0.5 text-ink-muted">{scope.description}</p>
                  </div>
                </label>
              {/each}
            </div>
          </div>

          <!-- Caps -->
          <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <Field label="Plafond $ par action">
                <Input type="number" bind:value={fMaxAmount} placeholder="Optionnel" />
              </Field>
              <p class="mt-1 text-xs text-ink-muted">
                Plafond $/action — l'agent ne peut pas dépenser plus que ce montant en une seule
                action.
              </p>
            </div>
            <div>
              <Field label="Actions max par minute">
                <Input type="number" bind:value={fMaxRate} placeholder="Optionnel" />
              </Field>
              <p class="mt-1 text-xs text-ink-muted">
                Débit max/min — limite le nombre d'appels MCP que l'agent peut déclencher par
                minute.
              </p>
            </div>
          </div>
        </div>
      </Card>

      <div class="mt-4 flex justify-end gap-3">
        <Button variant="primary" type="submit" loading={saving} disabled={saving}>
          Enregistrer
        </Button>
      </div>
    </form>
  </div>

  <!-- Autonomie -->
  <div id="autonomie" class="mt-10">
    <h2 class="mb-4 text-base font-semibold text-ink">Autonomie</h2>

    <!-- Circuit breaker banner -->
    {#if agent.breakerTrippedAt}
      <Card>
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div class="flex items-center gap-2">
            <Badge tone="danger">Circuit breaker actif</Badge>
            <span class="text-sm text-ink-muted">
              L'agent est rétrogradé en PROPOSE — déclenché le {formatDateTime(
                agent.breakerTrippedAt,
              )}.
            </span>
          </div>
          <Button variant="secondary" onclick={resetBreaker} loading={busy} disabled={busy}>
            Réarmer
          </Button>
        </div>
      </Card>
    {/if}

    <!-- Trust banner -->
    {#if trust}
      <Card>
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div class="min-w-0">
            <div class="flex items-center gap-2">
              <span class="text-sm font-semibold text-ink">Confiance : {trust.score}/100</span>
              <Badge tone={autonomyTone(trust.currentLevel as AutonomyLevel)}
                >{trust.currentLevel}</Badge
              >
            </div>
            {#if trust.readyForNext}
              <p class="mt-1 text-xs text-ink-muted">Prêt pour {trust.nextLevel}.</p>
            {:else if trust.reasons.length > 0}
              <ul class="mt-1 space-y-0.5 text-xs text-ink-muted">
                {#each trust.reasons as reason (reason)}
                  <li>· {reason}</li>
                {/each}
              </ul>
            {/if}
          </div>
          {#if trust.readyForNext}
            <Button variant="primary" onclick={promote} loading={busy} disabled={busy}>
              Promouvoir
            </Button>
          {/if}
        </div>
      </Card>
    {/if}

    <!-- Policies summary (read-only) -->
    {#if agent.caps?.policies?.length}
      <div class="mt-4">
        <Card>
          <div class="mb-3">
            <h3 class="text-sm font-semibold text-ink">Règles de politique</h3>
            <p class="mt-0.5 text-xs text-ink-muted">
              Lecture seule — ces règles s'éditent depuis la configuration de l'agent.
            </p>
          </div>
          <ul class="divide-y divide-edge">
            {#each agent.caps.policies as policy, i (i)}
              <li class="flex flex-wrap items-center gap-2 px-1 py-2 text-xs">
                <code class="font-mono text-ink">{policy.tool ?? 'tout outil'}</code>
                <span class="text-ink-muted">· {policy.tierMax ?? '—'}</span>
                <span class="text-ink-muted">· {policy.maxAmount ?? '—'}</span>
                <span class="text-ink-muted">→</span>
                <Badge tone={policy.effect === 'DENY' ? 'danger' : 'ok'}>{policy.effect}</Badge>
              </li>
            {/each}
          </ul>
        </Card>
      </div>
    {/if}
  </div>

  <!-- KPI (30 derniers jours) -->
  {#if kpis}
    <div id="kpi" class="mt-10">
      <h2 class="mb-4 text-base font-semibold text-ink">KPI (30 derniers jours)</h2>
      <div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card
          ><p class="text-xs text-ink-muted">Actions</p>
          <p class="text-xl font-semibold text-ink">{kpis.actions.total}</p></Card
        >
        <Card
          ><p class="text-xs text-ink-muted">Taux d'approbation</p>
          <p class="text-xl font-semibold text-ink">{pct(kpis.approvalRate)}</p></Card
        >
        <Card
          ><p class="text-xs text-ink-muted">Auto-approbation</p>
          <p class="text-xl font-semibold text-ink">{pct(kpis.autoApprovalRate)}</p></Card
        >
        <Card
          ><p class="text-xs text-ink-muted">Taux d'erreur</p>
          <p class="text-xl font-semibold text-ink">{pct(kpis.errorRate)}</p></Card
        >
        <Card
          ><p class="text-xs text-ink-muted">Runs réussis</p>
          <p class="text-xl font-semibold text-ink">
            {kpis.runs.succeeded}/{kpis.runs.total}
          </p></Card
        >
        <Card
          ><p class="text-xs text-ink-muted">Latence moy.</p>
          <p class="text-xl font-semibold text-ink">
            {kpis.avgRunLatencyMs == null ? '—' : kpis.avgRunLatencyMs + ' ms'}
          </p></Card
        >
        <Card
          ><p class="text-xs text-ink-muted">Tâches résolues</p>
          <p class="text-xl font-semibold text-ink">{kpis.tasksResolved}</p></Card
        >
        <Card
          ><p class="text-xs text-ink-muted">Trips breaker</p>
          <p class="text-xl font-semibold text-ink">{kpis.breakerTrips}</p></Card
        >
      </div>
    </div>
  {/if}

  <!-- Timeline -->
  <div id="timeline" class="mt-10">
    <h2 class="mb-4 text-base font-semibold text-ink">Timeline</h2>
    <Card>
      {#if timelineItems.length === 0}
        <p class="py-4 text-center text-sm text-ink-faint">Aucune activité.</p>
      {:else}
        <ul class="divide-y divide-edge">
          {#each timelineItems as t (t.kind + (t.ref ?? '') + t.at)}
            <li class="flex items-center justify-between gap-3 px-1 py-2 text-sm">
              <span class="min-w-0"
                ><Badge tone="neutral">{t.kind}</Badge>
                <span class="text-ink">{t.summary}</span></span
              >
              <span class="shrink-0 text-ink-faint">{formatDateTime(t.at)}</span>
            </li>
          {/each}
        </ul>
      {/if}
    </Card>
  </div>

  <!-- Activité 24/7 -->
  <div id="activite-24-7" class="mt-10">
    <h2 class="mb-4 text-base font-semibold text-ink">Activité 24/7</h2>

    <Card>
      <!-- Runtime readiness chip — proactive: shows whether the runtime can actually run this
           agent right now and why not, instead of only surfacing it as a toast after a failed
           "Exécuter maintenant" click. Best-effort: hidden if the readiness call failed. -->
      {#if runtimeReadiness}
        <div
          class={`mb-4 flex flex-wrap items-center gap-2 rounded-card border px-3 py-2 text-xs
            ${runtimeReadiness.ready ? 'border-ok bg-ok-soft' : 'border-warning bg-warning-soft'}`}
        >
          <Badge tone={runtimeReadiness.ready ? 'ok' : 'warn'}>
            {runtimeReadiness.ready ? 'Runtime prêt' : 'Runtime non prêt'}
          </Badge>
          {#if runtimeReadiness.ready}
            <span class="text-ink-muted">
              {#if runtimeProviderLabel}Fournisseur : <span class="font-medium text-ink"
                  >{runtimeProviderLabel}</span
                >{/if}
              {#if agent.model ?? runtimeDefaultModel}
                · Modèle : <span class="font-medium text-ink"
                  >{agent.model ?? runtimeDefaultModel}</span
                >
              {/if}
            </span>
          {:else}
            <span class="text-ink">{runtimeReasonText}</span>
          {/if}
        </div>
      {/if}

      <!-- Heartbeat + controls -->
      <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div class="flex items-center gap-2">
          {#if agent.status === 'PAUSED'}
            <Badge tone="warn">En pause</Badge>
          {:else if agent.status === 'REVOKED'}
            <Badge tone="danger">Révoqué</Badge>
          {:else}
            <Badge tone="ok">Actif</Badge>
          {/if}
          <span class="text-xs text-ink-muted">
            {#if agent.lastSeenAt}
              Vu : {new Date(agent.lastSeenAt).toLocaleString()}
            {:else if agent.lastRunAt}
              Dernière exécution : {new Date(agent.lastRunAt).toLocaleString()}
            {:else}
              Jamais vu
            {/if}
          </span>
        </div>

        {#if agent.status !== 'REVOKED'}
          <div class="flex shrink-0 gap-2">
            {#if agent.status === 'PAUSED'}
              <Button
                variant="primary"
                onclick={() => runAction('resume', 'Agent réactivé')}
                loading={busy}
                disabled={busy}
              >
                Reprendre
              </Button>
            {:else}
              <Button variant="secondary" onclick={runNow} loading={busy} disabled={busy}>
                Exécuter maintenant
              </Button>
              <Button
                variant="secondary"
                onclick={() => runAction('pause', 'Agent mis en pause')}
                loading={busy}
                disabled={busy}
              >
                Pause
              </Button>
            {/if}
          </div>
        {/if}
      </div>

      {#if runsError}
        <p class="mb-3 text-sm text-danger">{runsError}</p>
      {/if}

      <!-- Run history -->
      {#if runs.length === 0}
        <p class="py-4 text-center text-sm text-ink-faint">Aucune exécution pour l'instant.</p>
      {:else}
        <ul class="divide-y divide-edge">
          {#each runs as run (run.id)}
            <li class="flex flex-wrap items-center gap-3 px-1 py-2.5">
              <span class="min-w-0 flex-1">
                <span class="block truncate text-sm font-medium text-ink">
                  {#if run.task}
                    {run.task.title}
                  {:else}
                    {run.trigger} · {run.taskId ?? '—'}
                  {/if}
                </span>
                <span class="text-xs text-ink-muted">
                  {#if run.task}<span class="font-medium text-ink-muted">{run.task.category}</span> ·
                  {/if}{run.trigger} · {run.proposedActionCount} action{run.proposedActionCount !==
                  1
                    ? 's'
                    : ''} · {formatDateTime(run.startedAt)}
                </span>
                {#if run.task?.resolutionNote}
                  <span
                    class="mt-0.5 block truncate text-xs text-ink-muted"
                    title={run.task.resolutionNote}>↳ {run.task.resolutionNote}</span
                  >
                {/if}
                {#if run.error}
                  <span class="mt-0.5 block truncate text-xs text-danger">{run.error}</span>
                {/if}
              </span>
              <div class="flex shrink-0 items-center gap-2">
                {#if run.task}
                  <Badge tone={run.task.status === 'RESOLVED' ? 'ok' : 'neutral'}
                    >{run.task.status}</Badge
                  >
                {/if}
                <Badge tone={runStatusTone(run.status)}>{run.status}</Badge>
              </div>
            </li>
          {/each}
        </ul>
      {/if}
    </Card>
  </div>

  <!-- Activité -->
  <div id="activite" class="mt-10">
    <h2 class="mb-4 text-base font-semibold text-ink">Activité</h2>

    {#if activityError}
      <p class="mb-4 text-sm text-danger">{activityError}</p>
    {/if}

    {#if activity}
      <!-- Stats row -->
      <div class="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {#each [{ label: 'Conversations', value: activity.stats.conversations }, { label: 'En attente', value: activity.stats.pending }, { label: 'Exécutées', value: activity.stats.executed }, { label: 'Rejetées', value: activity.stats.rejected }] as stat (stat.label)}
          <div class="rounded-card border border-edge bg-surface p-4 text-center">
            <p class="text-2xl font-bold text-ink">{stat.value}</p>
            <p class="mt-0.5 text-xs text-ink-muted">{stat.label}</p>
          </div>
        {/each}
      </div>

      <!-- Conversations list -->
      <Card>
        <div class="mb-3 flex items-center justify-between">
          <h3 class="text-sm font-semibold text-ink">Conversations</h3>
        </div>
        {#if activity.conversations.length === 0}
          <p class="py-4 text-center text-sm text-ink-faint">Aucune conversation pour l'instant.</p>
        {:else}
          <ul class="divide-y divide-edge">
            {#each activity.conversations as convo (convo.id)}
              <li>
                <button
                  class="flex w-full items-center justify-between gap-4 px-1 py-2.5 text-left transition hover:bg-surface-muted disabled:opacity-50"
                  onclick={() => openConversation(convo.id)}
                  disabled={loadingConversation}
                >
                  <span class="min-w-0">
                    <span class="block truncate text-sm font-medium text-ink">
                      {convo.title ?? 'Sans titre'}
                    </span>
                    <span class="text-xs text-ink-muted">
                      {convo.messageCount} message{convo.messageCount !== 1 ? 's' : ''} · {formatDateTime(
                        convo.createdAt,
                      )}
                    </span>
                  </span>
                  <span class="shrink-0 text-xs text-accent">Ouvrir ↓</span>
                </button>
              </li>
            {/each}
          </ul>
        {/if}
      </Card>

      <!-- Proposed actions list -->
      <div class="mt-4">
        <Card>
          <div class="mb-3 flex items-center justify-between">
            <h3 class="text-sm font-semibold text-ink">Actions proposées</h3>
            <a href="/agent-actions" class="text-xs text-accent hover:underline"> Voir toutes → </a>
          </div>
          {#if activity.proposedActions.length === 0}
            <p class="py-4 text-center text-sm text-ink-faint">
              Aucune action proposée pour l'instant.
            </p>
          {:else}
            <ul class="divide-y divide-edge">
              {#each activity.proposedActions as action (action.id)}
                <li class="flex flex-wrap items-center gap-3 py-2.5 px-1">
                  <span class="min-w-0 flex-1">
                    <span class="block truncate text-sm font-medium text-ink">{action.tool}</span>
                    <span class="text-xs text-ink-muted">{formatDateTime(action.proposedAt)}</span>
                    {#if actionReasonText(action)}
                      <span class="mt-0.5 block text-xs text-ink-faint"
                        >{actionReasonText(action)}</span
                      >
                    {/if}
                  </span>
                  <div class="flex shrink-0 items-center gap-1.5">
                    <Badge tone={riskTierTone(action.riskTier)}>{action.riskTier}</Badge>
                    <Badge tone={actionStatusTone(action.status)}>{action.status}</Badge>
                  </div>
                </li>
              {/each}
            </ul>
          {/if}
        </Card>
      </div>
    {:else if !activityError}
      <Card><Skeleton rows={5} /></Card>
    {/if}
  </div>

  <!-- Chat -->
  <div id="chat" class="mt-10 mb-12">
    <h2 class="mb-4 text-base font-semibold text-ink">Chat</h2>
    <Card padded={false}>
      <div class="flex h-[520px] flex-col">
        {#if chatConversationId !== null || chatInitialMessages.length > 0}
          <!-- Loaded from activity list: show a reset button -->
          <div class="flex items-center justify-between border-b border-edge px-4 py-2">
            <span class="text-xs text-ink-muted">Conversation chargée depuis l'historique</span>
            <button
              class="text-xs text-accent hover:underline"
              onclick={() => {
                chatConversationId = null;
                chatInitialMessages = [];
                chatReset = true;
              }}
            >
              Nouvelle conversation
            </button>
          </div>
        {/if}
        {#key chatConversationId}
          <Conversation
            {agentId}
            initialConversationId={chatConversationId}
            initialMessages={chatInitialMessages}
          />
        {/key}
      </div>
    </Card>
  </div>
{/if}
