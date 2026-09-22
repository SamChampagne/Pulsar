<script lang="ts">
  import { api, ApiError } from '$lib/api/client';
  import { auth } from '$lib/stores/auth';
  import BusinessAssistant from './BusinessAssistant.svelte';
  import { Button, Field, Input, Select, ErrorNotice, Skeleton, Modal } from '$lib/components/ui';
  type Source = {
    kind: 'time' | 'part';
    id: string;
    label: string;
    quantity: string;
    unit: string;
    expectedVersion: string;
  };
  type Billable = {
    project: {
      partner: { billingCustomerId: string | null };
      quote: { number: string; currency: string; totalAmount: string } | null;
    };
    sources: Source[];
    remainingSources: number;
    truncated: boolean;
    invoices: {
      id: string;
      invoice: {
        id: string;
        invoiceNumber: string;
        status: string;
        totalAmount: string;
        currency: string;
      } | null;
    }[];
  };
  type Intent = {
    operationKey: string;
    currency: string;
    sources: { kind: 'time' | 'part'; id: string; unitPrice: number; expectedVersion: string }[];
  };
  let { projectId }: { projectId: string } = $props();
  const permissions = $derived(($auth?.user.permissions ?? []) as string[]);
  const visible = $derived(
    $auth?.tenant.enabledModules.includes('billing') &&
      permissions.includes('billing.customer-invoices.read'),
  );
  const manage = $derived(
    permissions.includes('billing.customer-invoices.manage') &&
      permissions.includes('services.manage'),
  );
  const key = $derived(`pulsar:service-invoice:${$auth?.tenant.id}:${$auth?.user.id}:${projectId}`);
  let data = $state<Billable | null>(null),
    loading = $state(false),
    busy = $state(false),
    error = $state(''),
    currency = $state('CAD');
  let prices = $state<Record<string, number>>({}),
    chosen = $state<Record<string, boolean>>({}),
    confirm = $state(false),
    pending = $state<Intent | null>(null),
    resultId = $state('');
  let generation = 0;
  async function load() {
    const seq = ++generation;
    loading = true;
    error = '';
    prices = {};
    chosen = {};
    try {
      const r = await api<Billable>(`/services/projects/${projectId}/billable`);
      if (seq === generation) {
        data = r;
        currency = r.project.quote?.currency ?? 'CAD';
        const stored = sessionStorage.getItem(key);
        pending = stored ? JSON.parse(stored) : null;
      }
    } catch (e) {
      if (seq === generation) {
        data = null;
        error = (e as Error).message;
      }
    } finally {
      if (seq === generation) loading = false;
    }
  }
  $effect(() => {
    projectId;
    if (visible) void load();
  });
  const selected = $derived(data?.sources.filter((s) => chosen[s.id]) ?? []);
  const valid = $derived(
    selected.length > 0 &&
      selected.length <= 100 &&
      selected.every((s) => Number(prices[s.id]) > 0),
  );
  async function send() {
    if (busy || (!pending && !valid)) return;
    busy = true;
    error = '';
    try {
      if (!pending) {
        pending = {
          operationKey: crypto.randomUUID(),
          currency,
          sources: selected.map((s) => ({
            kind: s.kind,
            id: s.id,
            expectedVersion: s.expectedVersion,
            unitPrice: Number(prices[s.id]),
          })),
        };
        sessionStorage.setItem(key, JSON.stringify(pending));
      }
      const result = await api<{ invoiceId: string }>(`/services/projects/${projectId}/invoice`, {
        method: 'POST',
        body: pending,
      });
      resultId = result.invoiceId;
      sessionStorage.removeItem(key);
      pending = null;
      confirm = false;
      await load();
    } catch (e) {
      error = (e as Error).message;
      if (e instanceof ApiError && e.statusCode < 500) {
        sessionStorage.removeItem(key);
        pending = null;
      }
    } finally {
      busy = false;
    }
  }
</script>

{#if visible}<section
    class="mt-8 rounded-xl border border-edge bg-surface p-5"
    aria-label="Facturation du projet"
  >
    <div class="mb-4 flex flex-wrap justify-between gap-3">
      <div>
        <h2 class="font-semibold">Travaux à facturer</h2>
        <p class="mt-1 text-sm text-ink-muted">
          Heures approuvées et pièces consommées, sans double facturation.
        </p>
      </div>
      <Button variant="secondary" onclick={load} disabled={busy || loading}
        >Actualiser les sources</Button
      >
    </div>
    <ErrorNotice message={error} />
    <BusinessAssistant
      permission="services.read"
      prompt={`Consulte services_billable_context pour le projet ${projectId}. Explique les sources facturables et celles à vérifier, cite le devis et les factures liés. Ne calcule pas de prix inventés et ne crée aucune facture.`}
    />
    {#if resultId}<Button
        variant="secondary"
        href={`/invoices?tab=statements&statement=${encodeURIComponent(resultId)}`}
        >Ouvrir la facture brouillon</Button
      >{/if}
    {#if loading}<Skeleton rows={3} />{:else if data}
      {#if data.project.quote}<p class="mb-3 text-sm">
          Référence : {data.project.quote.number} · {data.project.quote.totalAmount}
          {data.project.quote.currency} hors taxes. Les prix ci-dessous sont à confirmer pour les travaux
          réels.
        </p>{/if}
      {#if !data.project.partner.billingCustomerId}<p class="my-3 text-sm text-warn">
          Reliez ce partenaire à un client de facturation dans <a
            class="underline"
            href="/catalog/partners">Catalogue → Partenaires → Connexions</a
          >.
        </p>{/if}
      {#if pending}<div class="my-3 rounded-lg bg-warn-soft p-3 text-sm">
          <p>
            Une demande non confirmée est conservée. Reprendre renvoie exactement la même demande,
            sans créer une seconde facture.
          </p>
          <Button variant="secondary" disabled={busy || !manage} onclick={send}
            >Reprendre la facturation conservée</Button
          >
        </div>{/if}
      {#if data.truncated}<p class="mb-3 text-sm text-warn">
          Affichage limité à 100 sources de chaque type. Facturez un lot puis actualisez pour voir
          la suite.
        </p>{/if}
      <fieldset disabled={busy || !!pending || !manage} class="space-y-3">
        <div class="max-w-36">
          <Field label="Devise de facturation"
            ><Select bind:value={currency}
              >{#each ['CAD', 'USD', 'EUR', 'GBP'] as c}<option>{c}</option>{/each}</Select
            ></Field
          >
        </div>
        {#each data.sources as source}<div
            class="grid items-center gap-3 rounded-lg border border-edge p-3 sm:grid-cols-[minmax(0,1fr)_10rem]"
          >
            <label class="flex items-start gap-3 text-sm"
              ><input type="checkbox" class="mt-1" bind:checked={chosen[source.id]} /><span
                >{source.label}<span class="mt-1 block text-xs text-ink-muted"
                  >{Number(source.quantity).toLocaleString(undefined, { maximumFractionDigits: 4 })}
                  {source.unit}</span
                ></span
              ></label
            ><Field label={`Prix / ${source.unit}`}
              ><Input
                type="number"
                min="0.0001"
                max="10000000"
                step="0.0001"
                bind:value={prices[source.id]}
              /></Field
            >
          </div>{/each}
        {#if !data.sources.length}<p class="py-3 text-sm text-ink-muted">
            Aucune source facturable actuellement. Soumettez puis faites approuver les heures, ou
            consommez une pièce dans une intervention.
          </p>{/if}
      </fieldset>
      {#if manage}<Button
          disabled={!valid || !data.project.partner.billingCustomerId || busy || !!pending}
          onclick={() => {
            confirm = true;
          }}>Préparer la facture brouillon ({selected.length})</Button
        >{/if}
      {#if data.invoices.length}<h3 class="mb-2 mt-6 text-sm font-medium">
          Historique de facturation
        </h3>
        <ul class="space-y-2 text-sm">
          {#each data.invoices as batch}<li>
              {#if batch.invoice}<a
                  class="text-accent hover:underline"
                  href={`/invoices?tab=statements&statement=${batch.invoice.id}`}
                  >{batch.invoice.invoiceNumber}</a
                >
                · {batch.invoice.status} · {batch.invoice.totalAmount}
                {batch.invoice.currency}{:else}<span class="text-ink-muted"
                  >Brouillon supprimé — sources libérées, demande historique conservée.</span
                >{/if}
            </li>{/each}
        </ul>{/if}
    {/if}
  </section>{/if}
<Modal bind:open={confirm} title="Confirmer le brouillon de facture" dismissible={!busy}>
  <p class="mb-4 text-sm">
    Créer une facture avec {selected.length} source(s) en {currency} ? Les quantités sont relues et verrouillées
    côté serveur. Les prix sont figés à la création. Les taxes, l’approbation et l’envoi restent dans
    Facturation.
  </p>
  <ErrorNotice message={error} /><Button loading={busy} onclick={send}>Créer le brouillon</Button>
</Modal>
