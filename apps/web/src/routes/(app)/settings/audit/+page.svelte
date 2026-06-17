<script lang="ts">
  import type { Paginated } from '@pulsar/shared';
  import { PERMISSIONS } from '@pulsar/shared';
  import { api, ApiError } from '$lib/api/client';
  import { auth } from '$lib/stores/auth';
  import {
    PageHeader,
    Button,
    FilterBar,
    Field,
    Input,
    Select,
    Table,
    Badge,
    Card,
    EmptyState,
    Skeleton,
    Modal,
    ErrorNotice,
    type Tone,
  } from '$lib/components/ui';

  interface AuditUser {
    id: string;
    email: string;
    firstName: string | null;
    lastName: string | null;
  }
  interface AuditRow {
    id: string;
    userId: string | null;
    action: string;
    entityType: string;
    entityId: string | null;
    before: unknown;
    after: unknown;
    createdAt: string;
    user: AuditUser | null;
  }

  const canRead = $derived($auth?.user.permissions.includes(PERMISSIONS.CORE.AUDIT_READ) ?? false);

  const PAGE_SIZE = 50;
  let rows = $state<AuditRow[]>([]);
  let total = $state(0);
  let page = $state(1);
  let loading = $state(true);
  let error = $state('');

  // Server-side filters (entityType/entityId are supported by GET /audit-logs).
  let entityType = $state('');
  let entityId = $state('');
  // Client-side refinement over the loaded page.
  let actionFilter = $state('');
  let selected = $state<AuditRow | null>(null);

  const ACTION_TONE: Record<string, Tone> = {
    CREATE: 'ok',
    UPDATE: 'info',
    DELETE: 'danger',
    STATUS_CHANGE: 'warn',
    LOGIN: 'neutral',
  };
  const ACTION_LABEL: Record<string, string> = {
    CREATE: 'Création',
    UPDATE: 'Modification',
    DELETE: 'Suppression',
    STATUS_CHANGE: 'Changement de statut',
    LOGIN: 'Connexion',
  };
  function actionTone(a: string): Tone {
    return ACTION_TONE[a] ?? 'neutral';
  }
  function actionLabel(a: string): string {
    return ACTION_LABEL[a] ?? a;
  }

  const totalPages = $derived(Math.max(1, Math.ceil(total / PAGE_SIZE)));
  const visible = $derived(actionFilter ? rows.filter((r) => r.action === actionFilter) : rows);

  // Page-level signals — computed over the rows currently loaded, labelled honestly.
  const onPage = $derived(rows.length);
  const created = $derived(rows.filter((r) => r.action === 'CREATE').length);
  const updated = $derived(rows.filter((r) => r.action === 'UPDATE').length);
  const removed = $derived(rows.filter((r) => r.action === 'DELETE').length);
  const statusChanges = $derived(rows.filter((r) => r.action === 'STATUS_CHANGE').length);
  const actors = $derived(new Set(rows.map((r) => r.userId ?? 'system')).size);

  async function load() {
    loading = true;
    error = '';
    try {
      const result = await api<Paginated<AuditRow>>('/audit-logs', {
        query: {
          page,
          pageSize: PAGE_SIZE,
          entityType: entityType.trim() || undefined,
          entityId: entityId.trim() || undefined,
        },
      });
      rows = result.items;
      total = result.total;
    } catch (e) {
      error = e instanceof ApiError ? e.message : 'Échec du chargement du journal d’audit';
    } finally {
      loading = false;
    }
  }

  function applyFilters() {
    page = 1;
    void load();
  }
  function resetFilters() {
    entityType = '';
    entityId = '';
    actionFilter = '';
    page = 1;
    void load();
  }
  function go(delta: number) {
    const next = page + delta;
    if (next < 1 || next > totalPages) return;
    page = next;
    void load();
  }
  function focusEntity(type: string) {
    entityType = type;
    applyFilters();
  }

  function actorName(r: AuditRow): string {
    if (!r.user) return r.userId ? 'Utilisateur supprimé' : 'Système / agent';
    const name = `${r.user.firstName ?? ''} ${r.user.lastName ?? ''}`.trim();
    return name || r.user.email;
  }
  function when(iso: string): string {
    return new Date(iso).toLocaleString('fr-CA');
  }

  // --- before/after diffing for the detail panel ------------------------------
  function asRecord(v: unknown): Record<string, unknown> | null {
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  }
  function changedKeys(before: unknown, after: unknown): string[] {
    const b = asRecord(before);
    const a = asRecord(after);
    const keys = new Set<string>([...(b ? Object.keys(b) : []), ...(a ? Object.keys(a) : [])]);
    return [...keys]
      .filter((k) => JSON.stringify(b?.[k]) !== JSON.stringify(a?.[k]))
      .sort((x, y) => x.localeCompare(y));
  }
  function fmtVal(v: unknown): string {
    if (v === undefined) return '—';
    if (v === null) return 'null';
    if (typeof v === 'object') return JSON.stringify(v);
    return String(v);
  }
  function hasPayload(r: AuditRow): boolean {
    return r.before != null || r.after != null;
  }

  const detailKeys = $derived(selected ? changedKeys(selected.before, selected.after) : []);

  $effect(() => {
    if (canRead) void load();
    else loading = false;
  });
</script>

<svelte:head><title>Journal d’audit — Pulsar</title></svelte:head>

<PageHeader
  title="Journal d’audit"
  subtitle="Trace immuable de chaque création, modification, changement de statut et connexion sur ce tenant. Cliquez une ligne pour voir l’avant/après."
  count={total}
/>

{#if !canRead}
  <Card>
    <EmptyState
      title="Accès restreint"
      message="Vous n’avez pas la permission « core.audit.read ». Demandez-la à un administrateur du tenant."
    />
  </Card>
{:else}
  <ErrorNotice message={error} onretry={load} />

  <div class="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
    <Card>
      <div class="text-xs text-ink-faint">Événements (total)</div>
      <div class="mt-1 text-2xl font-bold text-ink">{total}</div>
      <div class="mt-1 text-[11px] text-ink-faint">{onPage} sur cette page</div>
    </Card>
    <Card>
      <div class="text-xs text-ink-faint">Créations</div>
      <div class="mt-1 text-2xl font-bold text-ok">{created}</div>
      <div class="mt-1 text-[11px] text-ink-faint">sur cette page</div>
    </Card>
    <Card>
      <div class="text-xs text-ink-faint">Modifications</div>
      <div class="mt-1 text-2xl font-bold text-info">{updated}</div>
      <div class="mt-1 text-[11px] text-ink-faint">sur cette page</div>
    </Card>
    <Card>
      <div class="text-xs text-ink-faint">Statut / suppressions</div>
      <div class="mt-1 text-2xl font-bold text-warn">{statusChanges + removed}</div>
      <div class="mt-1 text-[11px] text-ink-faint">{statusChanges} statut · {removed} suppr.</div>
    </Card>
    <Card>
      <div class="text-xs text-ink-faint">Acteurs distincts</div>
      <div class="mt-1 text-2xl font-bold text-ink">{actors}</div>
      <div class="mt-1 text-[11px] text-ink-faint">sur cette page</div>
    </Card>
  </div>

  <FilterBar>
    <div class="w-56">
      <input
        placeholder="Type d’entité (load, agent…)"
        bind:value={entityType}
        onkeydown={(e) => {
          if (e.key === 'Enter') applyFilters();
        }}
        class="w-full rounded-md border border-edge bg-surface px-3 py-1.5 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
      />
    </div>
    <div class="w-56">
      <input
        placeholder="ID d’entité"
        bind:value={entityId}
        onkeydown={(e) => {
          if (e.key === 'Enter') applyFilters();
        }}
        class="w-full rounded-md border border-edge bg-surface px-3 py-1.5 font-mono text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
      />
    </div>
    <div class="w-48">
      <Select bind:value={actionFilter}>
        <option value="">Toutes les actions</option>
        <option value="CREATE">Création</option>
        <option value="UPDATE">Modification</option>
        <option value="STATUS_CHANGE">Changement de statut</option>
        <option value="DELETE">Suppression</option>
        <option value="LOGIN">Connexion</option>
      </Select>
    </div>
    <Button variant="secondary" onclick={applyFilters}>Filtrer</Button>
    <Button variant="ghost" onclick={resetFilters}>Réinitialiser</Button>
  </FilterBar>

  {#if loading}
    <Card padded={false}><Skeleton rows={8} /></Card>
  {:else if visible.length === 0}
    <Card>
      <EmptyState
        title="Aucun événement"
        message={entityType || entityId || actionFilter
          ? 'Aucun événement ne correspond à ces filtres. Élargissez la recherche.'
          : 'Le journal d’audit se remplit dès qu’une donnée est créée ou modifiée.'}
      >
        {#snippet children()}
          {#if entityType || entityId || actionFilter}
            <Button variant="secondary" onclick={resetFilters}>Réinitialiser les filtres</Button>
          {/if}
        {/snippet}
      </EmptyState>
    </Card>
  {:else}
    <Table>
      {#snippet head()}
        <th>Horodatage</th><th>Action</th><th>Entité</th><th>Référence</th><th>Acteur</th><th></th>
      {/snippet}
      {#snippet body()}
        {#each visible as row (row.id)}
          <tr class="cursor-pointer hover:bg-surface-muted" onclick={() => (selected = row)}>
            <td class="whitespace-nowrap text-ink-muted">{when(row.createdAt)}</td>
            <td><Badge tone={actionTone(row.action)}>{actionLabel(row.action)}</Badge></td>
            <td>
              <button
                class="font-mono text-xs text-accent hover:underline"
                onclick={(e) => {
                  e.stopPropagation();
                  focusEntity(row.entityType);
                }}
                title="Filtrer sur ce type">{row.entityType}</button
              >
            </td>
            <td class="font-mono text-xs text-ink-faint"
              >{row.entityId ? row.entityId.slice(0, 12) : '—'}</td
            >
            <td class="text-ink">{actorName(row)}</td>
            <td class="text-right text-xs text-ink-faint">
              {#if hasPayload(row)}Détails →{/if}
            </td>
          </tr>
        {/each}
      {/snippet}
    </Table>

    <div class="mt-3 flex items-center justify-between text-sm text-ink-muted">
      <span>Page {page} / {totalPages} · {total} événements</span>
      <div class="flex gap-2">
        <Button variant="secondary" onclick={() => go(-1)} disabled={page <= 1}>Précédent</Button>
        <Button variant="secondary" onclick={() => go(1)} disabled={page >= totalPages}
          >Suivant</Button
        >
      </div>
    </div>
  {/if}
{/if}

<Modal open={selected !== null} size="lg" title="Détail de l’événement" onclose={() => (selected = null)}>
  {#snippet children()}
    {#if selected}
      <div class="space-y-4 text-sm">
        <div class="grid grid-cols-2 gap-3">
          <div>
            <div class="text-[11px] uppercase tracking-wide text-ink-faint">Action</div>
            <div class="mt-1">
              <Badge tone={actionTone(selected.action)}>{actionLabel(selected.action)}</Badge>
            </div>
          </div>
          <div>
            <div class="text-[11px] uppercase tracking-wide text-ink-faint">Horodatage</div>
            <div class="mt-1 text-ink">{when(selected.createdAt)}</div>
          </div>
          <div>
            <div class="text-[11px] uppercase tracking-wide text-ink-faint">Type d’entité</div>
            <div class="mt-1 font-mono text-xs text-ink">{selected.entityType}</div>
          </div>
          <div>
            <div class="text-[11px] uppercase tracking-wide text-ink-faint">Référence</div>
            <div class="mt-1 break-all font-mono text-xs text-ink">{selected.entityId ?? '—'}</div>
          </div>
          <div class="col-span-2">
            <div class="text-[11px] uppercase tracking-wide text-ink-faint">Acteur</div>
            <div class="mt-1 text-ink">
              {actorName(selected)}{selected.user ? ` · ${selected.user.email}` : ''}
            </div>
          </div>
        </div>

        {#if selected.before != null || selected.after != null}
          <div class="border-t border-edge pt-3">
            <div class="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
              {selected.before != null && selected.after != null
                ? 'Changements'
                : selected.after != null
                  ? 'Données créées'
                  : 'Données supprimées'}
            </div>
            {#if detailKeys.length === 0}
              <p class="text-xs text-ink-faint">Aucun champ comparable.</p>
            {:else}
              <div class="overflow-hidden rounded-lg border border-edge">
                <table class="w-full text-left text-xs">
                  <thead class="bg-surface-muted text-ink-faint">
                    <tr
                      ><th class="px-2 py-1.5 font-medium">Champ</th><th
                        class="px-2 py-1.5 font-medium">Avant</th
                      ><th class="px-2 py-1.5 font-medium">Après</th></tr
                    >
                  </thead>
                  <tbody>
                    {#each detailKeys as key (key)}
                      {@const b = asRecord(selected.before)?.[key]}
                      {@const a = asRecord(selected.after)?.[key]}
                      <tr class="border-t border-edge-soft align-top">
                        <td class="px-2 py-1.5 font-mono text-ink">{key}</td>
                        <td class="px-2 py-1.5 break-all text-danger/80">{fmtVal(b)}</td>
                        <td class="px-2 py-1.5 break-all text-ok">{fmtVal(a)}</td>
                      </tr>
                    {/each}
                  </tbody>
                </table>
              </div>
            {/if}
          </div>

          <details class="border-t border-edge pt-3">
            <summary class="cursor-pointer text-xs font-semibold text-ink-muted hover:text-ink"
              >Charge utile brute (JSON)</summary
            >
            <pre
              class="mt-2 max-h-72 overflow-auto rounded-lg bg-surface-muted p-3 text-[11px] leading-relaxed text-ink-muted">{JSON.stringify(
                { before: selected.before, after: selected.after },
                null,
                2,
              )}</pre>
          </details>
        {:else}
          <p class="border-t border-edge pt-3 text-xs text-ink-faint">
            Cet événement ne porte pas de charge avant/après (ex. connexion).
          </p>
        {/if}
      </div>
    {/if}
  {/snippet}
</Modal>
