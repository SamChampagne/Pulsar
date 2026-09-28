<script lang="ts">
  import {
    PartyDirectoryKind,
    directoryValidity,
    validateDirectoryEntry,
    type DirectoryEntryData,
    type Paginated,
  } from '@pulsar/shared';
  import { api, ApiError } from '$lib/api/client';
  import { auth } from '$lib/stores/auth';
  import { userTimeZone } from '$lib/stores/time-zone.svelte';
  import { formatDate, formatDateTime } from '$lib/format';
  import { Drawer, Button, Badge, ErrorNotice, Skeleton, EmptyState } from '$lib/components/ui';
  import AddressFields, { type Address } from './AddressFields.svelte';
  import DirectoryImpact from './DirectoryImpact.svelte';
  import {
    readDirectoryIntent,
    rememberDirectoryIntent,
    clearDirectoryIntent,
    type DirectoryIntent,
  } from './directory-intent';
  interface Entry {
    id: string;
    kind: PartyDirectoryKind;
    label: string;
    version: number;
    data: DirectoryEntryData;
    updatedAt: string;
  }
  interface Revision {
    version: number;
    snapshot: Entry;
    reason: string;
    createdAt: string;
  }
  let {
    endpoint,
    name,
    canManage,
    onclose,
  }: { endpoint: string; name: string; canManage: boolean; onclose: () => void } = $props();
  let open = $state(true),
    kind = $state(PartyDirectoryKind.ADDRESS),
    page = $state(1),
    revision = $state(0);
  let search = $state(''),
    rows = $state<Entry[]>([]),
    total = $state(0),
    loading = $state(true),
    error = $state('');
  let editing = $state(false),
    editingRow = $state<Entry | null>(null),
    busy = $state(false);
  let draft = $state<DirectoryEntryData>(blank()),
    address = $state<Address | null>(null),
    reason = $state('');
  let pending = $state<DirectoryIntent | null>(null),
    storageError = $state('');
  let history = $state<Entry | null>(null),
    historyRows = $state<Revision[]>([]),
    historyPage = $state(1),
    historyTotal = $state(0);
  let impact = $state<Entry | null>(null);
  let onDate = $state(
    new Intl.DateTimeFormat('en-CA', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      timeZone: userTimeZone.value,
    }).format(new Date()),
  );
  const scope = $derived(`${$auth?.tenant.id}:${$auth?.user.id}:${endpoint}`);
  const validityLabels = {
    ACTIVE: 'Valide',
    INACTIVE: 'Désactivée',
    UPCOMING: 'À venir',
    EXPIRED: 'Expirée',
    UNKNOWN: 'Date à choisir',
  };
  function blank(): DirectoryEntryData {
    return {
      kind: PartyDirectoryKind.ADDRESS,
      label: '',
      role: 'Livraison',
      active: true,
      validFrom: null,
      validUntil: null,
      email: '',
      phone: '',
      address: null,
      notes: '',
    };
  }
  const addressText = (a: DirectoryEntryData['address']) =>
    a
      ? [a.line1, a.line2, a.city, a.region, a.postalCode, a.countryCode].filter(Boolean).join(', ')
      : '';
  $effect(() => {
    try {
      pending = readDirectoryIntent(scope);
      storageError = '';
    } catch (e) {
      storageError = (e as Error).message;
    }
  });
  $effect(() => {
    if (!open) onclose();
  });
  $effect(() => {
    const path = endpoint,
      p = history ? historyPage : page,
      h = history?.id,
      q = search,
      k = kind;
    void revision;
    let stale = false;
    loading = true;
    error = '';
    const timer = setTimeout(() => {
      api<Paginated<Entry | Revision>>(h ? `${path}/${h}/history` : path, {
        query: { page: p, pageSize: 20, ...(!h ? { kind: k, search: q } : {}) },
      })
        .then((r) => {
          if (stale) return;
          if (h) {
            historyRows = r.items as Revision[];
            historyTotal = r.total;
          } else {
            rows = r.items as Entry[];
            total = r.total;
          }
        })
        .catch((e) => {
          if (!stale) {
            error = e.message;
            rows = [];
            historyRows = [];
          }
        })
        .finally(() => {
          if (!stale) loading = false;
        });
    }, 100);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  });
  function edit(row: Entry | null) {
    editingRow = row;
    draft = row
      ? JSON.parse(JSON.stringify(row.data))
      : { ...blank(), kind, role: kind === 'ADDRESS' ? 'Livraison' : 'Réception' };
    address = draft.address
      ? { ...draft.address }
      : kind === 'ADDRESS'
        ? { line1: '', city: '', countryCode: 'CA' }
        : null;
    reason = '';
    error = '';
    editing = true;
  }
  async function send(intent: DirectoryIntent) {
    if (busy) return;
    busy = true;
    error = '';
    try {
      await api(`${endpoint}${intent.id ? '/' + encodeURIComponent(intent.id) : ''}`, {
        method: intent.id ? 'PATCH' : 'POST',
        body: intent.body,
      });
      clearDirectoryIntent(scope, intent.body.operationKey);
      pending = null;
      editing = false;
      revision++;
    } catch (e) {
      error = (e as Error).message;
      if (
        e instanceof ApiError &&
        e.statusCode >= 400 &&
        e.statusCode < 500 &&
        e.statusCode !== 408
      ) {
        try {
          clearDirectoryIntent(scope, intent.body.operationKey);
          pending = null;
        } catch (err) {
          storageError = (err as Error).message;
        }
      }
    } finally {
      busy = false;
    }
  }
  async function save(e: SubmitEvent) {
    e.preventDefault();
    if (busy || pending || storageError) return;
    const checked = validateDirectoryEntry({
      ...draft,
      address: draft.kind === 'ADDRESS' ? address : null,
    });
    if (!checked.value) {
      error = checked.errors.join(' ');
      return;
    }
    const intent: DirectoryIntent = {
      id: editingRow?.id ?? null,
      body: {
        operationKey: crypto.randomUUID(),
        ...(editingRow ? { expectedVersion: editingRow.version } : {}),
        entry: checked.value,
        reason: reason.trim(),
      },
    };
    try {
      rememberDirectoryIntent(scope, intent);
      pending = intent;
    } catch (e) {
      storageError = 'Aucun envoi : ' + (e as Error).message;
      return;
    }
    await send(intent);
  }
</script>

<Drawer bind:open title={`Carnet · ${name}`} width="xl" dismissible={!busy}>
  <p class="mb-4 text-sm text-ink-muted">
    Adresses et contacts partagés. Aucun accès portail, destinataire d’envoi ou document existant ne
    change automatiquement.
  </p>
  <ErrorNotice message={storageError || error} />
  {#if pending}<section
      class="my-4 rounded-lg border border-warn/30 bg-warn/5 p-4"
      aria-label="Demande à confirmer"
    >
      <p class="text-sm">
        La modification « {pending.body.entry.label} » attend confirmation. La même demande est conservée
        dans cet onglet, même après rechargement.
      </p>
      {#if canManage}<Button
          disabled={busy}
          onclick={() => {
            if (pending) return send(pending);
          }}>Vérifier / reprendre la même demande</Button
        >{/if}
    </section>{/if}
  {#if editing}
    <form onsubmit={save} class="space-y-4" aria-label="Éditer le carnet">
      <div class="flex items-center justify-between gap-3">
        <h2 class="text-lg font-semibold">
          {editingRow ? 'Modifier' : 'Ajouter'}
          {draft.kind === 'ADDRESS' ? 'une adresse' : 'un contact'}
        </h2>
        <Button
          variant="ghost"
          disabled={busy}
          onclick={() => {
            editing = false;
            revision++;
          }}>Retour au carnet</Button
        >
      </div>
      <fieldset disabled={busy || !!pending || !!storageError} class="space-y-4">
        <div class="grid gap-4 sm:grid-cols-2">
          <label class="grid gap-1 text-sm"
            >{draft.kind === 'ADDRESS' ? 'Nom du site / adresse' : 'Nom du contact'}<input
              class="rounded-lg border border-edge bg-surface px-3 py-2"
              required
              maxlength="160"
              bind:value={draft.label}
            /></label
          >
          <label class="grid gap-1 text-sm"
            >Fonction / usage<input
              class="rounded-lg border border-edge bg-surface px-3 py-2"
              required
              maxlength="100"
              list="directory-roles"
              bind:value={draft.role}
            /></label
          >
          <datalist id="directory-roles"
            ><option value="Facturation"></option><option value="Livraison"></option><option
              value="Enlèvement"
            ></option><option value="Réception"></option><option value="Achats"></option><option
              value="Service client"
            ></option></datalist
          >
        </div>
        <p class="text-xs text-ink-muted">
          La fonction est un libellé libre adapté à votre entreprise, pas une permission d’accès.
        </p>
        {#if draft.kind === 'ADDRESS'}<AddressFields
            label="Coordonnées du site"
            bind:value={address}
          />{/if}
        <div class="grid gap-4 sm:grid-cols-2">
          <label class="grid gap-1 text-sm"
            >Courriel<input
              class="rounded-lg border border-edge bg-surface px-3 py-2"
              type="email"
              maxlength="254"
              bind:value={draft.email}
            /></label
          >
          <label class="grid gap-1 text-sm"
            >Téléphone<input
              class="rounded-lg border border-edge bg-surface px-3 py-2"
              type="tel"
              maxlength="40"
              bind:value={draft.phone}
            /></label
          >
          <label class="grid gap-1 text-sm"
            >Valide à partir du<input
              class="rounded-lg border border-edge bg-surface px-3 py-2"
              type="date"
              min="1900-01-01"
              max="2199-12-31"
              bind:value={draft.validFrom}
            /></label
          >
          <label class="grid gap-1 text-sm"
            >Fin de validité (exclue)<input
              class="rounded-lg border border-edge bg-surface px-3 py-2"
              type="date"
              min="1900-01-01"
              max="2199-12-31"
              bind:value={draft.validUntil}
            /></label
          >
        </div>
        <p class="text-xs text-ink-muted">
          Exemple : une fin au 1er octobre signifie que la fiche n’est plus valide le 1er octobre.
          Une borne vide n’impose pas de limite.
        </p>
        <label class="flex items-center gap-2 text-sm"
          ><input type="checkbox" bind:checked={draft.active} />Fiche active</label
        >
        <label class="grid gap-1 text-sm"
          >Instructions / notes<textarea
            class="rounded-lg border border-edge bg-surface px-3 py-2"
            rows="2"
            maxlength="1000"
            bind:value={draft.notes}
          ></textarea></label
        >
        <label class="grid gap-1 text-sm"
          >Motif de la modification<textarea
            class="rounded-lg border border-edge bg-surface px-3 py-2"
            required
            minlength="3"
            maxlength="500"
            rows="2"
            bind:value={reason}
          ></textarea></label
        >
        <p class="text-xs text-ink-muted">
          Une nouvelle version sera conservée. Les adresses par défaut de la fiche principale, les
          horaires et les documents engagés restent inchangés.
        </p>
        {#if canManage}<Button type="submit" disabled={busy || !!pending}
            >Enregistrer la version</Button
          >{/if}
      </fieldset>
    </form>
  {:else if impact}
    <DirectoryImpact
      endpoint={`${endpoint}/${impact.id}/impact`}
      onback={() => {
        impact = null;
        revision++;
      }}
    />
  {:else if history}
    <Button
      variant="ghost"
      onclick={() => {
        history = null;
        historyPage = 1;
      }}>Retour au carnet</Button
    >
    <h2 class="my-4 text-lg font-semibold">Historique · {history.label}</h2>
    {#if loading}<Skeleton rows={4} />{:else if !error}
      {#each historyRows as r (r.version)}<details class="mb-3 rounded-lg border border-edge p-4">
          <summary class="cursor-pointer text-sm font-medium"
            >Version {r.version} · {formatDateTime(r.createdAt)}</summary
          >
          <p class="my-2 text-sm">{r.reason}</p>
          <p class="text-sm font-semibold">{r.snapshot.data.label} · {r.snapshot.data.role}</p>
          <p class="text-sm text-ink-muted">{addressText(r.snapshot.data.address)}</p>
          <p class="text-sm">
            {[r.snapshot.data.email, r.snapshot.data.phone].filter(Boolean).join(' · ')}
          </p>
          <p class="text-xs text-ink-muted">
            {r.snapshot.data.active ? 'Active' : 'Désactivée'} · {formatDate(
              r.snapshot.data.validFrom,
            )} → {formatDate(r.snapshot.data.validUntil)} (fin exclue)
          </p>
          <p class="mt-2 whitespace-pre-wrap text-sm">{r.snapshot.data.notes}</p>
        </details>{/each}
      <div class="flex items-center justify-between gap-2 text-sm">
        <span>{historyTotal} versions · page {historyPage}</span><Button
          variant="secondary"
          disabled={historyPage <= 1}
          onclick={() => {
            historyPage--;
          }}>Précédent</Button
        ><Button
          variant="secondary"
          disabled={historyPage * 20 >= historyTotal}
          onclick={() => {
            historyPage++;
          }}>Suivant</Button
        >
      </div>
    {/if}
  {:else}
    <div class="mb-4 flex flex-wrap gap-2" aria-label="Type de carnet">
      {#each [PartyDirectoryKind.ADDRESS, PartyDirectoryKind.CONTACT] as k}<Button
          variant={kind === k ? 'primary' : 'secondary'}
          onclick={() => {
            kind = k;
            page = 1;
            search = '';
          }}>{k === 'ADDRESS' ? 'Adresses' : 'Contacts'}</Button
        >{/each}
    </div>
    <div class="mb-4 grid gap-3 sm:grid-cols-2">
      <label class="grid gap-1 text-sm"
        >Rechercher dans le carnet<input
          class="min-w-0 rounded-lg border border-edge bg-surface px-3 py-2"
          value={search}
          oninput={(e) => {
            search = e.currentTarget.value;
            page = 1;
          }}
        /></label
      ><label class="grid gap-1 text-sm"
        >Validité au<input
          class="rounded-lg border border-edge bg-surface px-3 py-2"
          type="date"
          bind:value={onDate}
        /></label
      >
    </div>
    {#if canManage}<div class="mb-4">
        <Button disabled={!!pending || !!storageError} onclick={() => edit(null)}
          >{kind === 'ADDRESS' ? 'Ajouter une adresse' : 'Ajouter un contact'}</Button
        >
      </div>{/if}
    {#if loading}<Skeleton rows={4} />{:else if !error && !rows.length}<EmptyState
        title="Carnet à compléter"
        message="Ajoutez les sites et interlocuteurs utiles à ce dossier. Les coordonnées historiques restent sur la fiche principale; aucune copie n’est créée automatiquement."
      />{:else if !error}
      <ul class="divide-y divide-edge rounded-lg border border-edge">
        {#each rows as row (row.id)}<li class="p-4">
            <div class="flex flex-wrap items-start justify-between gap-2">
              <div class="min-w-0">
                <h3 class="break-words font-semibold">{row.data.label}</h3>
                <p class="text-sm text-ink-muted">{row.data.role}</p>
              </div>
              <Badge tone={directoryValidity(row.data, onDate) === 'ACTIVE' ? 'ok' : 'neutral'}
                >{validityLabels[directoryValidity(row.data, onDate)]}</Badge
              >
            </div>
            <p class="mt-2 break-words text-sm">{addressText(row.data.address)}</p>
            <p class="break-words text-sm">
              {[row.data.email, row.data.phone].filter(Boolean).join(' · ')}
            </p>
            <p class="mt-2 text-xs text-ink-muted">
              Version {row.version} · {formatDate(row.data.validFrom)} → {formatDate(
                row.data.validUntil,
              )} (fin exclue)
            </p>
            <div class="mt-2 flex flex-wrap gap-2">
              {#if canManage}<Button
                  variant="ghost"
                  disabled={!!pending || !!storageError}
                  aria-label={`Modifier ${row.label}`}
                  onclick={() => edit(row)}>Modifier</Button
                >{/if}<Button
                variant="ghost"
                aria-label={`Historique ${row.label}`}
                onclick={() => {
                  history = row;
                  historyPage = 1;
                }}>Historique</Button
              ><Button
                variant="ghost"
                aria-label={`Documents utilisant ${row.label}`}
                disabled={!!pending || !!storageError}
                onclick={() => {
                  impact = row;
                }}>Documents liés</Button
              >
            </div>
          </li>{/each}
      </ul>
      <div class="mt-4 flex items-center justify-between gap-2 text-sm">
        <span>{total} fiches · page {page}</span><Button
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
    {/if}
  {/if}
  {#if error}<div class="mt-3">
      <Button
        variant="secondary"
        onclick={() => {
          revision++;
        }}>Recharger le carnet</Button
      >
    </div>{/if}
</Drawer>
