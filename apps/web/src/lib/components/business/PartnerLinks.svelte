<script lang="ts">
  import { api, ApiError } from '$lib/api/client';
  import { auth } from '$lib/stores/auth';
  import { Button, Modal, EntityPicker, ErrorNotice, Skeleton } from '$lib/components/ui';
  import type { Partner } from './types';
  let {
    partner,
    onchanged = () => {},
    context = 'catalog',
  }: { partner: Partner; onchanged?: () => void; context?: 'catalog' | 'services' } = $props();
  const can = $derived(($auth?.user.permissions ?? []) as string[]);
  const billing = $derived(
    $auth?.tenant.enabledModules.includes('billing') &&
      can.includes('billing.customer-invoices.read'),
  );
  const crm = $derived($auth?.tenant.enabledModules.includes('crm') && can.includes('crm.read'));
  let open = $state(false),
    loading = $state(false),
    busy = $state(false),
    error = $state(''),
    uncertain = $state(false);
  let customerId = $state(''),
    companyId = $state(''),
    version = $state('');
  async function show() {
    open = true;
    loading = true;
    version = '';
    error = '';
    uncertain = false;
    try {
      const r = await api<{
        updatedAt: string;
        billingCustomerId?: string | null;
        crmCompanyId?: string | null;
      }>(`/${context}/partners/${partner.id}/links`);
      version = r.updatedAt;
      customerId = r.billingCustomerId ?? '';
      companyId = r.crmCompanyId ?? '';
    } catch (e) {
      error = (e as Error).message;
    } finally {
      loading = false;
    }
  }
  async function save(create = false) {
    if (busy || !version || uncertain) return;
    busy = true;
    error = '';
    try {
      await api(`/${context}/partners/${partner.id}/${create ? 'billing-customer' : 'links'}`, {
        method: create ? 'POST' : 'PATCH',
        body: {
          expectedUpdatedAt: version,
          ...(!create
            ? {
                ...(billing ? { billingCustomerId: customerId || null } : {}),
                ...(crm ? { crmCompanyId: companyId || null } : {}),
              }
            : {}),
        },
      });
      open = false;
      onchanged();
    } catch (e) {
      error = (e as Error).message;
      uncertain = !(e instanceof ApiError) || e.statusCode >= 500;
    } finally {
      busy = false;
    }
  }
</script>

{#if billing || crm}<Button
    variant="ghost"
    onclick={show}
    aria-label={`Connexions de ${partner.name}`}>Connexions</Button
  >{/if}
<Modal bind:open title="Connexions du partenaire" dismissible={!busy}>
  <p class="mb-4 text-sm">
    {partner.name} — choisissez les fiches qui représentent la même entreprise. Aucun rapprochement automatique
    par nom.
  </p>
  {#if loading}<Skeleton rows={2} />{:else if version}
    <div class="space-y-4">
      {#if billing}<EntityPicker
          label="Client Facturation / Transport"
          endpoint={`/${context}/references/billing-customers`}
          bind:value={customerId}
          selectedLabel={customerId}
          disabled={busy || uncertain || !can.includes(`${context}.manage`)}
        />{/if}
      {#if crm}<EntityPicker
          label="Société CRM"
          endpoint="/crm/companies"
          bind:value={companyId}
          selectedLabel={companyId}
          disabled={busy || uncertain || !can.includes(`${context}.manage`)}
        />{/if}
      <p class="text-xs text-ink-muted">
        Le lien de facturation est figé dès qu’une facture Services utilise ce partenaire. Les
        fiches restent distinctes; aucun contact n’est écrasé.
      </p>
      {#if can.includes(`${context}.manage`)}<Button
          disabled={busy || uncertain}
          onclick={() => save()}>Enregistrer les connexions</Button
        >{/if}
      {#if billing && !customerId && partner.isCustomer && can.includes(`${context}.manage`) && can.includes('billing.customer-invoices.manage')}<Button
          variant="secondary"
          disabled={busy || uncertain}
          onclick={() => save(true)}>Créer le client de facturation depuis cette fiche</Button
        >{/if}
    </div>
  {/if}
  <ErrorNotice message={error} />
  {#if uncertain}<p class="mt-3 text-sm text-warn">
      Réponse incertaine. Fermez puis rouvrez pour vérifier avant de réessayer.
    </p>{/if}
</Modal>
