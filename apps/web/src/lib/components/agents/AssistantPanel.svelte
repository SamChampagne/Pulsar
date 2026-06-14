<script lang="ts">
  import { X, Send, ExternalLink, Wrench } from 'lucide-svelte';
  import { pushOverlay, popOverlay, isTopOverlay } from '$lib/stores/overlay-stack';
  import { api, ApiError } from '$lib/api/client';
  import { streamAgentTurn } from '$lib/api/agent-stream';
  import { Button, Badge } from '$lib/components/ui';

  let { open = $bindable(false) } = $props();

  interface Agent {
    id: string;
    name: string;
    role?: string;
    avatar?: string;
    status: string;
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

  let agents = $state<Agent[]>([]);
  let loadingAgents = $state(false);
  let selectedAgent = $state<Agent | null>(null);
  let conversationId = $state<string | null>(null);
  let messages = $state<ChatMessage[]>([]);
  let input = $state('');
  let sending = $state(false);
  let error = $state('');
  let listEl = $state<HTMLDivElement | null>(null);

  // Overlay-stack registration so Escape closes this panel topmost-first.
  let token = $state<symbol | null>(null);
  $effect(() => {
    if (open) {
      const t = pushOverlay();
      token = t;
      return () => {
        popOverlay(t);
        token = null;
      };
    }
  });

  // Load the agent roster the first time the panel opens with no agent picked.
  $effect(() => {
    if (open && !selectedAgent && agents.length === 0 && !loadingAgents) {
      void loadAgents();
    }
  });

  function onkeydown(e: KeyboardEvent) {
    if (e.key === 'Escape' && token && isTopOverlay(token)) open = false;
  }

  async function loadAgents() {
    loadingAgents = true;
    error = '';
    try {
      const all = await api<Agent[]>('/agents');
      agents = all.filter((a) => a.status === 'ACTIVE');
    } catch (e) {
      error = e instanceof ApiError ? e.message : 'Failed to load agents';
    } finally {
      loadingAgents = false;
    }
  }

  async function pickAgent(agent: Agent) {
    error = '';
    try {
      const convo = await api<{ id: string }>('/agent-conversations', {
        method: 'POST',
        body: { agentId: agent.id },
      });
      selectedAgent = agent;
      conversationId = convo.id;
      messages = [];
    } catch (e) {
      error = e instanceof ApiError ? e.message : 'Failed to start conversation';
    }
  }

  function scrollToBottom() {
    queueMicrotask(() => {
      if (listEl) listEl.scrollTop = listEl.scrollHeight;
    });
  }

  async function send(e?: Event) {
    e?.preventDefault();
    const text = input.trim();
    if (!text || !conversationId || sending) return;

    error = '';
    input = '';
    sending = true;
    messages = [...messages, { role: 'user', text, toolCalls: [] }];
    const assistant: ChatMessage = { role: 'assistant', text: '', toolCalls: [], streaming: true };
    messages = [...messages, assistant];
    const idx = messages.length - 1;
    scrollToBottom();

    try {
      for await (const ev of streamAgentTurn(conversationId, text)) {
        if (ev.type === 'text') {
          messages[idx].text += ev.text;
        } else if (ev.type === 'tool_call') {
          messages[idx].toolCalls = [...messages[idx].toolCalls, { name: ev.name, args: ev.args }];
        } else if (ev.type === 'error') {
          error = ev.message;
        } else if (ev.type === 'end') {
          break;
        }
        scrollToBottom();
      }
    } catch (err) {
      error = err instanceof Error ? err.message : 'Stream interrupted';
    } finally {
      messages[idx].streaming = false;
      sending = false;
      scrollToBottom();
    }
  }

  function resetAgent() {
    selectedAgent = null;
    conversationId = null;
    messages = [];
    error = '';
  }

  function formatArgs(args: unknown): string {
    if (args === undefined || args === null) return '';
    try {
      return JSON.stringify(args, null, 2);
    } catch {
      return String(args);
    }
  }

  function onSubmitKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  }
</script>

<svelte:window {onkeydown} />

{#if open}
  <aside
    class="fixed top-0 right-0 z-40 flex h-full w-[420px] flex-col border-l border-edge bg-surface shadow-pop"
    aria-label="AI assistant"
  >
    <div class="flex items-center justify-between border-b border-edge px-4 py-3">
      <div class="flex min-w-0 items-center gap-2">
        {#if selectedAgent}
          {#if selectedAgent.avatar}<span class="text-lg">{selectedAgent.avatar}</span>{/if}
          <div class="min-w-0">
            <h2 class="truncate text-sm font-bold text-ink">{selectedAgent.name}</h2>
            {#if selectedAgent.role}
              <p class="truncate text-xs text-ink-muted">{selectedAgent.role}</p>
            {/if}
          </div>
        {:else}
          <h2 class="text-sm font-bold text-ink">AI assistant</h2>
        {/if}
      </div>
      <div class="flex items-center gap-2">
        {#if selectedAgent}
          <button class="text-xs text-accent hover:underline" onclick={resetAgent}>Switch</button>
        {/if}
        <button class="text-ink-faint hover:text-ink" onclick={() => (open = false)} aria-label="Close">
          <X class="size-4" />
        </button>
      </div>
    </div>

    {#if error}
      <p class="border-b border-danger-soft bg-danger-soft px-4 py-2 text-xs text-danger">{error}</p>
    {/if}

    {#if !selectedAgent}
      <!-- Agent picker -->
      <div class="flex-1 overflow-y-auto p-4">
        <p class="mb-3 text-xs text-ink-muted">Pick an employee-agent to chat with.</p>
        {#if loadingAgents}
          <p class="text-sm text-ink-faint">Loading agents…</p>
        {:else if agents.length === 0}
          <p class="text-sm text-ink-faint">No active agents. Register one in Settings → Agents.</p>
        {:else}
          <ul class="space-y-1.5">
            {#each agents as agent (agent.id)}
              <li>
                <button
                  class="flex w-full items-center gap-3 rounded-card border border-edge bg-surface px-3 py-2 text-left hover:bg-surface-muted"
                  onclick={() => pickAgent(agent)}
                >
                  <span class="text-xl">{agent.avatar ?? '🤖'}</span>
                  <span class="min-w-0">
                    <span class="block truncate text-sm font-semibold text-ink">{agent.name}</span>
                    {#if agent.role}<span class="block truncate text-xs text-ink-muted">{agent.role}</span>{/if}
                  </span>
                </button>
              </li>
            {/each}
          </ul>
        {/if}
      </div>
    {:else}
      <!-- Conversation -->
      <div bind:this={listEl} class="flex-1 space-y-3 overflow-y-auto p-4">
        {#if messages.length === 0}
          <p class="text-center text-xs text-ink-faint">Say hello to {selectedAgent.name}.</p>
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
                <!-- Proposed-action card: lands in the Agent actions inbox server-side. -->
                <div class="max-w-[85%] rounded-card border border-edge bg-surface p-3">
                  <div class="mb-1.5 flex items-center gap-2">
                    <Wrench class="size-3.5 text-ink-muted" />
                    <span class="text-xs font-semibold text-ink">Proposed action</span>
                    <Badge tone="info">{call.name}</Badge>
                  </div>
                  {#if formatArgs(call.args)}
                    <pre class="overflow-x-auto rounded bg-surface-muted px-2 py-1.5 text-[11px] text-ink-muted">{formatArgs(call.args)}</pre>
                  {/if}
                  <a
                    href="/agent-actions"
                    class="mt-2 inline-flex items-center gap-1 text-xs text-accent hover:underline"
                    onclick={() => (open = false)}
                  >
                    Review in Agent actions <ExternalLink class="size-3" />
                  </a>
                </div>
              {/each}
            </div>
          {/if}
        {/each}
      </div>

      <form class="flex items-end gap-2 border-t border-edge p-3" onsubmit={send}>
        <textarea
          rows={1}
          bind:value={input}
          onkeydown={onSubmitKeydown}
          placeholder="Message {selectedAgent.name}…"
          disabled={sending}
          class="max-h-32 min-h-[2.25rem] w-full resize-none rounded-md border border-edge bg-surface px-3 py-1.5 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none disabled:bg-surface-muted"
        ></textarea>
        <Button type="submit" loading={sending} disabled={!input.trim()}>
          <Send class="size-4" />
        </Button>
      </form>
    {/if}
  </aside>
{/if}
