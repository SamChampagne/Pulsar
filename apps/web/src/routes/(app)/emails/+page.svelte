<script lang="ts">
  import { page as routePage } from '$app/state';
  import type { Paginated } from '@pulsar/shared';
  import { api, ApiError } from '$lib/api/client';
  import { toast } from '$lib/stores/toast';
  import { formatDateTime } from '$lib/format';
  import type { Tone } from '$lib/components/ui';
  import {
    PageHeader,
    Button,
    Card,
    Table,
    Badge,
    EmptyState,
    Skeleton,
    Input,
    Field,
    ErrorNotice,
    Modal,
    Select,
    FilterBar,
    Textarea,
  } from '$lib/components/ui';

  interface EmailMessage {
    id: string;
    toAddresses: string[];
    cc: string[];
    subject: string;
    html: string;
    status: string;
    sentAt: string | null;
    relatedType: string | null;
    relatedId: string | null;
    createdByUserId: string | null;
    agentId: string | null;
    createdAt: string;
    attachments?: { id: string; documentId: string; filename: string }[];
  }

  interface EmailTemplate {
    id: string;
    key: string;
    name: string;
    subject: string;
    html: string;
    category: string | null;
  }

  // — Filters —
  let statusFilter = $state('');
  let search = $state('');
  let page = $state(1);
  const pageSize = 20;

  // — Data —
  let rows = $state<EmailMessage[]>([]);
  let total = $state(0);
  let loading = $state(true);
  let error = $state('');

  const totalPages = $derived(Math.max(1, Math.ceil(total / pageSize)));

  // — Detail modal —
  let detailOpen = $state(false);
  let detailEmail = $state<EmailMessage | null>(null);

  function openDetail(email: EmailMessage) {
    detailEmail = email;
    detailOpen = true;
  }

  function closeDetail() {
    detailOpen = false;
    detailEmail = null;
  }

  // — Composer modal —
  let composerOpen = $state(false);
  let composerSaving = $state(false);
  let drafting = $state(false);
  let templates = $state<EmailTemplate[]>([]);
  let templatesLoaded = $state(false);
  let draftPrompt = $state('');
  let selectedTemplateId = $state('');

  interface ComposerForm {
    to: string;
    cc: string;
    subject: string;
    html: string;
    attachmentDocumentId: string;
    attachmentFilename: string;
  }

  let composerForm = $state<ComposerForm>({
    to: '',
    cc: '',
    subject: '',
    html: '',
    attachmentDocumentId: '',
    attachmentFilename: '',
  });

  async function openComposer() {
    composerOpen = true;
    composerForm = {
      to: '',
      cc: '',
      subject: '',
      html: '',
      attachmentDocumentId: '',
      attachmentFilename: '',
    };
    draftPrompt = '';
    selectedTemplateId = '';
    if (!templatesLoaded) {
      try {
        const result = await api<EmailTemplate[]>('/emails/templates');
        templates = result;
        templatesLoaded = true;
      } catch {
        templates = [];
      }
    }
  }

  function closeComposer() {
    composerOpen = false;
  }

  function onTemplateChange(e: Event) {
    const select = e.currentTarget as HTMLSelectElement;
    const id = select.value;
    selectedTemplateId = id;
    if (!id) return;
    const tpl = templates.find((t) => t.id === id);
    if (tpl) {
      composerForm.subject = tpl.subject;
      composerForm.html = tpl.html;
    }
  }

  async function draftWithAI() {
    if (!draftPrompt.trim()) return;
    drafting = true;
    try {
      const result = await api<{ subject: string; html: string }>('/emails/draft', {
        method: 'POST',
        body: { prompt: draftPrompt },
      });
      composerForm.subject = result.subject;
      composerForm.html = result.html;
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

  async function submitComposer() {
    if (!composerForm.to.trim()) {
      toast.error('Veuillez saisir au moins une adresse destinataire');
      return;
    }
    composerSaving = true;
    try {
      const toArr = composerForm.to
        .split(/[,\s]+/)
        .map((s) => s.trim())
        .filter(Boolean);
      const ccArr = composerForm.cc
        .split(/[,\s]+/)
        .map((s) => s.trim())
        .filter(Boolean);
      const attachments =
        composerForm.attachmentDocumentId.trim() && composerForm.attachmentFilename.trim()
          ? [
              {
                documentId: composerForm.attachmentDocumentId.trim(),
                filename: composerForm.attachmentFilename.trim(),
              },
            ]
          : undefined;

      await api('/emails', {
        method: 'POST',
        body: {
          to: toArr,
          cc: ccArr.length ? ccArr : undefined,
          subject: composerForm.subject,
          html: composerForm.html,
          attachments,
        },
      });
      toast.success('Courriel envoyé');
      closeComposer();
      void load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Erreur lors de l'envoi");
    } finally {
      composerSaving = false;
    }
  }

  // — Load data —
  async function load() {
    loading = true;
    error = '';
    try {
      const result = await api<Paginated<EmailMessage>>('/emails', {
        query: {
          status: statusFilter || undefined,
          search: search || undefined,
          page,
          pageSize,
          relatedType: routePage.url.searchParams.get('relatedType') ?? undefined,
          relatedId: routePage.url.searchParams.get('relatedId') ?? undefined,
        },
      });
      rows = result.items;
      total = result.total;
    } catch (e) {
      error = e instanceof ApiError ? e.message : 'Échec du chargement';
    } finally {
      loading = false;
    }
  }

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

  // Single effect: read all reactive filter/page state synchronously so Svelte
  // re-runs this whenever any of them change, then call load().
  $effect(() => {
    statusFilter;
    search;
    page;
    routePage.url.search;
    error = '';
    void load();
  });
</script>

<PageHeader title="Courriels" eyebrow="Communication" count={total}>
  {#snippet actions()}
    <Button onclick={openComposer}>Composer</Button>
  {/snippet}
</PageHeader>

<ErrorNotice message={error} onretry={load} />

<FilterBar>
  <div class="w-56">
    <input
      bind:value={search}
      placeholder="Sujet, destinataire…"
      onkeydown={(e) => {
        if (e.key === 'Enter') {
          page = 1;
        }
      }}
      class="w-full rounded-md border border-edge bg-surface px-3 py-1.5 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
    />
  </div>
  <div class="w-40">
    <Select
      bind:value={statusFilter}
      onchange={() => {
        page = 1;
      }}
    >
      <option value="">Tous les statuts</option>
      <option value="QUEUED">En file</option>
      <option value="SENT">Envoyé</option>
      <option value="FAILED">Échec</option>
      <option value="DRAFT">Brouillon</option>
    </Select>
  </div>
  <Button
    variant="secondary"
    onclick={() => {
      search = '';
      statusFilter = '';
      page = 1;
    }}
  >
    Réinitialiser
  </Button>
</FilterBar>

{#if loading}
  <Card padded={false}><div class="p-4"><Skeleton rows={6} /></div></Card>
{:else}
  <Table>
    {#snippet head()}
      <th>Statut</th>
      <th>À</th>
      <th>Sujet</th>
      <th>Lié à</th>
      <th>Envoyé le</th>
      <th class="text-right">Action</th>
    {/snippet}
    {#snippet body()}
      {#each rows as row (row.id)}
        <tr class="cursor-pointer hover:bg-surface-muted" onclick={() => openDetail(row)}>
          <td>
            <Badge tone={statusTone(row.status)}>{statusLabel(row.status)}</Badge>
          </td>
          <td class="max-w-[16rem] truncate text-sm">{row.toAddresses.join(', ')}</td>
          <td class="text-sm font-medium">{row.subject}</td>
          <td class="text-xs text-ink-muted">
            {#if row.relatedType && row.relatedId}
              <span class="font-mono">{row.relatedType}:{row.relatedId.slice(0, 8)}</span>
            {:else}
              —
            {/if}
          </td>
          <td class="text-xs text-ink-muted">
            {formatDateTime(row.sentAt)}
          </td>
          <td class="text-right">
            <button
              type="button"
              class="inline-flex items-center justify-center rounded-md border border-edge bg-surface px-3 py-1 text-xs font-medium text-ink transition-colors hover:bg-surface-muted"
              onclick={(e) => {
                e.stopPropagation();
                openDetail(row);
              }}>Détails</button
            >
          </td>
        </tr>
      {:else}
        <tr>
          <td colspan="6">
            <EmptyState
              title="Aucun courriel"
              message="Aucun courriel ne correspond à ces filtres."
            />
          </td>
        </tr>
      {/each}
    {/snippet}
  </Table>

  {#if total > pageSize}
    <div class="mt-3 flex items-center justify-between text-sm text-ink-muted">
      <span class="font-mono text-xs">
        {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} sur {total}
      </span>
      <div class="flex items-center gap-2">
        <Button
          variant="secondary"
          disabled={page <= 1}
          onclick={() => {
            page = Math.max(1, page - 1);
            void load();
          }}>Précédent</Button
        >
        <span class="font-mono text-xs">Page {page} / {totalPages}</span>
        <Button
          variant="secondary"
          disabled={page >= totalPages}
          onclick={() => {
            page = Math.min(totalPages, page + 1);
            void load();
          }}>Suivant</Button
        >
      </div>
    </div>
  {/if}
{/if}

<!-- Detail Modal -->
<Modal
  bind:open={detailOpen}
  title={detailEmail?.subject ?? 'Détail courriel'}
  size="lg"
  onclose={closeDetail}
>
  {#if detailEmail}
    <div class="flex flex-col gap-4">
      <div class="flex items-center gap-2">
        <Badge tone={statusTone(detailEmail.status)}>{statusLabel(detailEmail.status)}</Badge>
        {#if detailEmail.sentAt}
          <span class="text-xs text-ink-muted">Envoyé le {formatDateTime(detailEmail.sentAt)}</span>
        {/if}
      </div>

      <div class="grid gap-2 text-sm">
        <div class="flex gap-2">
          <span class="w-12 shrink-0 font-medium text-ink-muted">À</span>
          <span class="break-all">{detailEmail.toAddresses.join(', ')}</span>
        </div>
        {#if detailEmail.cc && detailEmail.cc.length > 0}
          <div class="flex gap-2">
            <span class="w-12 shrink-0 font-medium text-ink-muted">Cc</span>
            <span class="break-all">{detailEmail.cc.join(', ')}</span>
          </div>
        {/if}
        <div class="flex gap-2">
          <span class="w-12 shrink-0 font-medium text-ink-muted">Sujet</span>
          <span class="font-medium">{detailEmail.subject}</span>
        </div>
        {#if detailEmail.relatedType && detailEmail.relatedId}
          <div class="flex gap-2">
            <span class="w-12 shrink-0 font-medium text-ink-muted">Lié à</span>
            <span class="font-mono text-xs">{detailEmail.relatedType}:{detailEmail.relatedId}</span>
          </div>
        {/if}
      </div>

      <div>
        <p class="mb-1 text-xs font-medium text-ink-muted">Corps</p>
        <iframe
          srcdoc={detailEmail.html}
          title="Corps du courriel"
          class="h-80 w-full rounded-inner border border-edge bg-white"
          sandbox="allow-same-origin"
        ></iframe>
      </div>

      {#if detailEmail.attachments && detailEmail.attachments.length > 0}
        <div>
          <p class="mb-1 text-xs font-medium text-ink-muted">Pièces jointes</p>
          <ul class="flex flex-col gap-1">
            {#each detailEmail.attachments as att (att.id)}
              <li class="text-sm text-ink">{att.filename}</li>
            {/each}
          </ul>
        </div>
      {/if}
    </div>
  {/if}
  {#snippet footer()}
    <Button variant="secondary" onclick={closeDetail}>Fermer</Button>
  {/snippet}
</Modal>

<!-- Composer Modal -->
<Modal bind:open={composerOpen} title="Composer un courriel" size="xl" onclose={closeComposer}>
  <div class="flex flex-col gap-4">
    <!-- Template picker -->
    <Field label="Gabarit (optionnel)">
      <Select value={selectedTemplateId} onchange={onTemplateChange}>
        <option value="">— Aucun gabarit —</option>
        {#each templates as tpl (tpl.id)}
          <option value={tpl.id}>{tpl.name}</option>
        {/each}
      </Select>
    </Field>

    <div>
      <Field label="À">
        <Input bind:value={composerForm.to} placeholder="alice@example.com, bob@example.com" />
      </Field>
      <p class="mt-1 text-xs text-ink-faint">Adresses séparées par des virgules</p>
    </div>

    <Field label="Cc (optionnel)">
      <Input bind:value={composerForm.cc} placeholder="chef@example.com" />
    </Field>

    <Field label="Sujet">
      <Input bind:value={composerForm.subject} placeholder="Objet du courriel" />
    </Field>

    <Field label="Corps HTML">
      <Textarea bind:value={composerForm.html} rows={8} placeholder="<p>Bonjour,</p>" />
    </Field>

    <!-- AI draft -->
    <div class="rounded-inner border border-edge bg-surface-muted p-3">
      <p class="mb-2 text-xs font-semibold text-ink-muted">Rédiger avec l'IA</p>
      <div class="flex gap-2">
        <div class="flex-1">
          <Input
            bind:value={draftPrompt}
            placeholder="Décrivez le courriel à rédiger…"
            disabled={drafting}
          />
        </div>
        <Button
          variant="secondary"
          onclick={draftWithAI}
          disabled={drafting || !draftPrompt.trim()}
        >
          {drafting ? 'Génération…' : 'Générer'}
        </Button>
      </div>
    </div>

    <!-- Attachment (simple v1) -->
    <div class="rounded-inner border border-edge bg-surface-muted p-3">
      <p class="mb-2 text-xs font-semibold text-ink-muted">Joindre un document</p>
      <div class="grid gap-2 sm:grid-cols-2">
        <Field label="ID du document">
          <Input bind:value={composerForm.attachmentDocumentId} placeholder="UUID du document" />
        </Field>
        <Field label="Nom du fichier">
          <Input bind:value={composerForm.attachmentFilename} placeholder="facture.pdf" />
        </Field>
      </div>
    </div>
  </div>

  {#snippet footer()}
    <Button variant="secondary" onclick={closeComposer} disabled={composerSaving}>Annuler</Button>
    <Button onclick={submitComposer} disabled={composerSaving}>
      {composerSaving ? 'Envoi…' : 'Envoyer'}
    </Button>
  {/snippet}
</Modal>
