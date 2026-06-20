<script lang="ts">
  import { onDestroy } from 'svelte';
  import type { Paginated } from '@pulsar/shared';
  import { api, ApiError } from '$lib/api/client';
  import { downloadDocument, fetchDocumentObjectUrl } from '$lib/api/files';
  import { toast } from '$lib/stores/toast';
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
  } from '$lib/components/ui';

  interface DocCenterItem {
    id: string;
    entityType: string;
    entityId: string;
    category: string;
    fileName: string;
    mimeType: string;
    sizeBytes: number;
    uploadedByName?: string;
    createdAt: string;
  }

  interface DocumentCategoryFacet {
    entityType: string;
    label: string;
    count: number;
  }

  interface ComplianceAlertItem {
    id: string;
    subjectType: string;
    subjectId: string;
    docType: string;
    reference?: string;
    expiresAt: string;
    status: 'EXPIRING' | 'EXPIRED';
    documentId?: string;
  }

  interface DocumentCenterDto {
    documents: Paginated<DocCenterItem>;
    categories: DocumentCategoryFacet[];
    compliance: ComplianceAlertItem[];
  }

  // — Filters —
  let category = $state('');
  let search = $state('');
  let from = $state('');
  let to = $state('');
  let page = $state(1);
  const pageSize = 25;

  // — Data —
  let rows = $state<DocCenterItem[]>([]);
  let total = $state(0);
  let categories = $state<DocumentCategoryFacet[]>([]);
  let compliance = $state<ComplianceAlertItem[]>([]);
  let loading = $state(true);
  let error = $state('');

  const totalPages = $derived(Math.max(1, Math.ceil(total / pageSize)));

  function humanSize(bytes: number): string {
    if (!bytes) return '0 o';
    const units = ['o', 'Ko', 'Mo', 'Go', 'To'];
    const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
    const value = bytes / Math.pow(1024, i);
    return `${i === 0 ? value : value.toFixed(1)} ${units[i]}`;
  }

  function shortId(id: string): string {
    return id.length > 8 ? id.slice(0, 8) : id;
  }

  // — Authenticated download (a plain <a href> would 401 — no bearer token) —
  let downloadingId = $state<string | null>(null);
  async function download(doc: { id: string; fileName: string }) {
    downloadingId = doc.id;
    try {
      await downloadDocument(doc.id, doc.fileName);
    } catch {
      toast.error('Échec du téléchargement');
    } finally {
      downloadingId = null;
    }
  }

  // — Inline preview —
  let previewDoc = $state<DocCenterItem | null>(null);
  let previewOpen = $state(false);
  let previewUrl = $state<string | null>(null);
  let previewLoading = $state(false);
  let previewError = $state('');

  const previewKind = $derived.by(() => {
    const m = previewDoc?.mimeType ?? '';
    if (m.startsWith('image/')) return 'image';
    if (m === 'application/pdf') return 'pdf';
    if (m.startsWith('text/') || m === 'application/json') return 'text';
    return 'other';
  });

  function revokePreview() {
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      previewUrl = null;
    }
  }

  async function openPreview(doc: DocCenterItem) {
    previewDoc = doc;
    previewOpen = true;
    previewError = '';
    revokePreview();
    const kind = doc.mimeType.startsWith('image/')
      ? 'image'
      : doc.mimeType === 'application/pdf'
        ? 'pdf'
        : doc.mimeType.startsWith('text/') || doc.mimeType === 'application/json'
          ? 'text'
          : 'other';
    if (kind === 'other') return; // nothing to fetch; show download CTA
    previewLoading = true;
    try {
      previewUrl = await fetchDocumentObjectUrl(doc.id);
    } catch {
      previewError = "Impossible de charger l'aperçu";
    } finally {
      previewLoading = false;
    }
  }

  function closePreview() {
    previewOpen = false;
    previewDoc = null;
    revokePreview();
  }

  onDestroy(revokePreview);

  async function load() {
    loading = true;
    try {
      const r = await api<DocumentCenterDto>('/documents/center', {
        query: {
          category: category || undefined,
          search: search || undefined,
          from: from || undefined,
          to: to || undefined,
          page,
          pageSize,
        },
      });
      rows = r.documents.items;
      total = r.documents.total;
      categories = r.categories;
      compliance = r.compliance;
    } catch (e) {
      error = e instanceof ApiError ? e.message : 'Échec du chargement';
    } finally {
      loading = false;
    }
  }

  function toggleCategory(entityType: string) {
    category = category === entityType ? '' : entityType;
  }

  // Reset to page 1 whenever a filter changes.
  $effect(() => {
    category;
    search;
    from;
    to;
    page = 1;
  });

  $effect(() => {
    error = '';
    void load();
  });
</script>

<PageHeader
  title="Document Center"
  eyebrow="Documents"
  subtitle="Retrouvez n'importe quel document du tenant, filtrez par catégorie, recherche ou date, et surveillez la conformité qui expire."
  count={total}
/>

<ErrorNotice message={error} onretry={load} />

<!-- 1. Category facets -->
{#if categories.length > 0}
  <div class="mb-4 flex flex-wrap items-center gap-2">
    <button
      type="button"
      class={`rounded-full border px-3 py-1 text-xs font-semibold transition ${
        category === ''
          ? 'border-accent bg-accent-soft text-accent'
          : 'border-edge bg-surface text-ink-muted hover:text-ink'
      }`}
      onclick={() => (category = '')}
    >
      Tous <span class="font-mono">{categories.reduce((s, c) => s + c.count, 0)}</span>
    </button>
    {#each categories as facet (facet.entityType)}
      <button
        type="button"
        class={`rounded-full border px-3 py-1 text-xs font-semibold transition ${
          category === facet.entityType
            ? 'border-accent bg-accent-soft text-accent'
            : 'border-edge bg-surface text-ink-muted hover:text-ink'
        }`}
        onclick={() => toggleCategory(facet.entityType)}
      >
        {facet.label} <span class="font-mono">{facet.count}</span>
      </button>
    {/each}
  </div>
{/if}

<div class="grid gap-4 lg:grid-cols-[1fr_22rem]">
  <!-- Documents column -->
  <div>
    <!-- 2. Filters bar -->
    <div class="mb-3 grid gap-3 sm:grid-cols-[2fr_1fr_1fr]">
      <Field label="Recherche (nom de fichier)">
        <Input bind:value={search} placeholder="ex. connaissement, facture…" />
      </Field>
      <Field label="Du">
        <Input type="date" bind:value={from} />
      </Field>
      <Field label="Au">
        <Input type="date" bind:value={to} />
      </Field>
    </div>

    <!-- 3. Documents table -->
    {#if loading}
      <Card padded={false}><div class="p-4"><Skeleton rows={6} /></div></Card>
    {:else}
      <Table>
        {#snippet head()}
          <th>Fichier</th><th>Catégorie</th><th>Entité</th><th>Taille</th>
          <th>Uploadé par</th><th>Date</th><th class="text-right">Action</th>
        {/snippet}
        {#snippet body()}
          {#each rows as row (row.id)}
            <tr>
              <td>
                <button
                  type="button"
                  class="text-left font-medium text-ink transition-colors hover:text-accent hover:underline"
                  onclick={() => openPreview(row)}
                >{row.fileName}</button>
              </td>
              <td><Badge tone="neutral">{row.category}</Badge></td>
              <td class="text-xs text-ink-muted">
                <span class="font-mono">{row.entityType}:{shortId(row.entityId)}</span>
              </td>
              <td class="font-mono text-xs">{humanSize(row.sizeBytes)}</td>
              <td class="text-sm">{row.uploadedByName ?? '—'}</td>
              <td class="text-xs text-ink-muted">{new Date(row.createdAt).toLocaleString()}</td>
              <td class="text-right">
                <div class="inline-flex items-center gap-1.5">
                  <button
                    type="button"
                    onclick={() => openPreview(row)}
                    class="inline-flex items-center justify-center rounded-md border border-edge bg-surface px-3 py-1 text-xs font-medium text-ink transition-colors hover:bg-surface-muted"
                  >Aperçu</button>
                  <button
                    type="button"
                    onclick={() => download(row)}
                    disabled={downloadingId === row.id}
                    class="inline-flex items-center justify-center rounded-md border border-edge bg-surface px-3 py-1 text-xs font-medium text-ink transition-colors hover:bg-surface-muted disabled:opacity-50"
                  >{downloadingId === row.id ? '…' : 'Télécharger'}</button>
                </div>
              </td>
            </tr>
          {:else}
            <tr
              ><td colspan="7"
                ><EmptyState
                  title="Aucun document"
                  message="Aucun document ne correspond à ces filtres. Ajustez la catégorie, la recherche ou la plage de dates."
                /></td
              ></tr
            >
          {/each}
        {/snippet}
      </Table>

      {#if total > pageSize}
        <div class="mt-3 flex items-center justify-between text-sm text-ink-muted">
          <span class="font-mono text-xs"
            >{(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} sur {total}</span
          >
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
  </div>

  <!-- 4. Compliance panel -->
  <Card>
    <div class="mb-3 flex items-center justify-between">
      <h2 class="text-sm font-bold text-ink">Conformité à risque</h2>
      {#if compliance.length > 0}
        <span class="font-mono text-xs text-ink-muted">{compliance.length}</span>
      {/if}
    </div>
    {#if loading}
      <Skeleton rows={4} />
    {:else if compliance.length === 0}
      <EmptyState message="Aucune conformité à risque" />
    {:else}
      <ul class="flex flex-col gap-2">
        {#each compliance as item (item.id)}
          <li class="rounded-inner border border-edge-soft bg-surface-muted p-2.5">
            <div class="flex items-start justify-between gap-2">
              <div class="min-w-0">
                <div class="truncate text-sm font-medium text-ink">{item.docType}</div>
                <div class="text-xs text-ink-muted">
                  <span class="font-mono">{item.subjectType}</span>
                  {#if item.reference}· {item.reference}{/if}
                </div>
                <div class="mt-0.5 text-xs text-ink-faint">
                  Échéance : {new Date(item.expiresAt).toLocaleDateString()}
                </div>
              </div>
              <Badge tone={item.status === 'EXPIRED' ? 'danger' : 'warn'}>
                {item.status === 'EXPIRED' ? 'Expiré' : 'Expire bientôt'}
              </Badge>
            </div>
            {#if item.documentId}
              {@const docId = item.documentId}
              <button
                type="button"
                onclick={() => download({ id: docId, fileName: `${item.docType}.pdf` })}
                disabled={downloadingId === docId}
                class="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-accent hover:underline disabled:opacity-50"
                >{downloadingId === docId ? 'Téléchargement…' : 'Télécharger le document'}</button
              >
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
  </Card>
</div>

<!-- Document preview -->
<Modal bind:open={previewOpen} title={previewDoc?.fileName ?? 'Aperçu'} size="xl" onclose={closePreview}>
  {#if previewDoc}
    {#if previewError}
      <div class="py-10 text-center text-sm text-danger">{previewError}</div>
    {:else if previewLoading}
      <div class="flex h-[60vh] items-center justify-center"><Skeleton rows={6} /></div>
    {:else if previewKind === 'image' && previewUrl}
      <div class="flex justify-center">
        <img src={previewUrl} alt={previewDoc.fileName} class="max-h-[70vh] max-w-full rounded-inner object-contain" />
      </div>
    {:else if previewKind === 'pdf' && previewUrl}
      <iframe src={previewUrl} title={previewDoc.fileName} class="h-[70vh] w-full rounded-inner border border-edge"></iframe>
    {:else if previewKind === 'text' && previewUrl}
      <iframe src={previewUrl} title={previewDoc.fileName} class="h-[60vh] w-full rounded-inner border border-edge bg-white"></iframe>
    {:else}
      <div class="flex flex-col items-center gap-3 py-12 text-center">
        <p class="text-sm text-ink-muted">
          Aperçu non disponible pour ce type de fichier ({previewDoc.mimeType || 'inconnu'}).
        </p>
        <Button onclick={() => { if (previewDoc) void download(previewDoc); }}>Télécharger le fichier</Button>
      </div>
    {/if}
  {/if}
  {#snippet footer()}
    {#if previewDoc}
      <span class="mr-auto text-xs text-ink-faint">{humanSize(previewDoc.sizeBytes)} · {previewDoc.mimeType}</span>
      <Button variant="secondary" onclick={closePreview}>Fermer</Button>
      <Button onclick={() => { if (previewDoc) void download(previewDoc); }} disabled={downloadingId === previewDoc.id}>
        {downloadingId === previewDoc.id ? 'Téléchargement…' : 'Télécharger'}
      </Button>
    {/if}
  {/snippet}
</Modal>
