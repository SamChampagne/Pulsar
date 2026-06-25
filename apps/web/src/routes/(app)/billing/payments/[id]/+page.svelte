<script lang="ts">
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { api, ApiError } from '$lib/api/client';
  import { toast } from '$lib/stores/toast';
  import { formatDate, formatMoney } from '$lib/format';
  import {
    PageHeader,
    Button,
    Card,
    Badge,
    Skeleton,
    ErrorNotice,
    type Tone,
  } from '$lib/components/ui';

  // ── Types ─────────────────────────────────────────────────────────────────────

  type PaymentStatus = 'DRAFT' | 'SUBMITTED' | 'CANCELLED';
  type PaymentType = 'RECEIVE' | 'PAY';

  interface AllocationRow {
    id: string;
    targetType: string;
    targetId: string;
    amount: string | number;
  }

  interface Payment {
    id: string;
    paymentNumber: string;
    type: PaymentType;
    partyType: string;
    partyId: string;
    date: string;
    totalAmount: string | number;
    currency: string;
    reference: string | null;
    note: string | null;
    status: PaymentStatus;
    modeOfPayment: { id: string; name: string } | null;
    allocations: AllocationRow[];
  }

  // ── State ─────────────────────────────────────────────────────────────────────

  let payment = $state<Payment | null>(null);
  let loading = $state(true);
  let notFound = $state(false);
  let error = $state('');
  let busy = $state(false);

  // ── Derived ───────────────────────────────────────────────────────────────────

  const paymentId = $derived(page.params.id as string);

  // ── Data loading ─────────────────────────────────────────────────────────────

  async function load() {
    loading = true;
    error = '';
    notFound = false;
    try {
      payment = await api<Payment>(`/billing/payments/${paymentId}`);
    } catch (e) {
      if (e instanceof ApiError && e.statusCode === 404) {
        notFound = true;
      } else {
        error = e instanceof ApiError ? e.message : 'Impossible de charger le paiement';
      }
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    void paymentId;
    void load();
  });

  // ── Actions ───────────────────────────────────────────────────────────────────

  async function doSubmit() {
    if (!payment) return;
    busy = true;
    try {
      await api(`/billing/payments/${payment.id}/submit`, { method: 'POST' });
      toast.success('Paiement soumis.');
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Erreur lors de la soumission');
    } finally {
      busy = false;
    }
  }

  async function doCancel() {
    if (!payment) return;
    busy = true;
    try {
      await api(`/billing/payments/${payment.id}/cancel`, { method: 'POST' });
      toast.success('Paiement annulé.');
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Erreur lors de l'annulation");
    } finally {
      busy = false;
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────────

  const STATUS_LABELS: Record<PaymentStatus, string> = {
    DRAFT: 'Brouillon',
    SUBMITTED: 'Soumis',
    CANCELLED: 'Annulé',
  };

  const STATUS_TONES: Record<PaymentStatus, Tone> = {
    DRAFT: 'neutral',
    SUBMITTED: 'warn',
    CANCELLED: 'danger',
  };

  function statusLabel(status: PaymentStatus): string {
    return STATUS_LABELS[status] ?? status;
  }

  function statusTone(status: PaymentStatus): Tone {
    return STATUS_TONES[status] ?? 'neutral';
  }

  function typeTone(t: PaymentType): Tone {
    return t === 'RECEIVE' ? 'ok' : 'info';
  }

  function typeLabel(t: PaymentType): string {
    return t === 'RECEIVE' ? 'Encaissement' : 'Décaissement';
  }
</script>

{#if loading}
  <PageHeader title="Chargement…" />
  <Card padded={false}><Skeleton rows={8} /></Card>
{:else if notFound}
  <PageHeader title="Paiement introuvable" />
  <ErrorNotice message="Ce paiement n'existe pas ou vous n'y avez pas accès." />
  <div class="mt-4">
    <Button variant="secondary" onclick={() => goto('/billing/payments')}>
      ← Retour aux paiements
    </Button>
  </div>
{:else if error}
  <PageHeader title="Erreur" />
  <ErrorNotice message={error} onretry={load} />
{:else if payment}
  <!-- ── Hero ──────────────────────────────────────────────────────────────────── -->
  <div class="mb-6 flex items-start justify-between gap-4">
    <div class="min-w-0">
      <div class="mb-1">
        <Button variant="secondary" onclick={() => goto('/billing/payments')}>
          ← Paiements
        </Button>
      </div>
      <h1 class="mt-2 font-mono text-2xl font-bold text-ink">{payment.paymentNumber}</h1>
      <div class="mt-1 flex flex-wrap items-center gap-2">
        <Badge tone={statusTone(payment.status)}>{statusLabel(payment.status)}</Badge>
        <Badge tone={typeTone(payment.type)}>{typeLabel(payment.type)}</Badge>
      </div>
    </div>
  </div>

  <div class="grid grid-cols-1 gap-6 lg:grid-cols-3">
    <!-- ── Main column ── -->
    <div class="space-y-6 lg:col-span-2">

      <!-- Payment info -->
      <Card>
        <h2 class="mb-3 text-sm font-semibold text-ink">Informations</h2>
        <div class="grid grid-cols-2 gap-4 text-xs sm:grid-cols-3">
          <div>
            <div class="mb-0.5 font-semibold uppercase tracking-wide text-ink-muted">Statut</div>
            <Badge tone={statusTone(payment.status)}>{statusLabel(payment.status)}</Badge>
          </div>
          <div>
            <div class="mb-0.5 font-semibold uppercase tracking-wide text-ink-muted">Type</div>
            <Badge tone={typeTone(payment.type)}>{typeLabel(payment.type)}</Badge>
          </div>
          <div>
            <div class="mb-0.5 font-semibold uppercase tracking-wide text-ink-muted">Date</div>
            <div class="text-ink">{formatDate(payment.date)}</div>
          </div>
          <div>
            <div class="mb-0.5 font-semibold uppercase tracking-wide text-ink-muted">Montant</div>
            <div class="text-base font-semibold text-accent">
              {formatMoney(payment.totalAmount, payment.currency)}
            </div>
          </div>
          <div>
            <div class="mb-0.5 font-semibold uppercase tracking-wide text-ink-muted">Partie</div>
            <div class="text-ink">{payment.partyType} · {payment.partyId.slice(0, 8)}…</div>
          </div>
          <div>
            <div class="mb-0.5 font-semibold uppercase tracking-wide text-ink-muted">Mode</div>
            <div class="text-ink">{payment.modeOfPayment?.name ?? '—'}</div>
          </div>
          {#if payment.reference}
            <div>
              <div class="mb-0.5 font-semibold uppercase tracking-wide text-ink-muted">Référence</div>
              <div class="font-mono text-xs text-ink">{payment.reference}</div>
            </div>
          {/if}
          {#if payment.note}
            <div class="col-span-2 sm:col-span-3">
              <div class="mb-0.5 font-semibold uppercase tracking-wide text-ink-muted">Note</div>
              <div class="text-ink">{payment.note}</div>
            </div>
          {/if}
        </div>
      </Card>

      <!-- Allocations table -->
      <Card>
        <h2 class="mb-3 text-sm font-semibold text-ink">
          Allocations ({payment.allocations.length})
        </h2>
        {#if payment.allocations.length === 0}
          <p class="text-xs text-ink-faint">Aucune allocation.</p>
        {:else}
          <div class="overflow-x-auto">
            <table class="w-full text-xs">
              <thead>
                <tr class="border-b border-edge text-[11px] uppercase tracking-wide text-ink-muted">
                  <th class="py-2 pr-3 text-left font-semibold">Type cible</th>
                  <th class="py-2 px-2 text-left font-semibold">ID cible</th>
                  <th class="py-2 pl-3 text-right font-semibold w-32">Montant</th>
                </tr>
              </thead>
              <tbody>
                {#each payment.allocations as alloc (alloc.id)}
                  <tr class="border-b border-edge/50 last:border-0">
                    <td class="py-2 pr-3 text-ink">{alloc.targetType}</td>
                    <td class="py-2 px-2 font-mono text-ink-muted">{alloc.targetId}</td>
                    <td class="py-2 pl-3 text-right font-semibold text-ink">
                      {formatMoney(alloc.amount, payment.currency)}
                    </td>
                  </tr>
                {/each}
              </tbody>
              <tfoot>
                <tr class="border-t border-edge">
                  <td colspan="2" class="py-2 pr-3 text-right text-[11px] uppercase tracking-wide font-semibold text-ink-muted">
                    Total alloué
                  </td>
                  <td class="py-2 pl-3 text-right text-sm font-bold text-accent">
                    {formatMoney(
                      payment.allocations.reduce((s, a) => s + Number(a.amount), 0),
                      payment.currency,
                    )}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        {/if}
      </Card>
    </div>

    <!-- ── Right column ── -->
    <div class="space-y-6">

      <!-- Actions -->
      {#if payment.status === 'DRAFT' || payment.status === 'SUBMITTED'}
        <Card>
          <h2 class="mb-2 text-sm font-semibold text-ink">Actions</h2>
          <div class="space-y-2">
            {#if payment.status === 'DRAFT'}
              <Button
                variant="primary"
                loading={busy}
                onclick={() => void doSubmit()}
              >
                Soumettre
              </Button>
            {/if}
            <Button
              variant="secondary"
              loading={busy}
              onclick={() => void doCancel()}
            >
              Annuler le paiement
            </Button>
          </div>
        </Card>
      {/if}

      <!-- Navigation -->
      <Card>
        <h2 class="mb-2 text-sm font-semibold text-ink">Navigation</h2>
        <div class="space-y-2">
          <a
            href="/billing/payments"
            class="flex items-center gap-2 rounded-md border border-edge bg-surface px-3 py-2 text-xs text-ink transition-colors hover:border-accent hover:text-accent"
          >
            ← Tous les paiements
          </a>
          <a
            href="/billing/payments/new"
            class="flex items-center gap-2 rounded-md border border-edge bg-surface px-3 py-2 text-xs text-ink transition-colors hover:border-accent hover:text-accent"
          >
            + Nouvelle écriture
          </a>
        </div>
      </Card>
    </div>
  </div>
{/if}
