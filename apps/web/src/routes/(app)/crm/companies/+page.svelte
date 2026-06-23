<script lang="ts">
  import type { Paginated } from '@pulsar/shared';
  import { api, ApiError } from '$lib/api/client';
  import { toast } from '$lib/stores/toast';
  import { formatDate } from '$lib/format';
  import {
    PageHeader,
    Button,
    FilterBar,
    Select,
    Table,
    Badge,
    EmptyState,
    Card,
    Skeleton,
    ErrorNotice,
    type Tone,
  } from '$lib/components/ui';
  import { untrack } from 'svelte';
  import ActivityTimeline from '$lib/components/crm/ActivityTimeline.svelte';
  import type { Activity } from '$lib/components/crm/ActivityTimeline.svelte';
  import LogActivity from '$lib/components/crm/LogActivity.svelte';

  // ── Types ───────────────────────────────────────────────────────────────────

  interface CompanyRow {
    id: string;
    name: string;
    domain: string | null;
    industry: string | null;
    status: string;
    ownerUserId: string | null;
    customerId: string | null;
    createdAt: string;
  }

  interface ContactRow {
    id: string;
    name: string;
    title: string | null;
    email: string | null;
    phone: string | null;
  }

  interface DealRow {
    id: string;
    title: string;
    stage: string;
    amount: number | null;
    currency: string;
    convertedCustomerId: string | null;
  }

  interface CompanyDetail extends CompanyRow {
    contacts: ContactRow[];
    deals: DealRow[];
    activities: Activity[];
  }

  // ── State — list ─────────────────────────────────────────────────────────────

  let companies = $state<CompanyRow[]>([]);
  let total = $state(0);
  let page = $state(1);
  const pageSize = 25;
  const totalPages = $derived(Math.max(1, Math.ceil(total / pageSize)));
  let search = $state('');
  let statusFilter = $state('');
  let loading = $state(true);
  let error = $state('');

  // ── State — detail panel ─────────────────────────────────────────────────────

  let selected = $state<CompanyDetail | null>(null);
  let detailLoading = $state(false);
  let converting = $state<string | null>(null); // dealId being converted

  // ── Data loading ─────────────────────────────────────────────────────────────

  async function load() {
    loading = true;
    error = '';
    try {
      const result = await api<Paginated<CompanyRow>>('/crm/companies', {
        query: { search, page, pageSize, status: statusFilter || undefined },
      });
      companies = result.items;
      total = result.total;
    } catch (e) {
      error = e instanceof ApiError ? e.message : 'Impossible de charger les sociétés';
    } finally {
      loading = false;
    }
  }

  async function openDetail(company: CompanyRow) {
    selected = null;
    detailLoading = true;
    try {
      const full = await api<CompanyDetail>(`/crm/companies/${company.id}`);
      selected = full;
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Impossible de charger la société');
    } finally {
      detailLoading = false;
    }
  }

  async function refreshDetail() {
    if (!selected) return;
    try {
      const full = await api<CompanyDetail>(`/crm/companies/${selected.id}`);
      selected = full;
    } catch {
      // non-blocking refresh
    }
  }

  // ── Convert deal ─────────────────────────────────────────────────────────────

  async function convertDeal(dealId: string) {
    converting = dealId;
    try {
      const result = await api<{ dealId: string; customerId: string }>(
        `/crm/deals/${dealId}/convert`,
        { method: 'POST' },
      );
      toast.success(`Client créé (ID: ${result.customerId})`);
      await refreshDetail();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Erreur lors de la conversion');
    } finally {
      converting = null;
    }
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────

  function statusTone(status: string): Tone {
    switch (status) {
      case 'ACTIVE':   return 'ok';
      case 'PROSPECT': return 'info';
      case 'INACTIVE': return 'neutral';
      default:         return 'neutral';
    }
  }

  function statusLabel(status: string): string {
    switch (status) {
      case 'ACTIVE':   return 'Actif';
      case 'PROSPECT': return 'Prospect';
      case 'INACTIVE': return 'Inactif';
      default:         return status;
    }
  }

  function stageTone(stage: string): Tone {
    switch (stage) {
      case 'WON':      return 'ok';
      case 'LOST':     return 'danger';
      case 'PROPOSAL': return 'warn';
      case 'QUALIFIED': return 'info';
      default:         return 'neutral';
    }
  }

  function stageLabel(stage: string): string {
    switch (stage) {
      case 'LEAD':      return 'Prospect';
      case 'QUALIFIED': return 'Qualifié';
      case 'PROPOSAL':  return 'Proposition';
      case 'WON':       return 'Gagné';
      case 'LOST':      return 'Perdu';
      default:          return stage;
    }
  }

  function formatAmount(amount: number | null, currency: string): string {
    if (amount == null) return '—';
    return new Intl.NumberFormat('fr-CA', { style: 'currency', currency, maximumFractionDigits: 0 }).format(amount);
  }

  /** A WON deal that has not yet been converted. */
  function unconvertedWonDeals(deals: DealRow[]): DealRow[] {
    return deals.filter((d) => d.stage === 'WON' && !d.convertedCustomerId);
  }

  // ── Reactive load ─────────────────────────────────────────────────────────────
  // Single effect: tracks filters, resets to page 1, fires exactly one load.
  // Pagination buttons call load() directly and are not tracked here.
  $effect(() => {
    const _s = search;
    const _sf = statusFilter;
    untrack(() => {
      page = 1;
      void load();
    });
  });
</script>

<PageHeader title="Sociétés" subtitle="Gérez vos prospects et clients CRM." count={total} />

<ErrorNotice message={error} onretry={load} />

<FilterBar>
  <div class="w-64">
    <input
      placeholder="Rechercher par nom…"
      bind:value={search}
      onkeydown={(e) => { if (e.key === 'Enter') void load(); }}
      class="w-full rounded-md border border-edge bg-surface px-3 py-1.5 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
    />
  </div>
  <div class="w-40">
    <Select bind:value={statusFilter}>
      <option value="">Tous les statuts</option>
      <option value="PROSPECT">Prospect</option>
      <option value="ACTIVE">Actif</option>
      <option value="INACTIVE">Inactif</option>
    </Select>
  </div>
</FilterBar>

<!-- List / panel layout -->
<div class={`flex gap-4 ${selected || detailLoading ? 'items-start' : ''}`}>
  <!-- ── List ── -->
  <div class={`min-w-0 flex-1 transition-all ${selected || detailLoading ? 'max-w-[55%]' : ''}`}>
    {#if loading}
      <Card padded={false}><Skeleton rows={6} /></Card>
    {:else if companies.length === 0}
      <Card>
        <EmptyState message="Aucune société pour le moment." />
      </Card>
    {:else}
      <Table>
        {#snippet head()}
          <th>Nom</th><th>Domaine</th><th>Secteur</th><th>Statut</th><th>Créé le</th>
        {/snippet}
        {#snippet body()}
          {#each companies as company (company.id)}
            <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
            <tr
              class={`cursor-pointer transition-colors hover:bg-surface-muted ${selected?.id === company.id ? 'bg-accent-soft/20' : ''}`}
              onclick={() => void openDetail(company)}
            >
              <td class="font-semibold text-ink">{company.name}</td>
              <td class="text-ink-muted">{company.domain ?? '—'}</td>
              <td class="text-ink-muted">{company.industry ?? '—'}</td>
              <td><Badge tone={statusTone(company.status)}>{statusLabel(company.status)}</Badge></td>
              <td class="text-ink-muted">{formatDate(company.createdAt)}</td>
            </tr>
          {/each}
        {/snippet}
      </Table>
    {/if}

    {#if total > pageSize}
      <div class="mt-3 flex items-center justify-between text-sm text-ink-muted">
        <span class="font-mono text-xs">
          {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} sur {total}
        </span>
        <div class="flex items-center gap-2">
          <Button
            variant="secondary"
            disabled={page <= 1}
            onclick={() => { page = Math.max(1, page - 1); void load(); }}
          >Précédent</Button>
          <span class="font-mono text-xs">Page {page} / {totalPages}</span>
          <Button
            variant="secondary"
            disabled={page >= totalPages}
            onclick={() => { page = Math.min(totalPages, page + 1); void load(); }}
          >Suivant</Button>
        </div>
      </div>
    {/if}
  </div>

  <!-- ── Detail panel ── -->
  {#if detailLoading}
    <div class="w-[42%] shrink-0">
      <Card padded={false}><Skeleton rows={8} /></Card>
    </div>
  {:else if selected}
    <div class="w-[42%] shrink-0">
      <Card>
        <!-- Panel header -->
        <div class="mb-4 flex items-start justify-between gap-2">
          <div class="min-w-0">
            <h2 class="truncate text-base font-bold text-ink">{selected.name}</h2>
            <Badge tone={statusTone(selected.status)}>{statusLabel(selected.status)}</Badge>
          </div>
          <div class="flex shrink-0 items-center gap-1">
            <a
              href="/crm/companies/{selected.id}"
              class="rounded px-2 py-1 text-xs font-medium text-accent hover:bg-surface-muted hover:underline"
              title="Ouvrir la fiche complète"
            >
              Ouvrir la fiche
            </a>
            <button
              class="rounded p-1 text-ink-faint hover:bg-surface-muted hover:text-ink"
              onclick={() => { selected = null; }}
              aria-label="Fermer"
            >✕</button>
          </div>
        </div>

        <!-- Company fields -->
        <div class="mb-4 grid grid-cols-2 gap-3 text-xs">
          {#if selected.domain}
            <div>
              <div class="mb-0.5 font-semibold uppercase tracking-wide text-ink-muted">Domaine</div>
              <div class="text-ink">{selected.domain}</div>
            </div>
          {/if}
          {#if selected.industry}
            <div>
              <div class="mb-0.5 font-semibold uppercase tracking-wide text-ink-muted">Secteur</div>
              <div class="text-ink">{selected.industry}</div>
            </div>
          {/if}
          <div>
            <div class="mb-0.5 font-semibold uppercase tracking-wide text-ink-muted">Créé le</div>
            <div class="text-ink">{formatDate(selected.createdAt)}</div>
          </div>
          {#if selected.customerId}
            <div>
              <div class="mb-0.5 font-semibold uppercase tracking-wide text-ink-muted">Client</div>
              <div class="font-mono text-accent text-xs">{selected.customerId.slice(0, 8)}…</div>
            </div>
          {/if}
        </div>

        <!-- Convert WON deals -->
        {#if unconvertedWonDeals(selected.deals).length > 0}
          <div class="mb-4 rounded-md border border-ok bg-ok-soft/20 px-3 py-2.5">
            <p class="mb-2 text-xs font-semibold text-ok">
              {unconvertedWonDeals(selected.deals).length} affaire(s) gagnée(s) prête(s) à convertir
            </p>
            {#each unconvertedWonDeals(selected.deals) as deal (deal.id)}
              <div class="mb-1 flex items-center justify-between gap-2">
                <span class="truncate text-xs text-ink">{deal.title}</span>
                <Button
                  variant="primary"
                  loading={converting === deal.id}
                  onclick={() => void convertDeal(deal.id)}
                >
                  Convertir en client
                </Button>
              </div>
            {/each}
          </div>
        {/if}

        <!-- Contacts -->
        <div class="mb-4">
          <div class="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
            Contacts ({selected.contacts.length})
          </div>
          {#if selected.contacts.length === 0}
            <p class="text-xs text-ink-faint">Aucun contact.</p>
          {:else}
            <ul class="space-y-1">
              {#each selected.contacts as c (c.id)}
                <li class="rounded-md border border-edge bg-surface-muted px-2.5 py-2 text-xs">
                  <div class="font-semibold text-ink">{c.name}</div>
                  {#if c.title}<div class="text-ink-muted">{c.title}</div>{/if}
                  {#if c.email}<div class="text-ink-faint">{c.email}</div>{/if}
                  {#if c.phone}<div class="text-ink-faint">{c.phone}</div>{/if}
                </li>
              {/each}
            </ul>
          {/if}
        </div>

        <!-- Deals -->
        <div class="mb-4">
          <div class="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
            Affaires ({selected.deals.length})
          </div>
          {#if selected.deals.length === 0}
            <p class="text-xs text-ink-faint">Aucune affaire.</p>
          {:else}
            <ul class="space-y-1">
              {#each selected.deals as deal (deal.id)}
                <li class="flex items-center justify-between gap-2 rounded-md border border-edge bg-surface-muted px-2.5 py-2 text-xs">
                  <div class="min-w-0">
                    <div class="truncate font-semibold text-ink">{deal.title}</div>
                    <div class="text-ink-muted">{formatAmount(deal.amount, deal.currency)}</div>
                  </div>
                  <Badge tone={stageTone(deal.stage)}>{stageLabel(deal.stage)}</Badge>
                </li>
              {/each}
            </ul>
          {/if}
        </div>

        <!-- Activity timeline -->
        <div class="mb-4">
          <div class="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
            Activités récentes
          </div>
          <ActivityTimeline activities={selected.activities} />
        </div>

        <!-- Log activity -->
        <div>
          <div class="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
            Enregistrer une activité
          </div>
          <LogActivity
            companyId={selected.id}
            onLogged={() => void refreshDetail()}
          />
        </div>
      </Card>
    </div>
  {/if}
</div>
