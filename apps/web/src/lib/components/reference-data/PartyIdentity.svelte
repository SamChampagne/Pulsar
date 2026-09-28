<script lang="ts">
  import { api, ApiError } from '$lib/api/client';
  import { Button, ErrorNotice, Skeleton, EntityPicker } from '$lib/components/ui';
  let { endpoint }: { endpoint: string } = $props();
  type Identity = {
    owner: { name: string; updatedAt: string };
    canEdit: boolean;
    notice: string;
    groups: Array<{ family: string; label: string; records: Array<{ id: string; name: string }> }>;
  };
  let view = $state<Identity | null>(null),
    loading = $state(true),
    busy = $state(false),
    error = $state(''),
    uncertain = $state(false);
  let customer = $state(''),
    company = $state(''),
    reason = $state('');
  let review = $state<{ token: string; payload: string; names: string[] } | null>(null);
  const payload = $derived(
    JSON.stringify({
      expectedUpdatedAt: view?.owner.updatedAt,
      ...(view?.groups.some((g) => g.family === 'customer')
        ? { billingCustomerId: customer || null }
        : {}),
      ...(view?.groups.some((g) => g.family === 'crm-company')
        ? { crmCompanyId: company || null }
        : {}),
      reason,
    }),
  );
  const reviewed = $derived(review?.payload === payload);
  async function load() {
    loading = true;
    error = '';
    review = null;
    try {
      view = await api<Identity>(`${endpoint}/identity`);
      customer = view.groups.find((g) => g.family === 'customer')?.records[0]?.id ?? '';
      company = view.groups.find((g) => g.family === 'crm-company')?.records[0]?.id ?? '';
      uncertain = false;
    } catch (e) {
      error = (e as Error).message;
      view = null;
    } finally {
      loading = false;
    }
  }
  $effect(() => {
    void endpoint;
    void load();
  });
  async function save(confirm = false) {
    if (busy || uncertain || !view || (confirm && !reviewed)) return;
    busy = true;
    error = '';
    try {
      const result = await api<{
        reviewToken: string;
        customer?: { name: string } | null;
        company?: { name: string } | null;
      }>(`${endpoint}/identity/${confirm ? 'confirm' : 'review'}`, {
        method: 'POST',
        body: { ...JSON.parse(payload), ...(confirm ? { reviewToken: review!.token } : {}) },
      });
      if (confirm) {
        reason = '';
        await load();
      } else
        review = {
          token: result.reviewToken,
          payload,
          names: [
            result.customer?.name ??
              (view.groups.some((g) => g.family === 'customer') ? 'Aucun client lié' : ''),
            result.company?.name ??
              (view.groups.some((g) => g.family === 'crm-company')
                ? 'Aucune société CRM liée'
                : ''),
          ].filter(Boolean),
        };
    } catch (e) {
      error = (e as Error).message;
      if (confirm) uncertain = !(e instanceof ApiError) || e.statusCode >= 500;
      review = null;
    } finally {
      busy = false;
    }
  }
</script>

<section class="space-y-4" aria-label="Rapprochement des identités">
  <p class="text-sm text-ink-muted">
    Associez explicitement les fiches de la même entreprise. Chaque fiche conserve ses informations,
    son carnet et ses droits.
  </p>
  {#if loading}<Skeleton rows={3} />{:else if view}
    {#if !view.groups.length}<p class="rounded-lg bg-surface-muted p-4 text-sm">
        Aucun registre complémentaire accessible avec vos modules et permissions.
      </p>{/if}
    {#each view.groups as group}<div class="rounded-lg border border-edge p-3">
        <h3 class="text-sm font-medium">{group.label}</h3>
        <p class="mt-1 text-sm text-ink-muted">
          {group.records.map((r) => r.name).join(', ') || 'Aucune fiche liée'}
        </p>
      </div>{/each}
    <p class="text-xs text-ink-muted">{view.notice}</p>
    {#if view.canEdit && view.groups.length}
      {#if view.groups.some((g) => g.family === 'customer')}<div class="space-y-1">
          <p class="text-sm font-medium">Client à rapprocher</p>
          <EntityPicker
            label="Client à rapprocher"
            endpoint={`${endpoint}/identity/candidates`}
            filters={{ family: 'customer' }}
            bind:value={customer}
            selectedLabel={view.groups
              .find((g) => g.family === 'customer')
              ?.records.find((r) => r.id === customer)?.name ?? ''}
            disabled={busy || uncertain}
          />
        </div>{/if}
      {#if view.groups.some((g) => g.family === 'crm-company')}<div class="space-y-1">
          <p class="text-sm font-medium">Société CRM à rapprocher</p>
          <EntityPicker
            label="Société CRM à rapprocher"
            endpoint={`${endpoint}/identity/candidates`}
            filters={{ family: 'crm-company' }}
            bind:value={company}
            selectedLabel={view.groups
              .find((g) => g.family === 'crm-company')
              ?.records.find((r) => r.id === company)?.name ?? ''}
            disabled={busy || uncertain}
          />
        </div>{/if}
      <label class="grid gap-1 text-sm"
        >Motif du rapprochement<textarea
          class="rounded-lg border border-edge bg-surface px-3 py-2"
          bind:value={reason}
          maxlength={500}
          disabled={busy || uncertain}
          placeholder="Ex. identité confirmée avec le responsable du compte"
        ></textarea></label
      >
      <Button disabled={busy || uncertain || reason.trim().length < 5} onclick={() => save()}
        >Vérifier le rapprochement</Button
      >
      {#if reviewed && review}<div
          class="space-y-3 rounded-lg border border-edge bg-surface-muted p-4"
          role="status"
        >
          <p class="text-sm font-medium">À confirmer : {review.names.join(' · ')}</p>
          <p class="text-xs text-ink-muted">
            Aucune fusion ni copie d’informations. Cette association peut orienter les prochaines
            factures Services; les documents existants ne changent pas.
          </p>
          <Button disabled={busy || uncertain} onclick={() => save(true)}
            >Confirmer les liens</Button
          >
        </div>{/if}
    {:else if view.groups.length}<p class="text-sm text-ink-muted">
        Pour modifier ces associations, ouvrez la fiche partenaire dans Clients, Services, SAV,
        Achats ou Catalogue avec les droits de gestion correspondants.
      </p>{/if}
  {/if}
  <ErrorNotice message={error} />
  {#if uncertain}<p class="text-sm text-warn" role="alert">
      Réponse incertaine. Relisez les liens enregistrés avant toute nouvelle confirmation.
    </p>{/if}
  <Button variant="secondary" disabled={busy || loading} onclick={load}>Relire les liens</Button>
</section>
