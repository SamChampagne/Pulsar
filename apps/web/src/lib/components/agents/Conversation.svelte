<script lang="ts">
  import { untrack } from 'svelte';
  import { Send, Wrench, ExternalLink } from 'lucide-svelte';
  import { api, ApiError } from '$lib/api/client';
  import { streamAgentTurn } from '$lib/api/agent-stream';
  import { Button, Badge } from '$lib/components/ui';
  import { agentTurnMessage, type AgentTurnResult } from '@pulsar/shared';
  import ChatImage from './ChatImage.svelte';
  type Image = { id: string; fileName: string };

  interface ToolCall {
    name: string;
    args: unknown;
  }

  interface ChatMessage {
    role: 'user' | 'assistant';
    text: string;
    toolCalls: ToolCall[];
    streaming?: boolean;
    result?: AgentTurnResult;
    images?: Image[];
  }

  interface ExistingMessage {
    role: string;
    content: string;
    toolCalls?: { name: string; args?: unknown }[];
    createdAt?: string;
    images?: Image[];
  }

  let {
    agentId,
    initialConversationId = null,
    initialMessages = [],
    initialPrompt = '',
  }: {
    agentId: string;
    initialConversationId?: string | null;
    initialMessages?: ExistingMessage[];
    initialPrompt?: string;
  } = $props();

  // Intentional one-time reads: the parent uses {#key} to remount when these change.
  let conversationId = $state<string | null>(untrack(() => initialConversationId));
  let messages = $state<ChatMessage[]>(
    untrack(() =>
      initialMessages.map((m) => ({
        role: m.role === 'user' ? 'user' : 'assistant',
        text: m.content,
        images: m.images,
        toolCalls: (m.toolCalls ?? []).map((tc) => ({ name: tc.name, args: tc.args ?? null })),
      })),
    ),
  );
  let input = $state(untrack(() => initialPrompt));
  let sending = $state(false);
  let error = $state('');
  let listEl = $state<HTMLDivElement | null>(null);

  function scrollToBottom() {
    queueMicrotask(() => {
      if (listEl) listEl.scrollTop = listEl.scrollHeight;
    });
  }

  async function send(e?: Event) {
    e?.preventDefault();
    const text = input.trim();
    if (!text || sending) return;

    error = '';
    input = '';
    sending = true;

    // Start a new conversation for this agent if none is active.
    if (!conversationId) {
      try {
        const convo = await api<{ id: string }>('/agent-conversations', {
          method: 'POST',
          body: { agentId },
        });
        conversationId = convo.id;
      } catch (err) {
        error = err instanceof ApiError ? err.message : 'Impossible de démarrer la conversation';
        sending = false;
        return;
      }
    }

    messages = [...messages, { role: 'user', text, toolCalls: [] }];
    const assistant: ChatMessage = { role: 'assistant', text: '', toolCalls: [], streaming: true };
    messages = [...messages, assistant];
    const idx = messages.length - 1;
    scrollToBottom();

    try {
      for await (const ev of streamAgentTurn(conversationId, text)) {
        if (ev.type === 'text') {
          messages[idx] = { ...messages[idx], text: messages[idx].text + ev.text };
        } else if (ev.type === 'tool_call') {
          messages[idx] = {
            ...messages[idx],
            toolCalls: [...messages[idx].toolCalls, { name: ev.name, args: ev.args }],
          };
        } else if (ev.type === 'error') {
          error = ev.message || 'assistant indisponible';
        } else if (ev.type === 'result') {
          messages[idx] = { ...messages[idx], result: ev.result };
          if (ev.result.status !== 'succeeded') error = agentTurnMessage(ev.result);
        } else if (ev.type === 'end') {
          break;
        }
        scrollToBottom();
      }
    } catch (err) {
      error = err instanceof Error ? err.message : 'assistant indisponible';
    } finally {
      messages[idx] = { ...messages[idx], streaming: false };
      sending = false;
      scrollToBottom();
    }
  }

  function onSubmitKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  }

  function formatArgs(args: unknown): string {
    if (args === undefined || args === null) return '';
    try {
      return JSON.stringify(args, null, 2);
    } catch {
      return String(args);
    }
  }
</script>

<!-- Message list -->
<div bind:this={listEl} class="flex-1 space-y-3 overflow-y-auto p-4" style="min-height: 0;">
  {#if messages.length === 0}
    <p class="text-center text-xs text-ink-faint">Envoyez un message pour commencer.</p>
  {/if}
  {#each messages as msg, i (i)}
    {#if msg.role === 'user'}
      <div class="flex justify-end">
        <div
          class="max-w-[85%] rounded-card bg-accent px-3 py-2 text-sm text-white whitespace-pre-wrap"
        >
          {msg.text}
          {#if msg.images?.length}<div class="mt-2 flex flex-wrap gap-2">
              {#each msg.images as image}<ChatImage {image} {conversationId} />{/each}
            </div>{/if}
        </div>
      </div>
    {:else}
      <div class="flex flex-col gap-2">
        {#if msg.result && msg.result.status !== 'succeeded'}
          <div>
            <Badge tone={msg.result.status === 'cancelled' ? 'warn' : 'danger'}
              >{msg.result.status === 'cancelled'
                ? 'Réponse interrompue'
                : 'Réponse non validée'}</Badge
            >
          </div>
        {/if}
        {#if msg.text || msg.streaming}
          <div
            class="max-w-[85%] rounded-card bg-surface-muted px-3 py-2 text-sm text-ink whitespace-pre-wrap"
          >
            {msg.text}{#if msg.streaming}<span class="ml-0.5 inline-block animate-pulse">▍</span
              >{/if}
          </div>
        {/if}
        {#each msg.toolCalls as call, ci (ci)}
          <div class="max-w-[85%] rounded-card border border-edge bg-surface p-3">
            <div class="mb-1.5 flex items-center gap-2">
              <Wrench class="size-3.5 text-ink-muted" />
              <span class="text-xs font-semibold text-ink">Outil utilisé</span>
              <Badge tone="info">{call.name}</Badge>
            </div>
            {#if formatArgs(call.args)}
              <pre
                class="overflow-x-auto rounded bg-surface-muted px-2 py-1.5 text-[11px] text-ink-muted">{formatArgs(
                  call.args,
                )}</pre>
            {/if}
            <!-- The chat stream can't tell whether a tool was auto-executed, queued
                 for approval, or internal — so we don't claim "à approuver" here.
                 Real pending approvals live on the Agent actions page (nav badge). -->
            <a
              href="/agent-actions"
              class="mt-2 inline-flex items-center gap-1 text-xs text-ink-faint hover:text-ink hover:underline"
            >
              Journal des actions <ExternalLink class="size-3" />
            </a>
          </div>
        {/each}
        {#if msg.result?.usage && msg.result.usage.totalTokens !== null}
          <p class="text-[11px] text-ink-faint">
            Compteur du processus IA : {msg.result.usage.totalTokens.toLocaleString('fr-CA')} tokens cumulés.
            Ce n’est pas le coût de ce message.
          </p>
        {/if}
      </div>
    {/if}
  {/each}
</div>

{#if error}
  <p class="border-t border-danger-soft bg-danger-soft px-4 py-2 text-xs text-danger">{error}</p>
{/if}

<!-- Input -->
<form class="flex items-end gap-2 border-t border-edge p-3" onsubmit={send}>
  <textarea
    rows={1}
    bind:value={input}
    onkeydown={onSubmitKeydown}
    placeholder="Envoyer un message…"
    disabled={sending}
    class="max-h-32 min-h-[2.25rem] w-full resize-none rounded-md border border-edge bg-surface px-3 py-1.5 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none disabled:bg-surface-muted"
  ></textarea>
  <Button type="submit" loading={sending} disabled={!input.trim() || sending}>
    <Send class="size-4" />
  </Button>
</form>
