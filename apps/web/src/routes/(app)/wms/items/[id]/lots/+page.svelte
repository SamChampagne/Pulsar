<script lang="ts">
  import { page } from '$app/stores';
  import { beforeNavigate } from '$app/navigation';
  import { untrack } from 'svelte';
  import { auth } from '$lib/stores/auth';
  import { api, ApiError } from '$lib/api/client';
  import { PageHeader, Button, Field, Input, Skeleton } from '$lib/components/ui';
  import type { Paginated } from '@pulsar/shared';
  import LotDispositionPanel from '$lib/components/wms/LotDispositionPanel.svelte';
  import LotConnections from '$lib/components/wms/LotConnections.svelte';
  type Lot = {
    id: string;
    code: string;
    supplierLot: string | null;
    manufacturedOn: string | null;
    expiresOn: string | null;
    qtyOnHand: string;
    disposition: string;
    dispositionRevision: number;
    dispositionReason: string | null;
  };
  let rows = $state<Lot[]>([]),
    item = $state<{ sku: string; name: string; unit: string; lotTracked: boolean } | null>(null),
    current = $state(1),
    total = $state(0),
    loading = $state(true),
    error = $state(''),
    busy = $state(false),
    uncertain = $state(false),
    form = $state(false);
  let code = $state(''),
    supplierLot = $state(''),
    manufacturedOn = $state(''),
    expiresOn = $state(''),
    search = $state('');
  const manage = $derived($auth?.user.permissions.includes('wms.manage'));
  const id = $derived($page.params.id);
  const focusedLot = $derived($page.url.searchParams.get('lotId') ?? '');
  let generation = 0;
  let loadedItemId = '';
  beforeNavigate((n) => {
    if (busy) {
      n.cancel();
      error = 'Attendez la réponse avant de quitter.';
    }
  });
  $effect(() => {
    void search;
    void focusedLot;
    untrack(() => {
      current = 1;
    });
  });
  async function load() {
    const g = ++generation;
    if (loadedItemId !== id) {
      rows = [];
      item = null;
      loadedItemId = id ?? '';
    }
    loading = true;
    error = '';
    try {
      const [i, r] = await Promise.all([
        api<typeof item>(`/wms/items/${id}`),
        api<Paginated<Lot>>(`/wms/items/${id}/lots`, {
          query: { page: current, pageSize: 20, search, lotId: focusedLot || undefined },
        }),
      ]);
      if (g === generation) {
        item = i;
        rows = r.items;
        total = r.total;
        uncertain = false;
      }
    } catch (e) {
      if (g === generation) error = e instanceof Error ? e.message : 'Lecture impossible.';
    } finally {
      if (g === generation) loading = false;
    }
  }
  $effect(() => {
    void id;
    void current;
    void load();
  });
  async function save() {
    if (busy || uncertain) return;
    busy = true;
    error = '';
    try {
      await api(`/wms/items/${id}/lots`, {
        method: 'POST',
        body: {
          code,
          ...(supplierLot ? { supplierLot } : {}),
          ...(manufacturedOn ? { manufacturedOn } : {}),
          ...(expiresOn ? { expiresOn } : {}),
        },
      });
      form = false;
      code = '';
      supplierLot = '';
      manufacturedOn = '';
      expiresOn = '';
      await load();
    } catch (e) {
      error = e instanceof Error ? e.message : 'Création impossible.';
      uncertain = !(e instanceof ApiError) || e.statusCode >= 500 || e.statusCode === 409;
    } finally {
      busy = false;
    }
  }
</script>

<svelte:head><title>Lots de stock | Pulsar</title></svelte:head>
<div class="space-y-5">
  <PageHeader title={item ? `Lots · ${item.sku}` : 'Lots de stock'} count={total} />
  <div class="flex flex-wrap gap-4 text-sm">
    <a class="text-accent underline" href="/wms/items">← Articles</a><a
      class="text-accent underline"
      href="/documentation?module=wms">Règles du suivi par lot</a
    ><Button
      variant="ghost"
      disabled={busy}
      onclick={() => {
        form = false;
        void load();
      }}>Relire les lots enregistrés</Button
    >
  </div>
  <p class="max-w-3xl text-sm text-ink-muted">
    {item?.name} · Chaque lot conserve son identité et ses dates déclarées. Créer la fiche ne crée aucun
    stock. Les quantités ci-dessous couvrent tous vos entrepôts, pour cet article uniquement.
  </p>
  {#if error}<p role="alert" class="text-danger text-sm">{error}</p>{/if}
  {#if uncertain}<p class="text-warn text-sm">
      Résultat à vérifier. Relisez les lots enregistrés avant une nouvelle demande; aucun renvoi
      automatique.
    </p>{/if}
  {#if item && !item.lotTracked}<p class="rounded-lg border border-edge p-4 text-sm">
      Cet article ne suit pas les lots. Ce choix est fait à la création; son historique ne sera pas
      réinterprété.
    </p>{/if}
  {#if manage && item?.lotTracked && !form}<Button
      disabled={busy || loading || uncertain}
      onclick={() => {
        form = true;
      }}>Créer un lot</Button
    >{/if}
  {#if form}<form
      class="max-w-3xl rounded-lg border border-edge p-4 space-y-4"
      onsubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <h2 class="text-sm font-semibold">Identité du lot</h2>
      <fieldset class="grid min-w-0 gap-4 sm:grid-cols-2" disabled={busy || uncertain}>
        <Field label="Numéro de lot"><Input bind:value={code} required maxlength={100} /></Field
        ><Field label="Lot fournisseur (facultatif)"
          ><Input bind:value={supplierLot} maxlength={100} /></Field
        >
        <Field label="Date de fabrication"><Input type="date" bind:value={manufacturedOn} /></Field
        ><Field label="Date de péremption"><Input type="date" bind:value={expiresOn} /></Field>
      </fieldset>
      <p class="text-xs text-ink-muted">
        Dates civiles facultatives, sans conversion de fuseau. Identité et dates sont fixes après
        création : vérifiez l’étiquette. Aucune interdiction automatique d’utilisation ni règle
        réglementaire n’est déduite de ces dates.
      </p>
      <div class="flex flex-wrap gap-2">
        <Button type="submit" loading={busy} disabled={uncertain}>Enregistrer le lot</Button><Button
          variant="ghost"
          disabled={busy}
          onclick={() => {
            form = false;
          }}>Annuler</Button
        >
      </div>
    </form>{/if}
  <Field label="Rechercher un lot"><Input bind:value={search} maxlength={100} /></Field>
  {#if focusedLot}<p class="text-sm text-ink-muted">
      Vue du lot lié au contrôle. <a class="text-accent underline" href={`/wms/items/${id}/lots`}
        >Voir tous les lots de cet article</a
      >
    </p>{/if}
  {#if loading && !rows.length}<Skeleton rows={3} />{:else if !rows.length && !error}<p
      class="rounded-lg border border-dashed border-edge p-5 text-sm text-ink-muted"
    >
      Aucun lot enregistré pour cette recherche.
    </p>{:else}<div class="space-y-3">
      {#each rows as lot (lot.id)}<article class="rounded-lg border border-edge p-4 space-y-3">
          <div class="flex flex-wrap justify-between gap-3">
            <h2 class="font-mono font-semibold break-all">{lot.code}</h2>
            <span class="font-mono">{lot.qtyOnHand} {item?.unit} en stock</span>
          </div>
          <dl class="grid gap-3 text-sm sm:grid-cols-3">
            <div>
              <dt class="text-ink-muted">Lot fournisseur</dt>
              <dd class="break-all">{lot.supplierLot ?? '—'}</dd>
            </div>
            <div>
              <dt class="text-ink-muted">Fabrication déclarée</dt>
              <dd>{lot.manufacturedOn?.slice(0, 10) ?? '—'}</dd>
            </div>
            <div>
              <dt class="text-ink-muted">Péremption déclarée</dt>
              <dd>{lot.expiresOn?.slice(0, 10) ?? '—'}</dd>
            </div>
          </dl>
          <a
            class="text-sm text-accent underline"
            href={`/wms/movements?itemId=${id}&lotId=${lot.id}`}>Voir les mouvements de ce lot →</a
          >
          <LotDispositionPanel itemId={id ?? ''} {lot} onchange={() => void load()} />
          <LotConnections
            itemId={id ?? ''}
            lotId={lot.id}
            revision={lot.dispositionRevision}
            unit={item?.unit ?? ''}
          />
        </article>{/each}
    </div>{/if}
  <div class="flex justify-end items-center gap-3">
    <Button
      variant="ghost"
      disabled={loading || current === 1}
      onclick={() => {
        current--;
      }}>Précédent</Button
    ><span class="text-sm">{current} / {Math.max(1, Math.ceil(total / 20))}</span><Button
      variant="ghost"
      disabled={loading || current * 20 >= total}
      onclick={() => {
        current++;
      }}>Suivant</Button
    >
  </div>
</div>
