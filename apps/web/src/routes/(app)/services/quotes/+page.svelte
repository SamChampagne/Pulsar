<script lang="ts">
  import { api, ApiError } from '$lib/api/client';
  import { auth } from '$lib/stores/auth';
  import { page } from '$app/state';
  import DocumentCoordinates from '$lib/components/reference-data/DocumentCoordinates.svelte';
  import {
    PageHeader,
    Button,
    Modal,
    Field,
    Input,
    Select,
    EntityPicker,
    ErrorNotice,
    Skeleton,
    EmptyState,
    Badge,
  } from '$lib/components/ui';
  type Line = {
    catalogItemId: string;
    name?: string;
    quantity: number;
    unitPrice: number;
    unit?: string;
  };
  type Quote = {
    id: string;
    number: string;
    title: string;
    partnerId: string;
    partner: { name: string };
    currency: string;
    validUntil: string | null;
    lines: Line[];
    totalAmount: string;
    status: string;
    updatedAt: string;
    project: { id: string; number: string } | null;
  };
  const manage = $derived($auth?.user.permissions.includes('services.manage'));
  let rows = $state<Quote[]>([]),
    total = $state(0),
    current = $state(1),
    search = $state(''),
    loading = $state(true),
    error = $state('');
  let open = $state(false),
    busy = $state(false),
    coordinatesBusy = $state(false),
    selected = $state<Quote | null>(null),
    formError = $state(''),
    uncertain = $state(false);
  let title = $state(''),
    partnerId = $state(''),
    currency = $state('CAD'),
    validUntil = $state(''),
    lines = $state<Line[]>([]);
  let itemId = $state(''),
    itemName = $state(''),
    itemUnit = $state(''),
    quantity = $state(1),
    unitPrice = $state(0),
    confirm = $state('');
  let intent = $state<{
    operationKey: string;
    title: string;
    partnerId: string;
    currency: string;
    validUntil: string | null;
    lines: Line[];
  } | null>(null);
  const key = $derived(`pulsar:quote-intent:${$auth?.tenant.id}:${$auth?.user.id}`);
  let generation = 0;
  async function load() {
    const g = ++generation;
    loading = true;
    error = '';
    try {
      const r = await api<{ items: Quote[]; total: number }>('/services/quotes', {
        query: { page: current, pageSize: 20, search },
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
  $effect(() => {
    current;
    search;
    void load();
  });
  function show(q: Quote | null) {
    selected = q;
    title = q?.title ?? '';
    partnerId = q?.partnerId ?? '';
    currency = q?.currency ?? 'CAD';
    validUntil = q?.validUntil?.slice(0, 10) ?? '';
    lines = structuredClone(q ? $state.snapshot(q.lines) : []);
    formError = '';
    uncertain = false;
    confirm = '';
    intent = null;
    open = true;
    if (!q) {
      try {
        const stored = sessionStorage.getItem(key);
        if (stored) {
          intent = JSON.parse(stored);
          uncertain = true;
        }
      } catch {
        formError = 'Stockage de reprise indisponible.';
      }
    }
  }
  $effect(() => {
    const id = page.url.searchParams.get('quoteId');
    if (!id) return;
    let stale = false;
    void api<Quote>(`/services/quotes/${encodeURIComponent(id)}`)
      .then((q) => {
        if (!stale) show(q);
      })
      .catch((e) => {
        if (!stale) error = e.message;
      });
    return () => {
      stale = true;
    };
  });
  function add() {
    if (!itemId || quantity <= 0 || unitPrice <= 0) return;
    lines = [
      ...lines,
      {
        catalogItemId: itemId,
        name: itemName,
        unit: itemUnit,
        quantity: Number(quantity),
        unitPrice: Number(unitPrice),
      },
    ];
    itemId = '';
  }
  async function save() {
    if (busy || coordinatesBusy || (uncertain && !intent)) return;
    busy = true;
    formError = '';
    try {
      const body = {
        title,
        partnerId,
        currency,
        validUntil: validUntil || null,
        lines: lines.map((l) => ({
          catalogItemId: l.catalogItemId,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
        })),
      };
      if (!selected && !intent) {
        intent = { ...body, operationKey: crypto.randomUUID() };
        sessionStorage.setItem(key, JSON.stringify(intent));
      }
      const result = await api<Quote>(`/services/quotes${selected ? '/' + selected.id : ''}`, {
        method: selected ? 'PATCH' : 'POST',
        body: selected ? { ...body, expectedUpdatedAt: selected.updatedAt } : intent,
      });
      if (intent) sessionStorage.removeItem(key);
      intent = null;
      show(result);
      await load();
    } catch (e) {
      formError = (e as Error).message;
      uncertain = !(e instanceof ApiError) || e.statusCode >= 500;
      if (!uncertain && intent) {
        sessionStorage.removeItem(key);
        intent = null;
      }
    } finally {
      busy = false;
    }
  }
  async function transition() {
    if (!selected || busy || coordinatesBusy || uncertain) return;
    busy = true;
    try {
      const result = await api<Quote>(`/services/quotes/${selected.id}/transition`, {
        method: 'POST',
        body: { status: confirm, expectedUpdatedAt: selected.updatedAt },
      });
      show(result);
      await load();
    } catch (e) {
      formError = (e as Error).message;
      uncertain = !(e instanceof ApiError) || e.statusCode >= 500;
    } finally {
      busy = false;
    }
  }
</script>

<svelte:head><title>Devis Services | Pulsar</title></svelte:head>
<PageHeader
  title="Devis Services"
  subtitle="Chiffrer une prestation, figer l’accord puis ouvrir un projet."
  count={total}
  >{#snippet actions()}{#if manage}<Button onclick={() => show(null)}>Nouveau devis</Button
      >{/if}{/snippet}</PageHeader
>
<div class="mb-4 max-w-sm">
  <Input
    aria-label="Rechercher un devis"
    placeholder="Numéro ou titre"
    bind:value={search}
    oninput={() => {
      current = 1;
    }}
  />
</div>
<ErrorNotice message={error} onretry={load} />
{#if loading}<Skeleton rows={5} />{:else if !rows.length}<EmptyState
    title="Aucun devis"
    message="Choisissez ou ajoutez votre client et une prestation directement dans le devis, puis chiffrez votre offre. Aucun autre module à activer."
  />{:else}<div class="divide-y divide-edge rounded-xl border border-edge bg-surface">
    {#each rows as q}<div class="flex flex-wrap items-center justify-between gap-3 p-4">
        <div>
          <p class="font-medium">{q.number} · {q.title}</p>
          <p class="mt-1 text-sm text-ink-muted">
            {q.partner.name} · {q.totalAmount}
            {q.currency} · {q.status}
          </p>
        </div>
        <Button variant="secondary" onclick={() => show(q)}>Ouvrir le devis</Button>
      </div>{/each}
  </div>{/if}
<div class="mt-4 flex justify-end gap-2">
  <Button
    variant="ghost"
    disabled={current === 1}
    onclick={() => {
      current--;
    }}>Précédent</Button
  ><Button
    variant="ghost"
    disabled={current * 20 >= total}
    onclick={() => {
      current++;
    }}>Suivant</Button
  >
</div>
<Modal
  bind:open
  title={selected?.number ?? 'Nouveau devis'}
  size="lg"
  dismissible={!busy && !coordinatesBusy}
>
  <ErrorNotice message={formError} />
  {#if uncertain}<p class="my-3 rounded-md bg-warn-soft p-3 text-sm">
      Réponse incertaine. {intent
        ? 'La demande initiale est conservée : reprendre utilise exactement la même clé et le même contenu.'
        : 'Fermez et rouvrez le devis depuis la liste actualisée pour vérifier son état.'}
    </p>{/if}
  {#if intent && uncertain}<Button loading={busy} onclick={save}
      >Reprendre la demande conservée</Button
    >{:else if !selected || selected.status === 'DRAFT'}
    <form
      class="space-y-4"
      onsubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <fieldset disabled={!manage || busy || coordinatesBusy || uncertain} class="space-y-4">
        <Field label="Titre"><Input bind:value={title} required maxlength={200} /></Field>
        <EntityPicker
          label="Client"
          endpoint="/services/references/customers"
          bind:value={partnerId}
          selectedLabel={selected?.partner.name}
        />
        <div class="grid grid-cols-2 gap-3">
          <Field label="Devise"
            ><Select bind:value={currency}
              >{#each ['CAD', 'USD', 'EUR', 'GBP'] as c}<option>{c}</option>{/each}</Select
            ></Field
          ><Field label="Valide jusqu’au"><Input type="date" bind:value={validUntil} /></Field>
        </div>
        <div class="rounded-lg border border-edge p-3">
          <EntityPicker
            label="Prestation à ajouter"
            endpoint="/services/references/items"
            bind:value={itemId}
            onselect={(r) => {
              itemName = String(r.name);
              itemUnit = String(r.unit);
            }}
          />
          <div class="my-3 grid grid-cols-2 gap-3">
            <Field label="Quantité"
              ><Input type="number" min="0.0001" step="0.0001" bind:value={quantity} /></Field
            ><Field label="Prix unitaire"
              ><Input type="number" min="0.0001" step="0.0001" bind:value={unitPrice} /></Field
            >
          </div>
          <Button variant="secondary" onclick={add}>Ajouter la ligne</Button>
        </div>
        {#each lines as line, i}<div class="flex justify-between gap-3 text-sm">
            <span>{line.name} · {line.quantity} {line.unit} × {line.unitPrice} {currency}</span
            ><Button
              variant="ghost"
              onclick={() => {
                lines = lines.filter((_, n) => n !== i);
              }}>Retirer</Button
            >
          </div>{/each}
        <Button type="submit" disabled={!partnerId || !lines.length} loading={busy}
          >Enregistrer le devis</Button
        >
      </fieldset>
    </form>
    {#if selected && manage}<div class="mt-5 border-t border-edge pt-4">
        <p class="mb-3 text-sm text-ink-muted">
          L’acceptation porte sur le dernier devis enregistré ({selected.totalAmount}
          {selected.currency}). Elle fige ses lignes et crée un seul projet brouillon. Aucun
          courriel ni facture n’est envoyé.
        </p>
        <div class="flex gap-2">
          <Button
            disabled={busy || coordinatesBusy || uncertain}
            onclick={() => {
              confirm = 'ACCEPTED';
            }}>Accepter le devis enregistré</Button
          ><Button
            variant="ghost"
            disabled={busy || coordinatesBusy || uncertain}
            onclick={() => {
              confirm = 'CANCELLED';
            }}>Annuler le devis</Button
          >
        </div>
      </div>{/if}
  {:else}<Badge>{selected.status === 'ACCEPTED' ? 'Accepté — prix figés' : 'Annulé'}</Badge>
    <h2 class="my-3 font-medium">{selected.title}</h2>
    <p class="mb-3 text-sm">
      {selected.partner.name} · {selected.totalAmount}
      {selected.currency} hors taxes
    </p>
    {#each selected.lines as line}<p class="py-2 text-sm">
        {line.name} · {line.quantity}
        {line.unit} × {line.unitPrice}
        {selected.currency}
      </p>{/each}{#if selected.project}<Button href={`/services/projects/${selected.project.id}`}
        >Ouvrir {selected.project.number}</Button
      >{/if}{/if}
  {#if confirm}<div class="mt-4 rounded-lg border border-edge p-4">
      <p class="mb-3 text-sm">
        Confirmer {confirm === 'ACCEPTED'
          ? 'l’accord et la création du projet'
          : 'l’annulation définitive'} ?
      </p>
      <Button loading={busy} disabled={uncertain || coordinatesBusy} onclick={transition}
        >Confirmer</Button
      ><Button
        variant="ghost"
        onclick={() => {
          confirm = '';
        }}>Retour</Button
      >
    </div>{/if}
  {#if selected}
    {#key selected.id + selected.status}
      <DocumentCoordinates
        directoryBase="/services/data/customers"
        endpoint={`/services/quotes/${selected.id}/coordinates`}
        documentVersion={selected.updatedAt}
        bind:busy={coordinatesBusy}
        canManage={!!manage && !busy && !uncertain}
        onchanged={async () => {
          if (selected) selected = await api<Quote>(`/services/quotes/${selected.id}`);
          await load();
        }}
      />
    {/key}
  {/if}
</Modal>
