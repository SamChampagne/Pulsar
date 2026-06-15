<script lang="ts">
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { PERMISSION_CATALOG } from '@pulsar/shared';
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
    Textarea,
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

  // Chat: active conversation loaded from activity list
  let chatConversationId = $state<string | null>(null);
  let chatInitialMessages = $state<ConversationDetail['messages']>([]);
  let loadingConversation = $state(false);

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
        loadError = e instanceof ApiError ? e.message : 'Impossible de charger l\'agent';
      }
    }
  }

  async function loadActivity(id: string) {
    activityError = '';
    try {
      const data = await api<AgentActivity>(`/agents/${id}/activity`);
      activity = data;
    } catch (e) {
      activityError = e instanceof ApiError ? e.message : 'Impossible de charger l\'activité';
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
      toast.success('Niveau d\'autonomie promu');
      await load();
      await loadTrust(agentId);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Échec de la promotion');
    } finally {
      busy = false;
    }
  }

  async function runAction(verb: 'pause' | 'resume' | 'run-now', label: string) {
    busy = true;
    try {
      await api(`/agents/${agentId}/${verb}`, { method: 'POST' });
      toast.success(label);
      await load();
      await loadRuns(agentId);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Échec de l\'action');
    } finally {
      busy = false;
    }
  }

  async function openConversation(convId: string) {
    loadingConversation = true;
    try {
      const data = await api<ConversationDetail>(`/agent-conversations/${convId}`);
      chatConversationId = data.id;
      chatInitialMessages = data.messages;
      // Scroll to chat section
      queueMicrotask(() => {
        document.getElementById('chat')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    } catch (e) {
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
      if (fMaxAmount.trim() !== '' && amount > 0) caps.maxAmountPerAction = amount;
      if (fMaxRate.trim() !== '' && rate > 0) caps.maxActionsPerMinute = rate;

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
    if (!confirm(`Révoquer l'agent "${agent?.name}" ? Sa clé cessera de fonctionner immédiatement.`)) return;
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
      L'identifiant <code class="rounded bg-surface-muted px-1 text-xs">{agentId}</code> ne correspond à aucun agent.
    </p>
    <div class="mt-4">
      <Button variant="secondary" onclick={() => goto('/agents')}>Retour aux agents</Button>
    </div>
  </div>
{:else if loadError && !agent}
  <p class="mt-8 text-sm text-danger">{loadError}</p>
{:else if !agent}
  <div class="py-16 text-center text-sm text-ink-muted">Chargement…</div>
{:else}
  <!-- Page header: avatar + name + badges + revoke action -->
  <div class="mb-6 flex flex-wrap items-center justify-between gap-4">
    <div class="flex items-center gap-3">
      <div class="flex size-12 shrink-0 items-center justify-center rounded-full bg-accent-soft text-2xl">
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
              <Input bind:value={fModel} placeholder="ex. anthropic:claude-sonnet-4-6" />
            </Field>
          </div>

          <!-- Description -->
          <Field label="Description">
            <Input bind:value={fDescription} placeholder="Ce que fait cet agent…" />
          </Field>

          <!-- Persona -->
          <div>
            <Field label="Persona">
              <Textarea bind:value={fPersona} rows={4} placeholder="Personnalité et instructions système de cet employé…" />
            </Field>
            <p class="mt-1 text-xs text-ink-muted">
              Personnalité + instructions système de l'employé. Définit le ton, le style de réponse et les règles métier internes.
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
                    onchange={() => { fAutonomy = opt.value; }}
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
              Scopes accordés à l'agent. Seules les permissions listées seront disponibles dans les outils MCP.
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
                Plafond $/action — l'agent ne peut pas dépenser plus que ce montant en une seule action.
              </p>
            </div>
            <div>
              <Field label="Actions max par minute">
                <Input type="number" bind:value={fMaxRate} placeholder="Optionnel" />
              </Field>
              <p class="mt-1 text-xs text-ink-muted">
                Débit max/min — limite le nombre d'appels MCP que l'agent peut déclencher par minute.
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
              L'agent est rétrogradé en PROPOSE — déclenché le {formatDateTime(agent.breakerTrippedAt)}.
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
              <Badge tone={autonomyTone(trust.currentLevel as AutonomyLevel)}>{trust.currentLevel}</Badge>
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

  <!-- Activité 24/7 -->
  <div id="activite-24-7" class="mt-10">
    <h2 class="mb-4 text-base font-semibold text-ink">Activité 24/7</h2>

    <Card>
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
              <Button
                variant="secondary"
                onclick={() => runAction('run-now', 'Exécution déclenchée')}
                loading={busy}
                disabled={busy}
              >
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
                  {run.trigger} · {run.taskId ?? '—'}
                </span>
                <span class="text-xs text-ink-muted">
                  Tentative {run.attempt} · {run.proposedActionCount} action{run.proposedActionCount !== 1 ? 's' : ''} · {formatDateTime(run.startedAt)}
                </span>
                {#if run.error}
                  <span class="mt-0.5 block truncate text-xs text-ink-muted">{run.error}</span>
                {/if}
              </span>
              <div class="shrink-0">
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
        {#each [
          { label: 'Conversations', value: activity.stats.conversations },
          { label: 'En attente', value: activity.stats.pending },
          { label: 'Exécutées', value: activity.stats.executed },
          { label: 'Rejetées', value: activity.stats.rejected },
        ] as stat (stat.label)}
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
                      {convo.messageCount} message{convo.messageCount !== 1 ? 's' : ''} · {formatDateTime(convo.createdAt)}
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
            <a href="/agent-actions" class="text-xs text-accent hover:underline">
              Voir toutes →
            </a>
          </div>
          {#if activity.proposedActions.length === 0}
            <p class="py-4 text-center text-sm text-ink-faint">Aucune action proposée pour l'instant.</p>
          {:else}
            <ul class="divide-y divide-edge">
              {#each activity.proposedActions as action (action.id)}
                <li class="flex flex-wrap items-center gap-3 py-2.5 px-1">
                  <span class="min-w-0 flex-1">
                    <span class="block truncate text-sm font-medium text-ink">{action.tool}</span>
                    <span class="text-xs text-ink-muted">{formatDateTime(action.proposedAt)}</span>
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
      <Card>
        <p class="py-6 text-center text-sm text-ink-muted">Chargement de l'activité…</p>
      </Card>
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
              onclick={() => { chatConversationId = null; chatInitialMessages = []; }}
            >
              Nouvelle conversation
            </button>
          </div>
        {/if}
        {#key chatConversationId}
          <Conversation
            agentId={agentId}
            initialConversationId={chatConversationId}
            initialMessages={chatInitialMessages}
          />
        {/key}
      </div>
    </Card>
  </div>
{/if}
