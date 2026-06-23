<script lang="ts">
  import type { Paginated } from '@pulsar/shared';
  import { api, ApiError } from '$lib/api/client';
  import { toast } from '$lib/stores/toast';
  import type { Tone } from '$lib/components/ui';
  import {
    Badge,
    Button,
    Card,
    EmptyState,
    Input,
    Field,
    Skeleton,
    Textarea,
  } from '$lib/components/ui';

  // ── Types ───────────────────────────────────────────────────────────────────

  interface EmailMessage {
    id: string;
    toAddresses: string[];
    subject: string;
    status: string;
    sentAt: string | null;
    relatedType: string | null;
    relatedId: string | null;
    createdAt: string;
  }

  // ── Props ───────────────────────────────────────────────────────────────────

  let {
    relatedType,
    relatedId,
    defaultTo = undefined,
  }: {
    relatedType: string;
    relatedId: string;
    defaultTo?: string;
  } = $props();

  // ── State — list ─────────────────────────────────────────────────────────────

  let emails = $state<EmailMessage[]>([]);
  let loading = $state(false);
  let listError = $state('');

  // ── State — composer ─────────────────────────────────────────────────────────

  let composerOpen = $state(false);
  let to = $state('');
  let subject = $state('');
  let html = $state('');
  let draftPrompt = $state('');
  let drafting = $state(false);
  let sending = $state(false);

  // ── Helpers ──────────────────────────────────────────────────────────────────

  function statusTone(status: string): Tone {
    if (status === 'SENT') return 'ok';
    if (status === 'QUEUED') return 'info';
    if (status === 'FAILED') return 'danger';
    return 'neutral';
  }

  function statusLabel(status: string): string {
    if (status === 'SENT') return 'Envoyé';
    if (status === 'QUEUED') return 'En file';
    if (status === 'FAILED') return 'Échec';
    if (status === 'DRAFT') return 'Brouillon';
    return status;
  }

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

  // ── Data loading ─────────────────────────────────────────────────────────────

  async function load() {
    if (!relatedId) return;
    loading = true;
    listError = '';
    try {
      const result = await api<Paginated<EmailMessage>>('/emails', {
        query: { relatedType, relatedId, pageSize: 20 },
      });
      emails = result.items;
    } catch (e) {
      listError = e instanceof ApiError ? e.message : 'Impossible de charger les courriels';
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    // Re-run whenever relatedId changes
    relatedId;
    void load();
  });

  // ── Composer ─────────────────────────────────────────────────────────────────

  function openComposer() {
    to = defaultTo ?? '';
    subject = '';
    html = '';
    draftPrompt = '';
    composerOpen = true;
  }

  function closeComposer() {
    composerOpen = false;
  }

  async function draftWithAI() {
    if (!draftPrompt.trim()) return;
    drafting = true;
    try {
      const result = await api<{ subject: string; html: string }>('/emails/draft', {
        method: 'POST',
        body: { prompt: draftPrompt },
      });
      subject = result.subject;
      html = result.html;
    } catch (e) {
      if (e instanceof ApiError && e.statusCode === 400) {
        toast.error('IA non configurée pour ce tenant');
      } else {
        toast.error('Erreur lors de la génération du brouillon');
      }
    } finally {
      drafting = false;
    }
  }

  async function send() {
    if (!to.trim()) {
      toast.error('Veuillez saisir au moins une adresse destinataire');
      return;
    }
    sending = true;
    try {
      const toArr = to
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      await api('/emails', {
        method: 'POST',
        body: { to: toArr, subject, html, relatedType, relatedId },
      });
      toast.success('Courriel envoyé');
      closeComposer();
      void load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Erreur lors de l'envoi");
    } finally {
      sending = false;
    }
  }
</script>

<Card>
  <!-- Section header -->
  <div class="mb-3 flex items-center justify-between gap-2">
    <h2 class="text-sm font-semibold text-ink">Courriels</h2>
    {#if !composerOpen}
      <Button variant="secondary" onclick={openComposer}>Rédiger un courriel</Button>
    {/if}
  </div>

  <!-- Inline composer -->
  {#if composerOpen}
    <div class="mb-4 rounded-inner border border-edge bg-surface-muted p-3 space-y-3">
      <Field label="À">
        <Input bind:value={to} placeholder="alice@example.com, bob@example.com" disabled={sending} />
      </Field>
      <p class="text-xs text-ink-faint -mt-1">Adresses séparées par des virgules</p>

      <Field label="Sujet">
        <Input bind:value={subject} placeholder="Objet du courriel" disabled={sending} />
      </Field>

      <Field label="Corps HTML">
        <Textarea bind:value={html} rows={5} placeholder="<p>Bonjour,</p>" disabled={sending} />
      </Field>

      <!-- AI draft -->
      <div class="rounded-inner border border-edge bg-surface p-3">
        <p class="mb-2 text-xs font-semibold text-ink-muted">Rédiger avec l'IA</p>
        <div class="flex gap-2">
          <div class="flex-1">
            <Input
              bind:value={draftPrompt}
              placeholder="Décrivez le courriel à rédiger…"
              disabled={drafting || sending}
            />
          </div>
          <Button
            variant="secondary"
            onclick={draftWithAI}
            disabled={drafting || sending || !draftPrompt.trim()}
          >
            {drafting ? 'Génération…' : 'Rédiger avec l\'IA'}
          </Button>
        </div>
      </div>

      <!-- Actions -->
      <div class="flex justify-end gap-2">
        <Button variant="secondary" onclick={closeComposer} disabled={sending}>Annuler</Button>
        <Button onclick={send} disabled={sending || !to.trim()}>
          {sending ? 'Envoi…' : 'Envoyer'}
        </Button>
      </div>
    </div>
  {/if}

  <!-- Email list -->
  {#if loading}
    <Skeleton rows={3} />
  {:else if listError}
    <p class="text-xs text-danger">{listError}</p>
  {:else if emails.length === 0}
    <EmptyState title="Aucun courriel" message="Aucun courriel associé à cet enregistrement." />
  {:else}
    <ol class="space-y-2">
      {#each emails as email (email.id)}
        <li class="rounded-md border border-edge bg-surface-muted px-3 py-2 text-xs">
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0 flex-1">
              <div class="mb-0.5 flex flex-wrap items-center gap-1.5">
                <Badge tone={statusTone(email.status)}>{statusLabel(email.status)}</Badge>
                <span class="truncate font-medium text-ink">{email.subject || '(sans objet)'}</span>
              </div>
              <div class="text-ink-muted truncate">
                À : {email.toAddresses.join(', ')}
              </div>
            </div>
            <span
              class="shrink-0 text-[10px] text-ink-faint"
              title={email.sentAt ?? email.createdAt}
            >
              {relativeTime(email.sentAt ?? email.createdAt)}
            </span>
          </div>
        </li>
      {/each}
    </ol>
  {/if}
</Card>
