<script lang="ts">
  import CommunicationButton from '$lib/components/communications/CommunicationButton.svelte';
  import { untrack } from 'svelte';
  import { auth } from '$lib/stores/auth';
  import LineItemsEditor, { type LineItem } from '$lib/components/crm/LineItemsEditor.svelte';
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { api, ApiError } from '$lib/api/client';
  import { formatDate } from '$lib/format';
  import { PERMISSIONS } from '@pulsar/shared';
  import DealPipeline from '$lib/components/crm/DealPipeline.svelte';
  import {
    PageHeader,
    RecordHeader,
    RecordNav,
    RecordSection,
    Button,
    Badge,
    Card,
    Skeleton,
    ErrorNotice,
    type Tone,
  } from '$lib/components/ui';

  // ── Types ────────────────────────────────────────────────────────────────────

  interface DealDetail {
    id: string;
    title: string;
    stage: string;
    amount: string | number | null;
    currency: string;
    ownerUserId: string | null;
    expectedCloseDate: string | null;
    companyId: string;
    company: { id: string; name: string } | null;
    pipelineStage?: { id: string; name: string } | null;
    pipelineId?: string | null;
    pipelineStageId?: string | null;
    primaryContactId?: string | null;
    stageRevision?: number;
  }

  // ── State ────────────────────────────────────────────────────────────────────

  let deal = $state<DealDetail | null>(null);
  let loading = $state(true);
  let notFound = $state(false);
  let error = $state('');

  let lines = $state<LineItem[]>([]);
  let linesLoading = $state(false);
  let linesError = $state('');

  const canManage = $derived(!!$auth?.user.permissions.includes(PERMISSIONS.CRM.MANAGE));

  // Create sales order state
  let creatingOrder = $state(false);
  let createOrderError = $state('');

  // ── Data loading ─────────────────────────────────────────────────────────────

  async function loadDeal() {
    const id = page.params.id;
    loading = true;
    error = '';
    notFound = false;
    try {
      const result = await api<DealDetail>(`/crm/deals/${id}`);
      if (page.params.id !== id) return;
      deal = result;
      await loadLines();
    } catch (e) {
      if (page.params.id !== id) return;
      if (e instanceof ApiError && e.statusCode === 404) {
        notFound = true;
      } else {
        error = e instanceof ApiError ? e.message : "Impossible de charger l'affaire";
      }
    } finally {
      if (page.params.id === id) loading = false;
    }
  }

  async function loadLines() {
    if (!deal) return;
    const id = deal.id;
    linesLoading = true;
    linesError = '';
    try {
      const result = await api<LineItem[]>(`/crm/deals/${id}/line-items`);
      if (deal?.id === id) lines = result;
    } catch (e) {
      if (deal?.id !== id) return;
      linesError = e instanceof ApiError ? e.message : 'Impossible de charger les lignes';
    } finally {
      if (deal?.id === id) linesLoading = false;
    }
  }

  async function reloadAll() {
    if (!deal) return;
    const id = deal.id;
    linesError = '';
    // Reload both the deal header (amount changes) and the lines
    try {
      const [freshDeal, freshLines] = await Promise.all([
        api<DealDetail>(`/crm/deals/${deal.id}`),
        api<LineItem[]>(`/crm/deals/${deal.id}/line-items`),
      ]);
      if (deal?.id !== id) return;
      deal = freshDeal;
      lines = freshLines;
    } catch (e) {
      linesError = 'Données non actualisées. Rechargez les lignes avant de poursuivre.';
    }
  }

  // ── Create sales order ────────────────────────────────────────────────────────

  async function createSalesOrder() {
    if (!deal || creatingOrder || !canManage) return;
    creatingOrder = true;
    createOrderError = '';
    try {
      const created = await api<{ id: string }>(`/crm/deals/${deal.id}/create-sales-order`, {
        method: 'POST',
      });
      await goto(`/crm/sales-orders/${created.id}`);
    } catch (e) {
      createOrderError =
        e instanceof ApiError ? e.message : 'Erreur lors de la création de la commande';
    } finally {
      creatingOrder = false;
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────────

  function stageTone(stage: string): Tone {
    switch (stage) {
      case 'WON':
        return 'ok';
      case 'LOST':
        return 'danger';
      case 'PROPOSAL':
        return 'warn';
      case 'QUALIFIED':
        return 'info';
      default:
        return 'neutral';
    }
  }

  function stageLabel(stage: string): string {
    switch (stage) {
      case 'LEAD':
        return 'Prospect';
      case 'QUALIFIED':
        return 'Qualifié';
      case 'PROPOSAL':
        return 'Proposition';
      case 'WON':
        return 'Gagné';
      case 'LOST':
        return 'Perdu';
      default:
        return stage;
    }
  }

  function formatAmount(amount: string | number | null, currency: string): string {
    if (amount == null) return '—';
    const n = Number(amount);
    if (isNaN(n)) return '—';
    return new Intl.NumberFormat('fr-CA', {
      style: 'currency',
      currency: currency || 'CAD',
      maximumFractionDigits: 2,
    }).format(n);
  }

  // ── Init ─────────────────────────────────────────────────────────────────────

  $effect(() => {
    const id = page.params.id;
    untrack(() => {
      deal = null;
      lines = [];
      void loadDeal();
    });
  });
</script>

{#if loading}
  <PageHeader title="Chargement…" />
  <Card padded={false}><Skeleton rows={8} /></Card>
{:else if notFound}
  <PageHeader title="Affaire introuvable" />
  <ErrorNotice message="Cette affaire n'existe pas ou vous n'y avez pas accès." />
  <div class="mt-4">
    <Button variant="secondary" onclick={() => goto('/crm/deals')}>← Retour aux affaires</Button>
  </div>
{:else if error}
  <PageHeader title="Erreur" />
  <ErrorNotice message={error} onretry={loadDeal} />
{:else if deal}
  <RecordHeader
    title={deal!.title}
    kind="Opportunité"
    backHref="/crm/deals"
    backLabel="Opportunités"
  >
    {#snippet meta()}<Badge tone={stageTone(deal!.stage)}
        >{deal!.pipelineStage?.name ?? stageLabel(deal!.stage)}</Badge
      ><span class="font-mono">{formatAmount(deal!.amount, deal!.currency)}</span
      >{#if deal!.company}<a
          class="hover:text-ink hover:underline"
          href="/crm/companies/{deal!.company.id}">{deal!.company.name}</a
        >{/if}{/snippet}
    {#snippet actions()}<CommunicationButton access="crm/deals" entityId={deal!.id} /><Button
        variant="secondary"
        href="/crm/coach?dealId={deal!.id}">Coach IA</Button
      >{#if deal!.stage === 'WON' && canManage}<Button
          loading={creatingOrder}
          onclick={() => void createSalesOrder()}>Créer une commande</Button
        >{/if}{/snippet}
  </RecordHeader>
  <ErrorNotice message={createOrderError} />
  <RecordNav
    sections={[
      { id: 'record-pipeline', label: 'Pipeline et suivi' },
      { id: 'record-lines', label: 'Lignes' },
      { id: 'record-info', label: 'Informations' },
    ]}
  />
  <RecordSection id="record-pipeline" label="Pipeline et suivi"
    >{#key deal!.id}<DealPipeline {deal} onchanged={reloadAll} />{/key}</RecordSection
  >
  <div class="grid grid-cols-1 gap-6 lg:grid-cols-3">
    <!-- ── Left column ── -->
    <div class="space-y-6 lg:col-span-2">
      <RecordSection id="record-lines" label="Lignes">
        {#key deal!.id}<LineItemsEditor
            endpoint={`/crm/deals/${deal!.id}/line-items`}
            {lines}
            currency={deal!.currency}
            total={deal!.amount}
            editable={canManage}
            loading={linesLoading}
            error={linesError}
            onretry={reloadAll}
            onchanged={reloadAll}
          />{/key}
      </RecordSection>
    </div>

    <aside class="space-y-5">
      <RecordSection id="record-info" label="Informations">
        <Card>
          <h2 class="mb-3 text-sm font-semibold text-ink">Informations</h2>
          <div class="grid grid-cols-1 gap-3 text-sm">
            <div>
              <div class="mb-0.5 font-medium text-ink-muted">Étape</div>
              <Badge tone={stageTone(deal!.stage)}
                >{deal!.pipelineStage?.name ?? stageLabel(deal!.stage)}</Badge
              >
            </div>
            <div>
              <div class="mb-0.5 font-medium text-ink-muted">Montant total</div>
              <div class="text-base font-semibold text-accent">
                {formatAmount(deal!.amount, deal!.currency)}
              </div>
            </div>
            {#if deal!.company}
              <div>
                <div class="mb-0.5 font-medium text-ink-muted">Société</div>
                <a
                  href="/crm/companies/{deal!.company.id}"
                  class="text-ink hover:underline hover:text-accent"
                >
                  {deal!.company.name}
                </a>
              </div>
            {/if}
            {#if deal!.ownerUserId}
              <div>
                <div class="mb-0.5 font-medium text-ink-muted">Responsable</div>
                <div class="font-mono text-xs text-ink">{deal!.ownerUserId.slice(0, 8)}…</div>
              </div>
            {/if}
            {#if deal!.expectedCloseDate}
              <div>
                <div class="mb-0.5 font-medium text-ink-muted">Clôture prévue</div>
                <div class="text-ink">{formatDate(deal!.expectedCloseDate)}</div>
              </div>
            {/if}
          </div>
        </Card>
      </RecordSection>
    </aside>
  </div>
{/if}
