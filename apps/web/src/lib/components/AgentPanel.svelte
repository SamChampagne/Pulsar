<script lang="ts">
  // Reusable contextual AI agent panel. Drops the tenant's AI employee into any
  // operational tool (Dispatch, Finance, …) so the agent is present where work
  // happens — not only in /agents. Mirrors the proven /crm/coach pattern:
  // find-or-activate an agent by role preset, stream a conversation over SSE,
  // and surface the agent's ProposedActions for inline human approval.
  //
  // Governance is unchanged: mutating tools still queue as ProposedAction and are
  // executed only on approve(). Runtime is best-effort — Hermes down ⇒ a friendly
  // message, never a crash (rule 24).
  import { api, ApiError } from '$lib/api/client';
  import { streamAgentTurn } from '$lib/api/agent-stream';
  import { AGENT_ROLE_PRESETS } from '@pulsar/shared';
  import { Button, Badge } from '$lib/components/ui';

  let {
    presetId,
    title = 'Assistant IA',
    intro = 'Posez une question ou demandez une action — l’agent propose, vous approuvez.',
  }: { presetId: string; title?: string; intro?: string } = $props();

  interface AgentSummary {
    id: string;
    name: string;
    role: string | null;
    autonomyLevel?: string;
  }
  interface ChatMessage {
    role: 'user' | 'assistant';
    text: string;
    toolCalls: { name: string; args: unknown }[];
    streaming?: boolean;
  }
  interface ProposedAction {
    id: string;
    agentId?: string;
    tool: string;
    status: string;
    riskTier?: string;
    proposedAt?: string;
    summary?: string;
  }

  const preset = $derived(AGENT_ROLE_PRESETS.find((p) => p.id === presetId) ?? null);

  let agent = $state<AgentSummary | null>(null);
  let loading = $state(true);
  let activating = $state(false);
  let loadError = $state('');

  let conversationId = $state<string | null>(null);
  let messages = $state<ChatMessage[]>([]);
  let input = $state('');
  let busy = $state(false);
  let chatError = $state('');

  let pendingActions = $state<ProposedAction[]>([]);

  let scroller: HTMLDivElement | null = $state(null);
  function scrollToBottom() {
    queueMicrotask(() => {
      if (scroller) scroller.scrollTop = scroller.scrollHeight;
    });
  }

  async function loadAgent() {
    loading = true;
    loadError = '';
    try {
      const agents = await api<AgentSummary[]>('/agents');
      agent = agents.find((a) => a.role === presetId) ?? null;
      if (agent) await loadPendingActions();
    } catch (e) {
      loadError = e instanceof ApiError ? e.message : 'Chargement de l’agent impossible.';
    } finally {
      loading = false;
    }
  }

  async function activate() {
    if (!preset) return;
    activating = true;
    loadError = '';
    try {
      agent = await api<AgentSummary>('/agents', {
        method: 'POST',
        body: {
          name: preset.label,
          persona: preset.persona,
          role: preset.id,
          permissions: preset.suggestedPermissions,
          autonomyLevel: preset.suggestedAutonomy,
        },
      });
      await loadPendingActions();
    } catch (e) {
      loadError = e instanceof ApiError ? e.message : 'Activation impossible.';
    } finally {
      activating = false;
    }
  }

  async function loadPendingActions() {
    if (!agent) return;
    try {
      const all = await api<ProposedAction[]>('/agent-actions');
      pendingActions = all.filter(
        (a) => a.status === 'PENDING' && (!a.agentId || a.agentId === agent!.id),
      );
    } catch {
      // best-effort — leave the list as-is
    }
  }

  async function ensureConversation(): Promise<string | null> {
    if (conversationId) return conversationId;
    if (!agent) return null;
    const convo = await api<{ id: string }>('/agent-conversations', {
      method: 'POST',
      body: { agentId: agent.id },
    });
    conversationId = convo.id;
    return conversationId;
  }

  async function send() {
    const text = input.trim();
    if (!text || busy || !agent) return;
    input = '';
    chatError = '';
    busy = true;
    messages = [...messages, { role: 'user', text, toolCalls: [] }];
    messages = [...messages, { role: 'assistant', text: '', toolCalls: [], streaming: true }];
    const idx = messages.length - 1;
    scrollToBottom();
    try {
      const convId = await ensureConversation();
      if (!convId) {
        chatError = 'Conversation indisponible.';
        return;
      }
      for await (const ev of streamAgentTurn(convId, text)) {
        if (ev.type === 'text') {
          messages[idx] = { ...messages[idx], text: messages[idx].text + ev.text };
        } else if (ev.type === 'tool_call') {
          messages[idx] = {
            ...messages[idx],
            toolCalls: [...messages[idx].toolCalls, { name: ev.name, args: ev.args }],
          };
        } else if (ev.type === 'error') {
          chatError = ev.message;
        }
        scrollToBottom();
      }
    } catch (e) {
      chatError = e instanceof ApiError ? e.message : 'Le runtime de l’agent est indisponible.';
    } finally {
      messages[idx] = { ...messages[idx], streaming: false };
      busy = false;
      void loadPendingActions();
      scrollToBottom();
    }
  }

  async function approve(id: string) {
    try {
      await api(`/agent-actions/${id}/approve`, { method: 'POST' });
    } catch (e) {
      chatError = e instanceof ApiError ? e.message : 'Approbation impossible.';
    } finally {
      void loadPendingActions();
    }
  }
  async function reject(id: string) {
    try {
      await api(`/agent-actions/${id}/reject`, { method: 'POST' });
    } catch (e) {
      chatError = e instanceof ApiError ? e.message : 'Rejet impossible.';
    } finally {
      void loadPendingActions();
    }
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  }

  $effect(() => {
    void loadAgent();
  });
</script>

<div class="flex h-full flex-col rounded-card border border-edge bg-surface">
  <div class="flex items-center justify-between gap-2 border-b border-edge px-4 py-3">
    <div class="min-w-0">
      <div class="flex items-center gap-2">
        <span class="text-sm font-semibold text-ink">{title}</span>
        {#if agent}
          <Badge tone="info">{agent.autonomyLevel ?? 'PROPOSE'}</Badge>
        {/if}
      </div>
      <p class="truncate text-xs text-ink-muted">{intro}</p>
    </div>
  </div>

  {#if loading}
    <div class="p-4 text-sm text-ink-muted">Chargement de l’agent…</div>
  {:else if !agent}
    <div class="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
      <p class="text-sm text-ink-muted">
        {preset
          ? `Activez « ${preset.label} » pour travailler avec un agent dans cet outil.`
          : 'Aucun preset d’agent pour cet outil.'}
      </p>
      {#if preset}
        <Button onclick={activate} loading={activating}>Activer l’agent</Button>
      {/if}
      {#if loadError}<p class="text-xs text-danger">{loadError}</p>{/if}
    </div>
  {:else}
    <!-- Pending actions awaiting approval -->
    {#if pendingActions.length > 0}
      <div class="border-b border-edge bg-warn-soft px-4 py-2">
        <p class="mb-2 text-xs font-semibold text-ink">
          {pendingActions.length} action(s) à approuver
        </p>
        <div class="flex flex-col gap-2">
          {#each pendingActions as a (a.id)}
            <div class="rounded-md border border-edge bg-surface p-2 text-xs">
              <div class="flex items-center justify-between gap-2">
                <span class="font-medium text-ink">{a.tool}</span>
                {#if a.riskTier}<Badge tone="warn">{a.riskTier}</Badge>{/if}
              </div>
              {#if a.summary}<p class="mt-1 text-ink-muted">{a.summary}</p>{/if}
              <div class="mt-2 flex gap-2">
                <Button variant="primary" onclick={() => approve(a.id)}>Approuver</Button>
                <Button variant="ghost" onclick={() => reject(a.id)}>Rejeter</Button>
              </div>
            </div>
          {/each}
        </div>
      </div>
    {/if}

    <!-- Messages -->
    <div bind:this={scroller} class="flex-1 space-y-3 overflow-y-auto p-4">
      {#if messages.length === 0}
        <p class="text-sm text-ink-muted">{intro}</p>
      {/if}
      {#each messages as m, i (i)}
        <div class="flex {m.role === 'user' ? 'justify-end' : 'justify-start'}">
          <div
            class="max-w-[85%] whitespace-pre-wrap rounded-card px-3 py-2 text-sm {m.role === 'user'
              ? 'bg-accent text-white'
              : 'bg-surface-muted text-ink'}"
          >
            {#if m.text}{m.text}{:else if m.streaming}<span class="text-ink-muted">…</span>{/if}
            {#if m.toolCalls.length > 0}
              <div class="mt-2 space-y-1">
                {#each m.toolCalls as tc (tc.name)}
                  <div class="rounded bg-surface px-2 py-1 text-xs text-ink-muted">
                    🔧 {tc.name}
                  </div>
                {/each}
              </div>
            {/if}
          </div>
        </div>
      {/each}
    </div>

    {#if chatError}
      <p class="px-4 pb-1 text-xs text-danger">{chatError}</p>
    {/if}

    <div class="border-t border-edge p-3">
      <div class="flex items-end gap-2">
        <textarea
          bind:value={input}
          onkeydown={onKey}
          rows="2"
          placeholder="Écrire à l’agent…"
          class="flex-1 resize-none rounded-md border border-edge bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
        ></textarea>
        <Button onclick={send} loading={busy} disabled={!input.trim()}>Envoyer</Button>
      </div>
    </div>
  {/if}
</div>
