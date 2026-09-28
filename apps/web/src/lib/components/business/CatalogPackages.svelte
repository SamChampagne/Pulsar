<script lang="ts">
  import { api, ApiError } from '$lib/api/client';
  import { Button, Field, Input, Skeleton, Badge } from '$lib/components/ui';
  import type { Paginated } from '@pulsar/shared';
  import type { CatalogPackage } from './types';
  let {
    endpoint,
    manage,
    busy = $bindable(false),
  }: { endpoint: string; manage: boolean; busy?: boolean } = $props();
  let rows = $state<CatalogPackage[]>([]),
    total = $state(0),
    current = $state(1),
    unit = $state(''),
    loading = $state(false),
    error = $state(''),
    uncertain = $state(false);
  let form = $state(false),
    editing = $state<CatalogPackage | null>(null),
    code = $state(''),
    label = $state(''),
    barcode = $state(''),
    units = $state(''),
    wholeOnly = $state(true),
    active = $state(true);
  async function load() {
    loading = true;
    error = '';
    uncertain = false;
    try {
      const r = await api<Paginated<CatalogPackage> & { baseUnit: string }>(
        `${endpoint}/packages`,
        { query: { page: current, pageSize: 10 } },
      );
      rows = r.items;
      total = r.total;
      unit = r.baseUnit;
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
  function edit(row: CatalogPackage | null) {
    editing = row;
    code = row?.code ?? '';
    label = row?.label ?? '';
    barcode = row?.barcode ?? '';
    units = row?.unitsPerPackage ?? '';
    wholeOnly = row?.wholeOnly ?? true;
    active = row?.active ?? true;
    form = true;
    error = '';
  }
  async function save() {
    if (busy || uncertain) return;
    busy = true;
    error = '';
    try {
      await api(`${endpoint}/packages${editing ? `/${editing.id}` : ''}`, {
        method: editing ? 'PATCH' : 'POST',
        body: editing
          ? { expectedVersion: editing.version, label, active }
          : { code, label, barcode: barcode || null, unitsPerPackage: units, wholeOnly },
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

<section class="space-y-4">
  <p class="text-sm text-ink-muted">
    Décrivez une boîte, un carton, une palette ou un lot : <strong
      >1 conditionnement = un contenu précis en {unit}</strong
    >. Code, contenu, code-barres et règle de fractionnement restent fixes. Créez une nouvelle fiche
    si ce contenu change.
  </p>
  {#if error}<p role="alert" class="text-sm text-danger">{error}</p>{/if}
  {#if uncertain}<p class="text-sm text-warn">
      Relisez les données avant de réessayer; aucun renvoi automatique.
    </p>
    <Button
      variant="secondary"
      onclick={() => {
        form = false;
        void load();
      }}>Relire les conditionnements</Button
    >{/if}
  {#if form}<form
      class="space-y-4 rounded-lg border border-edge p-4"
      onsubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <h3 class="font-semibold text-sm">
        {editing ? 'Modifier le libellé ou l’activation' : 'Nouveau conditionnement'}
      </h3>
      <fieldset disabled={busy || uncertain} class="grid min-w-0 gap-3 sm:grid-cols-2">
        <Field label="Code du conditionnement"
          ><Input
            aria-label="Code du conditionnement"
            bind:value={code}
            required
            maxlength={50}
            disabled={!!editing}
          /></Field
        >
        <Field label="Libellé du conditionnement"
          ><Input
            aria-label="Libellé du conditionnement"
            bind:value={label}
            required
            maxlength={150}
          /></Field
        >
        <Field label={`Contenu en ${unit}`}
          ><Input
            aria-label="Unités par conditionnement"
            inputmode="decimal"
            bind:value={units}
            required
            maxlength={17}
            disabled={!!editing}
          /></Field
        >
        <Field label="Code-barres (facultatif)"
          ><Input
            aria-label="Code-barres du conditionnement"
            bind:value={barcode}
            maxlength={128}
            disabled={!!editing}
          /></Field
        >
        <label class="flex items-center gap-2 text-sm sm:col-span-2"
          ><input type="checkbox" bind:checked={wholeOnly} disabled={!!editing} />Nombre entier de
          conditionnements uniquement</label
        >
        {#if editing}<label class="flex items-center gap-2 text-sm"
            ><input type="checkbox" bind:checked={active} />Actif pour les nouvelles commandes</label
          >{/if}
      </fieldset>
      <p class="text-xs text-ink-muted">
        Les zéros au début d’un code-barres sont conservés. Un code est réservé dans le registre des
        conditionnements de votre entreprise, même si la fiche est désactivée. Aucun changement de
        stock ni tarif par cette fiche.
      </p>
      <div class="flex flex-wrap justify-end gap-2">
        <Button
          variant="secondary"
          disabled={busy}
          onclick={() => {
            form = false;
          }}>Annuler</Button
        ><Button type="submit" loading={busy} disabled={uncertain}
          >Enregistrer le conditionnement</Button
        >
      </div>
    </form>{:else}
    {#if manage}<Button
        variant="secondary"
        disabled={loading || uncertain}
        onclick={() => edit(null)}>Ajouter un conditionnement</Button
      >{/if}
    {#if loading}<Skeleton rows={3} />{:else if !rows.length}<p
        class="rounded-lg border border-dashed border-edge p-4 text-sm text-ink-muted"
      >
        Aucun conditionnement. Les commandes et réceptions à l’unité de base restent disponibles.
      </p>{:else}
      {#each rows as row}<article class="space-y-2 rounded-lg border border-edge p-4">
          <div class="flex flex-wrap justify-between gap-2">
            <h3 class="text-sm font-semibold">{row.code} · {row.label}</h3>
            <Badge tone={row.active ? 'ok' : 'neutral'}>{row.active ? 'Actif' : 'Inactif'}</Badge>
          </div>
          <p class="font-mono text-sm">1 × {row.label} = {row.unitsPerPackage} {unit}</p>
          <p class="text-xs text-ink-muted break-all">
            Code-barres : {row.barcode ?? 'non renseigné'} · {row.wholeOnly
              ? 'Colis entiers'
              : 'Fractions autorisées'} · v{row.version}
          </p>
          {#if manage}<Button variant="ghost" onclick={() => edit(row)}
              >Modifier le conditionnement {row.code}</Button
            >{/if}
        </article>{/each}
    {/if}
    <div class="flex items-center justify-end gap-2">
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
</section>
