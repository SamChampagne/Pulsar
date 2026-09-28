<script lang="ts">
  import { REFERENCE_ACCESS, type Paginated, type ReferenceAccess } from '@pulsar/shared';
  import { api } from '$lib/api/client';
  import { auth } from '$lib/stores/auth';
  import {
    PageHeader,
    Button,
    Table,
    Badge,
    Skeleton,
    ErrorNotice,
    EmptyState,
  } from '$lib/components/ui';
  import ReferenceEditor from './ReferenceEditor.svelte';
  import PartyDirectory from './PartyDirectory.svelte';
  import PartyDossier from './PartyDossier.svelte';
  import { referenceLabel, referenceFields, type ReferenceRow } from './fields';
  import PartnerLinks from '../business/PartnerLinks.svelte';
  import StockLink from '../business/StockLink.svelte';
  import ItemDossier from '../business/ItemDossier.svelte';
  import type { Partner, CatalogItem } from '../business/types';
  import { toast } from '$lib/stores/toast';
  import { labelFor, toneFor } from '../ui/status';
  import ConfigurableTable from '../ui/ConfigurableTable.svelte';
  import type { ViewColumn } from '../ui/table-view';
  const baseColumns: ViewColumn[] = [
    { key: 'code', label: 'Référence', width: 140 },
    { key: 'name', label: 'Nom', required: true, width: 220 },
    { key: 'status', label: 'État', width: 110 },
  ];
  function addressText(value: unknown) {
    if (!value || typeof value !== 'object') return 'Non renseignée';
    const a = value as Record<string, string>;
    return [a.line1, a.line2, a.city, a.region, a.postalCode, a.countryCode]
      .filter(Boolean)
      .join(', ');
  }
  const referenceStatus = (row: ReferenceRow) =>
    String(row.status ?? (row.active === false || row.isActive === false ? 'INACTIVE' : 'ACTIVE'));
  let { module }: { module: string } = $props();
  const accesses = $derived(
    REFERENCE_ACCESS.filter(
      (a) =>
        a.module === module &&
        $auth?.tenant.enabledModules.includes(a.module) &&
        $auth.user.permissions.includes(a.read),
    ),
  );
  // Multiple billing workflows expose the same identities with their own least-privilege grants.
  const resources = $derived(
    accesses.filter((a, i) => accesses.findIndex((b) => b.kind === a.kind) === i),
  );
  let selected = $state(''),
    search = $state(''),
    page = $state(1),
    revision = $state(0);
  const access = $derived(resources.find((a) => a.path === selected) ?? resources[0]);
  const columns = $derived([
    ...baseColumns,
    ...(access
      ? referenceFields[access.kind]
          .filter((f) => !['code', 'name', 'unitNumber', 'firstName', 'lastName'].includes(f.key))
          .map((f) => ({ key: f.key, label: f.label, width: 180 }))
      : []),
    ...(['customer', 'client', 'supplier'].includes(access?.kind ?? '')
      ? [
          { key: 'billingAddress', label: 'Facturation', width: 240 },
          { key: 'shippingAddress', label: 'Livraison', width: 240 },
        ]
      : []),
    { key: 'actions', label: 'Actions', required: true, width: 240 },
  ]);
  let rows = $state<ReferenceRow[]>([]),
    total = $state(0),
    loading = $state(true),
    error = $state('');
  let editing = $state<{ access: ReferenceAccess; row: ReferenceRow | null } | null>(null);
  let directory = $state<{ access: ReferenceAccess; row: ReferenceRow } | null>(null);
  async function portalLink(row: ReferenceRow) {
    try {
      const { url } = await api<{ url: string }>(
        `/customer-portal/customers/${row.id}/portal-link`,
        { method: 'POST' },
      );
      await navigator.clipboard.writeText(url);
      toast.success('Lien portail copié');
    } catch (e) {
      toast.error((e as Error).message);
    }
  }
  $effect(() => {
    const endpoint = access?.path,
      q = search,
      p = page;
    void revision;
    let cancelled = false;
    if (!endpoint) {
      loading = false;
      rows = [];
      return;
    }
    loading = true;
    error = '';
    const timer = setTimeout(() => {
      api<Paginated<ReferenceRow>>(`/${endpoint}`, { query: { search: q, page: p, pageSize: 20 } })
        .then((r) => {
          if (!cancelled) {
            rows = r.items;
            total = r.total;
          }
        })
        .catch((e) => {
          if (!cancelled) {
            error = e.message;
            rows = [];
          }
        })
        .finally(() => {
          if (!cancelled) loading = false;
        });
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  });
</script>

<PageHeader
  title={module === 'clients' ? 'Clients' : 'Données'}
  subtitle={module === 'clients'
    ? 'Les coordonnées et adresses partagées de votre entreprise.'
    : 'Vos références, directement dans votre application. Aucun module supplémentaire à activer.'}
/>
{#if module === 'clients'}<p class="mb-4 text-sm text-ink-muted">
    Choisissez le registre du client. Les fiches existantes restent partagées; aucune fusion
    automatique.
  </p>{/if}
{#if resources.length}
  <div class="mb-5 flex flex-wrap items-center gap-2" aria-label="Référentiels">
    {#each resources as resource}<Button
        variant={access?.path === resource.path ? 'primary' : 'secondary'}
        onclick={() => {
          selected = resource.path;
          page = 1;
          search = '';
        }}>{resource.label}</Button
      >{/each}
  </div>
  <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
    <label class="flex items-center gap-2 text-sm"
      >Rechercher<input
        aria-label="Rechercher dans les données"
        class="rounded-lg border border-edge bg-surface px-3 py-2"
        value={search}
        oninput={(e) => {
          search = e.currentTarget.value;
          page = 1;
        }}
      /></label
    >
    {#if access && $auth?.user.permissions.includes(access.manage)}<Button
        onclick={() => {
          editing = { access, row: null };
        }}>Ajouter</Button
      >{/if}
  </div>
  <p class="mb-4 text-xs text-ink-muted">
    Une fiche partagée, plusieurs usages. Aucune commande, écriture comptable ou opération de stock
    n’est créée ici.
  </p>
  <ErrorNotice message={error} />
  {#if error}<Button
      variant="secondary"
      onclick={() => {
        revision++;
      }}>Recharger</Button
    >{/if}
  {#if loading}<Skeleton rows={5} />{:else if !rows.length && !error}<EmptyState
      title="Aucune fiche"
      message="Ajoutez votre première référence ici ou directement depuis un sélecteur de formulaire."
    />{:else if !error}
    <ConfigurableTable viewKey={`reference:${access?.path}`} {columns} {rows}>
      {#snippet cell(row, key)}
        {#if key === 'code'}{String(row.code ?? row.unitNumber ?? '—')}
        {:else if key === 'name'}<span class="font-medium">{referenceLabel(row)}</span>
        {:else if key === 'billingAddress' || key === 'shippingAddress'}<span
            class="text-xs text-ink-muted">{addressText(row[key])}</span
          >
        {:else if key === 'status'}<Badge tone={toneFor(referenceStatus(row))}
            >{labelFor(referenceStatus(row))}</Badge
          >
        {:else if key === 'actions'}{#if access && ['customer', 'client', 'supplier'].includes(access.kind)}<PartyDossier
              endpoint={`/${access.path}/${row.id}`}
              name={referenceLabel(row)}
            /><Button
              variant="secondary"
              aria-label={`Carnet de ${referenceLabel(row)}`}
              onclick={() => {
                directory = { access, row };
              }}>Carnet</Button
            >{/if}{#if access && $auth?.user.permissions.includes(access.manage)}<Button
              variant="ghost"
              aria-label={`Modifier ${referenceLabel(row)}`}
              onclick={() => {
                editing = { access, row };
              }}>Modifier</Button
            >{/if}
          {#if module === 'services' && access?.kind === 'client'}<PartnerLinks
              partner={row as unknown as Partner}
              context="services"
              onchanged={() => {
                revision++;
              }}
            />{/if}
          {#if (module === 'services' || module === 'purchasing') && access?.kind === 'item'}<ItemDossier
              endpoint={`/${access.path}/${row.id}`}
              name={String(row.name)}
            /><StockLink
              item={row as unknown as CatalogItem}
              context={module}
              onchanged={() => {
                revision++;
              }}
            />{/if}
          {#if module === 'customer-portal' && $auth?.user.permissions.includes('customer-portal.links.manage')}<Button
              variant="secondary"
              onclick={() => portalLink(row)}>Copier le lien portail</Button
            >{/if}
        {:else}{String(row[key] ?? '—')}{/if}
      {/snippet}
    </ConfigurableTable>
    <div class="mt-4 flex items-center justify-between gap-2 text-sm">
      <span>{total} fiches · Page {page}</span>
      <div class="flex gap-2">
        <Button
          variant="secondary"
          disabled={page <= 1}
          onclick={() => {
            page--;
          }}>Précédent</Button
        ><Button
          variant="secondary"
          disabled={page * 20 >= total}
          onclick={() => {
            page++;
          }}>Suivant</Button
        >
      </div>
    </div>
  {/if}
{:else}<EmptyState
    title="Données non accessibles"
    message="Votre rôle ne dispose pas des droits de lecture des référentiels de ce module."
  />{/if}
{#if editing}<ReferenceEditor
    access={editing.access}
    row={editing.row}
    onclose={() => (editing = null)}
    onsaved={() => {
      editing = null;
      revision++;
    }}
  />{/if}
{#if directory}{#key `${directory.access.path}:${directory.row.id}`}<PartyDirectory
      endpoint={`/${directory.access.path}/${directory.row.id}/directory`}
      name={referenceLabel(directory.row)}
      canManage={$auth?.user.permissions.includes(directory.access.manage) ?? false}
      onclose={() => (directory = null)}
    />{/key}{/if}
