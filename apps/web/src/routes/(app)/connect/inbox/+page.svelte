<script lang="ts">
  import { api, ApiError } from '$lib/api/client';
  import { auth } from '$lib/stores/auth';
  import { PERMISSIONS, INBOUND_SOURCES, INBOUND_STATUSES, type Paginated } from '@pulsar/shared';
  import type { InboundSource, InboundStatus } from '@pulsar/shared';
  import { formatDateTime } from '$lib/format';
  import {
    PageHeader,
    Badge,
    Card,
    EmptyState,
    ErrorNotice,
    FilterBar,
    Modal,
    Select,
    Skeleton,
    Table,
    type Tone,
  } from '$lib/components/ui';

  // ── Types ──────────────────────────────────────────────────────────────────

  interface InboundMessage {
    id: string;
    source: InboundSource;
    status: InboundStatus;
    kind: string;
    summary: string | null;
    documentId: string | null;
    parsed: Record<string, unknown> | null;
    error: string | null;
    refType: string | null;
    refId: string | null;
    createdAt: string;
  }

  interface InboundMessageDetail extends InboundMessage {
    documentUrl?: string | null;
  }

  // ── State ──────────────────────────────────────────────────────────────────

  let items = $state<InboundMessage[]>([]);
  let total = $state(0);
  let page = $state(1);
  const pageSize = 20;
  let loading = $state(true);
  let error = $state('');

  // Filters — use bind:value with Select
  let filterSource = $state('');
  let filterStatus = $state('');

  // Detail modal
  let modalOpen = $state(false);
  let selected = $state<InboundMessageDetail | null>(null);
  let detailLoading = $state(false);
  let ignoring = $state(false);
  let actionError = $state('');

  // ── Permissions ────────────────────────────────────────────────────────────

  const canManage = $derived(
    $auth?.user.permissions.includes(PERMISSIONS.CORE.CONNECT_MANAGE) ?? false,
  );

  // ── Helpers ────────────────────────────────────────────────────────────────

  function sourceTone(source: InboundSource): Tone {
    if (source === 'WEBHOOK') return 'info';
    if (source === 'CSV') return 'ok';
    if (source === 'PDF') return 'warn';
    return 'neutral';
  }

  function statusTone(status: InboundStatus): Tone {
    if (status === 'IMPORTED') return 'ok';
    if (status === 'PARSED') return 'info';
    if (status === 'RECEIVED') return 'neutral';
    if (status === 'FAILED') return 'danger';
    if (status === 'IGNORED') return 'neutral';
    return 'neutral';
  }

  function parsedEntries(parsed: Record<string, unknown> | null): [string, string][] {
    if (!parsed || typeof parsed !== 'object') return [];
    return Object.entries(parsed).map(([k, v]): [string, string] => [
      k,
      typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v ?? ''),
    ]);
  }

  // ── Load list ──────────────────────────────────────────────────────────────

  async function load() {
    loading = true;
    error = '';
    try {
      const res = await api<Paginated<InboundMessage>>('/connect/inbox', {
        query: {
          source: filterSource || undefined,
          status: filterStatus || undefined,
          page,
          pageSize,
        },
      });
      items = res.items;
      total = res.total;
    } catch (e) {
      error = e instanceof ApiError ? e.message : 'Failed to load inbox';
    } finally {
      loading = false;
    }
  }

  // ── Open detail ────────────────────────────────────────────────────────────

  async function openDetail(msg: InboundMessage) {
    selected = msg;
    modalOpen = true;
    actionError = '';
    detailLoading = true;
    try {
      const detail = await api<InboundMessageDetail>(`/connect/inbox/${msg.id}`);
      selected = detail;
    } catch {
      // non-fatal — modal still shows list data
    } finally {
      detailLoading = false;
    }
  }

  // ── Ignore action ──────────────────────────────────────────────────────────

  async function ignore() {
    if (!selected || !canManage) return;
    ignoring = true;
    actionError = '';
    try {
      await api(`/connect/inbox/${selected.id}/ignore`, { method: 'POST' });
      modalOpen = false;
      selected = null;
      await load();
    } catch (e) {
      actionError = e instanceof ApiError ? e.message : 'Failed to ignore message';
    } finally {
      ignoring = false;
    }
  }

  // ── Reactivity ────────────────────────────────────────────────────────────

  $effect(() => {
    void load();
  });

  // Re-load on filter change (debounce via $effect tracking filterSource/filterStatus)
  $effect(() => {
    const _s = filterSource;
    const _st = filterStatus;
    page = 1;
    void load();
  });

  const totalPages = $derived(Math.ceil(total / pageSize));
</script>

<PageHeader
  title="Inbox"
  subtitle="Messages entrants : webhooks, CSV, documents. Cliquez sur une ligne pour voir le détail."
  count={loading ? undefined : total}
/>

<ErrorNotice message={error} onretry={load} />

<FilterBar>
  <label class="flex items-center gap-2 text-xs font-semibold text-ink-muted">
    Source
    <Select bind:value={filterSource}>
      <option value="">Toutes</option>
      {#each INBOUND_SOURCES as src (src)}
        <option value={src}>{src}</option>
      {/each}
    </Select>
  </label>
  <label class="flex items-center gap-2 text-xs font-semibold text-ink-muted">
    Statut
    <Select bind:value={filterStatus}>
      <option value="">Tous</option>
      {#each INBOUND_STATUSES as st (st)}
        <option value={st}>{st}</option>
      {/each}
    </Select>
  </label>
</FilterBar>

{#if loading}
  <Card padded={false}><Skeleton rows={5} /></Card>
{:else if items.length === 0}
  <EmptyState
    title="Aucun message"
    message="Aucun message entrant ne correspond à ces filtres."
  />
{:else}
  <Table>
    {#snippet head()}
      <th>Source</th>
      <th>Statut</th>
      <th>Type</th>
      <th>Résumé</th>
      <th>Reçu le</th>
    {/snippet}
    {#snippet body()}
      {#each items as msg (msg.id)}
        <tr
          class="cursor-pointer"
          onclick={() => void openDetail(msg)}
          onkeydown={(e: KeyboardEvent) => e.key === 'Enter' && void openDetail(msg)}
          tabindex="0"
          role="button"
          aria-label="Voir le message {msg.id}"
        >
          <td><Badge tone={sourceTone(msg.source)}>{msg.source}</Badge></td>
          <td><Badge tone={statusTone(msg.status)}>{msg.status}</Badge></td>
          <td class="text-xs text-ink-muted">{msg.kind || '—'}</td>
          <td class="max-w-xs truncate text-sm text-ink">{msg.summary || '—'}</td>
          <td class="text-xs text-ink-muted">{formatDateTime(msg.createdAt)}</td>
        </tr>
      {/each}
    {/snippet}
  </Table>

  {#if totalPages > 1}
    <div class="mt-3 flex items-center justify-between text-xs text-ink-muted">
      <span>{total} messages · page {page} / {totalPages}</span>
      <div class="flex gap-2">
        <button
          class="rounded-md border border-edge px-3 py-1.5 hover:bg-surface-muted disabled:opacity-40"
          disabled={page <= 1}
          onclick={() => { page -= 1; void load(); }}
        >Préc.</button>
        <button
          class="rounded-md border border-edge px-3 py-1.5 hover:bg-surface-muted disabled:opacity-40"
          disabled={page >= totalPages}
          onclick={() => { page += 1; void load(); }}
        >Suiv.</button>
      </div>
    </div>
  {/if}
{/if}

<!-- Detail Modal -->
<Modal bind:open={modalOpen} title="Message entrant" size="lg">
  {#if selected}
    <div class="space-y-4">
      {#if actionError}
        <div class="rounded-card border border-danger/30 bg-danger/5 px-3 py-2 text-xs text-danger">
          {actionError}
        </div>
      {/if}

      <!-- Header badges -->
      <div class="flex flex-wrap gap-2">
        <Badge tone={sourceTone(selected.source)}>{selected.source}</Badge>
        <Badge tone={statusTone(selected.status)}>{selected.status}</Badge>
        {#if selected.kind}
          <span class="rounded-full bg-surface-muted px-2 py-0.5 text-xs font-semibold text-ink-muted">
            {selected.kind}
          </span>
        {/if}
      </div>

      <!-- Summary -->
      {#if selected.summary}
        <div>
          <p class="text-xs font-semibold uppercase tracking-wide text-ink-faint">Résumé</p>
          <p class="mt-1 text-sm text-ink">{selected.summary}</p>
        </div>
      {/if}

      <!-- Ref -->
      {#if selected.refType || selected.refId}
        <div>
          <p class="text-xs font-semibold uppercase tracking-wide text-ink-faint">Référence</p>
          <p class="mt-1 text-xs text-ink-muted">
            {selected.refType ?? ''}
            {#if selected.refId}· <span class="font-mono">{selected.refId}</span>{/if}
          </p>
        </div>
      {/if}

      <!-- Parsed key-values -->
      {#if selected.parsed && parsedEntries(selected.parsed).length > 0}
        <div>
          <p class="text-xs font-semibold uppercase tracking-wide text-ink-faint">Données parsées</p>
          <dl class="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
            {#each parsedEntries(selected.parsed) as [key, value] (key)}
              <dt class="font-medium text-ink-muted">{key}</dt>
              <dd class="break-all text-ink">{value}</dd>
            {/each}
          </dl>
        </div>
      {/if}

      <!-- Error -->
      {#if selected.error}
        <div class="rounded-card border border-danger/20 bg-danger/5 px-3 py-2">
          <p class="text-xs font-semibold uppercase tracking-wide text-danger">Erreur</p>
          <p class="mt-1 text-xs text-ink">{selected.error}</p>
        </div>
      {/if}

      <!-- Document link -->
      {#if detailLoading}
        <div class="text-xs text-ink-faint">Chargement du document…</div>
      {:else if selected.documentUrl}
        <div>
          <p class="text-xs font-semibold uppercase tracking-wide text-ink-faint">Document</p>
          <a
            href={selected.documentUrl}
            target="_blank"
            rel="noopener noreferrer"
            class="mt-1 inline-flex items-center gap-1 text-xs font-medium text-accent underline hover:text-accent-strong"
          >
            Télécharger / ouvrir le document
          </a>
        </div>
      {/if}

      <!-- Meta -->
      <div class="border-t border-edge-soft pt-3">
        <p class="text-xs text-ink-faint">ID: <span class="font-mono">{selected.id}</span></p>
        <p class="text-xs text-ink-faint">Reçu le: {formatDateTime(selected.createdAt)}</p>
      </div>

      <!-- Actions -->
      {#if canManage && selected.status !== 'IGNORED'}
        <div class="flex justify-end gap-2 border-t border-edge-soft pt-3">
          <button
            class="rounded-md border border-edge px-3 py-1.5 text-xs font-semibold text-ink-muted hover:bg-surface-muted disabled:opacity-50"
            disabled={ignoring}
            onclick={ignore}
          >
            {ignoring ? 'En cours…' : 'Ignorer'}
          </button>
        </div>
      {/if}
    </div>
  {/if}
</Modal>
