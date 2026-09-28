<script lang="ts">
  import type { Paginated } from '@pulsar/shared';
  import { api, ApiError } from '$lib/api/client';
  import {
    Button,
    Field,
    Input,
    Select,
    Textarea,
    EntityPicker,
    Badge,
    Skeleton,
  } from '$lib/components/ui';
  import type { SupplierOffer } from './types';
  let {
    endpoint,
    manage,
    busy = $bindable(false),
  }: { endpoint: string; manage: boolean; busy?: boolean } = $props();
  let rows = $state<SupplierOffer[]>([]),
    current = $state(1),
    total = $state(0),
    loading = $state(false),
    error = $state(''),
    uncertain = $state(false);
  let editing = $state<SupplierOffer | null>(null),
    form = $state(false);
  let supplierId = $state(''),
    supplierReference = $state(''),
    currency = $state('CAD'),
    unitPrice = $state('0'),
    minimumQuantity = $state(''),
    orderMultiple = $state(''),
    leadTimeDays = $state(''),
    validFrom = $state(''),
    validUntil = $state(''),
    packaging = $state(''),
    terms = $state(''),
    active = $state(true);
  let unit = $state('');
  async function load() {
    loading = true;
    error = '';
    uncertain = false;
    try {
      const [r, d] = await Promise.all([
        api<Paginated<SupplierOffer>>(`${endpoint}/supplier-offers`, {
          query: { page: current, pageSize: 10 },
        }),
        api<{ item: { unit: string } }>(`${endpoint}/details`),
      ]);
      rows = r.items;
      total = r.total;
      unit = d.item.unit;
    } catch (e) {
      error = e instanceof Error ? e.message : 'Lecture impossible.';
      uncertain = true;
    } finally {
      loading = false;
    }
  }
  $effect(() => {
    void endpoint;
    void current;
    void load();
  });
  function edit(row: SupplierOffer | null) {
    editing = row;
    supplierId = row?.supplierId ?? '';
    supplierReference = row?.supplierReference ?? '';
    currency = row?.currency ?? 'CAD';
    unitPrice = row?.unitPrice ?? '0';
    minimumQuantity = row?.minimumQuantity ?? '';
    orderMultiple = row?.orderMultiple ?? '';
    leadTimeDays = row?.leadTimeDays?.toString() ?? '';
    validFrom = row?.validFrom?.slice(0, 10) ?? '';
    validUntil = row?.validUntil?.slice(0, 10) ?? '';
    packaging = row?.packaging ?? '';
    terms = row?.terms ?? '';
    active = row?.active ?? true;
    form = true;
    error = '';
    uncertain = false;
  }
  async function save() {
    if (busy || uncertain) return;
    busy = true;
    error = '';
    try {
      await api(`${endpoint}/supplier-offers`, {
        method: 'PUT',
        body: {
          expectedVersion: editing?.version ?? 0,
          supplierId,
          supplierReference,
          currency,
          unitPrice,
          minimumQuantity: minimumQuantity || null,
          orderMultiple: orderMultiple || null,
          leadTimeDays: leadTimeDays ? Number(leadTimeDays) : null,
          validFrom: validFrom || null,
          validUntil: validUntil || null,
          packaging,
          terms,
          active,
        },
      });
      form = false;
      await load();
    } catch (e) {
      error = e instanceof Error ? e.message : 'Enregistrement impossible.';
      uncertain = !(e instanceof ApiError) || e.statusCode >= 500 || e.statusCode === 409;
    } finally {
      busy = false;
    }
  }
</script>

<div class="space-y-4">
  <p class="text-sm text-ink-muted">
    Une référence par fournisseur et article. Prix, minimum et multiple sont exprimés en <strong
      >{unit}</strong
    >, jamais en boîtes converties automatiquement. Choisissez ces conditions explicitement sur une
    ligne de commande.
  </p>
  {#if error}<p role="alert" class="rounded-md bg-danger-soft p-3 text-sm text-danger">
      {error}
    </p>{/if}
  {#if uncertain}<p class="text-sm text-warn">
      Réponse incertaine ou version périmée. Relisez les références avant de poursuivre.
    </p>
    <Button
      variant="secondary"
      onclick={() => {
        form = false;
        void load();
      }}>Relire les références</Button
    >{/if}
  {#if form}<form
      onsubmit={(e) => {
        e.preventDefault();
        void save();
      }}
      class="space-y-4 rounded-lg border border-edge p-4"
    >
      <h3 class="text-sm font-semibold">
        {editing ? `Modifier ${editing.supplierReference}` : 'Nouvelle référence fournisseur'}
      </h3>
      <fieldset disabled={busy || uncertain} class="space-y-4">
        <div>
          <p class="mb-1.5 text-xs font-medium text-ink-muted">Fournisseur de la référence</p>
          <EntityPicker
            endpoint={`${endpoint}/supplier-offers/suppliers`}
            label="Fournisseur de la référence"
            bind:value={supplierId}
            selectedLabel={editing?.supplier.name ?? ''}
            disabled={!!editing}
          />
        </div>
        <div class="grid gap-3 sm:grid-cols-2">
          <Field label="Référence chez le fournisseur"
            ><Input
              aria-label="Référence chez le fournisseur"
              bind:value={supplierReference}
              maxlength={120}
              required
            /></Field
          >
          <Field label="Devise de la référence"
            ><Select aria-label="Devise de la référence" bind:value={currency}
              >{#each ['CAD', 'USD', 'EUR', 'GBP'] as c}<option value={c}>{c}</option
                >{/each}</Select
            ></Field
          >
          <Field label={`Prix par ${unit}`}
            ><Input
              aria-label="Prix de la référence"
              inputmode="decimal"
              bind:value={unitPrice}
              required
              maxlength={14}
            /></Field
          >
          <Field label="Délai indicatif (jours calendaires)"
            ><Input
              aria-label="Délai indicatif"
              inputmode="numeric"
              bind:value={leadTimeDays}
              maxlength={4}
            /></Field
          >
          <Field label={`Quantité minimale (${unit})`}
            ><Input
              aria-label="Quantité minimale"
              inputmode="decimal"
              bind:value={minimumQuantity}
              maxlength={14}
            /></Field
          >
          <Field label={`Multiple de commande (${unit})`}
            ><Input
              aria-label="Multiple de commande"
              inputmode="decimal"
              bind:value={orderMultiple}
              maxlength={14}
            /></Field
          >
          <Field label="Valide à partir du (UTC)"
            ><Input aria-label="Début de validité" type="date" bind:value={validFrom} /></Field
          >
          <Field label="Valide jusqu’au (UTC inclus)"
            ><Input aria-label="Fin de validité" type="date" bind:value={validUntil} /></Field
          >
        </div>
        <Field label="Conditionnement fournisseur"
          ><Textarea
            aria-label="Conditionnement fournisseur"
            bind:value={packaging}
            maxlength={1000}
          /></Field
        >
        <Field label="Conditions et consignes d’achat"
          ><Textarea
            aria-label="Conditions et consignes d’achat"
            bind:value={terms}
            maxlength={4000}
          /></Field
        >
        <label class="flex gap-2 text-sm"
          ><input type="checkbox" bind:checked={active} />Référence active pour les nouveaux
          engagements</label
        >
        <p class="text-xs text-ink-muted">
          Le délai ne fixe pas la date de livraison. Les consignes ne calculent ni taxe, ni échéance
          de paiement. Une modification exigera de revoir les brouillons utilisant l’ancienne
          version.
        </p>
      </fieldset>
      <div class="flex justify-end gap-2">
        <Button
          variant="secondary"
          disabled={busy}
          onclick={() => {
            form = false;
          }}>Annuler</Button
        ><Button type="submit" disabled={!supplierId || uncertain} loading={busy}
          >Enregistrer la référence</Button
        >
      </div>
    </form>{:else}
    {#if manage}<Button
        variant="secondary"
        disabled={loading || uncertain}
        onclick={() => edit(null)}>Ajouter une référence fournisseur</Button
      >{/if}
    {#if loading}<Skeleton rows={3} />{:else if !rows.length}<p
        class="rounded-lg border border-dashed border-edge p-5 text-sm text-ink-muted"
      >
        Aucune référence fournisseur. Les commandes à prix manuel restent disponibles.
      </p>{:else}
      <div class="space-y-3">
        {#each rows as row}<article class="rounded-lg border border-edge p-4 space-y-2">
            <div class="flex flex-wrap justify-between gap-2">
              <h3 class="text-sm font-semibold">{row.supplier.name} · {row.supplierReference}</h3>
              <Badge tone={row.active ? 'ok' : 'neutral'}
                >{row.active ? 'Active' : 'Inactive'}</Badge
              >
            </div>
            <p class="text-sm">
              {row.unitPrice}
              {row.currency} / {unit} · minimum {row.minimumQuantity ?? 'libre'} · multiple {row.orderMultiple ??
                'libre'}
            </p>
            <p class="text-xs text-ink-muted">
              Délai : {row.leadTimeDays ?? 'non précisé'} jours · validité UTC : {row.validFrom?.slice(
                0,
                10,
              ) ?? 'sans début'} → {row.validUntil?.slice(0, 10) ?? 'sans fin'} · version {row.version}
            </p>
            {#if row.packaging}<p class="text-sm whitespace-pre-wrap break-words">
                {row.packaging}
              </p>{/if}{#if row.terms}<p
                class="text-sm whitespace-pre-wrap break-words text-ink-muted"
              >
                {row.terms}
              </p>{/if}
            {#if manage}<Button variant="ghost" onclick={() => edit(row)}
                >Modifier la référence {row.supplierReference}</Button
              >{/if}
          </article>{/each}
      </div>
    {/if}
    <div class="flex justify-end items-center gap-2">
      <Button
        variant="ghost"
        disabled={loading || current === 1}
        onclick={() => {
          current--;
        }}>Précédent</Button
      ><span class="text-xs">{current} / {Math.max(1, Math.ceil(total / 10))}</span><Button
        variant="ghost"
        disabled={loading || current * 10 >= total}
        onclick={() => {
          current++;
        }}>Suivant</Button
      >
    </div>
  {/if}
</div>
