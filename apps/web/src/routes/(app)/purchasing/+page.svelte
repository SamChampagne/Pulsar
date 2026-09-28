<script lang="ts">
  import DocumentCoordinates from '$lib/components/reference-data/DocumentCoordinates.svelte';
  import SupplierTermsPicker from '$lib/components/business/SupplierTermsPicker.svelte';
  import PackageChoice from '$lib/components/business/PackageChoice.svelte';
  import type { CatalogPackageSnapshot } from '@pulsar/shared';
  import type { SupplierTermsSnapshot } from '@pulsar/shared';
  import PartyDirectory from '$lib/components/reference-data/PartyDirectory.svelte';
  import { beforeNavigate, goto } from '$app/navigation';
  import { page } from '$app/state';
  import { tick } from 'svelte';
  import { api, ApiError } from '$lib/api/client';
  import { auth } from '$lib/stores/auth';
  import { BUSINESS_STATUS_LABELS, type Paginated } from '@pulsar/shared';
  import {
    PageHeader,
    Button,
    Drawer,
    Modal,
    Field,
    Input,
    Textarea,
    Select,
    EntityPicker,
    Badge,
    Skeleton,
    EmptyState,
  } from '$lib/components/ui';
  import type { SupplierOrder } from '$lib/components/business/types';
  const manage = $derived(
    (($auth?.user.permissions ?? []) as string[]).includes('purchasing.manage'),
  );
  let rows = $state<SupplierOrder[]>([]),
    total = $state(0),
    current = $state(1),
    search = $state(''),
    queue = $state(''),
    loading = $state(true),
    error = $state('');
  let open = $state(false),
    editing = $state<SupplierOrder | null>(null),
    saving = $state(false),
    formError = $state(''),
    uncertain = $state(false),
    confirm = $state(false),
    nextStatus = $state(''),
    closeReason = $state('');
  let coordinatesBusy = $state(false),
    coordinatesBlocked = $state(false),
    coordinateRevision = $state(0);
  let showDirectory = $state(false);
  let coordinateSelectionOpen = $state(false);
  let supplierId = $state(''),
    currency = $state('CAD'),
    expectedDate = $state(''),
    notes = $state('');
  type Line = {
    key: string;
    catalogItemId: string;
    name: string;
    quantity: number;
    unitPrice: number;
    supplierTermsSnapshot?: SupplierTermsSnapshot | null;
    packageSnapshot?: CatalogPackageSnapshot | null;
  };
  let lines = $state<Line[]>([]),
    baseline = $state('');
  const editable = $derived(!editing || editing.status === 'DRAFT');
  const payload = $derived({
    supplierId,
    currency,
    expectedDate: expectedDate || null,
    notes,
    lines: lines.map((l) => ({
      catalogItemId: l.catalogItemId,
      quantity: Number(l.quantity),
      unitPrice: Number(l.unitPrice),
      ...(l.packageSnapshot
        ? {
            packageId: l.packageSnapshot.packageId,
            packageVersion: l.packageSnapshot.version,
            packageCount: l.packageSnapshot.orderedCount,
          }
        : {}),
      ...(l.supplierTermsSnapshot
        ? {
            supplierOfferId: l.supplierTermsSnapshot.offerId,
            supplierOfferVersion: l.supplierTermsSnapshot.version,
          }
        : {}),
    })),
  });
  const dirty = $derived(JSON.stringify(payload) !== baseline);
  let generation = 0;
  async function load() {
    const g = ++generation;
    loading = true;
    error = '';
    try {
      const r = await api<Paginated<SupplierOrder>>('/purchasing/orders', {
        query: {
          page: current,
          pageSize: 20,
          search,
          orderStatus: queue && queue !== 'late' ? queue : undefined,
          orderFollowup: queue === 'late' ? 'late' : undefined,
        },
      });
      if (g === generation) {
        rows = r.items;
        total = r.total;
      }
    } catch (e) {
      if (g === generation) error = e instanceof Error ? e.message : 'Chargement impossible.';
    } finally {
      if (g === generation) loading = false;
    }
  }
  $effect(() => {
    void load();
  });
  $effect(() => {
    const id = page.url.searchParams.get('orderId');
    if (!id) return;
    let active = true;
    void api<SupplierOrder>(`/purchasing/orders/${encodeURIComponent(id)}`)
      .then((row) => {
        if (active) show(row);
      })
      .catch((e) => {
        if (active) error = e instanceof Error ? e.message : 'Commande inaccessible.';
      });
    return () => {
      active = false;
    };
  });
  beforeNavigate((n) => {
    if (open) {
      n.cancel();
      formError = 'Fermez la commande avant de quitter cet écran.';
    }
  });
  function blank(): Line {
    return { key: crypto.randomUUID(), catalogItemId: '', name: '', quantity: 1, unitPrice: 0 };
  }
  function show(row: SupplierOrder | null) {
    coordinatesBlocked = !!row;
    editing = row;
    supplierId = row?.supplierId ?? '';
    currency = row?.currency ?? 'CAD';
    expectedDate = row?.expectedDate?.slice(0, 10) ?? '';
    notes = row?.notes ?? '';
    lines = row
      ? row.lines.map((l) => ({
          key: crypto.randomUUID(),
          catalogItemId: l.catalogItemId,
          name: l.nameSnapshot,
          quantity: Number(l.quantity),
          unitPrice: Number(l.unitPrice),
          supplierTermsSnapshot: l.supplierTermsSnapshot,
          packageSnapshot: l.packageSnapshot,
        }))
      : [blank()];
    formError = '';
    uncertain = false;
    baseline = JSON.stringify({
      supplierId,
      currency,
      expectedDate: expectedDate || null,
      notes,
      lines: lines.map((l) => ({
        catalogItemId: l.catalogItemId,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        ...(l.packageSnapshot
          ? {
              packageId: l.packageSnapshot.packageId,
              packageVersion: l.packageSnapshot.version,
              packageCount: l.packageSnapshot.orderedCount,
            }
          : {}),
        ...(l.supplierTermsSnapshot
          ? {
              supplierOfferId: l.supplierTermsSnapshot.offerId,
              supplierOfferVersion: l.supplierTermsSnapshot.version,
            }
          : {}),
      })),
    });
    open = true;
  }
  function failed(e: unknown) {
    formError = e instanceof Error ? e.message : 'Action impossible.';
    uncertain = !(e instanceof ApiError) || e.statusCode >= 500 || e.statusCode === 409;
  }
  async function refreshOrder() {
    if (!editing) return;
    const id = editing.id;
    const fresh = await api<SupplierOrder>(`/purchasing/orders/${id}`);
    if (editing?.id !== id || !open) return;
    confirm = false;
    show(fresh);
    coordinateRevision++;
    await load();
  }
  async function verifyOrder() {
    if (saving || coordinatesBusy) return;
    saving = true;
    try {
      await refreshOrder();
    } catch (e) {
      failed(e);
    } finally {
      saving = false;
    }
  }
  async function save() {
    if (saving || uncertain || coordinatesBusy || coordinatesBlocked) return;
    saving = true;
    formError = '';
    try {
      const result = await api<SupplierOrder>(
        '/purchasing/orders' + (editing ? '/' + editing.id : ''),
        {
          method: editing ? 'PATCH' : 'POST',
          body: { ...payload, ...(editing ? { expectedUpdatedAt: editing.updatedAt } : {}) },
        },
      );
      show(result);
      await load();
    } catch (e) {
      failed(e);
    } finally {
      saving = false;
    }
  }
  function ask(status: string) {
    if (
      saving ||
      uncertain ||
      dirty ||
      coordinatesBusy ||
      (status === 'CONFIRMED' && coordinatesBlocked)
    )
      return;
    closeReason = '';
    nextStatus = status;
    formError = '';
    confirm = true;
  }
  async function transition() {
    if (
      !editing ||
      saving ||
      uncertain ||
      dirty ||
      coordinatesBusy ||
      (nextStatus === 'CONFIRMED' && coordinatesBlocked)
    )
      return;
    saving = true;
    try {
      const result = await api<SupplierOrder>(`/purchasing/orders/${editing.id}/transition`, {
        method: 'POST',
        body: {
          status: nextStatus,
          expectedUpdatedAt: editing.updatedAt,
          ...(nextStatus === 'CLOSED' && closeReason.trim()
            ? { closeReason: closeReason.trim() }
            : {}),
        },
      });
      confirm = false;
      show(result);
      await load();
    } catch (e) {
      failed(e);
    } finally {
      saving = false;
    }
  }
</script>

<svelte:head><title>Achats fournisseurs | Pulsar</title></svelte:head>
<div class="mx-auto max-w-7xl">
  <PageHeader
    title="Achats fournisseurs"
    subtitle="Préparer, confirmer et suivre vos engagements fournisseurs."
    count={total}
    >{#snippet actions()}{#if manage}<Button onclick={() => show(null)}>Nouvelle commande</Button
        >{/if}{/snippet}</PageHeader
  >
  <div class="mb-4 space-y-3">
    <div class="flex flex-wrap gap-2" aria-label="Files de commandes fournisseurs">
      {#each [['', 'Toutes'], ['DRAFT', 'À préparer'], ['CONFIRMED', 'Arrivages à suivre'], ['late', 'Échéance dépassée'], ['CLOSED', 'Clôturées'], ['CANCELLED', 'Annulées']] as [value, label]}
        <Button
          variant={queue === value ? 'primary' : 'secondary'}
          onclick={() => {
            queue = value;
            current = 1;
          }}>{label}</Button
        >
      {/each}
    </div>
    <p class="text-xs text-ink-muted">
      Préparer la commande → confirmer l’engagement → enregistrer les réceptions partielles WMS →
      vérifier le reliquat avant clôture. Une échéance dépassée est une date promise passée (jour
      UTC), pas une preuve de stock manquant.
    </p>
  </div>
  <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
    <div class="w-72">
      <Input
        aria-label="Rechercher une commande fournisseur"
        bind:value={search}
        oninput={() => (current = 1)}
        placeholder="Numéro ou note…"
      />
    </div>
    <a class="text-xs text-accent underline" href="/documentation?module=purchasing"
      >Comprendre les effets de la confirmation</a
    >
  </div>
  {#if error}<p role="alert" class="mb-4 text-sm text-danger">{error}</p>{/if}
  <div class="overflow-x-auto rounded-lg border border-edge bg-surface">
    {#if loading}<Skeleton rows={5} />{:else if !rows.length}<EmptyState
        title={search || queue
          ? 'Aucune commande dans cette vue'
          : 'Votre première commande fournisseur'}
        message="Ajoutez fournisseurs et articles depuis votre commande ou dans Données. Ce parcours conserve un engagement d’achat; il ne réceptionne ni ne paie automatiquement."
      />{:else}<table class="w-full text-left text-sm">
        <thead class="border-b border-edge bg-surface-muted text-xs text-ink-muted"
          ><tr
            ><th class="p-3">Commande</th><th class="p-3">Fournisseur</th><th class="p-3"
              >Date attendue</th
            ><th class="p-3">Total HT</th><th class="p-3">État</th></tr
          ></thead
        ><tbody
          >{#each rows as row}<tr
              class="border-b border-edge last:border-0 hover:bg-surface-muted/50"
              ><td class="p-3"
                ><button
                  class="font-mono text-accent underline underline-offset-4"
                  onclick={() => show(row)}>{row.number}</button
                ></td
              ><td class="p-3 font-medium">{row.supplier.name}</td><td class="p-3 text-ink-muted"
                >{row.expectedDate?.slice(0, 10) ?? 'Non définie'}</td
              ><td class="p-3 font-mono tabular-nums">{row.total} {row.currency}</td><td class="p-3"
                ><Badge
                  tone={row.status === 'CONFIRMED'
                    ? 'info'
                    : row.status === 'CLOSED'
                      ? 'ok'
                      : 'neutral'}>{BUSINESS_STATUS_LABELS[row.status]}</Badge
                ></td
              ></tr
            >{/each}</tbody
        >
      </table>{/if}
  </div>
  <div class="mt-4 flex justify-end items-center gap-3 text-sm">
    <Button
      variant="ghost"
      disabled={current === 1 || loading}
      onclick={() => {
        current--;
      }}>Précédent</Button
    ><span>{current} / {Math.max(1, Math.ceil(total / 20))}</span><Button
      variant="ghost"
      disabled={current * 20 >= total || loading}
      onclick={() => {
        current++;
      }}>Suivant</Button
    >
  </div>
</div>
<Drawer
  bind:open
  title={editing ? editing.number : 'Nouvelle commande fournisseur'}
  width="xl"
  dismissible={!saving && !coordinatesBusy && !coordinateSelectionOpen}
  onbeforeclose={() => {
    if (coordinatesBusy) return false;
    if (dirty && editable) {
      formError = 'Utilisez Fermer pour abandonner les changements non enregistrés.';
      return false;
    }
    return true;
  }}
>
  <form
    class="space-y-5"
    onsubmit={(e) => {
      e.preventDefault();
      void save();
    }}
  >
    {#if formError}<p role="alert" class="text-sm text-danger">{formError}</p>{/if}{#if uncertain}<p
        class="text-sm text-warn"
      >
        Résultat à vérifier. Relisez la commande enregistrée avant une nouvelle action. Pour une
        création sans numéro reçu, fermez puis vérifiez la liste avant de recommencer.
      </p>{/if}
    {#if uncertain && editing}<Button
        variant="secondary"
        disabled={saving || coordinatesBusy}
        onclick={verifyOrder}>Vérifier la commande enregistrée</Button
      >{/if}
    {#if editing}<div class="flex items-center justify-between">
        <Badge tone={editing.status === 'CONFIRMED' ? 'info' : 'neutral'}
          >{BUSINESS_STATUS_LABELS[editing.status]}</Badge
        >
        <p class="font-mono text-sm">Total enregistré : {editing.total} {editing.currency} HT</p>
      </div>{/if}
    {#if editing && editing.status !== 'DRAFT'}<Button
        variant="secondary"
        disabled={saving || coordinatesBusy || uncertain}
        onclick={async () => {
          const id = editing!.id;
          open = false;
          await tick();
          await goto(`/purchasing/orders/${id}/receiving`);
        }}>Réceptions et reliquats</Button
      >{/if}
    <fieldset
      disabled={saving || uncertain || coordinatesBusy || coordinatesBlocked}
      class="space-y-5 min-w-0"
    >
      <div>
        <p class="mb-1.5 text-xs font-medium text-ink-muted">Fournisseur</p>
        <EntityPicker
          endpoint="/purchasing/references/suppliers"
          label="Fournisseur"
          bind:value={supplierId}
          selectedLabel={editing?.supplier.name ?? ''}
          disabled={!manage || !editable}
        />
      </div>
      <p class="text-xs text-ink-muted">
        Fournisseurs actifs de votre entreprise. Ajoutez une fiche manquante dans le sélecteur.
        Aucun courriel n’est envoyé par ce formulaire.
      </p>
      {#if editing?.status === 'DRAFT' && editing.documentCoordinates}<p
          class="text-xs text-ink-muted"
        >
          Pour changer de fournisseur, retirez d’abord les choix enregistrés dans « Coordonnées du
          document ».
        </p>{/if}
      <div class="grid gap-3 sm:grid-cols-2">
        <Field label="Devise"
          ><Select bind:value={currency} disabled={!manage || !editable}
            >{#each ['CAD', 'USD', 'EUR', 'GBP'] as c}<option value={c}>{c}</option>{/each}</Select
          ></Field
        ><Field label="Date attendue"
          ><Input type="date" bind:value={expectedDate} disabled={!manage || !editable} /></Field
        >
      </div>
      <section>
        <div class="mb-3 flex justify-between items-center">
          <h2 class="text-sm font-semibold">Lignes de commande</h2>
          {#if manage && editable}<Button
              variant="secondary"
              disabled={lines.length >= 100}
              onclick={() => {
                lines = [...lines, blank()];
              }}>Ajouter une ligne</Button
            >{/if}
        </div>
        <div class="space-y-3">
          {#each lines as line, i (line.key)}<div
              class="rounded-md border border-edge bg-surface-muted/30 p-3"
            >
              <div class="mb-3 flex justify-between items-center">
                <span class="text-xs text-ink-muted">Ligne {i + 1}</span
                >{#if manage && editable}<Button
                    variant="ghost"
                    disabled={lines.length === 1}
                    aria-label={`Retirer la ligne ${i + 1}`}
                    onclick={() => {
                      lines = lines.filter((l) => l.key !== line.key);
                    }}>Retirer</Button
                  >{/if}
              </div>
              <p class="mb-1.5 text-xs font-medium text-ink-muted">Article ou prestation</p>
              <EntityPicker
                endpoint="/purchasing/references/items"
                label={`Article de la ligne ${i + 1}`}
                bind:value={line.catalogItemId}
                selectedLabel={line.name}
                disabled={!manage || !editable}
              />
              <div class="mt-3 grid grid-cols-2 gap-3">
                <Field label={`Quantité ${i + 1}`}
                  ><Input
                    type="number"
                    bind:value={line.quantity}
                    min={0.0001}
                    max={1000000000}
                    step={0.0001}
                    required
                    disabled={!manage || !editable || !!line.packageSnapshot}
                  /></Field
                ><Field label={`Prix unitaire ${i + 1}`}
                  ><Input
                    type="number"
                    bind:value={line.unitPrice}
                    min={0}
                    max={1000000000}
                    step={0.0001}
                    required
                    disabled={!manage || !editable || !!line.supplierTermsSnapshot}
                  /></Field
                >
              </div>
              {#if editing?.lines[i]?.unitSnapshot}<p class="mt-2 text-xs text-ink-muted">
                  Unité enregistrée : {editing.lines[i].unitSnapshot}
                </p>{/if}
              <PackageChoice
                itemId={line.catalogItemId}
                selected={line.packageSnapshot}
                editable={manage && editable}
                onchoose={(pack) => {
                  line.packageSnapshot = pack;
                  if (pack) line.quantity = Number(pack.baseQuantity);
                }}
              />
              <SupplierTermsPicker
                itemId={line.catalogItemId}
                {supplierId}
                {currency}
                selected={line.supplierTermsSnapshot}
                editable={manage && editable}
                onchoose={(offer) => {
                  if (!offer) {
                    line.supplierTermsSnapshot = null;
                    return;
                  }
                  line.unitPrice = Number(offer.unitPrice);
                  line.supplierTermsSnapshot = {
                    schemaVersion: 1,
                    offerId: offer.id,
                    version: offer.version,
                    supplierId: offer.supplierId,
                    catalogItemId: offer.catalogItem.id,
                    supplierReference: offer.supplierReference,
                    unit: offer.catalogItem.unit,
                    currency: offer.currency,
                    unitPrice: offer.unitPrice,
                    minimumQuantity: offer.minimumQuantity,
                    orderMultiple: offer.orderMultiple,
                    leadTimeDays: offer.leadTimeDays,
                    validFrom: offer.validFrom?.slice(0, 10) ?? null,
                    validUntil: offer.validUntil?.slice(0, 10) ?? null,
                    packaging: offer.packaging,
                    terms: offer.terms,
                    capturedAt: '',
                  };
                }}
              />
            </div>{/each}
        </div>
      </section>
      <Field label="Notes"><Textarea bind:value={notes} disabled={!manage || !editable} /></Field>
    </fieldset>
    <div class="flex flex-wrap justify-end gap-2 border-t border-edge pt-4">
      <Button
        variant="secondary"
        disabled={saving || coordinatesBusy || coordinateSelectionOpen}
        onclick={() => {
          open = false;
          void load();
        }}>Fermer</Button
      >{#if manage && editable}<Button
          type="submit"
          loading={saving}
          disabled={uncertain ||
            coordinatesBusy ||
            coordinatesBlocked ||
            !supplierId ||
            lines.some((l) => !l.catalogItemId || !l.quantity)}>Enregistrer le brouillon</Button
        >{/if}
    </div>
  </form>
  {#if editing}
    <section class="mt-5 space-y-3" aria-label="Coordonnées fournisseur de la commande">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <p class="text-xs text-ink-muted">
          Choisissez l’adresse et le contact de cet accord après avoir enregistré le brouillon.
        </p>
        <Button
          variant="secondary"
          disabled={saving || coordinatesBusy || coordinateSelectionOpen || dirty || uncertain}
          onclick={() => {
            showDirectory = true;
          }}>Carnet du fournisseur</Button
        >
      </div>
      {#if dirty}<p class="text-sm text-warn">
          Enregistrez ou abandonnez les modifications du brouillon avant de choisir les coordonnées.
        </p>{/if}
      {#key editing.id}
        <DocumentCoordinates
          endpoint={`/purchasing/orders/${editing.id}/coordinates`}
          directoryBase="/purchasing/data/suppliers"
          canManage={manage && !saving && !dirty && !uncertain}
          documentVersion={`${editing.updatedAt}:${coordinateRevision}`}
          bind:busy={coordinatesBusy}
          bind:blocked={coordinatesBlocked}
          bind:selectionOpen={coordinateSelectionOpen}
          onchanged={refreshOrder}
        />
      {/key}
    </section>
  {/if}
  {#if manage && editing && ['DRAFT', 'CONFIRMED'].includes(editing.status)}<section
      class="border-t border-edge pt-4"
    >
      <h2 class="mb-2 text-sm font-semibold">Validation</h2>
      <p class="mb-3 text-xs leading-5 text-ink-muted">
        Enregistrez vos modifications avant de valider. Confirmer fige les lignes et les coordonnées
        choisies. Clôturer termine le suivi administratif, sans stock ni écriture comptable.
      </p>
      <div class="flex flex-wrap gap-2">
        {#if editing.status === 'DRAFT'}<Button
            disabled={saving || dirty || uncertain || coordinatesBusy || coordinatesBlocked}
            onclick={() => ask('CONFIRMED')}>Confirmer la commande</Button
          >{:else}<Button
            disabled={saving || uncertain || coordinatesBusy}
            onclick={() => ask('CLOSED')}>Clôturer le suivi</Button
          >{/if}<Button
          variant="danger"
          disabled={saving || dirty || uncertain || coordinatesBusy}
          onclick={() => ask('CANCELLED')}>Annuler la commande</Button
        >
      </div>
    </section>{/if}
</Drawer>
<Modal bind:open={confirm} dismissible={!saving} title="Confirmer l’action fournisseur"
  ><div class="space-y-4">
    <p class="text-sm">{editing?.number} → {BUSINESS_STATUS_LABELS[nextStatus]}</p>
    <p class="text-sm text-ink-muted">
      Cette action ne génère ni livraison, ni paiement, ni courriel fournisseur. Les lignes
      confirmées ne seront plus éditables.
    </p>
    {#if formError}<p role="alert" class="text-sm text-danger">{formError}</p>{/if}
    {#if nextStatus === 'CLOSED'}<Field label="Motif de clôture du reliquat (si produits manquants)"
        ><Textarea bind:value={closeReason} maxlength={1000} /></Field
      >{/if}
    {#if uncertain}<Button variant="secondary" disabled={saving} onclick={verifyOrder}
        >Vérifier la commande enregistrée</Button
      >{/if}
    <div class="flex justify-end gap-2">
      <Button
        variant="secondary"
        disabled={saving}
        onclick={() => {
          confirm = false;
        }}>Retour</Button
      ><Button loading={saving} disabled={uncertain} onclick={transition}>Confirmer</Button>
    </div>
  </div></Modal
>

{#if showDirectory && editing}
  <PartyDirectory
    endpoint={`/purchasing/data/suppliers/${editing.supplierId}/directory`}
    name={editing.supplier.name}
    canManage={manage}
    onclose={() => {
      showDirectory = false;
      coordinateRevision++;
    }}
  />
{/if}
