<script lang="ts">
  import { beforeNavigate } from '$app/navigation';
  import { api, ApiError } from '$lib/api/client';
  import { auth } from '$lib/stores/auth';
  import type { Paginated } from '@pulsar/shared';
  import {
    PageHeader,
    Button,
    Drawer,
    Field,
    Input,
    Select,
    Textarea,
    Badge,
    Skeleton,
    EmptyState,
  } from '$lib/components/ui';
  import type { Partner, CatalogItem } from './types';
  import StockLink from './StockLink.svelte';
  import ItemDossier from './ItemDossier.svelte';
  import PartnerLinks from './PartnerLinks.svelte';
  import PartyDossier from '../reference-data/PartyDossier.svelte';
  let { partners = false }: { partners?: boolean } = $props();
  const canManage = $derived(
    (($auth?.user.permissions ?? []) as string[]).includes('catalog.manage'),
  );
  let rows = $state<(Partner | CatalogItem)[]>([]),
    total = $state(0),
    current = $state(1),
    search = $state(''),
    active = $state('true');
  let loading = $state(true),
    error = $state(''),
    open = $state(false),
    saving = $state(false),
    formError = $state(''),
    uncertain = $state(false);
  let editing = $state<Partner | CatalogItem | null>(null),
    code = $state(''),
    name = $state(''),
    description = $state(''),
    kind = $state('SERVICE'),
    unit = $state('H'),
    email = $state(''),
    phone = $state(''),
    isCustomer = $state(true),
    isSupplier = $state(false),
    isActive = $state(true);
  const endpoint = $derived('/catalog/' + (partners ? 'partners' : 'items'));
  let generation = 0;
  async function load() {
    const run = ++generation;
    loading = true;
    error = '';
    try {
      const r = await api<Paginated<Partner | CatalogItem>>(endpoint, {
        query: { page: current, pageSize: 20, search, active },
      });
      if (run === generation) {
        rows = r.items;
        total = r.total;
      }
    } catch (e) {
      if (run === generation) error = e instanceof Error ? e.message : 'Chargement impossible.';
    } finally {
      if (run === generation) loading = false;
    }
  }
  $effect(() => {
    void partners;
    void load();
  });
  beforeNavigate((n) => {
    if (open) {
      n.cancel();
      formError = 'Enregistrez ou annulez la saisie avant de quitter cet écran.';
    }
  });
  function edit(row: Partner | CatalogItem | null) {
    editing = row;
    code = row?.code ?? '';
    name = row?.name ?? '';
    isActive = row?.active ?? true;
    description = row && 'description' in row ? row.description : '';
    kind = row && 'kind' in row ? row.kind : 'SERVICE';
    unit = row && 'unit' in row ? row.unit : 'H';
    email = row && 'email' in row ? (row.email ?? '') : '';
    phone = row && 'phone' in row ? (row.phone ?? '') : '';
    isCustomer = row && 'isCustomer' in row ? row.isCustomer : true;
    isSupplier = row && 'isSupplier' in row ? row.isSupplier : false;
    formError = '';
    uncertain = false;
    open = true;
  }
  async function save() {
    if (saving || uncertain) return;
    saving = true;
    formError = '';
    try {
      const data = partners
        ? { name, email: email || null, phone: phone || null, isCustomer, isSupplier }
        : { name, description, ...(!editing ? { kind, unit } : {}) };
      await api(endpoint + (editing ? '/' + editing.id : ''), {
        method: editing ? 'PATCH' : 'POST',
        body: {
          ...data,
          ...(editing ? { expectedUpdatedAt: editing.updatedAt, active: isActive } : { code }),
        },
      });
      open = false;
      await load();
    } catch (e) {
      formError = e instanceof Error ? e.message : 'Enregistrement impossible.';
      uncertain = !(e instanceof ApiError) || e.statusCode >= 500;
    } finally {
      saving = false;
    }
  }
</script>

<svelte:head><title>{partners ? 'Partenaires' : 'Catalogue'} | Pulsar</title></svelte:head>
<div class="mx-auto max-w-7xl">
  <PageHeader
    title={partners ? 'Partenaires' : 'Produits et prestations'}
    subtitle={partners
      ? 'Une identité commune pour vos clients et fournisseurs Services/Achats.'
      : 'Le référentiel des nouvelles applications métier. Aucun stock n’est tenu ici.'}
    count={total}
    >{#snippet actions()}{#if canManage}<Button onclick={() => edit(null)}
          >{partners ? 'Nouveau partenaire' : 'Nouvel article'}</Button
        >{/if}{/snippet}</PageHeader
  >
  <div class="mb-4 flex flex-wrap gap-3">
    <div class="w-full sm:w-72">
      <Input
        aria-label="Rechercher dans le catalogue"
        bind:value={search}
        oninput={() => (current = 1)}
        placeholder="Code ou nom…"
      />
    </div>
    <div class="w-44">
      <Select aria-label="Filtrer par activation" bind:value={active} onchange={() => (current = 1)}
        ><option value="true">Actifs</option><option value="false">Inactifs</option><option value=""
          >Tous</option
        ></Select
      >
    </div>
  </div>
  {#if error}<p role="alert" class="mb-4 text-sm text-danger">{error}</p>{/if}
  <div class="overflow-x-auto rounded-lg border border-edge bg-surface">
    {#if loading}<Skeleton rows={5} />{:else if !rows.length}<EmptyState
        title={search ? 'Aucun résultat' : 'Votre catalogue commence ici'}
        message={partners
          ? 'Créez un client pour Services ou un fournisseur pour Achats. Une même entreprise peut avoir les deux rôles.'
          : 'Ajoutez une prestation en heures ou un produit avec son unité. Les fiches historiques CRM/WMS restent séparées.'}
      />{:else}
      <table class="w-full text-left text-sm">
        <thead class="border-b border-edge bg-surface-muted text-xs text-ink-muted"
          ><tr
            ><th class="p-3">Code</th><th class="p-3">Nom</th><th class="p-3"
              >{partners ? 'Rôles' : 'Type / unité'}</th
            ><th class="p-3">État</th><th class="relative p-3"
              ><span class="sr-only">Actions</span></th
            ></tr
          ></thead
        ><tbody
          >{#each rows as row}<tr
              class="border-b border-edge last:border-0 hover:bg-surface-muted/50"
              ><td class="p-3 font-mono text-xs">{row.code}</td><td class="p-3 font-medium"
                >{row.name}</td
              ><td class="p-3 text-ink-muted"
                >{#if 'isCustomer' in row}{[
                    row.isCustomer ? 'Client' : '',
                    row.isSupplier ? 'Fournisseur' : '',
                  ]
                    .filter(Boolean)
                    .join(' / ')}{:else}{row.kind === 'SERVICE' ? 'Prestation' : 'Produit'} / {row.unit}{/if}</td
              ><td class="p-3"
                ><Badge tone={row.active ? 'ok' : 'neutral'}
                  >{row.active ? 'Actif' : 'Inactif'}</Badge
                ></td
              ><td class="p-3"
                >{#if canManage}<Button
                    variant="ghost"
                    onclick={() => edit(row)}
                    aria-label={`Modifier ${row.name}`}>Modifier</Button
                  >{/if}{#if 'kind' in row}<ItemDossier
                    endpoint={`/catalog/items/${row.id}`}
                    name={row.name}
                  /><StockLink item={row} onchanged={() => void load()} />{:else}<PartyDossier
                    endpoint={`/catalog/partners/${row.id}`}
                    name={row.name}
                  /><PartnerLinks partner={row} onchanged={() => void load()} />{/if}</td
              ></tr
            >{/each}</tbody
        >
      </table>
    {/if}
  </div>
  <div class="mt-3 flex items-center justify-end gap-3 text-sm">
    <Button
      variant="ghost"
      disabled={current === 1 || loading}
      onclick={() => {
        current--;
      }}>Précédent</Button
    ><span class="text-ink-muted">Page {current} / {Math.max(1, Math.ceil(total / 20))}</span
    ><Button
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
  title={editing ? 'Modifier la fiche' : partners ? 'Nouveau partenaire' : 'Nouvel article'}
  dismissible={!saving}
  onbeforeclose={() => {
    formError = 'Utilisez Annuler pour abandonner cette saisie.';
    return false;
  }}
>
  <form
    onsubmit={(e) => {
      e.preventDefault();
      void save();
    }}
    class="space-y-4"
  >
    {#if formError}<p role="alert" class="rounded-md bg-danger-soft p-3 text-sm text-danger">
        {formError}
      </p>{/if}
    {#if uncertain}<p class="text-sm text-warn">
        Réponse incertaine. Fermez ce panneau et vérifiez la liste avant de soumettre à nouveau.
      </p>{/if}
    <Field label="Code"
      ><Input bind:value={code} required maxlength={50} disabled={!!editing} /></Field
    >
    <Field label="Nom"><Input bind:value={name} required maxlength={200} /></Field>
    {#if partners}<Field label="Courriel"
        ><Input type="email" bind:value={email} maxlength={254} /></Field
      ><Field label="Téléphone"><Input type="tel" bind:value={phone} maxlength={40} /></Field>
      <fieldset class="space-y-2">
        <legend class="mb-2 text-xs font-medium text-ink-muted">Rôles du partenaire</legend><label
          class="flex gap-2 text-sm"
          ><input type="checkbox" bind:checked={isCustomer} />Client</label
        ><label class="flex gap-2 text-sm"
          ><input type="checkbox" bind:checked={isSupplier} />Fournisseur</label
        >
      </fieldset>
    {:else}<div class="grid grid-cols-2 gap-3">
        <Field label="Type"
          ><Select bind:value={kind} disabled={!!editing}
            ><option value="SERVICE">Prestation</option><option value="GOODS">Produit</option
            ></Select
          ></Field
        ><Field label="Unité"
          ><Select bind:value={unit} disabled={!!editing}
            >{#each ['EA', 'H', 'KG', 'L', 'M', 'BOX', 'DAY'] as u}<option value={u}>{u}</option
              >{/each}</Select
          ></Field
        >
      </div>
      <Field label="Description"><Textarea bind:value={description} /></Field>
      <p class="text-xs leading-5 text-ink-muted">
        Le code, le type et l’unité restent fixes après création. Les stocks se gèrent dans WMS, pas
        dans ce catalogue.
      </p>{/if}
    {#if editing}<label class="flex gap-2 text-sm"
        ><input type="checkbox" bind:checked={isActive} />Fiche active pour les nouveaux dossiers</label
      >{/if}
    <div class="flex justify-end gap-2 border-t border-edge pt-4">
      <Button
        variant="secondary"
        disabled={saving}
        onclick={() => {
          open = false;
          void load();
        }}>{uncertain ? 'Fermer et vérifier' : 'Annuler'}</Button
      ><Button
        type="submit"
        loading={saving}
        disabled={uncertain ||
          !name.trim() ||
          (!editing && !code.trim()) ||
          (partners && !isCustomer && !isSupplier)}>Enregistrer</Button
      >
    </div>
  </form>
</Drawer>
