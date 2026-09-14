<script lang="ts">
  import { onDestroy } from 'svelte';
  import { PERMISSIONS } from '@pulsar/shared';
  import { api, ApiError } from '$lib/api/client';
  import { auth } from '$lib/stores/auth';
  import { formatDate, formatMoney } from '$lib/format';
  import {
    type Payment,
    postedPaymentTotals,
    paymentStatusLabel,
    paymentStatusTone,
    paymentTypeLabel,
  } from '$lib/billing/payments';
  import {
    PageHeader,
    Button,
    FilterBar,
    Select,
    Input,
    Table,
    Badge,
    EmptyState,
    Card,
    Skeleton,
    ErrorNotice,
  } from '$lib/components/ui';

  let payments = $state<Payment[]>([]);
  let statusFilter = $state('');
  let typeFilter = $state('');
  let search = $state('');
  let loading = $state(true);
  let error = $state('');
  let currentPage = $state(1);
  let generation = 0;
  const pageSize = 25;
  const canManage = $derived(
    !!$auth?.user.permissions.includes(PERMISSIONS.BILLING.PAYMENTS_MANAGE),
  );
  const filtered = $derived(
    payments.filter((p) =>
      [p.paymentNumber, p.party?.name, p.reference].some((v) =>
        v?.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()),
      ),
    ),
  );
  const totalPages = $derived(Math.max(1, Math.ceil(filtered.length / pageSize)));
  const visible = $derived(filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize));
  const totals = $derived(postedPaymentTotals(filtered));

  async function load(status = statusFilter, type = typeFilter) {
    const request = ++generation;
    loading = true;
    error = '';
    try {
      const result = await api<Payment[]>('/billing/payments', {
        query: { status: status || undefined, type: type || undefined },
      });
      if (request === generation) payments = result;
    } catch (e) {
      if (request === generation)
        error = e instanceof ApiError ? e.message : 'Impossible de charger les paiements.';
    } finally {
      if (request === generation) loading = false;
    }
  }
  $effect(() => {
    void load(statusFilter, typeFilter);
  });
  $effect(() => {
    void search;
    void statusFilter;
    void typeFilter;
    currentPage = 1;
  });
  onDestroy(() => {
    generation++;
  });
</script>

<PageHeader
  title="Paiements"
  subtitle="Des factures au grand livre : préparez, vérifiez, puis comptabilisez."
>
  {#snippet actions()}
    <Button variant="secondary" href="/invoices">Factures et relevés</Button>
    {#if canManage}<Button href="/billing/payments/new">Nouveau paiement</Button>{/if}
  {/snippet}
</PageHeader>

<FilterBar>
  <div class="min-w-40 flex-1">
    <Input
      bind:value={search}
      aria-label="Rechercher un paiement"
      placeholder="Numéro, client, transporteur, référence…"
    />
  </div>
  <div class="w-44">
    <Select bind:value={statusFilter} aria-label="Statut du paiement">
      <option value="">Tous les statuts</option><option value="DRAFT">Brouillon</option><option
        value="SUBMITTED">Comptabilisé</option
      ><option value="CANCELLED">Annulé</option>
    </Select>
  </div>
  <div class="w-44">
    <Select bind:value={typeFilter} aria-label="Type de paiement">
      <option value="">Tous les types</option><option value="RECEIVE">Encaissement</option><option
        value="PAY">Décaissement</option
      >
    </Select>
  </div>
</FilterBar>

<ErrorNotice message={error} onretry={() => load()} />
{#if loading}
  <Card padded={false}><Skeleton rows={6} /></Card>
{:else if !error}
  <div class="mb-4 flex flex-wrap items-center justify-between gap-2 text-xs text-ink-muted">
    <span
      >{filtered.length} paiement{filtered.length > 1 ? 's' : ''} dans cette vue · {filtered.filter(
        (p) => p.status === 'DRAFT',
      ).length} brouillon(s)</span
    >
    <span>Comptabilisé = allocations inscrites au grand livre.</span>
  </div>
  <Table>
    {#snippet head()}<th>Paiement</th><th>Client / transporteur</th><th>Date</th><th>Mode</th><th
        class="text-right">Montant déclaré</th
      ><th>Statut</th>{/snippet}
    {#snippet body()}
      {#each visible as payment (payment.id)}
        <tr>
          <td
            ><a
              class="font-mono font-medium text-accent hover:underline"
              href={`/billing/payments/${payment.id}`}>{payment.paymentNumber}</a
            >
            <div class="mt-1 text-xs text-ink-muted">{paymentTypeLabel[payment.type]}</div></td
          >
          <td
            ><span class="font-medium">{payment.party?.name ?? 'Partie indisponible'}</span
            >{#if payment.reference}<div class="mt-1 text-xs text-ink-muted">
                {payment.reference}
              </div>{/if}</td
          >
          <td class="whitespace-nowrap">{formatDate(payment.date)}</td>
          <td>{payment.modeOfPayment?.name ?? '—'}</td>
          <td class="whitespace-nowrap text-right font-mono"
            >{formatMoney(payment.totalAmount, payment.currency)}</td
          >
          <td
            ><Badge tone={paymentStatusTone[payment.status]}
              >{paymentStatusLabel[payment.status]}</Badge
            ></td
          >
        </tr>
      {:else}
        <tr
          ><td colspan="6"
            ><EmptyState
              title={search || statusFilter || typeFilter ? 'Aucun résultat' : 'Aucun paiement'}
              message={search || statusFilter || typeFilter
                ? 'Ajustez la recherche ou les filtres.'
                : 'Créez un brouillon à partir des factures ouvertes, puis vérifiez-le avant de le comptabiliser.'}
            /></td
          ></tr
        >
      {/each}
    {/snippet}
  </Table>
  {#if totalPages > 1}
    <nav
      aria-label="Pagination des paiements"
      class="mt-3 flex flex-wrap items-center justify-end gap-2"
    >
      <Button
        variant="secondary"
        disabled={currentPage <= 1}
        onclick={() => {
          currentPage--;
        }}>Précédent</Button
      >
      <span class="text-xs text-ink-muted">Page {currentPage} / {totalPages}</span>
      <Button
        variant="secondary"
        disabled={currentPage >= totalPages}
        onclick={() => {
          currentPage++;
        }}>Suivant</Button
      >
    </nav>
  {/if}
  {#if totals.length}
    <section
      aria-label="Montants comptabilisés dans cette vue"
      class="mt-6 border-t border-edge pt-4"
    >
      <h2 class="mb-3 text-sm font-medium text-ink">Allocations comptabilisées dans cette vue</h2>
      <div class="flex flex-wrap gap-x-10 gap-y-4">
        {#each totals as total (total.currency)}
          <dl class="min-w-48 space-y-1 text-sm">
            <dt class="mb-2 text-xs font-medium text-ink-muted">{total.currency}</dt>
            <div class="flex justify-between gap-6">
              <dt class="text-ink-muted">Encaissements</dt>
              <dd class="font-mono">{formatMoney(total.received, total.currency)}</dd>
            </div>
            <div class="flex justify-between gap-6">
              <dt class="text-ink-muted">Décaissements</dt>
              <dd class="font-mono">{formatMoney(total.paid, total.currency)}</dd>
            </div>
          </dl>
        {/each}
      </div>
    </section>
  {/if}
{/if}
