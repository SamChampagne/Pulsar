<script lang="ts">
  import { api, ApiError } from '$lib/api/client';
  import { toast } from '$lib/stores/toast';
  import { PERMISSIONS } from '@pulsar/shared';
  import {
    PageHeader,
    Button,
    Badge,
    EmptyState,
    Card,
    Skeleton,
    ErrorNotice,
    Field,
    Input,
    Textarea,
  } from '$lib/components/ui';
  import { untrack } from 'svelte';
  import DOMPurify from 'dompurify';

  // Sanitize inbound email HTML before {@html} render — inbound bodies are
  // attacker-controlled (stored verbatim from external senders) and must be
  // cleaned to prevent stored XSS. DOMPurify is safe here: ssr=false SPA,
  // window always exists at render time.
  function safeHtml(html: string | null): string {
    return DOMPurify.sanitize(html ?? '', { USE_PROFILES: { html: true } });
  }

  // ── Types ───────────────────────────────────────────────────────────────────

  interface Thread {
    id: string;
    subject: string;
    status: string;
    contactId: string | null;
    companyId: string | null;
    dealId: string | null;
    lastMessageAt: string;
    messageCount: number;
    /** Populated on detail fetch */
    contactName?: string;
    companyName?: string;
  }

  interface Msg {
    id: string;
    direction: 'INBOUND' | 'OUTBOUND';
    subject: string;
    html: string;
    fromAddress: string | null;
    createdAt: string;
  }

  interface ThreadDetail extends Thread {
    messages: Msg[];
  }

  interface ContactResult {
    id: string;
    name: string;
    email: string;
    companyName?: string;
  }

  // ── State — tab / list ────────────────────────────────────────────────────

  type TabStatus = 'UNLINKED' | 'LINKED' | 'ALL';

  let activeTab = $state<TabStatus>('UNLINKED');
  let threads = $state<Thread[]>([]);
  let listLoading = $state(true);
  let error = $state('');

  // ── State — selected thread ───────────────────────────────────────────────

  let selected = $state<ThreadDetail | null>(null);
  let threadLoading = $state(false);

  // ── State — reply composer ────────────────────────────────────────────────

  let replyHtml = $state('');
  let replySending = $state(false);

  // ── State — link panel ────────────────────────────────────────────────────

  let linkSearch = $state('');
  let linkResults = $state<ContactResult[]>([]);
  let linkSearching = $state(false);
  let linkSaving = $state(false);

  let createMode = $state(false);
  let createName = $state('');
  let createEmail = $state('');

  let archiving = $state(false);

  // ── Data loading ──────────────────────────────────────────────────────────

  async function loadThreads() {
    listLoading = true;
    error = '';
    try {
      const query: Record<string, string> = {};
      if (activeTab !== 'ALL') query.status = activeTab;
      const result = await api<{ items: Thread[] }>('/crm/threads', { query });
      threads = result.items;
    } catch (e) {
      error = e instanceof ApiError ? e.message : 'Impossible de charger les fils de discussion';
    } finally {
      listLoading = false;
    }
  }

  async function openThread(id: string) {
    threadLoading = true;
    try {
      selected = await api<ThreadDetail>(`/crm/threads/${id}`);
      replyHtml = '';
      linkSearch = '';
      linkResults = [];
      createMode = false;
      createName = '';
      createEmail = '';
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Impossible de charger le fil de discussion');
    } finally {
      threadLoading = false;
    }
  }

  // ── Reply ─────────────────────────────────────────────────────────────────

  async function sendReply() {
    if (!selected || !replyHtml.trim()) {
      toast.error('Le contenu de la réponse ne peut pas être vide');
      return;
    }
    replySending = true;
    try {
      await api(`/crm/threads/${selected.id}/reply`, {
        method: 'POST',
        body: { html: replyHtml.trim() },
      });
      toast.success('Réponse envoyée');
      replyHtml = '';
      await openThread(selected.id);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Échec de l'envoi");
    } finally {
      replySending = false;
    }
  }

  // ── Link panel ────────────────────────────────────────────────────────────

  async function searchContacts() {
    if (!linkSearch.trim()) {
      linkResults = [];
      return;
    }
    linkSearching = true;
    try {
      const result = await api<{ items: ContactResult[] }>('/crm/contacts', {
        query: { search: linkSearch.trim(), pageSize: 10 },
      });
      linkResults = result.items;
    } catch {
      linkResults = [];
    } finally {
      linkSearching = false;
    }
  }

  async function linkToContact(contactId: string) {
    if (!selected) return;
    linkSaving = true;
    try {
      await api(`/crm/threads/${selected.id}/link`, {
        method: 'POST',
        body: { contactId },
      });
      toast.success('Fil rattaché au contact');
      await openThread(selected.id);
      await loadThreads();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Échec du rattachement');
    } finally {
      linkSaving = false;
    }
  }

  async function createAndLink() {
    if (!selected) return;
    if (!createName.trim() || !createEmail.trim()) {
      toast.error('Nom et adresse courriel obligatoires');
      return;
    }
    linkSaving = true;
    try {
      await api(`/crm/threads/${selected.id}/link`, {
        method: 'POST',
        body: { createContact: { name: createName.trim(), email: createEmail.trim() } },
      });
      toast.success('Contact créé et fil rattaché');
      createMode = false;
      createName = '';
      createEmail = '';
      await openThread(selected.id);
      await loadThreads();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Échec de la création');
    } finally {
      linkSaving = false;
    }
  }

  async function archiveThread() {
    if (!selected) return;
    archiving = true;
    try {
      await api(`/crm/threads/${selected.id}/archive`, { method: 'POST' });
      toast.success('Fil archivé');
      selected = null;
      await loadThreads();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Échec de l'archivage");
    } finally {
      archiving = false;
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  function relativeTime(iso: string): string {
    const d = new Date(iso);
    const diffMs = Date.now() - d.getTime();
    const diffMin = Math.floor(diffMs / 60_000);
    if (diffMin < 1) return "À l'instant";
    if (diffMin < 60) return `Il y a ${diffMin}m`;
    const diffH = Math.floor(diffMin / 60);
    if (diffH < 24) return `Il y a ${diffH}h`;
    const diffD = Math.floor(diffH / 24);
    if (diffD < 7) return `Il y a ${diffD}j`;
    return d.toLocaleDateString('fr-CA');
  }

  function threadDisplay(t: Thread): string {
    return t.contactName ?? t.companyName ?? '—';
  }

  function statusTone(status: string): 'neutral' | 'warn' | 'ok' | 'info' {
    switch (status) {
      case 'UNLINKED':
        return 'warn';
      case 'LINKED':
        return 'ok';
      case 'ARCHIVED':
        return 'neutral';
      default:
        return 'neutral';
    }
  }

  function statusLabel(status: string): string {
    switch (status) {
      case 'UNLINKED':
        return 'À trier';
      case 'LINKED':
        return 'Rattaché';
      case 'ARCHIVED':
        return 'Archivé';
      default:
        return status;
    }
  }

  // ── Reactive load ─────────────────────────────────────────────────────────

  $effect(() => {
    const _tab = activeTab;
    untrack(() => {
      void loadThreads();
    });
  });

  // Re-run contact search when linkSearch changes (debounced via native event)
  $effect(() => {
    const _q = linkSearch;
    untrack(() => {
      if (_q.trim().length >= 2) void searchContacts();
      else linkResults = [];
    });
  });
</script>

<PageHeader
  title="Boîte de réception"
  subtitle="Fils de courriel entrant — triez, répondez et rattachez vos échanges."
/>

<ErrorNotice message={error} onretry={loadThreads} />

<!-- Tabs -->
<div class="mb-4 flex gap-1 rounded-xl bg-surface-muted p-1 w-fit">
  {#each [['UNLINKED', 'À trier'], ['LINKED', 'Rattachés'], ['ALL', 'Tous']] as const as [tab, label] (tab)}
    <button
      class={`rounded-lg px-4 py-1.5 text-sm font-semibold transition ${activeTab === tab ? 'bg-surface text-ink shadow-sm' : 'text-ink-muted hover:text-ink'}`}
      onclick={() => {
        activeTab = tab;
        selected = null;
      }}>{label}</button
    >
  {/each}
</div>

<div class="flex gap-4 items-start">
  <!-- ── Thread list ── -->
  <div class={`min-w-0 flex-1 transition-all ${selected ? 'max-w-[42%]' : ''}`}>
    {#if listLoading}
      <Card padded={false}><Skeleton rows={6} /></Card>
    {:else if threads.length === 0}
      <Card>
        <EmptyState message="Aucun fil de discussion pour cette vue." />
      </Card>
    {:else}
      <div class="flex flex-col gap-1">
        {#each threads as thread (thread.id)}
          <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
          <div
            class={`cursor-pointer rounded-xl border px-4 py-3 transition-colors ${selected?.id === thread.id ? 'border-accent/40 bg-accent-soft/20' : 'border-edge-soft bg-surface hover:border-edge hover:bg-surface-muted'}`}
            onclick={() => void openThread(thread.id)}
          >
            <div class="flex items-start justify-between gap-2">
              <div class="min-w-0 flex-1">
                <div class="truncate text-sm font-semibold text-ink">
                  {thread.subject || '(sans objet)'}
                </div>
                <div class="mt-0.5 flex items-center gap-2 text-xs text-ink-muted">
                  <span class="truncate">{threadDisplay(thread)}</span>
                </div>
              </div>
              <div class="flex shrink-0 flex-col items-end gap-1">
                <span class="text-[10px] text-ink-faint">{relativeTime(thread.lastMessageAt)}</span>
                <div class="flex items-center gap-1">
                  {#if thread.messageCount > 1}
                    <span
                      class="rounded-full bg-surface-muted px-1.5 py-0.5 font-mono text-[10px] font-semibold text-ink-muted"
                      >{thread.messageCount}</span
                    >
                  {/if}
                  <Badge tone={statusTone(thread.status)}>{statusLabel(thread.status)}</Badge>
                </div>
              </div>
            </div>
          </div>
        {/each}
      </div>
    {/if}
  </div>

  <!-- ── Thread detail ── -->
  {#if selected !== null}
    <div class="w-[56%] shrink-0">
      {#if threadLoading}
        <Card><Skeleton rows={8} /></Card>
      {:else}
        <Card>
          <!-- Header -->
          <div class="mb-4 flex items-start justify-between gap-2">
            <div class="min-w-0 flex-1">
              <h2 class="text-base font-bold text-ink">{selected.subject || '(sans objet)'}</h2>
              <div class="mt-1 flex flex-wrap items-center gap-2">
                <Badge tone={statusTone(selected.status)}>{statusLabel(selected.status)}</Badge>
                {#if threadDisplay(selected) !== '—'}
                  <span class="text-xs text-ink-muted">{threadDisplay(selected)}</span>
                {/if}
              </div>
            </div>
            <button
              class="shrink-0 rounded p-1 text-ink-faint hover:bg-surface-muted hover:text-ink"
              onclick={() => {
                selected = null;
              }}
              aria-label="Fermer">✕</button
            >
          </div>

          <!-- Message timeline -->
          <div class="mb-4 flex flex-col gap-3 max-h-96 overflow-y-auto pr-1">
            {#each selected.messages as msg (msg.id)}
              <div class={`flex ${msg.direction === 'OUTBOUND' ? 'justify-end' : 'justify-start'}`}>
                <div
                  class={`max-w-[80%] rounded-2xl px-4 py-3 text-xs ${msg.direction === 'OUTBOUND' ? 'rounded-br-sm bg-accent text-white' : 'rounded-bl-sm bg-surface-muted text-ink'}`}
                >
                  {#if msg.fromAddress}
                    <div
                      class={`mb-1 text-[10px] font-semibold ${msg.direction === 'OUTBOUND' ? 'text-white/70' : 'text-ink-faint'}`}
                    >
                      {msg.fromAddress}
                    </div>
                  {/if}
                  <!-- Inbound HTML is attacker-controlled; sanitized via DOMPurify before render. -->
                  <div class="prose-xs leading-snug [&_p]:mb-1 [&_a]:underline">
                    {@html msg.html ? safeHtml(msg.html) : '(contenu vide)'}
                  </div>
                  <div
                    class={`mt-2 text-[10px] ${msg.direction === 'OUTBOUND' ? 'text-white/60' : 'text-ink-faint'}`}
                  >
                    {relativeTime(msg.createdAt)}
                  </div>
                </div>
              </div>
            {/each}

            {#if selected.messages.length === 0}
              <p class="text-center text-xs text-ink-faint">Aucun message dans ce fil.</p>
            {/if}
          </div>

          <!-- Reply composer -->
          <div class="mb-4 border-t border-edge-soft pt-4">
            <div class="mb-2 text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
              Répondre
            </div>
            <Textarea
              bind:value={replyHtml}
              rows={4}
              placeholder="Contenu de votre réponse (HTML accepté)…"
            />
            <div class="mt-2 flex justify-end">
              <Button loading={replySending} onclick={sendReply}>Envoyer</Button>
            </div>
          </div>

          <!-- Link panel — only for UNLINKED threads -->
          {#if selected.status === 'UNLINKED'}
            <div class="border-t border-edge-soft pt-4">
              <div class="mb-3 text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
                Rattacher à un contact
              </div>

              <!-- Search contacts -->
              {#if !createMode}
                <div class="mb-2">
                  <Input bind:value={linkSearch} placeholder="Rechercher par nom ou courriel…" />
                </div>
                {#if linkSearching}
                  <Skeleton rows={2} />
                {:else if linkResults.length > 0}
                  <div class="mb-2 flex flex-col gap-1">
                    {#each linkResults as contact (contact.id)}
                      <div
                        class="flex items-center justify-between rounded-lg border border-edge-soft bg-surface-muted px-3 py-2 text-xs"
                      >
                        <div>
                          <div class="font-semibold text-ink">{contact.name}</div>
                          <div class="text-ink-faint">{contact.email}</div>
                        </div>
                        <Button
                          variant="secondary"
                          loading={linkSaving}
                          onclick={() => void linkToContact(contact.id)}>Rattacher</Button
                        >
                      </div>
                    {/each}
                  </div>
                {:else if linkSearch.trim().length >= 2}
                  <p class="mb-2 text-xs text-ink-faint">Aucun contact trouvé.</p>
                {/if}

                <Button
                  variant="secondary"
                  onclick={() => {
                    createMode = true;
                  }}>+ Créer un contact</Button
                >
              {:else}
                <!-- Create contact form -->
                <div class="flex flex-col gap-3">
                  <Field label="Nom *">
                    <Input bind:value={createName} placeholder="Prénom Nom" />
                  </Field>
                  <Field label="Adresse courriel *">
                    <Input type="email" bind:value={createEmail} placeholder="prenom@exemple.com" />
                  </Field>
                  <div class="flex gap-2">
                    <Button loading={linkSaving} onclick={createAndLink}>Créer et rattacher</Button>
                    <Button
                      variant="secondary"
                      onclick={() => {
                        createMode = false;
                      }}>Annuler</Button
                    >
                  </div>
                </div>
              {/if}
            </div>
          {/if}

          <!-- Archive button -->
          {#if selected.status !== 'ARCHIVED'}
            <div class="mt-4 border-t border-edge-soft pt-4 flex justify-end">
              <Button variant="secondary" loading={archiving} onclick={archiveThread}
                >Archiver</Button
              >
            </div>
          {/if}
        </Card>
      {/if}
    </div>
  {/if}
</div>
