<script lang="ts">
  import { untrack } from 'svelte';
  import type {
    DeliveryAllocationWorkspace as Workspace,
    DeliveryAllocationSourceRow,
  } from '@pulsar/shared';
  import { api, ApiError } from '$lib/api/client';
  import { Badge, Button, Card, Drawer, ErrorNotice, Field, Skeleton } from '$lib/components/ui';
  import { auth } from '$lib/stores/auth';
  import { confirmAction } from '$lib/stores/confirmation';
  import { formatDateTime } from '$lib/format';

  let {
    loadId,
    refreshKey,
    onReload,
  }: { loadId: string; refreshKey: string; onReload: () => Promise<void> } = $props();
  const endpoint = '/transportation/delivery-allocation';
  const canRead = $derived(
    $auth?.user.permissions.includes('transportation.planning.read') ?? false,
  );
  const canManage = $derived(
    $auth?.user.permissions.includes('transportation.planning.manage') ?? false,
  );
  const scope = $derived(`${$auth?.tenant.id ?? ''}:${$auth?.user.id ?? ''}:${loadId}`);
  type Pending = {
    kind: 'create' | 'release';
    shipmentId: string;
    allocationId?: string;
    body: {
      operationKey: string;
      expectedVersion: number;
      packageId?: string;
      contentIndex?: number;
      sourceSalesOrderLineId?: string;
      sourcePickLineId?: string;
      salesUnitAcknowledged?: boolean;
      expectedSalesLineUpdatedAt?: string;
      expectedSalesOrderUpdatedAt?: string;
      expectedPickUpdatedAt?: string;
    };
  };
  let shipments = $state<{ id: string; shipmentNumber: string; destinationName: string }[]>([]);
  let selectedShipment = $state(''),
    workspace = $state<Workspace | null>(null);
  let loading = $state(false),
    busy = $state(false),
    error = $state(''),
    actionError = $state(''),
    storageError = $state('');
  let pending = $state<Pending | null>(null),
    inspected = $state(false),
    open = $state(false);
  let chosenPackage = $state<Workspace['packages'][number] | null>(null),
    chosenIndex = $state(0);
  let salesId = $state(''),
    pickId = $state(''),
    acknowledged = $state(false);
  let generation = 0;
  const blocked = $derived(busy || loading || !!error || !!pending || !!storageError);
  const content = $derived(chosenPackage?.contents[chosenIndex]);
  const sales = $derived(workspace?.salesLines.find((row) => row.id === salesId));
  const picking = $derived(workspace?.pickLines.find((row) => row.id === pickId));
  const sourceRows = $derived([...(workspace?.salesLines ?? []), ...(workspace?.pickLines ?? [])]);
  const key = (value: string) => `pulsar.delivery-allocation.pending.v1:${value}`;
  const message = (e: unknown) => (e instanceof Error ? e.message : 'Action indisponible.');

  function isPending(value: unknown): value is Pending {
    if (!value || typeof value !== 'object') return false;
    const p = value as Pending,
      b = p.body;
    return (
      ['create', 'release'].includes(p.kind) &&
      typeof p.shipmentId === 'string' &&
      !!b &&
      /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(
        b.operationKey,
      ) &&
      Number.isInteger(b.expectedVersion) &&
      b.expectedVersion > 0 &&
      (p.kind === 'release'
        ? typeof p.allocationId === 'string'
        : typeof b.packageId === 'string' &&
          Number.isInteger(b.contentIndex) &&
          b.contentIndex! >= 0 &&
          b.contentIndex! < 50)
    );
  }
  function remember(value: Pending | null) {
    try {
      if (value) sessionStorage.setItem(key(scope), JSON.stringify(value));
      else sessionStorage.removeItem(key(scope));
      pending = value;
      inspected = false;
      storageError = '';
      return true;
    } catch {
      storageError = 'Impossible de conserver la demande dans ce navigateur. Aucun nouvel envoi.';
      return false;
    }
  }
  async function loadSources(id: string) {
    const token = ++generation;
    loading = true;
    error = '';
    workspace = null;
    if (!id) {
      loading = false;
      return;
    }
    try {
      const result = await api<Workspace>(endpoint, { query: { shipmentId: id } });
      if (token === generation) workspace = result;
    } catch (e) {
      if (token === generation) error = message(e);
    } finally {
      if (token === generation) loading = false;
    }
  }
  async function reload() {
    const currentScope = scope;
    if (!canRead) {
      generation++;
      shipments = [];
      workspace = null;
      return;
    }
    loading = true;
    error = '';
    try {
      const result = await api<{ shipments: typeof shipments }>(
        '/transportation/delivery-packages',
        { query: { loadId } },
      );
      if (currentScope !== scope) return;
      shipments = result.shipments;
      if (!shipments.some((s) => s.id === selectedShipment))
        selectedShipment = shipments[0]?.id ?? '';
      await loadSources(selectedShipment);
    } catch (e) {
      if (currentScope === scope) {
        error = message(e);
        workspace = null;
        loading = false;
      }
    }
  }
  $effect(() => {
    const currentScope = scope;
    untrack(() => {
      generation++;
      workspace = null;
      busy = false;
      chosenPackage = null;
      open = false;
      pending = null;
      inspected = false;
      storageError = '';
      actionError = '';
      try {
        const raw = sessionStorage.getItem(key(currentScope));
        if (raw) {
          const parsed: unknown = JSON.parse(raw);
          if (!isPending(parsed)) throw new Error('invalid');
          pending = parsed;
        }
      } catch {
        storageError =
          'Une demande conservée est illisible. Contactez l’exploitation avant une nouvelle attribution.';
      }
    });
  });
  $effect(() => {
    void refreshKey;
    void scope;
    void canRead;
    untrack(() => void reload());
  });

  function choose(pkg: Workspace['packages'][number], index: number) {
    chosenPackage = structuredClone($state.snapshot(pkg));
    chosenIndex = index;
    salesId = '';
    pickId = '';
    acknowledged = false;
    actionError = '';
    open = true;
  }
  async function send() {
    if (!pending || busy) return;
    const intent = pending,
      currentScope = scope;
    busy = true;
    actionError = '';
    try {
      const receipt = await api<{
        operationKey: string;
        allocationId: string;
        packageId: string;
        version: number;
        released: boolean;
      }>(intent.kind === 'create' ? endpoint : `${endpoint}/${intent.allocationId}/release`, {
        method: 'POST',
        body: intent.body,
      });
      if (scope !== currentScope) return;
      if (
        !receipt ||
        receipt.operationKey !== intent.body.operationKey ||
        typeof receipt.allocationId !== 'string' ||
        !receipt.allocationId ||
        receipt.version !== intent.body.expectedVersion + 1 ||
        receipt.released !== (intent.kind === 'release') ||
        (intent.kind === 'create'
          ? receipt.packageId !== intent.body.packageId
          : receipt.allocationId !== intent.allocationId)
      )
        throw new Error('Reçu incomplet : inspectez les liens puis reprenez la même demande.');
      remember(null);
      open = false;
      await reload();
      await onReload();
    } catch (e) {
      if (scope !== currentScope) return;
      actionError = message(e);
      if (e instanceof ApiError && e.statusCode === 400) remember(null);
      // Conflict, access loss or transport errors do not prove that the first request failed.
      inspected = false;
    } finally {
      if (scope === currentScope) busy = false;
    }
  }
  async function createLink(event: SubmitEvent) {
    event.preventDefault();
    if (
      blocked ||
      !chosenPackage ||
      !content ||
      !workspace ||
      (!sales && !picking) ||
      (sales && !acknowledged)
    )
      return;
    const body: Pending['body'] = {
      operationKey: crypto.randomUUID(),
      packageId: chosenPackage.id,
      contentIndex: chosenIndex,
      expectedVersion: chosenPackage.version,
      ...(sales
        ? {
            sourceSalesOrderLineId: sales.id,
            salesUnitAcknowledged: true,
            expectedSalesLineUpdatedAt: sales.updatedAt,
            expectedSalesOrderUpdatedAt: sales.orderUpdatedAt,
          }
        : {}),
      ...(picking
        ? { sourcePickLineId: picking.id, expectedPickUpdatedAt: picking.updatedAt }
        : {}),
    };
    if (remember({ kind: 'create', shipmentId: workspace.shipment.id, body })) await send();
  }
  async function releaseLink(link: Workspace['allocations'][number]) {
    const pkg = workspace?.packages.find((p) => p.id === link.packageId);
    if (!workspace || !pkg || blocked || !link.canRelease) return;
    if (
      !(await confirmAction(
        'Le lien reste dans l’historique. Sa quantité redevient disponible pour une nouvelle attribution; aucun stock ne bouge.',
        {
          title: 'Libérer cette attribution ?',
          confirmLabel: 'Libérer le lien',
        },
      ))
    )
      return;
    if (
      remember({
        kind: 'release',
        shipmentId: workspace.shipment.id,
        allocationId: link.id,
        body: { operationKey: crypto.randomUUID(), expectedVersion: pkg.version },
      })
    )
      await send();
  }
  async function inspect() {
    if (!pending || busy) return;
    selectedShipment = pending.shipmentId;
    await loadSources(selectedShipment);
    inspected = !!workspace && !error;
  }
  async function discard() {
    if (!inspected || busy) return;
    if (
      await confirmAction(
        'Confirmez avoir vérifié les attributions et leur historique. Oublier la demande locale n’annule aucune opération déjà enregistrée.',
        {
          title: 'Terminer cette reprise ?',
          confirmLabel: 'État vérifié',
        },
      )
    ) {
      remember(null);
      actionError = '';
    }
  }
  function sourceAvailable(row: DeliveryAllocationSourceRow) {
    return row.selectable && (!row.unit || row.unit === content?.unit);
  }
</script>

{#if canRead}
  <Card>
    <section aria-label="Traçabilité des quantités" class="space-y-4">
      <header class="flex flex-wrap items-start justify-between gap-3">
        <div class="max-w-2xl">
          <h2 class="text-sm font-semibold">De la commande à la livraison</h2>
          <p class="mt-1 text-xs leading-relaxed text-ink-muted">
            Reliez volontairement chaque ligne de colis à sa commande, sa préparation, ou aux deux.
            Transport reste utilisable sans CRM ni Entrepôt.
          </p>
        </div>
        <Button variant="ghost" onclick={reload} disabled={busy || loading}
          >Actualiser les liens</Button
        >
      </header>
      {#if storageError}<ErrorNotice message={storageError} />{/if}
      {#if pending}<aside
          class="rounded-md border border-edge-soft bg-surface-muted p-3"
          aria-label="Attribution à vérifier"
        >
          <p class="text-sm font-medium">Une demande attend vérification</p>
          <p class="mt-1 text-xs text-ink-muted">
            La réponse n’est pas confirmée. Inspectez les liens, puis reprenez exactement la même
            demande. Aucun renvoi automatique.
          </p>
          <div class="mt-3 flex flex-wrap gap-2">
            <Button variant="secondary" onclick={inspect} disabled={busy || loading}
              >Inspecter les liens</Button
            ><Button onclick={send} disabled={!inspected || busy || loading || !canManage}
              >Reprendre la même demande</Button
            ><Button variant="ghost" onclick={discard} disabled={!inspected || busy}
              >État vérifié, terminer</Button
            >
          </div>
        </aside>{/if}
      {#if actionError}<ErrorNotice message={actionError} />{/if}
      {#if error}<ErrorNotice message={error} />{/if}
      {#if shipments.length}<Field label="Expédition à rapprocher"
          ><select
            class="w-full rounded-md border border-edge bg-surface px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-accent"
            bind:value={selectedShipment}
            onchange={() => {
              open = false;
              void loadSources(selectedShipment);
            }}
            disabled={busy || !!pending}
          >
            {#each shipments as shipment}<option value={shipment.id}
                >{shipment.shipmentNumber} · {shipment.destinationName}</option
              >{/each}
          </select></Field
        >{/if}
      {#if loading}<Skeleton rows={4} />
      {:else if workspace}
        {#if !workspace.access.sales || !workspace.access.picking}<p class="text-xs text-ink-muted">
            Sources disponibles selon les modules et vos droits. {!workspace.access.sales
              ? 'Lecture CRM indisponible. '
              : ''}{!workspace.access.picking ? 'Lecture Entrepôt indisponible.' : ''} Les liens protégés
            ne dévoilent pas leurs sources.
          </p>{/if}
        {#if sourceRows.length}<section aria-label="Quantités par ligne source" class="space-y-3">
            {#each sourceRows as row (`${row.kind}:${row.id}`)}<article
                class="rounded-md bg-surface-muted p-3"
              >
                <div class="flex flex-wrap items-center gap-2">
                  <Badge tone="neutral"
                    >{row.kind === 'sales' ? 'Commande' : 'Préparation terminée'}</Badge
                  ><span class="font-mono text-xs">{row.documentNumber}</span>
                </div>
                <p class="mt-2 text-sm font-medium break-words">{row.name}</p>
                <p class="mt-1 text-xs text-ink-muted">
                  {row.siteName ?? 'Ligne commerciale · toutes ses expéditions'} · {row.unit
                    ? `${row.unit}${row.kind === 'sales' ? ' (équivalence confirmée 1:1)' : ''}`
                    : 'Unité commerciale à confirmer explicitement'}
                </p>
                <dl
                  class="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 text-xs sm:grid-cols-3 lg:grid-cols-6"
                >
                  {#each [{ label: row.kind === 'sales' ? 'Commandé' : 'Préparé', value: row.quantity }, { label: 'Emballé attribué', value: row.totals?.allocated ?? '0' }, { label: 'Livré net', value: row.totals?.delivered ?? '0' }, { label: 'Retourné', value: row.totals?.returned ?? '0' }, { label: 'À attribuer', value: row.totals?.remainingToAllocate ?? row.quantity }, { label: 'Non livré net', value: row.totals?.remainingToDeliver ?? row.quantity }] as metric}<div
                    >
                      <dt class="text-ink-muted">{metric.label}</dt>
                      <dd class="mt-1 font-mono text-sm tabular-nums">{metric.value}</dd>
                    </div>{/each}
                </dl>
              </article>{/each}
            <p class="text-xs leading-relaxed text-ink-muted">
              Ces compteurs restent séparés par ligne et unité. « Emballé attribué » inclut les
              colis livrés ou retournés qui conservent leur source. Un retour ne libère pas une
              quantité pour un remplacement et ne remet rien en stock.
            </p>
          </section>{:else}<p class="rounded-md bg-surface-muted p-3 text-sm text-ink-muted">
            Aucune source accessible pour cette expédition. Une préparation doit être terminée et
            liée à cette expédition; une commande CRM doit être sa source explicite. Vous pouvez
            continuer la livraison sans ces liens.
          </p>{/if}
        <section aria-label="Lignes de colis" class="space-y-3">
          {#each workspace.packages as pkg (pkg.id)}<article
              class="rounded-md border border-edge-soft p-3"
            >
              <div class="flex flex-wrap items-center gap-2">
                <h3 class="font-mono text-sm font-medium">{pkg.code}</h3>
                <Badge tone={pkg.status === 'DELIVERED' ? 'ok' : 'neutral'}
                  >{pkg.status === 'PREPARED'
                    ? 'Préparé'
                    : pkg.status === 'LOADED'
                      ? 'Chargé'
                      : pkg.status === 'DELIVERED'
                        ? 'Livré'
                        : pkg.status === 'RETURNED'
                          ? 'Retourné'
                          : 'Annulé'}</Badge
                >
              </div>
              <ul class="mt-2 divide-y divide-edge-soft">
                {#each pkg.contents as line, index}<li
                    class="flex flex-wrap items-center justify-between gap-3 py-3"
                  >
                    <div class="min-w-0">
                      <p class="text-sm break-words">
                        <span class="font-mono">{line.reference}</span> · {line.description}
                      </p>
                      <p class="mt-1 font-mono text-xs tabular-nums">{line.quantity} {line.unit}</p>
                    </div>
                    {#if pkg.lockedContentIndices.includes(index)}<Badge tone="info"
                        >Source attribuée</Badge
                      >
                    {:else if canManage && pkg.canAllocate}<Button
                        variant="secondary"
                        disabled={blocked || !sourceRows.some((row) => row.selectable)}
                        onclick={() => choose(pkg, index)}>Relier la ligne {index + 1}</Button
                      >
                    {:else}<span class="text-xs text-ink-muted">Sans attribution</span>{/if}
                  </li>{/each}
              </ul>
              {#each workspace.allocations.filter((link) => link.packageId === pkg.id) as link (link.id)}<div
                  class="border-t border-edge-soft pt-3 mt-2 text-xs"
                >
                  <div class="flex flex-wrap items-center justify-between gap-2">
                    <p class="font-medium">
                      Ligne {link.contentIndex + 1} · {link.quantity}
                      {link.unit} · {link.releasedAt ? 'Lien libéré' : 'Lien actif'}
                    </p>
                    {#if canManage && link.canRelease}<Button
                        variant="ghost"
                        disabled={blocked}
                        onclick={() => releaseLink(link)}>Libérer le lien</Button
                      >{/if}
                  </div>
                  {#if link.salesLabel}<p class="mt-1 break-words">
                      Commande : {link.salesLabel}
                    </p>{/if}{#if link.pickLabel}<p class="mt-1 break-words">
                      Préparation : {link.pickLabel}
                    </p>{/if}
                  <p class="mt-1 text-ink-muted">
                    Créé le {formatDateTime(link.createdAt)}{link.releasedAt
                      ? ` · Libéré le ${formatDateTime(link.releasedAt)}`
                      : ''}
                  </p>
                </div>{/each}
            </article>{/each}
          {#if !workspace.packages.length}<p class="text-sm text-ink-muted">
              Déclarez d’abord les colis dans la section Colis de livraison.
            </p>{/if}
        </section>
      {:else if !error}<p class="text-sm text-ink-muted">
          Aucune expédition affectée à rapprocher.
        </p>{/if}
    </section>
  </Card>
  <Drawer bind:open title="Relier une ligne de colis" width="lg" dismissible={!busy}>
    {#if chosenPackage && content && workspace}<form class="space-y-5" onsubmit={createLink}>
        <section class="rounded-md bg-surface-muted p-4">
          <p class="font-mono text-sm">{chosenPackage.code} · ligne {chosenIndex + 1}</p>
          <p class="mt-2 text-sm">{content.description}</p>
          <p class="mt-2 font-mono text-lg tabular-nums">{content.quantity} {content.unit}</p>
        </section>
        <p class="text-sm leading-relaxed text-ink-muted">
          La ligne entière sera attribuée. Vérifiez la correspondance métier : Pulsar ne rapproche
          jamais automatiquement les noms, les références ou les SKU.
        </p>
        {#if workspace.access.sales}<Field label="Ligne de commande CRM (facultatif)"
            ><select
              class="w-full rounded-md border border-edge bg-surface px-3 py-2 text-sm"
              bind:value={salesId}
              onchange={() => (acknowledged = false)}
              disabled={busy || !!pending}
              ><option value="">Aucune commande</option>{#each workspace.salesLines as row}<option
                  value={row.id}
                  disabled={!sourceAvailable(row)}
                  >{row.documentNumber} · {row.name} · {row.quantity}{row.unit
                    ? ` ${row.unit}`
                    : ''}</option
                >{/each}</select
            ></Field
          >{/if}
        {#if sales}<label
            class="flex items-start gap-3 rounded-md border border-edge-soft p-3 text-sm"
            ><input
              type="checkbox"
              bind:checked={acknowledged}
              disabled={busy || !!pending}
              class="mt-1"
            /><span
              >Je confirme qu’une unité commerciale de « {sales.name} » correspond exactement à 1 {content.unit}.
              Le CRM n’enregistre pas d’unité native sur cette ligne. Aucun ratio ni conversion
              n’est appliqué.</span
            ></label
          >{/if}
        {#if workspace.access.picking}<Field label="Ligne de préparation terminée (facultatif)"
            ><select
              class="w-full rounded-md border border-edge bg-surface px-3 py-2 text-sm"
              bind:value={pickId}
              disabled={busy || !!pending}
              ><option value="">Aucune préparation</option>{#each workspace.pickLines as row}<option
                  value={row.id}
                  disabled={!sourceAvailable(row)}
                  >{row.documentNumber} · {row.name} · {row.quantity} {row.unit}</option
                >{/each}</select
            ></Field
          >{/if}
        <p class="text-xs text-ink-muted">
          Choisir les deux sources affirme explicitement leur correspondance. La préparation a déjà
          comptabilisé la sortie de stock; cette attribution et la livraison ne créent aucun
          mouvement supplémentaire. Le lien devient irréversible dès le premier chargement physique.
        </p>
        {#if actionError}<ErrorNotice message={actionError} />{/if}
        <Button
          type="submit"
          disabled={blocked || (!sales && !picking) || (!!sales && !acknowledged)}
          >Confirmer l’attribution</Button
        >
      </form>{/if}
  </Drawer>
{/if}
