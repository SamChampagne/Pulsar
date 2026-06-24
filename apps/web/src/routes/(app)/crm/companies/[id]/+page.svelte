<script lang="ts">
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { api, ApiError } from '$lib/api/client';
  import { toast } from '$lib/stores/toast';
  import { formatDate } from '$lib/format';
  import {
    PageHeader,
    Button,
    Badge,
    Card,
    Skeleton,
    ErrorNotice,
    type Tone,
  } from '$lib/components/ui';
  import ActivityTimeline from '$lib/components/crm/ActivityTimeline.svelte';
  import type { Activity } from '$lib/components/crm/ActivityTimeline.svelte';
  import LogActivity from '$lib/components/crm/LogActivity.svelte';
  import RecordEmails from '$lib/components/crm/RecordEmails.svelte';

  // ── Types ───────────────────────────────────────────────────────────────────

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
    amount: string | number | null; // Decimal comes as string from API
    currency: string;
    convertedCustomerId: string | null;
  }

  interface CompanyDetail {
    id: string;
    name: string;
    domain: string | null;
    industry: string | null;
    status: string;
    ownerUserId: string | null;
    customerId: string | null;
    carrierId: string | null;
    createdAt: string;
    contacts: ContactRow[];
    deals: DealRow[];
    activities: Activity[];
  }

  // ── State ────────────────────────────────────────────────────────────────────

  let company = $state<CompanyDetail | null>(null);
  let loading = $state(true);
  let notFound = $state(false);
  let error = $state('');
  let converting = $state<string | null>(null);

  // ── Data loading ─────────────────────────────────────────────────────────────

  async function load() {
    loading = true;
    error = '';
    notFound = false;
    try {
      company = await api<CompanyDetail>(`/crm/companies/${page.params.id}`);
    } catch (e) {
      if (e instanceof ApiError && e.statusCode === 404) {
        notFound = true;
      } else {
        error = e instanceof ApiError ? e.message : 'Impossible de charger la société';
      }
    } finally {
      loading = false;
    }
  }

  async function refresh() {
    if (!company) return;
    try {
      company = await api<CompanyDetail>(`/crm/companies/${company.id}`);
    } catch {
      // non-blocking
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
      toast.success(`Client créé (ID : ${result.customerId})`);
      await refresh();
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
      case 'WON':       return 'ok';
      case 'LOST':      return 'danger';
      case 'PROPOSAL':  return 'warn';
      case 'QUALIFIED': return 'info';
      default:          return 'neutral';
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

  function formatAmount(amount: string | number | null, currency: string): string {
    if (amount == null) return '—';
    return new Intl.NumberFormat('fr-CA', {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    }).format(Number(amount));
  }

  function unconvertedWonDeals(deals: DealRow[]): DealRow[] {
    return deals.filter((d) => d.stage === 'WON' && !d.convertedCustomerId);
  }

  // ── Threads (conversations) ──────────────────────────────────────────────────

  interface ThreadRow {
    id: string;
    subject: string;
    status: string;
    lastMessageAt: string;
    messageCount: number;
  }

  let threads = $state<ThreadRow[]>([]);
  let threadsLoading = $state(false);
  let threadsError = $state('');

  async function loadThreads(companyId: string) {
    threadsLoading = true;
    threadsError = '';
    try {
      const result = await api<{ items: ThreadRow[] }>('/crm/threads', {
        query: { companyId },
      });
      threads = result.items;
    } catch (e) {
      threadsError = e instanceof ApiError ? e.message : 'Impossible de charger les conversations';
    } finally {
      threadsLoading = false;
    }
  }

  function threadStatusTone(status: string): Tone {
    switch (status) {
      case 'UNLINKED': return 'warn';
      case 'LINKED':   return 'ok';
      case 'ARCHIVED': return 'neutral';
      default:         return 'neutral';
    }
  }

  function threadStatusLabel(status: string): string {
    switch (status) {
      case 'UNLINKED': return 'À trier';
      case 'LINKED':   return 'Rattaché';
      case 'ARCHIVED': return 'Archivé';
      default:         return status;
    }
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

  // ── Init ─────────────────────────────────────────────────────────────────────

  $effect(() => {
    void load();
  });

  $effect(() => {
    if (company) void loadThreads(company.id);
  });
</script>

{#if loading}
  <PageHeader title="Chargement…" />
  <Card padded={false}><Skeleton rows={10} /></Card>
{:else if notFound}
  <PageHeader title="Société introuvable" />
  <ErrorNotice message="Cette société n'existe pas ou vous n'y avez pas accès." />
  <div class="mt-4">
    <Button variant="secondary" onclick={() => goto('/crm/companies')}>
      ← Retour aux sociétés
    </Button>
  </div>
{:else if error}
  <PageHeader title="Erreur" />
  <ErrorNotice message={error} onretry={load} />
{:else if company}
  <!-- ── Hero ── -->
  <div class="mb-6 flex items-start justify-between gap-4">
    <div class="min-w-0">
      <div class="mb-1 flex items-center gap-2">
        <Button variant="secondary" onclick={() => goto('/crm/companies')}>
          ← Sociétés
        </Button>
      </div>
      <h1 class="mt-2 text-2xl font-bold text-ink">{company.name}</h1>
      <div class="mt-1 flex flex-wrap items-center gap-2">
        <Badge tone={statusTone(company.status)}>{statusLabel(company.status)}</Badge>
        {#if company.domain}
          <span class="text-sm text-ink-muted">{company.domain}</span>
        {/if}
        {#if company.industry}
          <span class="text-sm text-ink-muted">· {company.industry}</span>
        {/if}
      </div>
    </div>
  </div>

  <div class="grid grid-cols-1 gap-6 lg:grid-cols-3">
    <!-- ── Left column: hero fields + contacts + deals ── -->
    <div class="space-y-6 lg:col-span-2">

      <!-- Company meta -->
      <Card>
        <h2 class="mb-3 text-sm font-semibold text-ink">Informations</h2>
        <div class="grid grid-cols-2 gap-4 text-xs sm:grid-cols-3">
          <div>
            <div class="mb-0.5 font-semibold uppercase tracking-wide text-ink-muted">Statut</div>
            <Badge tone={statusTone(company.status)}>{statusLabel(company.status)}</Badge>
          </div>
          {#if company.domain}
            <div>
              <div class="mb-0.5 font-semibold uppercase tracking-wide text-ink-muted">Domaine</div>
              <div class="text-ink">{company.domain}</div>
            </div>
          {/if}
          {#if company.industry}
            <div>
              <div class="mb-0.5 font-semibold uppercase tracking-wide text-ink-muted">Secteur</div>
              <div class="text-ink">{company.industry}</div>
            </div>
          {/if}
          {#if company.ownerUserId}
            <div>
              <div class="mb-0.5 font-semibold uppercase tracking-wide text-ink-muted">Responsable</div>
              <div class="font-mono text-xs text-ink">{company.ownerUserId.slice(0, 8)}…</div>
            </div>
          {/if}
          {#if company.customerId}
            <div>
              <div class="mb-0.5 font-semibold uppercase tracking-wide text-ink-muted">Client lié</div>
              <div class="font-mono text-xs text-accent">{company.customerId.slice(0, 8)}…</div>
            </div>
          {/if}
          {#if company.carrierId}
            <div>
              <div class="mb-0.5 font-semibold uppercase tracking-wide text-ink-muted">Transporteur lié</div>
              <div class="font-mono text-xs text-accent">{company.carrierId.slice(0, 8)}…</div>
            </div>
          {/if}
          <div>
            <div class="mb-0.5 font-semibold uppercase tracking-wide text-ink-muted">Créé le</div>
            <div class="text-ink">{formatDate(company.createdAt)}</div>
          </div>
        </div>
      </Card>

      <!-- Unconverted WON deals banner -->
      {#if unconvertedWonDeals(company.deals).length > 0}
        <div class="rounded-md border border-ok bg-ok-soft/20 px-4 py-3">
          <p class="mb-2 text-sm font-semibold text-ok">
            {unconvertedWonDeals(company.deals).length} affaire(s) gagnée(s) prête(s) à convertir
          </p>
          {#each unconvertedWonDeals(company.deals) as deal (deal.id)}
            <div class="mb-1 flex items-center justify-between gap-3">
              <span class="truncate text-sm text-ink">{deal.title}</span>
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
      <Card>
        <h2 class="mb-3 text-sm font-semibold text-ink">
          Contacts ({company.contacts.length})
        </h2>
        {#if company.contacts.length === 0}
          <p class="text-xs text-ink-faint">Aucun contact associé.</p>
        {:else}
          <ul class="space-y-2">
            {#each company.contacts as c (c.id)}
              <li class="rounded-md border border-edge bg-surface-muted px-3 py-2.5 text-xs">
                <div class="font-semibold text-ink">{c.name}</div>
                {#if c.title}<div class="text-ink-muted">{c.title}</div>{/if}
                <div class="mt-1 flex flex-wrap gap-3">
                  {#if c.email}
                    <a href="mailto:{c.email}" class="text-accent hover:underline">{c.email}</a>
                  {/if}
                  {#if c.phone}
                    <span class="font-mono text-ink-muted">{c.phone}</span>
                  {/if}
                </div>
              </li>
            {/each}
          </ul>
        {/if}
      </Card>

      <!-- Deals -->
      <Card>
        <h2 class="mb-3 text-sm font-semibold text-ink">
          Affaires ({company.deals.length})
        </h2>
        {#if company.deals.length === 0}
          <p class="text-xs text-ink-faint">Aucune affaire associée.</p>
        {:else}
          <ul class="space-y-2">
            {#each company.deals as deal (deal.id)}
              <li class="flex items-center justify-between gap-3 rounded-md border border-edge bg-surface-muted px-3 py-2.5 text-xs">
                <div class="min-w-0">
                  <div class="truncate font-semibold text-ink">{deal.title}</div>
                  <div class="text-ink-muted">{formatAmount(deal.amount, deal.currency)}</div>
                  {#if deal.convertedCustomerId}
                    <div class="mt-0.5 text-[10px] text-ok">
                      Converti · client {deal.convertedCustomerId.slice(0, 8)}…
                    </div>
                  {/if}
                </div>
                <Badge tone={stageTone(deal.stage)}>{stageLabel(deal.stage)}</Badge>
              </li>
            {/each}
          </ul>
        {/if}
      </Card>
      <!-- Conversations -->
      <Card>
        <div class="mb-3 flex items-center justify-between gap-2">
          <h2 class="text-sm font-semibold text-ink">Conversations</h2>
          <a href="/crm/inbox" class="text-xs text-accent hover:underline">Voir la boîte →</a>
        </div>
        {#if threadsLoading}
          <Skeleton rows={3} />
        {:else if threadsError}
          <p class="text-xs text-danger">{threadsError}</p>
        {:else if threads.length === 0}
          <p class="text-xs text-ink-faint">Aucune conversation rattachée.</p>
        {:else}
          <ul class="space-y-2">
            {#each threads as thread (thread.id)}
              <li class="rounded-md border border-edge bg-surface-muted px-3 py-2.5 text-xs">
                <div class="flex items-start justify-between gap-2">
                  <div class="min-w-0 flex-1">
                    <div class="truncate font-semibold text-ink">{thread.subject || '(sans objet)'}</div>
                    <div class="mt-0.5 text-ink-faint">{relativeTime(thread.lastMessageAt)}</div>
                  </div>
                  <div class="flex shrink-0 flex-col items-end gap-1">
                    {#if thread.messageCount > 1}
                      <span class="rounded-full bg-surface px-1.5 py-0.5 font-mono text-[10px] font-semibold text-ink-muted">{thread.messageCount}</span>
                    {/if}
                    <Badge tone={threadStatusTone(thread.status)}>{threadStatusLabel(thread.status)}</Badge>
                  </div>
                </div>
              </li>
            {/each}
          </ul>
        {/if}
      </Card>
    </div>

    <!-- ── Right column: activity timeline + log + emails ── -->
    <div class="space-y-6">
      <Card>
        <h2 class="mb-3 text-sm font-semibold text-ink">Activités</h2>
        <ActivityTimeline activities={company.activities} />
      </Card>

      <Card>
        <h2 class="mb-3 text-sm font-semibold text-ink">Enregistrer une activité</h2>
        <LogActivity
          companyId={company.id}
          onLogged={() => void refresh()}
        />
      </Card>

      <RecordEmails
        relatedType="crm-company"
        relatedId={company.id}
        defaultTo={company.contacts[0]?.email ?? undefined}
      />
    </div>
  </div>
{/if}
