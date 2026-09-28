<script lang="ts">
  import { api } from '$lib/api/client';
  import { packageQuantity, type CatalogPackageSnapshot, type Paginated } from '@pulsar/shared';
  import type { CatalogPackage } from './types';
  import { Button, Select, Input, Field } from '$lib/components/ui';
  let {
    itemId,
    selected,
    editable,
    onchoose,
  }: {
    itemId: string;
    selected?: CatalogPackageSnapshot | null;
    editable: boolean;
    onchoose: (value: CatalogPackageSnapshot | null) => void;
  } = $props();
  let rows = $state<CatalogPackage[]>([]),
    chosen = $state(''),
    count = $state('1'),
    error = $state(''),
    loading = $state(false),
    baseUnit = $state(''),
    current = $state(1),
    reload = $state(0),
    total = $state(0);
  $effect(() => {
    void itemId;
    current = 1;
  });
  $effect(() => {
    const item = itemId;
    void current;
    void reload;
    let alive = true;
    rows = [];
    chosen = '';
    error = '';
    loading = false;
    if (item && editable) {
      loading = true;
      void api<{ item: { kind: string; unit: string } }>(`/purchasing/data/items/${item}/details`)
        .then(async (d) => {
          if (!alive) return;
          baseUnit = d.item.unit;
          if (d.item.kind !== 'GOODS') return;
          const r = await api<Paginated<CatalogPackage>>(
            `/purchasing/data/items/${item}/packages`,
            { query: { page: current, pageSize: 20 } },
          );
          if (alive) {
            rows = r.items;
            total = r.total;
          }
        })
        .catch((e) => {
          if (alive) error = e.message;
        })
        .finally(() => {
          if (alive) loading = false;
        });
    }
    return () => {
      alive = false;
    };
  });
  function choose() {
    const row = rows.find((r) => r.id === chosen);
    if (!row) return;
    try {
      const baseQuantity = packageQuantity(count, row.unitsPerPackage, row.wholeOnly);
      onchoose({
        schemaVersion: 1,
        packageId: row.id,
        version: row.version,
        catalogItemId: itemId,
        code: row.code,
        label: row.label,
        barcode: row.barcode,
        unitsPerPackage: row.unitsPerPackage,
        wholeOnly: row.wholeOnly,
        baseUnit,
        orderedCount: count,
        baseQuantity,
      });
      error = '';
    } catch (e) {
      error = (e as Error).message;
    }
  }
</script>

{#if selected || rows.length || loading || error}
  <section
    class="mt-3 space-y-2 rounded-md border border-edge p-3 text-xs"
    aria-label="Conditionnement de la ligne"
  >
    {#if selected}<p class="font-medium">
        {selected.orderedCount} × {selected.label} = {selected.baseQuantity}
        {selected.baseUnit}
      </p>
      {#if selected.catalogItemId !== itemId}<p role="alert" class="text-danger">
          L’article a changé. Retirez ce conditionnement ou choisissez celui du nouvel article avant
          d’enregistrer.
        </p>{/if}
      <p class="text-ink-muted">
        Contenu figé : {selected.unitsPerPackage}
        {selected.baseUnit} · code-barres {selected.barcode ?? 'absent'} · v{selected.version}. Le
        prix reste par {selected.baseUnit}.
      </p>
      {#if editable}<Button variant="ghost" onclick={() => onchoose(null)}
          >Saisir en unités de base</Button
        >{/if}
    {/if}
    {#if editable && rows.length}<div class="grid gap-2 sm:grid-cols-2">
        <Field label="Conditionnement"
          ><Select aria-label="Conditionnement à commander" bind:value={chosen}
            ><option value="">Choisir explicitement…</option>{#each rows as row}<option
                value={row.id}
                disabled={!row.active}
                >{row.label} · {row.unitsPerPackage}
                {baseUnit}{!row.active ? ' (inactif)' : ''}</option
              >{/each}</Select
          ></Field
        >
        <Field label="Nombre de conditionnements"
          ><Input
            aria-label="Nombre de conditionnements"
            inputmode="decimal"
            bind:value={count}
          /></Field
        >
      </div>
      <Button variant="secondary" disabled={!chosen || loading} onclick={choose}
        >Appliquer le conditionnement</Button
      >
      {#if total > 20}<div class="flex gap-2">
          <Button
            variant="ghost"
            disabled={current === 1 || loading}
            onclick={() => {
              current--;
            }}>Conditionnements précédents</Button
          ><Button
            variant="ghost"
            disabled={current * 20 >= total || loading}
            onclick={() => {
              current++;
            }}>Conditionnements suivants</Button
          >
        </div>{/if}{/if}
    {#if editable}<Button
        variant="ghost"
        disabled={loading}
        onclick={() => {
          reload++;
        }}>Relire les formats disponibles</Button
      >{/if}
    {#if loading}<p>Lecture des conditionnements…</p>{/if}{#if error}<p
        role="alert"
        class="text-danger"
      >
        {error}
      </p>{/if}
  </section>
{/if}
