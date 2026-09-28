<script lang="ts">
  import ScanInput from '$lib/components/scanning/ScanInput.svelte';
  import { beforeNavigate } from '$app/navigation';
  import { auth } from '$lib/stores/auth';
  import type { ScanResult } from '@pulsar/shared';
  import { confirmAction } from '$lib/stores/confirmation';
  import { api, ApiError } from '$lib/api/client';
  import {
    Badge,
    Button,
    Card,
    EmptyState,
    EntityPicker,
    Field,
    PageHeader,
    Skeleton,
    Table,
    ViewToggle,
    type ViewId,
    type Tone,
  } from '$lib/components/ui';
  import { toast } from '$lib/stores/toast';

  interface Bin {
    id: string;
    code: string;
    location: { code: string; name: string };
  }
  interface CountLine {
    id: string;
    itemId: string;
    systemQty: string;
    countedQty: string | null;
    unitSnapshot: string | null;
    lotId: string | null;
    lot: { id: string; code: string; expiresOn: string | null } | null;
    item: { sku: string; name: string };
  }
  interface CycleCount {
    freshness: { valid: boolean; reason: string | null } | null;
    updatedAt: string;
    id: string;
    number: string;
    status: 'OPEN' | 'COUNTED' | 'RECONCILED' | 'CANCELLED';
    binId: string;
    note: string | null;
    bin: { code: string };
    lines?: CountLine[];
    _count?: { lines: number };
  }

  let counts = $state<CycleCount[]>([]);
  let bins = $state<Bin[]>([]);
  let selected = $state<CycleCount | null>(null);
  let loading = $state(true);
  let busy = $state(false);
  let createBinId = $state('');
  let createNote = $state('');
  let view = $state<ViewId>('table');
  // line id -> entered count (string)
  let entered = $state<Record<string, string>>({});
  let scanMode = $state<'select' | 'increment'>('select');
  let scannedLine = $state('');
  let scanCandidates = $state<CountLine[]>([]);
  let scanUnit = $state('');
  let scanRevision = $state(0);
  let uncertain = $state(false);
  let actionError = $state('');
  let reading = $state(false);
  let opening = $state(false);
  let openRequest = 0;
  const dirty = $derived(
    selected?.status === 'OPEN' &&
      (selected.lines ?? []).some(
        (l) => String(entered[l.id] ?? '') !== String(l.countedQty ?? ''),
      ),
  );
  beforeNavigate(({ cancel }) => {
    if (busy || opening || reading) {
      cancel();
      return;
    }
    if (dirty && !window.confirm('Quitter ce comptage et perdre les quantités non enregistrées ?'))
      cancel();
  });
  const canManage = $derived(!!$auth?.user.permissions.includes('wms.manage'));
  const fresh = $derived(selected?.freshness?.valid === true);
  const filled = $derived(
    (selected?.lines ?? []).filter((l) => entered[l.id] !== '' && entered[l.id] != null).length,
  );
  function selectScannedLine(line: CountLine, unit: string) {
    scannedLine = line.id;
    if (scanMode === 'increment') {
      if (unit !== 'EA')
        throw new Error('Le mode +1 est réservé aux unités EA. Saisissez la quantité mesurée.');
      const current = entered[line.id] === '' ? 0 : Number(entered[line.id] ?? 0);
      if (!Number.isFinite(current) || current < 0 || current >= 1e9)
        throw new Error('Quantité invalide; corrigez la saisie.');
      entered[line.id] = String(current + 1);
    }
  }
  function chooseScanLot(line: CountLine) {
    if (busy || reading || opening || uncertain || !fresh || !canManage) return;
    try {
      selectScannedLine(line, scanUnit);
      scanCandidates = [];
      scanRevision++;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Sélection impossible');
    }
  }
  async function scanItem(code: string) {
    if (
      !selected ||
      selected.status !== 'OPEN' ||
      busy ||
      reading ||
      opening ||
      uncertain ||
      !canManage ||
      !fresh
    )
      return;
    const id = selected.id;
    const mode = scanMode;
    reading = true;
    try {
      const item = await api<ScanResult>('/scan/wms', {
        method: 'POST',
        body: { kind: 'item', code },
      });
      if (!selected || selected.id !== id || selected.status !== 'OPEN') return;
      scanCandidates = [];
      const matches = (selected.lines ?? []).filter((l) => l.itemId === item.id);
      if (matches.length > 1) {
        scanCandidates = matches;
        scanUnit = item.unit ?? '';
        return 'Plusieurs lots : choisissez le lot physique ci-dessous. Aucune quantité ajoutée.';
      }
      const line = matches[0];
      if (!line)
        throw new Error('Article absent de ce comptage. Aucun ajout ni ajustement effectué.');
      selectScannedLine(line, item.unit ?? '');
      return (
        item.code +
        (mode === 'increment'
          ? ' : ' + entered[line.id] + ' EA comptés (non enregistrés)'
          : ' sélectionné — saisir la quantité comptée')
      );
    } finally {
      reading = false;
    }
  }

  const KANBAN_COLS: { status: CycleCount['status']; label: string }[] = [
    { status: 'OPEN', label: 'Ouvert' },
    { status: 'COUNTED', label: 'Compté' },
    { status: 'RECONCILED', label: 'Réconcilié' },
    { status: 'CANCELLED', label: 'Annulé' },
  ];

  function statusTone(s: string): Tone {
    return s === 'RECONCILED'
      ? 'ok'
      : s === 'COUNTED'
        ? 'info'
        : s === 'CANCELLED'
          ? 'neutral'
          : 'warn';
  }

  function statusLabel(s: string): string {
    switch (s) {
      case 'OPEN':
        return 'Ouvert';
      case 'COUNTED':
        return 'Compté';
      case 'RECONCILED':
        return 'Réconcilié';
      case 'CANCELLED':
        return 'Annulé';
      default:
        return s;
    }
  }

  async function load() {
    loading = true;
    try {
      const [cc, bn] = await Promise.all([
        api<CycleCount[]>('/wms/cycle-counts'),
        api<Bin[]>('/wms/bins'),
      ]);
      counts = cc;
      bins = bn;
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Échec du chargement');
    } finally {
      loading = false;
    }
  }

  async function openCount(id: string, force = false) {
    if (!force && (busy || reading || opening)) return;
    if (
      !force &&
      dirty &&
      !uncertain &&
      !(await confirmAction('Abandonner les quantités non enregistrées et ouvrir ce comptage ?'))
    )
      return;
    const request = ++openRequest;
    opening = true;
    try {
      const c = await api<CycleCount>(`/wms/cycle-counts/${id}`);
      if (request !== openRequest) return;
      selected = c;
      actionError = '';
      scannedLine = '';
      scanCandidates = [];
      uncertain = false;
      entered = {};
      for (const l of c.lines ?? []) entered[l.id] = l.countedQty ?? '';
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Échec');
    } finally {
      if (request === openRequest) opening = false;
    }
  }

  async function create() {
    if (!canManage || busy || reading || opening) return;
    if (
      dirty &&
      !(await confirmAction('Abandonner le brouillon du comptage avant d’en créer un autre ?'))
    )
      return;
    if (!createBinId) {
      toast.error('Choisis un emplacement');
      return;
    }
    busy = true;
    try {
      const c = await api<CycleCount>('/wms/cycle-counts', {
        method: 'POST',
        body: { binId: createBinId, note: createNote.trim() || undefined },
      });
      createNote = '';
      await load();
      await openCount(c.id, true);
      toast.success(`${c.number} créé — saisis les quantités comptées`);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Échec de la création');
    } finally {
      busy = false;
    }
  }

  async function recordCounts() {
    if (!selected || busy || reading || opening || uncertain || !canManage || !fresh) return;
    const payload = (selected.lines ?? [])
      .filter((l) => entered[l.id] !== '' && entered[l.id] != null)
      .map((l) => ({ lineId: l.id, countedQty: Number(entered[l.id]) }));
    if (!payload.length || payload.length !== selected.lines?.length) {
      toast.error(
        'Comptez chaque ligne. Saisissez zéro si rien n’est trouvé; ne laissez aucune case vide.',
      );
      return;
    }
    if (
      payload.some(
        (l) =>
          !Number.isFinite(l.countedQty) ||
          l.countedQty < 0 ||
          Math.abs(l.countedQty * 1000 - Math.round(l.countedQty * 1000)) > 1e-7,
      )
    ) {
      toast.error('Quantités positives ou nulles, trois décimales maximum.');
      return;
    }
    if (
      !(await confirmAction(
        'Enregistrer les quantités comptées ? Cette étape clôture la saisie, sans ajuster le stock.',
      ))
    )
      return;
    busy = true;
    actionError = '';
    try {
      await api(`/wms/cycle-counts/${selected.id}/counts`, {
        method: 'POST',
        body: { counts: payload, expectedUpdatedAt: selected.updatedAt },
      });
      toast.success('Comptage enregistré');
      uncertain = true; // Remain read-only until the saved document has been reloaded.
      await load();
      await openCount(selected.id, true);
    } catch (e) {
      if (!(e instanceof ApiError && [400, 403, 404, 409, 422].includes(e.statusCode)))
        uncertain = true;
      actionError =
        e instanceof Error ? e.message : 'Échec de l’enregistrement. Actualisez le dossier.';
      toast.error(e instanceof ApiError ? e.message : 'Échec');
    } finally {
      busy = false;
    }
  }

  async function reconcile() {
    if (!selected || busy || opening || uncertain || !canManage || !fresh) return;
    if (
      !(await confirmAction(
        'Réconcilier ce comptage ? Les écarts seront appliqués au stock réel via des ajustements.',
      ))
    )
      return;
    busy = true;
    actionError = '';
    try {
      await api(`/wms/cycle-counts/${selected.id}/reconcile`, {
        method: 'POST',
        body: { expectedUpdatedAt: selected.updatedAt },
      });
      toast.success('Réconcilié — ajustements postés');
      uncertain = true;
      await load();
      await openCount(selected.id, true);
    } catch (e) {
      if (!(e instanceof ApiError && [400, 403, 404, 409, 422].includes(e.statusCode)))
        uncertain = true;
      actionError =
        e instanceof Error ? e.message : 'Échec de la réconciliation. Actualisez le dossier.';
      toast.error(e instanceof ApiError ? e.message : 'Échec de la réconciliation');
    } finally {
      busy = false;
    }
  }

  async function cancel(id: string) {
    if (!canManage || busy || reading || opening || uncertain) return;
    if (!(await confirmAction('Annuler ce comptage ?'))) return;
    busy = true;
    try {
      await api(`/wms/cycle-counts/${id}/cancel`, {
        method: 'POST',
        body: { expectedUpdatedAt: selected?.id === id ? selected.updatedAt : undefined },
      });
      uncertain = true;
      await load();
      if (selected?.id === id) await openCount(id, true);
    } catch (e) {
      if (!(e instanceof ApiError && [400, 403, 404, 409, 422].includes(e.statusCode)))
        uncertain = true;
      toast.error(e instanceof ApiError ? e.message : 'Échec');
    } finally {
      busy = false;
    }
  }

  function variance(l: CountLine): number | null {
    const v = selected?.status === 'OPEN' ? entered[l.id] : l.countedQty;
    if (v == null || v === '' || !Number.isFinite(Number(v))) return null;
    return Math.round((Number(v) - Number(l.systemQty)) * 1000) / 1000;
  }

  $effect(() => {
    void load();
  });
</script>

<svelte:head><title>Comptages cycliques — Pulsar</title></svelte:head>

<PageHeader
  title="Comptages cycliques"
  subtitle="Boucle de précision d'inventaire : compter un emplacement, comparer au système, réconcilier — les écarts postent des ajustements et alimentent le Workbench."
  count={counts.length}
>
  {#snippet actions()}
    <ViewToggle bind:view views={['table', 'cards', 'kanban']} />
  {/snippet}
</PageHeader>

<div
  class="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3 xl:grid-cols-[minmax(0,360px)_minmax(0,1fr)]"
>
  <!-- Left: create + list -->
  <div class={`min-w-0 space-y-3 ${selected ? 'order-2' : 'order-1'} xl:order-1`}>
    {#if canManage}<Card>
        <h2 class="mb-3 text-sm font-bold text-ink">Nouveau comptage</h2>
        <div class="space-y-3">
          <Field label="Emplacement">
            <EntityPicker
              endpoint="/wms/bins"
              label="Emplacement"
              labelKey="code"
              detailKey="kind"
              listShape="array"
              bind:value={createBinId}
            />
          </Field>
          <Field label="Note">
            <input
              bind:value={createNote}
              placeholder="Optionnel"
              class="w-full rounded-md border border-edge bg-surface px-3 py-1.5 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
            />
          </Field>
          <Button variant="primary" loading={busy} onclick={create}>Démarrer le comptage</Button>
        </div>
      </Card>{/if}

    {#if loading}
      <Card padded={false}><Skeleton rows={5} /></Card>
    {:else if view === 'table'}
      {#if counts.length === 0}
        <Card><EmptyState message="Aucun comptage. Démarre-en un sur un emplacement." /></Card>
      {:else}
        <Card padded={false}>
          <div class="divide-y divide-edge">
            {#each counts as c (c.id)}
              <button
                type="button"
                class={`flex w-full flex-wrap items-center gap-3 px-4 py-2.5 text-left text-sm hover:bg-surface-muted ${selected?.id === c.id ? 'bg-surface-muted' : ''}`}
                onclick={() => openCount(c.id)}
              >
                <span class="min-w-0 break-all font-mono font-semibold text-ink">{c.number}</span>
                <span class="text-ink-muted">{c.bin.code}</span>
                <Badge tone={statusTone(c.status)}>{statusLabel(c.status)}</Badge>
                <span class="ml-auto text-xs text-ink-faint">{c._count?.lines ?? 0} lignes</span>
              </button>
            {/each}
          </div>
        </Card>
      {/if}
    {:else if view === 'cards'}
      {#if counts.length === 0}
        <Card><EmptyState message="Aucun comptage. Démarre-en un sur un emplacement." /></Card>
      {:else}
        <div class="grid gap-3">
          {#each counts as c (c.id)}
            <button type="button" class="block w-full text-left" onclick={() => openCount(c.id)}>
              <Card>
                <div class="flex items-start justify-between gap-2">
                  <span class="font-mono font-semibold text-ink">{c.number}</span>
                  <Badge tone={statusTone(c.status)}>{statusLabel(c.status)}</Badge>
                </div>
                <p class="mt-1 text-sm text-ink-muted">{c.bin.code}</p>
                <div class="mt-2 text-xs text-ink-faint">
                  {c._count?.lines ?? 0} lignes
                </div>
              </Card>
            </button>
          {/each}
        </div>
      {/if}
    {:else if view === 'kanban'}
      {#if counts.length === 0}
        <Card><EmptyState message="Aucun comptage. Démarre-en un sur un emplacement." /></Card>
      {:else}
        <div class="flex gap-2 overflow-x-auto pb-2">
          {#each KANBAN_COLS as col (col.status)}
            {@const items = counts.filter((c) => c.status === col.status)}
            <div
              class="flex w-52 shrink-0 flex-col rounded-card border border-edge-soft bg-surface-muted"
            >
              <div class="flex items-center justify-between px-3 py-2">
                <Badge tone={statusTone(col.status)}>{col.label}</Badge>
                <span class="font-mono text-xs text-ink-muted">{items.length}</span>
              </div>
              <div class="flex max-h-[50vh] flex-col gap-2 overflow-y-auto px-2 pb-2">
                {#if items.length === 0}
                  <p class="px-1 py-3 text-center text-xs text-ink-faint">—</p>
                {:else}
                  {#each items as c (c.id)}
                    <button
                      type="button"
                      class={`block w-full rounded-inner border text-left p-2.5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-card ${selected?.id === c.id ? 'border-accent bg-surface' : 'border-edge-soft bg-surface'}`}
                      onclick={() => openCount(c.id)}
                    >
                      <div class="font-mono font-semibold text-sm text-ink">{c.number}</div>
                      <div class="mt-0.5 text-xs text-ink-muted">{c.bin.code}</div>
                      <div class="mt-1 text-[11px] text-ink-faint">
                        {c._count?.lines ?? 0} lignes
                      </div>
                    </button>
                  {/each}
                {/if}
              </div>
            </div>
          {/each}
        </div>
      {/if}
    {/if}
  </div>

  <!-- Right: selected detail -->
  <div class={`min-w-0 ${selected ? 'order-1' : 'order-2'} xl:order-2`}>
    <Card padded={false}>
      {#if !selected}
        <div class="p-4">
          <EmptyState message="Sélectionne un comptage pour saisir les quantités." />
        </div>
      {:else}
        <div
          class="flex flex-wrap items-center justify-between gap-2 border-b border-edge px-4 py-3"
        >
          <div class="flex items-center gap-2">
            <span class="font-mono font-semibold text-ink">{selected.number}</span>
            <span class="text-ink-muted">{selected.bin.code}</span>
            <Badge tone={statusTone(selected.status)}>{statusLabel(selected.status)}</Badge>
          </div>
          <div class="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              disabled={busy || reading || opening}
              onclick={() => openCount(selected!.id)}>Actualiser</Button
            >
            {#if selected.status === 'OPEN' && canManage}
              <Button
                variant="primary"
                loading={busy}
                disabled={uncertain || !fresh || reading || opening}
                onclick={recordCounts}>Enregistrer le comptage</Button
              >
            {/if}
            {#if selected.status === 'COUNTED' && canManage}
              <Button
                variant="primary"
                loading={busy}
                disabled={uncertain || !fresh || opening}
                onclick={reconcile}>Réconcilier</Button
              >
            {/if}
            {#if canManage && (selected.status === 'OPEN' || selected.status === 'COUNTED')}
              <Button
                variant="secondary"
                disabled={busy || reading || opening || uncertain}
                onclick={() => cancel(selected!.id)}>Annuler</Button
              >
            {/if}
          </div>
        </div>

        {#if (selected.status === 'OPEN' || selected.status === 'COUNTED') && !fresh}
          <p
            role="alert"
            class="m-4 rounded-lg border border-warn/40 bg-surface-muted p-3 text-sm text-ink"
          >
            {selected.freshness?.reason ??
              'Contrôle de fraîcheur indisponible. Actualisez avant de continuer.'}
          </p>
        {/if}
        {#if actionError}<p role="alert" class="px-4 py-3 text-sm text-danger">
            {actionError}
          </p>{/if}
        {#if uncertain}<p role="alert" class="p-4 text-sm text-danger">
            Réponse incertaine. Ne renvoyez pas le comptage; rouvrez le dossier dans la liste pour
            vérifier son statut.
          </p>{/if}
        {#if selected.status === 'OPEN' && canManage}
          <div class="space-y-3 p-4">
            <label class="block text-sm"
              >Mode de comptage
              <select
                bind:value={scanMode}
                disabled={busy ||
                  reading ||
                  opening ||
                  uncertain ||
                  !fresh ||
                  scanCandidates.length > 0}
                class="mt-1 min-h-11 w-full rounded-md border border-edge bg-surface px-3"
              >
                <option value="select">Scanner pour sélectionner, puis saisir la quantité</option>
                <option value="increment">Chaque scan ajoute 1 unité EA au brouillon</option>
              </select>
            </label>
            {#key `${selected.id}:${scanRevision}`}<ScanInput
                onscan={scanItem}
                disabled={busy || opening || uncertain || !fresh}
                label="Scanner l’article à compter"
              />{/key}
            <p class="text-xs text-ink-muted">
              {filled} / {selected.lines?.length ?? 0} lignes renseignées. Les cases vides ne valent pas
              zéro. Chaque lot est compté séparément. Un scan d’article ne devine jamais le lot. Aucun
              stock ne change avant la réconciliation.
            </p>
            {#if scanCandidates.length}
              <div class="rounded-lg border border-edge p-3" aria-label="Choisir le lot scanné">
                <p class="mb-2 text-sm font-semibold">Quel lot avez-vous en main ?</p>
                <div class="flex flex-wrap gap-2">
                  {#each scanCandidates as line (line.id)}
                    <Button
                      variant="secondary"
                      disabled={busy || reading || opening || uncertain}
                      onclick={() => chooseScanLot(line)}>{line.lot?.code ?? 'Sans lot'}</Button
                    >
                  {/each}
                  <Button
                    variant="ghost"
                    onclick={() => {
                      scanCandidates = [];
                      scanRevision++;
                    }}>Ignorer ce scan</Button
                  >
                </div>
              </div>
            {/if}
          </div>
        {/if}
        {#if (selected.lines ?? []).length === 0}
          <div class="p-4">
            <EmptyState
              message="Aucun stock système dans cet emplacement. Annule ou ajoute du stock d'abord."
            />
          </div>
        {:else}
          <div class="divide-y divide-edge md:hidden">
            {#each selected.lines ?? [] as l (l.id)}
              {@const v = variance(l)}
              <article
                aria-label={`Comptage ${l.item.sku}${l.lot ? ' · ' + l.lot.code : ''}`}
                class={`space-y-3 p-4 ${scannedLine === l.id ? 'bg-accent/10' : ''}`}
              >
                <div>
                  <p class="break-all font-mono text-xs text-ink-muted">{l.item.sku}</p>
                  <p class="mt-1 font-semibold">{l.item.name}</p>
                  <p class="mt-1 text-sm">{l.lot ? `Lot ${l.lot.code}` : 'Sans suivi par lot'}</p>
                </div>
                <div class="flex flex-wrap items-end justify-between gap-3">
                  <div class="text-sm">
                    <p class="text-xs text-ink-muted">Système</p>
                    {Number(l.systemQty)}
                    {l.unitSnapshot ?? 'Unité non capturée'}
                  </div>
                  <div class="text-sm">
                    <p class="mb-1 text-xs text-ink-muted">Compté</p>
                    {#if selected.status === 'OPEN' && canManage}
                      <input
                        type="number"
                        aria-label={`Quantité comptée : ${l.item.sku}${l.lot ? ' · ' + l.lot.code : ''}`}
                        disabled={busy || reading || opening || uncertain || !fresh}
                        step="0.001"
                        min="0"
                        bind:value={entered[l.id]}
                        class="min-h-11 w-28 rounded-md border border-edge bg-surface px-3 text-right focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
                      />
                    {:else}{l.countedQty != null ? Number(l.countedQty) : 'Non compté'}{/if}
                  </div>
                  <div class="text-right text-sm">
                    <p class="text-xs text-ink-muted">Écart</p>
                    <span
                      class={v === null || v === 0
                        ? 'text-ink-muted'
                        : v > 0
                          ? 'text-ok'
                          : 'text-danger'}>{v == null ? '—' : v > 0 ? `+${v}` : v}</span
                    >
                  </div>
                </div>
              </article>
            {/each}
          </div>
          <div class="hidden md:block">
            <Table>
              {#snippet head()}
                <th>SKU</th><th>Article</th><th class="text-right">Système</th><th
                  class="text-right">Compté</th
                ><th class="text-right">Écart</th>
              {/snippet}
              {#snippet body()}
                {#each selected!.lines ?? [] as l (l.id)}
                  {@const v = variance(l)}
                  <tr
                    class={scannedLine === l.id ? 'bg-accent/10' : ''}
                    data-scan-selected={scannedLine === l.id ? 'true' : undefined}
                  >
                    <td class="font-mono font-semibold text-ink">{l.item.sku}</td>
                    <td class="text-ink-muted"
                      >{l.item.name}
                      <div class="mt-1 text-xs font-medium text-ink">
                        {l.lot ? `Lot ${l.lot.code}` : 'Sans suivi par lot'}
                      </div></td
                    >
                    <td class="text-right text-ink"
                      >{Number(l.systemQty)}
                      <span class="text-xs text-ink-muted"
                        >{l.unitSnapshot ?? 'Unité historique non capturée'}</span
                      ></td
                    >
                    <td class="text-right">
                      {#if selected!.status === 'OPEN' && canManage}
                        <input
                          type="number"
                          aria-label={`Quantité comptée : ${l.item.sku}${l.lot ? ' · ' + l.lot.code : ''}`}
                          disabled={busy || reading || opening || uncertain || !fresh}
                          step="0.001"
                          min="0"
                          bind:value={entered[l.id]}
                          class="w-24 rounded-md border border-edge bg-surface px-2 py-1 text-right text-sm focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
                        />
                      {:else}
                        {l.countedQty != null ? Number(l.countedQty) : '—'}
                      {/if}
                    </td>
                    <td
                      class={`text-right font-medium ${v == null ? 'text-ink-faint' : v === 0 ? 'text-ink-muted' : v > 0 ? 'text-ok' : 'text-danger'}`}
                    >
                      {v == null ? '—' : v > 0 ? `+${v}` : v}
                    </td>
                  </tr>
                {/each}
              {/snippet}
            </Table>
          </div>
        {/if}
      {/if}
    </Card>
  </div>
</div>
