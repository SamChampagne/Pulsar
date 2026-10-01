<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import {
    ArrowUp,
    Bot,
    Check,
    CircleAlert,
    LoaderCircle,
    MessageSquare,
    PanelLeft,
    Plus,
    Wrench,
    Paperclip,
    Monitor,
    X,
    Square,
    Copy,
  } from 'lucide-svelte';
  import { api, ApiError } from '$lib/api/client';
  import { streamAgentTurn } from '$lib/api/agent-stream';
  import { auth } from '$lib/stores/auth';
  import { Modal } from '$lib/components/ui';
  import { agentTurnMessage, type AgentTurnResult } from '@pulsar/shared';
  import ChatImage from './ChatImage.svelte';
  import { prepareChatImage, captureChatScreen, MAX_CHAT_IMAGES } from './chat-images';

  interface ImagePreview {
    id?: string;
    fileName: string;
    preview?: string;
  }
  interface DraftImage extends ImagePreview {
    key: string;
    file: File;
    preview: string;
  }

  let { open = $bindable(false), activeCount = $bindable(0) } = $props();
  interface Worker {
    id: string;
    name: string;
    role: string | null;
    model: string | null;
    status: string;
  }
  interface Message {
    role: 'user' | 'assistant';
    text: string;
    tools: string[];
    result?: AgentTurnResult;
    images?: ImagePreview[];
  }
  interface Thread {
    key: string;
    id: string | null;
    agentId: string;
    title: string;
    messages: Message[];
    loaded: boolean;
    loading: boolean;
    sending: boolean;
    error: string;
    draft: string;
    images: DraftImage[];
    preparing: boolean;
  }
  let workers = $state<Worker[]>([]);
  let threads = $state<Thread[]>([]);
  let selectedKey = $state('');
  let workerId = $state('');
  let loading = $state(false);
  let error = $state('');
  let historyOpen = $state(false);
  let listEl = $state<HTMLDivElement>();
  let search = $state('');
  let fileInput: HTMLInputElement;
  let attachmentError = $state('');
  let capturing = $state(false);
  let captureRequest: AbortController | undefined;
  const previews = new Set<string>();
  const requests = new Map<string, AbortController>();
  let generation = 0;
  let identity = '';
  const current = $derived(threads.find((t) => t.key === selectedKey));
  const worker = $derived(workers.find((w) => w.id === (current?.agentId || workerId)));
  const visibleThreads = $derived(
    threads
      .filter((t) => t.id || t.sending || t.draft || t.images.length || t.preparing)
      .filter((t) =>
        `${t.title} ${workers.find((w) => w.id === t.agentId)?.name ?? ''}`
          .toLowerCase()
          .includes(search.toLowerCase()),
      ),
  );
  const canManage = $derived($auth?.user.permissions.includes('core.agents.manage'));
  const canRead = $derived($auth?.user.permissions.includes('core.agents.read'));
  $effect(() => {
    activeCount = threads.filter((t) => t.sending).length;
  });

  function clear() {
    generation++;
    for (const request of requests.values()) request.abort();
    captureRequest?.abort();
    for (const url of previews) URL.revokeObjectURL(url);
    previews.clear();
    attachmentError = '';
    requests.clear();
    workers = [];
    threads = [];
    selectedKey = '';
    workerId = '';
    error = '';
    loading = false;
  }
  $effect(() => {
    const next = `${$auth?.tenant.id ?? ''}:${$auth?.user.id ?? ''}`;
    if (identity !== next) {
      identity = next;
      untrack(clear);
    }
  });
  $effect(() => {
    if (open)
      untrack(() => {
        void load();
      });
  });
  onDestroy(clear);
  $effect(() => {
    if (!open) captureRequest?.abort();
  });

  function draftThread() {
    if (!current) newConversation();
    return threads.find((t) => t.key === selectedKey);
  }
  async function attach(files: File[], thread = draftThread(), prepared = false) {
    if (!thread || thread.sending || thread.preparing || worker?.status !== 'ACTIVE') return;
    attachmentError = '';
    if (files.length + thread.images.length > MAX_CHAT_IMAGES) {
      attachmentError = 'Maximum 4 images par message.';
      return;
    }
    const version = generation;
    thread.preparing = true;
    try {
      for (const source of files) {
        const file = prepared ? source : await prepareChatImage(source);
        if (version !== generation) return;
        const preview = URL.createObjectURL(file);
        previews.add(preview);
        thread.images.push({ key: crypto.randomUUID(), file, preview, fileName: file.name });
      }
    } catch (e) {
      if (version === generation) attachmentError = failure(e);
    } finally {
      thread.preparing = false;
    }
  }
  function removeImage(key: string) {
    const image = current?.images.find((i) => i.key === key);
    if (!image || current?.sending) return;
    URL.revokeObjectURL(image.preview);
    previews.delete(image.preview);
    current!.images = current!.images.filter((i) => i.key !== key);
  }
  async function capture() {
    if (capturing) return;
    const thread = draftThread();
    if (!thread || thread.sending || thread.preparing) return;
    if (thread.images.length >= MAX_CHAT_IMAGES) {
      attachmentError = 'Maximum 4 images par message.';
      return;
    }
    capturing = true;
    attachmentError = '';
    const controller = new AbortController();
    captureRequest = controller;
    const version = generation;
    try {
      const file = await captureChatScreen(controller.signal);
      if (!controller.signal.aborted && version === generation) await attach([file], thread, true);
    } catch (e) {
      if (!controller.signal.aborted && version === generation)
        attachmentError =
          e instanceof DOMException && e.name === 'NotAllowedError'
            ? 'Capture annulée ou non autorisée. Aucune image envoyée.'
            : failure(e);
    } finally {
      capturing = false;
      if (captureRequest === controller) captureRequest = undefined;
    }
  }
  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      attachmentError = 'Copie indisponible. Sélectionnez le texte manuellement.';
    }
  }

  function failure(e: unknown) {
    return e instanceof ApiError || e instanceof Error ? e.message : 'Connexion indisponible.';
  }
  async function load() {
    if (loading) return;
    const version = generation;
    loading = true;
    error = '';
    try {
      const [roster, history] = await Promise.all([
        api<Worker[]>('/agent-conversations/workers'),
        api<{ id: string; agentId: string; title: string | null }[]>('/agent-conversations'),
      ]);
      if (version !== generation) return;
      workers = roster;
      if (!workerId) workerId = roster.find((w) => w.status === 'ACTIVE')?.id ?? '';
      const known = new Set(threads.map((t) => t.id));
      threads = [
        ...threads,
        ...history
          .filter((h) => !known.has(h.id))
          .map((h) => ({
            key: h.id,
            id: h.id,
            agentId: h.agentId,
            title: h.title || 'Conversation',
            messages: [],
            loaded: false,
            loading: false,
            sending: false,
            error: '',
            draft: '',
            images: [],
            preparing: false,
          })),
      ];
    } catch (e) {
      if (version === generation) error = failure(e);
    } finally {
      if (version === generation) loading = false;
    }
  }
  function newConversation(id = workerId) {
    if (!id) return;
    const key = crypto.randomUUID();
    captureRequest?.abort();
    attachmentError = '';
    threads = threads.filter((t) => t.id || t.sending || t.draft || t.images.length || t.preparing);
    threads = [
      {
        key,
        id: null,
        agentId: id,
        title: 'Nouvelle conversation',
        messages: [],
        loaded: true,
        loading: false,
        sending: false,
        error: '',
        draft: '',
        images: [],
        preparing: false,
      },
      ...threads,
    ];
    selectedKey = key;
    workerId = id;
    historyOpen = false;
  }
  async function selectThread(key: string) {
    captureRequest?.abort();
    attachmentError = '';
    selectedKey = key;
    historyOpen = false;
    const thread = threads.find((t) => t.key === key);
    if (!thread) return;
    workerId = thread.agentId;
    if (thread.loaded || thread.loading || !thread.id) return;
    const version = generation;
    thread.loading = true;
    thread.error = '';
    try {
      const data = await api<{
        messages: { role: string; content: string; images?: ImagePreview[] }[];
      }>(`/agent-conversations/${thread.id}`);
      if (version !== generation) return;
      thread.messages = data.messages
        .filter((m) => m.role === 'user' || m.role === 'assistant')
        .map((m) => ({
          role: m.role as Message['role'],
          text: m.content,
          tools: [],
          images: m.images,
        }));
      thread.loaded = true;
    } catch (e) {
      if (version === generation) thread.error = failure(e);
    } finally {
      if (version === generation) thread.loading = false;
    }
  }
  function scroll(key: string) {
    queueMicrotask(() => {
      if (selectedKey === key && listEl) listEl.scrollTop = listEl.scrollHeight;
    });
  }
  async function send(event?: Event) {
    event?.preventDefault();
    const thread = current;
    const text =
      thread?.draft.trim() || (thread?.images.length ? 'Analyse les images jointes.' : '');
    if (
      !thread ||
      !text ||
      thread.sending ||
      thread.preparing ||
      capturing ||
      !thread.loaded ||
      worker?.status !== 'ACTIVE'
    )
      return;
    const images = [...thread.images];
    const version = generation;
    thread.sending = true;
    thread.error = '';
    const controller = new AbortController();
    requests.set(thread.key, controller);
    try {
      if (!thread.id) {
        const created = await api<{ id: string }>('/agent-conversations', {
          method: 'POST',
          body: { agentId: thread.agentId },
        });
        if (version !== generation) return;
        thread.id = created.id;
      }
      if (controller.signal.aborted) {
        thread.error = 'Envoi arrêté avant le message.';
        return;
      }
      thread.draft = '';
      thread.images = [];
      thread.title = thread.messages.length ? thread.title : text.slice(0, 100);
      thread.messages.push(
        { role: 'user', text, tools: [], images },
        { role: 'assistant', text: '', tools: [] },
      );
      const reply = thread.messages[thread.messages.length - 1];
      scroll(thread.key);
      for await (const event of streamAgentTurn(
        thread.id,
        text,
        controller.signal,
        images.map((i) => i.file),
      )) {
        if (version !== generation) break;
        if (event.type === 'text') reply.text += event.text;
        if (event.type === 'tool_call') reply.tools.push(event.name);
        if (event.type === 'error') thread.error = event.message;
        if (event.type === 'result') {
          reply.result = event.result;
          if (event.result.status !== 'succeeded') thread.error = agentTurnMessage(event.result);
        }
        scroll(thread.key);
      }
    } catch (e) {
      if (version === generation) thread.error = failure(e);
    } finally {
      requests.delete(thread.key);
      if (version === generation) {
        thread.sending = false;
        if (controller.signal.aborted)
          thread.error =
            'Réponse arrêtée. Les actions déjà effectuées ne sont pas annulées; vérifiez le journal.';
        scroll(thread.key);
      }
    }
  }
  function choosePrompt(text: string) {
    if (!current) newConversation();
    const thread = threads.find((t) => t.key === selectedKey);
    if (thread) thread.draft = text;
  }
</script>

<Modal bind:open title="Espace IA" size="workspace">
  <div class="relative flex min-h-0 w-full overflow-hidden text-ink">
    <aside
      class="{historyOpen
        ? 'absolute inset-0 z-10 flex'
        : 'hidden'} min-h-0 w-full shrink-0 flex-col border-r border-edge bg-surface-muted md:relative md:flex md:w-64"
      aria-label="Historique IA"
    >
      <div class="flex items-center justify-between p-3">
        <button
          class="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors hover:bg-surface focus-visible:outline-2 focus-visible:outline-accent"
          disabled={!workerId}
          onclick={() => newConversation()}><Plus class="size-4" /> Nouvelle conversation</button
        >
        <button
          class="shell-icon md:hidden"
          aria-label="Fermer l’historique"
          onclick={() => (historyOpen = false)}><PanelLeft class="size-4" /></button
        >
      </div>
      <div class="px-4 pb-3">
        <input
          class="w-full rounded-md border border-edge bg-surface px-3 py-2 text-sm focus:outline-accent"
          aria-label="Rechercher une conversation"
          placeholder="Rechercher…"
          bind:value={search}
        />
      </div>
      <nav class="min-h-0 flex-1 space-y-1 overflow-y-auto px-3 pb-4" aria-label="Conversations IA">
        {#each visibleThreads as thread (thread.key)}
          <button
            class="flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm transition-colors hover:bg-surface focus-visible:outline-2 focus-visible:outline-accent {selectedKey ===
            thread.key
              ? 'bg-surface shadow-sm'
              : ''}"
            aria-current={selectedKey === thread.key ? 'page' : undefined}
            onclick={() => selectThread(thread.key)}
          >
            {#if thread.sending}<LoaderCircle
                class="size-4 shrink-0 animate-spin motion-reduce:animate-none text-accent"
              />{:else if thread.error}<CircleAlert
                class="size-4 shrink-0 text-danger"
              />{:else}<MessageSquare class="size-4 shrink-0 text-ink-faint" />{/if}
            <span class="min-w-0"
              ><span class="block truncate">{thread.title}</span><span
                class="block truncate text-xs text-ink-muted"
                >{workers.find((w) => w.id === thread.agentId)?.name ?? 'Worker'}{thread.sending
                  ? ' · En cours'
                  : ''}</span
              ></span
            >
          </button>
        {:else}<p class="p-3 text-xs leading-relaxed text-ink-muted">
            {search
              ? 'Aucune conversation trouvée.'
              : 'Vos conversations apparaîtront ici. Vous pouvez travailler avec plusieurs workers en parallèle.'}
          </p>{/each}
      </nav>
      <div class="space-y-2 border-t border-edge p-4 text-xs text-ink-muted">
        <p aria-live="polite">
          {activeCount
            ? `${activeCount} conversation${activeCount > 1 ? 's' : ''} en cours`
            : 'Aucune conversation en cours'}
        </p>
        {#if canRead}<a
            class="block hover:text-ink hover:underline"
            href="/agents"
            onclick={() => (open = false)}>Gérer les workers et leur activité →</a
          >{/if}
        {#if canManage}<a
            class="block hover:text-ink hover:underline"
            href="/settings/agent-runtime"
            onclick={() => (open = false)}>Configurer la connexion IA →</a
          >{/if}
      </div>
    </aside>
    <section
      class="flex min-w-0 flex-1 flex-col bg-surface"
      aria-label="Conversation avec le worker"
    >
      <header class="flex shrink-0 items-start gap-3 border-b border-edge-soft px-4 py-3 sm:px-6">
        <button
          class="shell-icon md:hidden"
          aria-label="Ouvrir l’historique"
          onclick={() => (historyOpen = true)}><PanelLeft class="size-4" /></button
        >
        <Bot class="mt-2 hidden size-5 shrink-0 text-ink-muted sm:block" />
        <div class="min-w-0 flex-1">
          <label for="global-worker" class="sr-only">Worker</label>
          <select
            id="global-worker"
            class="max-w-full rounded-md border border-edge bg-surface px-2 py-1.5 text-sm font-semibold focus:outline-accent"
            value={current?.agentId || workerId}
            onchange={(e) => newConversation(e.currentTarget.value)}
            disabled={loading || !workers.length}
          >
            {#if !workers.length}<option value=""
                >{loading ? 'Chargement des workers…' : 'Aucun worker disponible'}</option
              >{/if}
            {#each workers as w}<option value={w.id} disabled={w.status !== 'ACTIVE'}
                >{w.name}{w.status !== 'ACTIVE' ? ' · Indisponible' : ''}</option
              >{/each}
          </select>
          <p class="mt-1 text-xs break-words text-ink-muted">
            Modèle configuré : {worker?.model || 'Non configuré'}{worker?.role
              ? ` · ${worker.role}`
              : ''}
          </p>
        </div>
        <button
          class="shell-icon shrink-0"
          aria-label="Nouvelle conversation"
          disabled={!workerId}
          onclick={() => newConversation()}><Plus class="size-4" /></button
        >
      </header>
      {#if error}<div role="alert" class="bg-danger-soft px-5 py-3 text-sm text-danger">
          {error} <button class="ml-2 underline" onclick={load}>Réessayer le chargement</button>
        </div>{/if}
      <div
        bind:this={listEl}
        class="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-6 sm:px-10"
      >
        {#if loading || current?.loading}<div
            role="status"
            class="mx-auto max-w-3xl space-y-4 py-10"
          >
            <p class="text-sm text-ink-muted">Chargement de votre espace…</p>
            <div
              class="h-14 animate-pulse rounded-xl bg-surface-muted motion-reduce:animate-none"
            ></div>
            <div
              class="h-24 animate-pulse rounded-xl bg-surface-muted motion-reduce:animate-none"
            ></div>
          </div>
        {:else if !current?.messages.length}
          <div class="mx-auto flex min-h-full max-w-2xl flex-col justify-center py-6">
            <p class="mb-3 text-sm font-medium text-ink-muted">
              {worker?.name ?? 'Votre équipe IA'}{worker?.role ? ` / ${worker.role}` : ''}
            </p>
            <h3 class="text-2xl font-semibold tracking-tight sm:text-3xl">
              Sur quoi souhaitez-vous travailler ?
            </h3>
            <p class="mt-4 max-w-xl text-sm leading-relaxed text-ink-muted">
              Choisissez un worker et confiez-lui un objectif. Ses outils, ses droits et les
              validations de votre entreprise restent en place.
            </p>
            {#if workers.some((w) => w.status === 'ACTIVE')}
              <div class="mt-7 flex flex-wrap gap-2">
                {#each ['Présente-moi tes outils et ce que tu peux faire.', 'Aide-moi à identifier les dossiers à traiter en priorité.'] as prompt}
                  <button
                    class="rounded-xl border border-edge px-4 py-3 text-left text-sm transition-colors hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-accent"
                    onclick={() => choosePrompt(prompt)}>{prompt}</button
                  >
                {/each}
              </div>
            {:else}<p class="mt-6 text-sm text-ink-muted">
                {canManage
                  ? 'Créez ou réactivez un worker dans l’espace Agents pour commencer.'
                  : 'Demandez à votre administrateur d’activer un worker.'}
              </p>{/if}
          </div>
        {:else}
          <div class="mx-auto max-w-3xl space-y-7" aria-label="Messages">
            {#each current.messages as message, index (index)}
              <article
                class={message.role === 'user'
                  ? 'ml-auto max-w-[90%] rounded-2xl bg-surface-muted px-5 py-3'
                  : 'pr-3'}
              >
                <p class="mb-2 text-xs font-semibold text-ink-muted">
                  {message.role === 'user' ? 'Vous' : (worker?.name ?? 'Worker')}
                </p>
                <div class="text-sm leading-7 break-words whitespace-pre-wrap">{message.text}</div>
                {#if message.images?.length}<div class="mt-3 flex flex-wrap gap-2">
                    {#each message.images as image}<ChatImage
                        {image}
                        conversationId={current.id}
                      />{/each}
                  </div>{/if}
                {#if message.role === 'assistant' && message.text && !(current.sending && index === current.messages.length - 1)}
                  <button
                    type="button"
                    class="mt-2 inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-ink-muted hover:bg-surface-muted"
                    aria-label="Copier la réponse"
                    onclick={() => copy(message.text)}><Copy class="size-3" /> Copier</button
                  >
                {/if}
                {#each message.tools as tool}<p
                    class="mt-2 flex items-center gap-2 text-xs text-ink-muted"
                  >
                    <Wrench class="size-3.5" /> Outil : {tool}
                  </p>{/each}
                {#if message.tools.length && canRead}<a
                    class="mt-2 inline-block text-xs text-accent hover:underline"
                    href="/agent-actions"
                    onclick={() => (open = false)}>Consulter le journal des actions →</a
                  >{/if}
                {#if message.result && message.result.status !== 'succeeded'}<p
                    class="mt-3 flex items-center gap-2 text-xs text-danger"
                  >
                    <CircleAlert class="size-4" /> Réponse non validée
                  </p>
                {:else if message.result?.status === 'succeeded'}<p
                    class="mt-3 flex items-center gap-1 text-xs text-ink-faint"
                  >
                    <Check class="size-3" /> Réponse terminée
                  </p>{/if}
                {#if current.sending && index === current.messages.length - 1}<p
                    role="status"
                    class="mt-3 flex items-center gap-2 text-xs text-ink-muted"
                  >
                    <LoaderCircle class="size-4 animate-spin motion-reduce:animate-none" />
                    {worker?.name} travaille…
                  </p>{/if}
              </article>
            {/each}
          </div>
        {/if}
      </div>
      <div class="shrink-0 px-4 pb-4 sm:px-8 sm:pb-5">
        <div class="mx-auto max-w-3xl">
          {#if current?.error}<p
              role="alert"
              class="mb-3 rounded-lg bg-danger-soft px-4 py-3 text-sm text-danger"
            >
              {current.error} L’historique est conservé; aucun renvoi automatique.
            </p>{/if}
          {#if current && !current.loaded && !current.loading}<button
              class="mb-3 text-sm text-accent underline"
              onclick={() => selectThread(current.key)}>Recharger la conversation</button
            >{/if}
          <form
            class="rounded-2xl border border-edge bg-surface-muted p-3 shadow-sm focus-within:border-accent"
            onsubmit={send}
            ondragover={(e) => {
              if (e.dataTransfer?.types.includes('Files')) e.preventDefault();
            }}
            ondrop={(e) => {
              e.preventDefault();
              void attach(Array.from(e.dataTransfer?.files ?? []));
            }}
            onpaste={(e) => {
              const files = Array.from(e.clipboardData?.files ?? []);
              if (files.length) {
                e.preventDefault();
                void attach(files);
              }
            }}
          >
            <input
              bind:this={fileInput}
              type="file"
              class="sr-only"
              tabindex="-1"
              aria-label="Joindre des images"
              accept="image/png,image/jpeg,image/webp"
              multiple
              onchange={(e) => {
                void attach(Array.from(e.currentTarget.files ?? []));
                e.currentTarget.value = '';
              }}
            />
            {#if current?.images.length}<div
                class="mb-3 flex max-h-52 gap-3 overflow-x-auto overflow-y-auto px-1 pt-2 pb-1 sm:flex-wrap"
                aria-label="Images à envoyer"
              >
                {#each current.images as image (image.key)}<div
                    class="relative shrink-0 rounded-lg border border-edge bg-surface p-2"
                  >
                    <ChatImage {image} conversationId={current.id} />
                    <p class="mt-1 max-w-36 truncate text-[11px] text-ink-muted">
                      {image.fileName} · {Math.ceil(image.file.size / 1024)} Ko
                    </p>
                    <button
                      type="button"
                      aria-label={`Retirer ${image.fileName}`}
                      disabled={current.sending}
                      class="absolute -top-2 -right-2 rounded-full border border-edge bg-surface p-1 hover:bg-surface-muted"
                      onclick={() => removeImage(image.key)}><X class="size-3" /></button
                    >
                  </div>{/each}
              </div>{/if}
            {#if current?.preparing || capturing}<p
                role="status"
                class="mb-2 text-xs text-ink-muted"
              >
                {capturing
                  ? 'Choisissez une fenêtre. Une seule capture sera préparée, puis le partage sera arrêté.'
                  : 'Optimisation des images…'}
              </p>{/if}
            {#if attachmentError}<p role="alert" class="mb-2 text-xs text-danger">
                {attachmentError}
              </p>{/if}
            <textarea
              aria-label="Message au worker"
              placeholder={worker
                ? `Confier un objectif à ${worker.name}…`
                : 'Sélectionnez un worker…'}
              rows="3"
              maxlength="32000"
              class="block max-h-48 w-full resize-none bg-transparent px-2 py-1 text-sm text-ink placeholder:text-ink-faint focus:outline-none disabled:opacity-50"
              value={current?.draft ?? ''}
              disabled={loading ||
                current?.sending ||
                current?.loading ||
                (current && !current.loaded) ||
                worker?.status !== 'ACTIVE'}
              onfocus={() => {
                if (!current) newConversation();
              }}
              oninput={(e) => {
                if (current) current.draft = e.currentTarget.value;
              }}
              onkeydown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
                  e.preventDefault();
                  void send();
                }
              }}
            ></textarea>
            <div class="flex items-center justify-between gap-3 pl-2">
              <div class="flex items-center gap-1">
                <button
                  type="button"
                  class="shell-icon"
                  aria-label="Ajouter des images"
                  title="Images : choisir, coller ou déposer (4 maximum)"
                  disabled={loading ||
                    current?.sending ||
                    current?.preparing ||
                    capturing ||
                    worker?.status !== 'ACTIVE' ||
                    (current && !current.loaded)}
                  onclick={() => fileInput.click()}><Paperclip class="size-4" /></button
                >
                <button
                  type="button"
                  class="shell-icon"
                  aria-label="Capturer l’écran"
                  title="Capture ponctuelle avec votre autorisation, sans audio"
                  disabled={loading ||
                    current?.sending ||
                    current?.preparing ||
                    capturing ||
                    worker?.status !== 'ACTIVE' ||
                    (current && !current.loaded)}
                  onclick={capture}><Monitor class="size-4" /></button
                >
                <span class="hidden text-[11px] text-ink-faint sm:inline"
                  >Images · Capture d’écran</span
                >
              </div>
              {#if current?.sending}<button
                  type="button"
                  aria-label="Arrêter la réponse"
                  class="flex size-9 shrink-0 items-center justify-center rounded-full bg-ink text-surface"
                  onclick={() => requests.get(current!.key)?.abort()}
                  ><Square class="size-3.5 fill-current" /></button
                >
              {:else}<button
                  type="submit"
                  aria-label="Envoyer au worker"
                  class="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent text-white transition-opacity hover:opacity-85 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-30"
                  disabled={(!current?.draft.trim() && !current?.images.length) ||
                    current?.preparing ||
                    capturing ||
                    !current?.loaded ||
                    worker?.status !== 'ACTIVE'}><ArrowUp class="size-4" /></button
                >{/if}
            </div>
            {#if current?.images.length}<p
                class="mt-2 px-2 text-[11px] leading-relaxed text-ink-muted"
              >
                Vérifiez les informations visibles avant d’envoyer à votre fournisseur IA. Modèle
                avec vision requis. Images optimisées, pas de partage vidéo continu.
              </p>{/if}
          </form>
          <p class="mt-2 text-center text-[11px] text-ink-faint">
            Fermer cette fenêtre laisse les réponses avancer tant que Pulsar reste ouvert. Vérifiez
            les résultats avant toute décision.
          </p>
        </div>
      </div>
    </section>
  </div>
</Modal>
