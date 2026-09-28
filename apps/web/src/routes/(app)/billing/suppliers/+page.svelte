<script lang="ts">
  import { untrack } from 'svelte';
  import { auth } from '$lib/stores/auth';
  import { api } from '$lib/api/client';
  import { PageHeader, Button, Field, Input, Select, Table, Skeleton } from '$lib/components/ui';
  import type { Paginated } from '@pulsar/shared';
  import type { SupplierIdentity } from '$lib/billing/supplier-dossier';
  const canRead = $derived(!!$auth?.user.permissions.includes('billing.supplier-invoices.read'));
  let rows = $state<SupplierIdentity[]>([]),
    total = $state(0),
    page = $state(1),
    search = $state(''),
    activity = $state(''),
    loading = $state(true),
    error = $state('');
  let applied = $state({ search: '', activity: '' });
  let generation = 0;
  $effect(() => {
    void $auth?.tenant.id;
    if (canRead) untrack(() => void load());
    else {
      generation++;
      rows = [];
      loading = false;
    }
    return () => {
      generation++;
    };
  });
  async function load() {
    const g = ++generation;
    loading = true;
    error = '';
    rows = [];
    total = 0;
    try {
      const r = await api<Paginated<SupplierIdentity>>('/billing/supplier-dossiers', {
        query: { page, pageSize: 20, ...applied },
      });
      if (g === generation) {
        rows = r.items;
        total = r.total;
      }
    } catch (e) {
      if (g === generation) error = (e as Error).message;
    } finally {
      if (g === generation) loading = false;
    }
  }
</script>

<PageHeader
  title="Dossiers fournisseur"
  eyebrow="Finance"
  subtitle="Factures reçues, avoirs et justificatifs, réunis par fournisseur."
>
  {#snippet actions()}<Button href="/billing/supplier-invoices" variant="secondary"
      >Registre des factures</Button
    >{/snippet}
</PageHeader>
{#if !canRead}<p role="alert">La lecture des factures fournisseur est nécessaire.</p>{:else}
  <form
    class="mb-4 flex flex-wrap items-end gap-3"
    onsubmit={(e) => {
      e.preventDefault();
      page = 1;
      applied = { search, activity };
      void load();
    }}
  >
    <Field label="Rechercher un fournisseur"
      ><Input bind:value={search} maxlength={200} placeholder="Nom ou code" /></Field
    >
    <Field label="Activité du fournisseur"
      ><Select bind:value={activity}
        ><option value="">Tous, y compris désactivés</option><option value="ACTIVE">Actifs</option
        ><option value="INACTIVE">Désactivés</option></Select
      ></Field
    >
    <Button type="submit" disabled={loading}>Rechercher</Button>
  </form>
  <p class="mb-4 text-sm text-ink-muted">
    L’identité courante vient du référentiel partagé. Les noms conservés sur les factures restent
    inchangés. Les fournisseurs historiques restent consultables.
  </p>
  {#if error}<div role="alert" class="mb-4 text-danger">
      {error}
      <Button variant="secondary" onclick={load}>Réessayer</Button>
    </div>{/if}
  {#if loading}<Skeleton rows={5} />{:else if !error}
    {#if !rows.length}<div class="rounded-card border border-edge bg-surface p-6">
        <h2 class="font-medium">Aucun fournisseur trouvé</h2>
        <p class="mt-2 text-sm text-ink-muted">
          Modifiez la recherche. Pour une première facture, créez ou choisissez le fournisseur
          depuis le registre et ses données Finance.
        </p>
      </div>{:else}
      <Table
        >{#snippet head()}<th>Fournisseur</th><th>Activité</th><th
            ><span class="sr-only">Ouvrir le dossier</span></th
          >{/snippet}
        {#snippet body()}{#each rows as r (r.id)}<tr
              ><td
                ><div class="font-medium">{r.name}</div>
                <div class="text-xs text-ink-muted">{r.code}</div></td
              ><td
                >{r.active ? 'Actif' : 'Désactivé'}{#if !r.isSupplier}<div
                    class="text-xs text-ink-muted"
                  >
                    Historique fournisseur
                  </div>{/if}</td
              ><td
                ><Button href={`/billing/suppliers/${r.id}`} variant="ghost">Ouvrir {r.code}</Button
                ></td
              ></tr
            >{/each}{/snippet}
      </Table>
    {/if}
    <div class="mt-4 flex flex-wrap items-center gap-3">
      <span class="text-sm text-ink-muted">{total} fournisseur(s) · page {page}</span><Button
        variant="secondary"
        disabled={page === 1}
        onclick={() => {
          page--;
          void load();
        }}>Précédent</Button
      ><Button
        variant="secondary"
        disabled={page * 20 >= total}
        onclick={() => {
          page++;
          void load();
        }}>Suivant</Button
      >
    </div>
  {/if}
{/if}
