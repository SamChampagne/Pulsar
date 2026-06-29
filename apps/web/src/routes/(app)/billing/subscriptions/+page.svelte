<script lang="ts">
  import { api, ApiError } from '$lib/api/client';
  import { toast } from '$lib/stores/toast';
  import {
    PageHeader,
    Card,
    Table,
    Badge,
    Button,
    EmptyState,
    Skeleton,
    ErrorNotice,
    type Tone,
  } from '$lib/components/ui';

  // ── Local types aligned to the real API shapes ───────────────────────────────

  type SubscriptionStatus = 'ACTIVE' | 'PAUSED' | 'CANCELLED';
  type SubscriptionInterval = 'WEEKLY' | 'MONTHLY' | 'YEARLY';

  interface SubscriptionLine {
    id?: string;
    description: string;
    /** Decimal serialised as string by Prisma */
    amount: string;
  }

  interface SubscriptionCustomer {
    id: string;
    code: string;
    name: string;
  }

  /** Returned by GET /billing/subscriptions */
  interface Subscription {
    id: string;
    name: string;
    customerId: string;
    customer: SubscriptionCustomer;
    status: SubscriptionStatus;
    interval: SubscriptionInterval;
    startDate: string;
    nextRunDate: string;
    currency: string;
    lines: SubscriptionLine[];
  }

  /** Paginated list returned by GET /transportation/customers */
  interface CustomerItem {
    id: string;
    code: string;
    name: string;
  }

  interface Paginated<T> {
    items: T[];
    total: number;
    page: number;
    pageSize: number;
  }

  /** run-due result */
  interface RunDueResult {
    generated: number;
    skipped: number;
    errors: number;
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────

  function money(val: string | number | null | undefined): string {
    if (val === null || val === undefined) return '—';
    const n = Number(val);
    if (isNaN(n)) return '—';
    return n.toLocaleString('fr-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function periodTotal(lines: SubscriptionLine[]): number {
    return lines.reduce((acc, l) => acc + Number(l.amount), 0);
  }

  function fmtDate(iso: string | null | undefined): string {
    if (!iso) return '—';
    return iso.slice(0, 10);
  }

  function statusTone(status: SubscriptionStatus): Tone {
    if (status === 'ACTIVE') return 'ok';
    if (status === 'PAUSED') return 'warn';
    return 'neutral';
  }

  function statusLabel(status: SubscriptionStatus): string {
    if (status === 'ACTIVE') return 'Actif';
    if (status === 'PAUSED') return 'Suspendu';
    return 'Annulé';
  }

  function intervalLabel(interval: SubscriptionInterval): string {
    if (interval === 'WEEKLY') return 'Hebdomadaire';
    if (interval === 'MONTHLY') return 'Mensuel';
    return 'Annuel';
  }

  // ── List state ───────────────────────────────────────────────────────────────

  let subscriptions = $state<Subscription[]>([]);
  let loading = $state(true);
  let error = $state('');

  async function loadSubscriptions() {
    loading = true;
    error = '';
    try {
      subscriptions = await api<Subscription[]>('/billing/subscriptions');
    } catch (e) {
      error = e instanceof ApiError ? e.message : 'Échec du chargement des abonnements';
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    void loadSubscriptions();
  });

  // ── Customer list (for select) ────────────────────────────────────────────────

  let customers = $state<CustomerItem[]>([]);
  let loadingCustomers = $state(false);

  async function loadCustomers() {
    if (customers.length > 0) return;
    loadingCustomers = true;
    try {
      const res = await api<Paginated<CustomerItem>>('/transportation/customers?pageSize=100');
      customers = res.items;
    } catch {
      // non-blocking; select will be empty
    } finally {
      loadingCustomers = false;
    }
  }

  // ── Create / Edit modal ──────────────────────────────────────────────────────

  let showModal = $state(false);
  let editingSub = $state<Subscription | null>(null);

  interface LineForm {
    description: string;
    amount: number | null;
  }

  let form = $state({
    name: '',
    customerId: '',
    interval: 'MONTHLY' as SubscriptionInterval,
    startDate: '',
  });
  let formLines = $state<LineForm[]>([{ description: '', amount: null }]);
  let saving = $state(false);
  let formError = $state('');

  function openCreate() {
    editingSub = null;
    form = {
      name: '',
      customerId: '',
      interval: 'MONTHLY',
      startDate: new Date().toISOString().slice(0, 10),
    };
    formLines = [{ description: '', amount: null }];
    formError = '';
    showModal = true;
    void loadCustomers();
  }

  function openEdit(s: Subscription) {
    editingSub = s;
    form = {
      name: s.name,
      customerId: s.customerId,
      interval: s.interval,
      startDate: s.startDate.slice(0, 10),
    };
    formLines = s.lines.map((l) => ({ description: l.description, amount: Number(l.amount) }));
    if (formLines.length === 0) formLines = [{ description: '', amount: null }];
    formError = '';
    showModal = true;
    void loadCustomers();
  }

  function addLine() {
    formLines = [...formLines, { description: '', amount: null }];
  }

  function removeLine(idx: number) {
    if (formLines.length <= 1) return;
    formLines = formLines.filter((_, i) => i !== idx);
  }

  async function saveSub() {
    formError = '';
    if (!form.name.trim()) { formError = 'Le nom est requis.'; return; }
    if (!form.customerId) { formError = 'Le client est requis.'; return; }
    if (!form.startDate) { formError = 'La date de début est requise.'; return; }
    for (const [i, l] of formLines.entries()) {
      if (!l.description.trim()) { formError = `Ligne ${i + 1} : la description est requise.`; return; }
      const amt = Number(l.amount ?? '');
      if (l.amount === null || l.amount === undefined || isNaN(amt) || amt < 0) { formError = `Ligne ${i + 1} : montant invalide.`; return; }
    }

    saving = true;
    try {
      const body = {
        name: form.name.trim(),
        customerId: form.customerId,
        interval: form.interval,
        startDate: form.startDate,
        lines: formLines.map((l) => ({ description: l.description.trim(), amount: Number(l.amount ?? 0) })),
      };
      if (editingSub) {
        await api(`/billing/subscriptions/${editingSub.id}`, { method: 'PATCH', body });
        toast.success('Abonnement mis à jour');
      } else {
        await api('/billing/subscriptions', { method: 'POST', body });
        toast.success('Abonnement créé');
      }
      showModal = false;
      await loadSubscriptions();
    } catch (e) {
      formError = e instanceof ApiError ? e.message : "Échec de l'enregistrement";
    } finally {
      saving = false;
    }
  }

  // ── Delete ───────────────────────────────────────────────────────────────────

  let deletingId = $state<string | null>(null);

  async function deleteSub(s: Subscription) {
    if (!confirm(`Supprimer l'abonnement « ${s.name} » ?`)) return;
    deletingId = s.id;
    try {
      await api(`/billing/subscriptions/${s.id}`, { method: 'DELETE' });
      toast.success('Abonnement supprimé');
      await loadSubscriptions();
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : 'Échec de la suppression';
      // 409 = invoices exist — show inline
      toast.error(msg);
    } finally {
      deletingId = null;
    }
  }

  // ── Status actions ────────────────────────────────────────────────────────────

  let actioningId = $state<string | null>(null);

  async function doAction(s: Subscription, verb: string, successMsg: string) {
    actioningId = s.id;
    try {
      await api(`/billing/subscriptions/${s.id}/${verb}`, { method: 'POST' });
      toast.success(successMsg);
      await loadSubscriptions();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : `Échec : ${verb}`);
    } finally {
      actioningId = null;
    }
  }

  // ── Generate now ─────────────────────────────────────────────────────────────

  let generatingId = $state<string | null>(null);

  async function generateNow(s: Subscription) {
    generatingId = s.id;
    try {
      const invoice = await api<{ id: string; invoiceNumber: string }>(
        `/billing/subscriptions/${s.id}/generate`,
        { method: 'POST' },
      );
      toast.success(`Relevé ${invoice.invoiceNumber} généré`);
      await loadSubscriptions();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Échec de la génération');
    } finally {
      generatingId = null;
    }
  }

  // ── Run due ───────────────────────────────────────────────────────────────────

  let runningDue = $state(false);

  async function runDue() {
    runningDue = true;
    try {
      const result = await api<RunDueResult>('/billing/subscriptions/run-due', { method: 'POST' });
      toast.success(
        `Abonnements dus : ${result.generated} générés, ${result.skipped} sautés, ${result.errors} erreur(s)`,
      );
      await loadSubscriptions();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Échec du traitement des abonnements dus');
    } finally {
      runningDue = false;
    }
  }
</script>

<PageHeader
  title="Abonnements"
  subtitle="Facturation récurrente — générez des relevés client DRAFT à chaque période."
/>

<!-- Toolbar -->
<div class="mb-4 flex items-center justify-between gap-3 flex-wrap">
  <span class="text-sm text-ink-muted">{subscriptions.length} abonnement{subscriptions.length !== 1 ? 's' : ''}</span>
  <div class="flex gap-2">
    <Button variant="ghost" disabled={runningDue} onclick={runDue}>
      {runningDue ? 'Traitement…' : 'Générer les abonnements dus'}
    </Button>
    <Button variant="primary" onclick={openCreate}>+ Nouvel abonnement</Button>
  </div>
</div>

<ErrorNotice message={error} onretry={loadSubscriptions} />

{#if loading}
  <Card padded={false}><Skeleton rows={4} /></Card>
{:else}
  <Table>
    {#snippet head()}
      <th>Nom</th>
      <th>Client</th>
      <th>Intervalle</th>
      <th class="text-center">Statut</th>
      <th>Prochaine échéance</th>
      <th class="text-right">Total / période</th>
      <th></th>
    {/snippet}
    {#snippet body()}
      {#each subscriptions as s (s.id)}
        {@const total = periodTotal(s.lines)}
        <tr>
          <td class="font-medium">{s.name}</td>
          <td class="text-ink-muted text-sm">
            {s.customer ? `${s.customer.name} (${s.customer.code})` : s.customerId}
          </td>
          <td class="text-sm">{intervalLabel(s.interval)}</td>
          <td class="text-center">
            <Badge tone={statusTone(s.status)}>{statusLabel(s.status)}</Badge>
          </td>
          <td class="text-sm tabular-nums">{fmtDate(s.nextRunDate)}</td>
          <td class="text-right tabular-nums font-semibold">{money(total)} {s.currency}</td>
          <td class="text-right whitespace-nowrap text-xs space-x-2">
            <!-- Edit always available (except CANCELLED) -->
            {#if s.status !== 'CANCELLED'}
              <button class="text-accent hover:underline" onclick={() => openEdit(s)}>Modifier</button>
            {/if}

            <!-- ACTIVE actions -->
            {#if s.status === 'ACTIVE'}
              <button
                class="text-warn hover:underline disabled:opacity-40"
                disabled={actioningId === s.id}
                onclick={() => doAction(s, 'pause', 'Abonnement suspendu')}
              >{actioningId === s.id ? '…' : 'Suspendre'}</button>
              <button
                class="text-ok hover:underline disabled:opacity-40"
                disabled={generatingId === s.id}
                onclick={() => generateNow(s)}
              >{generatingId === s.id ? '…' : 'Générer maintenant'}</button>
            {/if}

            <!-- PAUSED actions -->
            {#if s.status === 'PAUSED'}
              <button
                class="text-ok hover:underline disabled:opacity-40"
                disabled={actioningId === s.id}
                onclick={() => doAction(s, 'resume', 'Abonnement repris')}
              >{actioningId === s.id ? '…' : 'Reprendre'}</button>
            {/if}

            <!-- Cancel (ACTIVE or PAUSED) -->
            {#if s.status === 'ACTIVE' || s.status === 'PAUSED'}
              <button
                class="text-danger hover:underline disabled:opacity-40"
                disabled={actioningId === s.id}
                onclick={() => doAction(s, 'cancel', 'Abonnement annulé')}
              >{actioningId === s.id ? '…' : 'Annuler'}</button>
            {/if}

            <!-- Delete (no invoices generated) -->
            <button
              class="text-ink-muted hover:text-danger hover:underline disabled:opacity-40"
              disabled={deletingId === s.id}
              onclick={() => deleteSub(s)}
            >{deletingId === s.id ? '…' : 'Supprimer'}</button>
          </td>
        </tr>
      {:else}
        <tr>
          <td colspan={7}>
            <EmptyState title="Aucun abonnement" message="Créez votre premier abonnement récurrent." />
          </td>
        </tr>
      {/each}
    {/snippet}
  </Table>
{/if}

<!-- ── Create / Edit modal ─────────────────────────────────────────────────── -->
{#if showModal}
  <div class="fixed inset-0 z-40 flex items-center justify-center bg-black/40">
    <div class="w-full max-w-xl rounded-xl bg-surface p-6 shadow-xl overflow-y-auto max-h-[90vh]">
      <div class="mb-4 flex items-center justify-between">
        <h2 class="text-base font-bold text-ink">
          {editingSub ? "Modifier l'abonnement" : 'Nouvel abonnement'}
        </h2>
        <button class="text-ink-muted hover:text-ink" onclick={() => { showModal = false; }}>✕</button>
      </div>

      <div class="space-y-3">
        <!-- Name -->
        <div>
          <label class="mb-1 block text-xs font-medium text-ink-muted" for="sub-name">Nom</label>
          <input
            id="sub-name"
            bind:value={form.name}
            placeholder="ex. Forfait mensuel Premium"
            class="w-full rounded-lg border border-edge bg-surface-muted px-3 py-1.5 text-sm focus:border-accent focus:outline-none"
          />
        </div>

        <!-- Customer + Interval -->
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="mb-1 block text-xs font-medium text-ink-muted" for="sub-customer">Client</label>
            <select
              id="sub-customer"
              bind:value={form.customerId}
              class="w-full rounded-lg border border-edge bg-surface-muted px-3 py-1.5 text-sm focus:border-accent focus:outline-none"
            >
              <option value="">— Sélectionner —</option>
              {#each customers as c (c.id)}
                <option value={c.id}>{c.name} ({c.code})</option>
              {/each}
            </select>
            {#if loadingCustomers}
              <p class="mt-0.5 text-xs text-ink-muted">Chargement…</p>
            {/if}
          </div>
          <div>
            <label class="mb-1 block text-xs font-medium text-ink-muted" for="sub-interval">Intervalle</label>
            <select
              id="sub-interval"
              bind:value={form.interval}
              class="w-full rounded-lg border border-edge bg-surface-muted px-3 py-1.5 text-sm focus:border-accent focus:outline-none"
            >
              <option value="WEEKLY">Hebdomadaire</option>
              <option value="MONTHLY">Mensuel</option>
              <option value="YEARLY">Annuel</option>
            </select>
          </div>
        </div>

        <!-- Start date -->
        <div>
          <label class="mb-1 block text-xs font-medium text-ink-muted" for="sub-start">Date de début</label>
          <input
            id="sub-start"
            type="date"
            bind:value={form.startDate}
            class="w-full rounded-lg border border-edge bg-surface-muted px-3 py-1.5 text-sm focus:border-accent focus:outline-none"
          />
        </div>

        <!-- Lines -->
        <div>
          <div class="mb-1 flex items-center justify-between">
            <span class="text-xs font-medium text-ink-muted">Lignes</span>
            <button class="text-xs text-accent hover:underline" onclick={addLine}>+ Ajouter une ligne</button>
          </div>
          <div class="space-y-2">
            {#each formLines as line, idx (idx)}
              <div class="flex items-center gap-2">
                <input
                  bind:value={line.description}
                  placeholder="Description"
                  class="flex-1 rounded-lg border border-edge bg-surface-muted px-3 py-1.5 text-sm focus:border-accent focus:outline-none"
                />
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  bind:value={line.amount}
                  placeholder="0.00"
                  class="w-28 rounded-lg border border-edge bg-surface-muted px-3 py-1.5 text-sm text-right tabular-nums focus:border-accent focus:outline-none"
                />
                <button
                  class="text-ink-muted hover:text-danger disabled:opacity-30"
                  disabled={formLines.length <= 1}
                  onclick={() => removeLine(idx)}
                >✕</button>
              </div>
            {/each}
          </div>
          {#if formLines.length > 0}
            {@const tot = formLines.reduce((acc, l) => acc + (Number(l.amount) || 0), 0)}
            <p class="mt-1 text-right text-xs text-ink-muted">
              Total / période : <span class="font-semibold tabular-nums">{money(tot)}</span>
            </p>
          {/if}
        </div>
      </div>

      {#if formError}
        <p class="mt-3 text-sm text-danger">{formError}</p>
      {/if}

      <div class="mt-5 flex justify-end gap-2">
        <Button variant="ghost" onclick={() => { showModal = false; }}>Annuler</Button>
        <Button variant="primary" disabled={saving} onclick={saveSub}>
          {saving ? 'Enregistrement…' : 'Enregistrer'}
        </Button>
      </div>
    </div>
  </div>
{/if}
