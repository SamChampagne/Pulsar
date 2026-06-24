<script lang="ts">
  import { page } from '$app/state';
  import { untrack } from 'svelte';
  import { AGENT_ROLE_PRESETS } from '@pulsar/shared';
  import { api, ApiError } from '$lib/api/client';
  import { streamAgentTurn } from '$lib/api/agent-stream';
  import { toast } from '$lib/stores/toast';
  import {
    Badge,
    Button,
    Card,
    PageHeader,
    Skeleton,
  } from '$lib/components/ui';
  import { Send, Wrench } from 'lucide-svelte';

  // ── Types ────────────────────────────────────────────────────────────────────

  interface AgentSummary {
    id: string;
    name: string;
    role: string | null;
    status: string;
    autonomyLevel: string;
  }

  interface ToolCall {
    name: string;
    args: unknown;
  }

  interface ChatMessage {
    role: 'user' | 'assistant';
    text: string;
    toolCalls: ToolCall[];
    streaming?: boolean;
  }

  interface ProposedAction {
    id: string;
    tool: string;
    status: string;
    riskTier: string;
    proposedAt: string;
    args?: unknown;
    summary?: string;
  }

  // ── Preset ───────────────────────────────────────────────────────────────────
  const preset = AGENT_ROLE_PRESETS.find((p) => p.id === 'deal-coach')!;

  // ── State ────────────────────────────────────────────────────────────────────

  let dealId = $derived(page.url.searchParams.get('dealId'));

  let coachAgent = $state<AgentSummary | null>(null);
  let loadingAgent = $state(true);
  let provisioningAgent = $state(false);
  let agentError = $state('');

  let conversationId = $state<string | null>(null);
  let messages = $state<ChatMessage[]>([]);
  let input = $state('');
  let sending = $state(false);
  let chatError = $state('');
  let runtimeUnavailable = $state(false);
  let listEl = $state<HTMLDivElement | null>(null);

  let pendingActions = $state<ProposedAction[]>([]);
  let loadingActions = $state(false);
  let actionsError = $state('');
  let actionBusy = $state<Record<string, boolean>>({});

  // ── Agent resolution ─────────────────────────────────────────────────────────

  async function loadCoachAgent() {
    loadingAgent = true;
    agentError = '';
    try {
      const agents = await api<AgentSummary[]>('/agents');
      const found = agents.find((a) => a.role === 'deal-coach');
      coachAgent = found ?? null;
    } catch (e) {
      agentError = e instanceof ApiError ? e.message : 'Impossible de vérifier les agents';
    } finally {
      loadingAgent = false;
    }
  }

  async function activateCoach() {
    provisioningAgent = true;
    agentError = '';
    try {
      const body: Record<string, unknown> = {
        name: preset.label,
        persona: preset.persona,
        role: preset.id,
        permissions: preset.suggestedPermissions,
        autonomyLevel: preset.suggestedAutonomy,
      };
      coachAgent = await api<AgentSummary>('/agents', { method: 'POST', body });
      toast.success('Coach commercial activé');
    } catch (e) {
      agentError = e instanceof ApiError ? e.message : "Impossible d'activer le coach";
    } finally {
      provisioningAgent = false;
    }
  }

  // ── Conversation ──────────────────────────────────────────────────────────────

  function scrollToBottom() {
    queueMicrotask(() => {
      if (listEl) listEl.scrollTop = listEl.scrollHeight;
    });
  }

  async function ensureConversation(): Promise<string | null> {
    if (conversationId) return conversationId;
    if (!coachAgent) return null;
    try {
      const convo = await api<{ id: string }>('/agent-conversations', {
        method: 'POST',
        body: { agentId: coachAgent.id },
      });
      conversationId = convo.id;
      return conversationId;
    } catch (err) {
      if (err instanceof ApiError && err.statusCode === 503) {
        runtimeUnavailable = true;
        return null;
      }
      chatError = err instanceof ApiError ? err.message : 'Impossible de démarrer la conversation';
      return null;
    }
  }

  async function sendMessage(text: string) {
    if (!text.trim() || sending) return;
    chatError = '';
    runtimeUnavailable = false;
    sending = true;
    input = '';

    const convId = await ensureConversation();
    if (!convId) {
      sending = false;
      return;
    }

    messages = [...messages, { role: 'user', text, toolCalls: [] }];
    const assistant: ChatMessage = { role: 'assistant', text: '', toolCalls: [], streaming: true };
    messages = [...messages, assistant];
    const idx = messages.length - 1;
    scrollToBottom();

    try {
      for await (const ev of streamAgentTurn(convId, text)) {
        if (ev.type === 'text') {
          messages[idx] = { ...messages[idx], text: messages[idx].text + ev.text };
        } else if (ev.type === 'tool_call') {
          messages[idx] = {
            ...messages[idx],
            toolCalls: [...messages[idx].toolCalls, { name: ev.name, args: ev.args }],
          };
        } else if (ev.type === 'error') {
          if (ev.message.includes('503') || ev.message.toLowerCase().includes('runtime')) {
            runtimeUnavailable = true;
          } else {
            chatError = ev.message || 'assistant indisponible';
          }
        } else if (ev.type === 'end') {
          break;
        }
        scrollToBottom();
      }
    } catch (err) {
      chatError = err instanceof Error ? err.message : 'assistant indisponible';
    } finally {
      messages[idx] = { ...messages[idx], streaming: false };
      sending = false;
      scrollToBottom();
      // Refresh proposed actions after each turn
      void loadPendingActions();
    }
  }

  function onSubmitForm(e: SubmitEvent) {
    e.preventDefault();
    void sendMessage(input.trim());
  }

  function onInputKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void sendMessage(input.trim());
    }
  }

  function sendSuggestedPrompt(prompt: string) {
    void sendMessage(prompt);
  }

  // ── Proposed actions ──────────────────────────────────────────────────────────

  async function loadPendingActions() {
    loadingActions = true;
    actionsError = '';
    try {
      const result = await api<ProposedAction[]>('/agent-actions');
      pendingActions = result.filter((a) => a.status === 'PENDING');
    } catch (e) {
      actionsError = e instanceof ApiError ? e.message : 'Impossible de charger les actions';
    } finally {
      loadingActions = false;
    }
  }

  async function approveAction(id: string) {
    actionBusy = { ...actionBusy, [id]: true };
    try {
      await api(`/agent-actions/${id}/approve`, { method: 'POST' });
      toast.success('Action approuvée');
      await loadPendingActions();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Échec de l'approbation");
    } finally {
      actionBusy = { ...actionBusy, [id]: false };
    }
  }

  async function rejectAction(id: string) {
    actionBusy = { ...actionBusy, [id]: true };
    try {
      await api(`/agent-actions/${id}/reject`, { method: 'POST' });
      toast.success('Action rejetée');
      await loadPendingActions();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Échec du rejet');
    } finally {
      actionBusy = { ...actionBusy, [id]: false };
    }
  }

  function riskTierTone(tier: string): 'ok' | 'warn' | 'danger' | 'info' | 'neutral' {
    if (tier === 'HIGH') return 'danger';
    if (tier === 'MEDIUM') return 'warn';
    if (tier === 'LOW') return 'ok';
    return 'neutral';
  }

  function formatArgs(args: unknown): string {
    if (args === undefined || args === null) return '';
    try {
      return JSON.stringify(args, null, 2);
    } catch {
      return String(args);
    }
  }

  // ── Init ──────────────────────────────────────────────────────────────────────

  $effect(() => {
    void loadCoachAgent();
    void loadPendingActions();
  });

  // Auto-send deal analysis prompt when deal mode is active and coach is ready.
  $effect(() => {
    const _dealId = dealId;
    const _agent = coachAgent;
    untrack(() => {
      if (_dealId && _agent && messages.length === 0 && !sending) {
        void sendMessage(
          `Analyse le deal ${_dealId} et explique comment le gagner : risques, leviers, et la prochaine meilleure action.`,
        );
      }
    });
  });
</script>

<PageHeader
  title="Coach commercial"
  subtitle={dealId ? `Analyse du deal ${dealId}` : 'Votre assistant IA pour gagner vos deals'}
/>

<!-- ── Agent bootstrap ── -->
{#if loadingAgent}
  <Card><Skeleton rows={2} /></Card>
{:else if agentError && !coachAgent}
  <div class="rounded-xl border border-danger-soft bg-danger-soft px-4 py-3 text-sm text-danger">
    {agentError}
  </div>
{:else if !coachAgent}
  <Card>
    <div class="flex flex-col items-center gap-4 py-6 text-center">
      <div class="text-4xl">🎯</div>
      <div>
        <h2 class="text-base font-semibold text-ink">Coach commercial non configuré</h2>
        <p class="mt-1 max-w-md text-sm text-ink-muted">
          L'agent coach n'est pas encore activé pour ce tenant. Cliquez ci-dessous pour le
          provisionner automatiquement avec les paramètres recommandés.
        </p>
      </div>
      <Button variant="primary" onclick={activateCoach} loading={provisioningAgent} disabled={provisioningAgent}>
        Activer le coach commercial
      </Button>
    </div>
  </Card>
{:else}
  <!-- ── Layout: chat + sidebar ── -->
  <div class="flex gap-4 items-start">
    <!-- ── Chat panel ── -->
    <div class="min-w-0 flex-1">
      <Card padded={false}>
        <div class="flex flex-col" style="height: 560px;">
          <!-- Agent header -->
          <div class="flex items-center gap-3 border-b border-edge px-4 py-3">
            <div class="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent-soft text-lg">
              🎯
            </div>
            <div class="min-w-0 flex-1">
              <p class="text-sm font-semibold text-ink">{coachAgent.name}</p>
              {#if coachAgent.role}
                <p class="text-xs text-ink-muted">{coachAgent.role}</p>
              {/if}
            </div>
            <Badge tone={coachAgent.status === 'ACTIVE' ? 'ok' : 'neutral'}>{coachAgent.status}</Badge>
          </div>

          <!-- Messages -->
          <div
            bind:this={listEl}
            class="flex-1 space-y-3 overflow-y-auto p-4"
            style="min-height: 0;"
          >
            {#if messages.length === 0 && !dealId}
              <!-- Pipeline mode: suggested prompts -->
              <div class="flex flex-col items-center gap-4 py-8 text-center">
                <p class="text-sm text-ink-muted">
                  Posez une question ou choisissez un point de départ :
                </p>
                <div class="flex flex-wrap justify-center gap-2">
                  {#each [
                    'Quels deals sont à risque ?',
                    'Où concentrer mes efforts ce mois-ci ?',
                    'Donne-moi un plan pour la semaine',
                  ] as prompt (prompt)}
                    <button
                      class="rounded-full border border-edge-soft bg-surface px-4 py-2 text-sm text-ink-muted transition hover:border-accent hover:text-accent disabled:opacity-50"
                      onclick={() => sendSuggestedPrompt(prompt)}
                      disabled={sending}
                    >{prompt}</button>
                  {/each}
                </div>
              </div>
            {:else if messages.length === 0 && dealId}
              <p class="text-center text-xs text-ink-faint">Analyse en cours…</p>
            {/if}

            {#each messages as msg, i (i)}
              {#if msg.role === 'user'}
                <div class="flex justify-end">
                  <div class="max-w-[85%] rounded-card bg-accent px-3 py-2 text-sm text-white whitespace-pre-wrap">
                    {msg.text}
                  </div>
                </div>
              {:else}
                <div class="flex flex-col gap-2">
                  {#if msg.text || msg.streaming}
                    <div class="max-w-[85%] rounded-card bg-surface-muted px-3 py-2 text-sm text-ink whitespace-pre-wrap">
                      {msg.text}{#if msg.streaming}<span class="ml-0.5 inline-block animate-pulse">▍</span>{/if}
                    </div>
                  {/if}
                  {#each msg.toolCalls as call, ci (ci)}
                    <div class="max-w-[85%] rounded-card border border-edge bg-surface p-3">
                      <div class="flex items-center gap-2">
                        <Wrench class="size-3.5 text-ink-muted" />
                        <span class="text-xs font-semibold text-ink">Outil utilisé</span>
                        <Badge tone="info">{call.name}</Badge>
                      </div>
                      {#if formatArgs(call.args)}
                        <pre class="mt-1.5 overflow-x-auto rounded bg-surface-muted px-2 py-1.5 text-[11px] text-ink-muted">{formatArgs(call.args)}</pre>
                      {/if}
                    </div>
                  {/each}
                </div>
              {/if}
            {/each}
          </div>

          <!-- Runtime unavailable banner -->
          {#if runtimeUnavailable}
            <div class="border-t border-warn-soft bg-warn-soft px-4 py-2 text-xs text-warn">
              Le runtime d'agent n'est pas configuré pour ce tenant —
              <a href="/agents" class="font-semibold underline">configure-le dans /agents</a>.
            </div>
          {/if}

          <!-- Chat error -->
          {#if chatError}
            <p class="border-t border-danger-soft bg-danger-soft px-4 py-2 text-xs text-danger">{chatError}</p>
          {/if}

          <!-- Input -->
          <form class="flex items-end gap-2 border-t border-edge p-3" onsubmit={onSubmitForm}>
            <textarea
              rows={1}
              bind:value={input}
              onkeydown={onInputKeydown}
              placeholder="Demandez au coach…"
              disabled={sending}
              class="max-h-32 min-h-[2.25rem] w-full resize-none rounded-md border border-edge bg-surface px-3 py-1.5 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none disabled:bg-surface-muted"
            ></textarea>
            <Button type="submit" loading={sending} disabled={!input.trim() || sending}>
              <Send class="size-4" />
            </Button>
          </form>
        </div>
      </Card>
    </div>

    <!-- ── Proposed actions sidebar ── -->
    <div class="w-80 shrink-0">
      <Card>
        <div class="mb-3 flex items-center justify-between">
          <h3 class="text-sm font-semibold text-ink">Actions proposées</h3>
          {#if pendingActions.length > 0}
            <Badge tone="warn">{pendingActions.length}</Badge>
          {/if}
        </div>

        {#if loadingActions}
          <Skeleton rows={3} />
        {:else if actionsError}
          <p class="text-xs text-danger">{actionsError}</p>
        {:else if pendingActions.length === 0}
          <p class="py-4 text-center text-xs text-ink-faint">
            Aucune action en attente d'approbation.
          </p>
        {:else}
          <ul class="divide-y divide-edge">
            {#each pendingActions as action (action.id)}
              <li class="py-3">
                <div class="mb-2 flex items-start gap-2">
                  <div class="min-w-0 flex-1">
                    <p class="truncate text-xs font-semibold text-ink">{action.tool}</p>
                    {#if action.summary}
                      <p class="mt-0.5 text-xs text-ink-muted">{action.summary}</p>
                    {/if}
                  </div>
                  <Badge tone={riskTierTone(action.riskTier)}>{action.riskTier}</Badge>
                </div>
                {#if formatArgs(action.args)}
                  <pre class="mb-2 overflow-x-auto rounded bg-surface-muted px-2 py-1 text-[10px] text-ink-muted">{formatArgs(action.args)}</pre>
                {/if}
                <div class="flex gap-2">
                  <Button
                    variant="primary"
                    loading={actionBusy[action.id]}
                    disabled={actionBusy[action.id]}
                    onclick={() => void approveAction(action.id)}
                  >
                    Approuver
                  </Button>
                  <Button
                    variant="secondary"
                    loading={actionBusy[action.id]}
                    disabled={actionBusy[action.id]}
                    onclick={() => void rejectAction(action.id)}
                  >
                    Rejeter
                  </Button>
                </div>
              </li>
            {/each}
          </ul>
        {/if}

        <div class="mt-4 border-t border-edge pt-3">
          <a href="/agent-actions" class="text-xs text-accent hover:underline">
            Voir toutes les actions →
          </a>
        </div>
      </Card>

      <!-- Agent info card -->
      <div class="mt-3">
        <Card>
          <p class="mb-1 text-xs font-semibold text-ink-muted uppercase tracking-wide">Agent</p>
          <div class="flex items-center justify-between gap-2">
            <p class="text-sm font-medium text-ink">{coachAgent.name}</p>
            <a href="/agents/{coachAgent.id}" class="text-xs text-accent hover:underline">Configurer →</a>
          </div>
          <p class="mt-1 text-xs text-ink-faint">Autonomie : {coachAgent.autonomyLevel}</p>
        </Card>
      </div>
    </div>
  </div>
{/if}
