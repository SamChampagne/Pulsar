<script lang="ts">
  import { untrack } from 'svelte';
  import { api } from '$lib/api/client';
  import { Button, Drawer, Field, Input } from '$lib/components/ui';
  import type { MaterialSupplier } from './material-purchase-types';
  let { open = $bindable(false), canManage }: { open?: boolean; canManage: boolean } = $props();
  let suppliers = $state<MaterialSupplier[]>([]),
    total = $state(0),
    page = $state(1),
    search = $state('');
  let editing = $state(false),
    selected = $state<MaterialSupplier | null>(null),
    code = $state(''),
    name = $state(''),
    email = $state(''),
    terms = $state(''),
    isActive = $state(true);
  let busy = $state(false),
    error = $state(''),
    inspect = $state(false);
  async function load() {
    busy = true;
    error = '';
    try {
      const result = await api<{ items: MaterialSupplier[]; total: number }>(
        '/manufacturing/material-purchases/suppliers',
        { query: { page, pageSize: 20, search } },
      );
      suppliers = result.items;
      total = result.total;
      inspect = false;
    } catch (e) {
      error = e instanceof Error ? e.message : 'Fournisseurs indisponibles.';
    } finally {
      busy = false;
    }
  }
  $effect(() => {
    if (open)
      untrack(() => {
        editing = false;
        void load();
      });
  });
  function edit(supplier: MaterialSupplier | null) {
    selected = supplier;
    code = supplier?.code ?? '';
    name = supplier?.name ?? '';
    email = supplier?.email ?? '';
    terms = supplier?.terms ?? '';
    isActive = supplier?.isActive ?? true;
    editing = true;
    error = '';
  }
  async function save() {
    if (busy || inspect || !canManage) return;
    busy = true;
    error = '';
    try {
      await api(`/manufacturing/material-purchases/suppliers${selected ? `/${selected.id}` : ''}`, {
        method: selected ? 'PUT' : 'POST',
        body: {
          code,
          name,
          ...(email ? { email } : {}),
          terms,
          isActive,
          ...(selected ? { expectedUpdatedAt: selected.updatedAt } : {}),
        },
      });
      editing = false;
      await load();
    } catch (e) {
      inspect = true;
      error =
        e instanceof Error
          ? e.message
          : 'Réponse incertaine. Revenez à la liste et inspectez avant de réessayer.';
    } finally {
      busy = false;
    }
  }
</script>

<Drawer
  bind:open
  title="Fournisseurs matières"
  width="lg"
  dismissible={!busy}
  onbeforeclose={() => !editing || window.confirm('Fermer et abandonner la saisie fournisseur ?')}
>
  {#snippet children()}
    <div class="space-y-4">
      <p class="text-sm text-ink-muted">
        Référentiel de cette entreprise. Modifier une fiche ne réécrit pas les commandes déjà
        capturées. Aucun courriel automatique.
      </p>
      {#if error}<p role="alert" class="text-sm text-danger">{error}</p>{/if}
      {#if editing}
        <form
          class="space-y-4"
          onsubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <Field label="Code fournisseur"
            ><Input bind:value={code} disabled={busy || inspect} required /></Field
          >
          <Field label="Nom du fournisseur"
            ><Input bind:value={name} disabled={busy || inspect} required /></Field
          >
          <Field label="Courriel de contact"
            ><Input type="email" bind:value={email} disabled={busy || inspect} /></Field
          >
          <Field label="Conditions par défaut"
            ><Input bind:value={terms} disabled={busy || inspect} /></Field
          >
          <label class="flex gap-2 text-sm"
            ><input type="checkbox" bind:checked={isActive} disabled={busy || inspect} />Fournisseur
            actif</label
          >
          <Button type="submit" disabled={busy || inspect}>Enregistrer le fournisseur</Button>
          {#if inspect}<p class="text-sm text-warn">
              Actualisation nécessaire : inspectez la fiche dans la liste avant une nouvelle
              modification.
            </p>{/if}
          <Button
            type="button"
            variant="secondary"
            disabled={busy}
            onclick={() => {
              editing = false;
              void load();
            }}>Revenir à la liste et actualiser</Button
          >
        </form>
      {:else}
        <form
          class="flex items-end gap-2"
          onsubmit={(e) => {
            e.preventDefault();
            page = 1;
            void load();
          }}
        >
          <Field label="Rechercher un fournisseur"
            ><Input bind:value={search} disabled={busy} /></Field
          ><Button type="submit" variant="secondary" disabled={busy}>Rechercher</Button>
        </form>
        {#if canManage}<Button disabled={busy} onclick={() => edit(null)}
            >Nouveau fournisseur</Button
          >{/if}
        {#if busy}<p role="status">Chargement…</p>{:else if !suppliers.length && !error}<p
            class="text-sm text-ink-muted"
          >
            Aucun fournisseur trouvé. Ajoutez les partenaires auprès de qui vous achetez vos
            matières.
          </p>{/if}
        {#each suppliers as supplier}<div
            class="flex items-center justify-between gap-3 rounded-md border border-edge p-3"
          >
            <div class="min-w-0">
              <p class="font-medium">{supplier.name}</p>
              <p class="break-words text-xs text-ink-muted">
                {supplier.code} · {supplier.isActive ? 'Actif' : 'Inactif'} · {supplier.email ??
                  'Sans courriel'}
              </p>
            </div>
            {#if canManage}<Button variant="ghost" disabled={busy} onclick={() => edit(supplier)}
                >Modifier</Button
              >{/if}
          </div>{/each}
        <div class="flex items-center justify-between gap-2 text-sm">
          <Button
            variant="secondary"
            disabled={busy || page === 1}
            onclick={() => {
              page--;
              void load();
            }}>Précédent</Button
          ><span>{page} · {total} fournisseurs</span><Button
            variant="secondary"
            disabled={busy || page * 20 >= total}
            onclick={() => {
              page++;
              void load();
            }}>Suivant</Button
          >
        </div>
      {/if}
    </div>
  {/snippet}
</Drawer>
