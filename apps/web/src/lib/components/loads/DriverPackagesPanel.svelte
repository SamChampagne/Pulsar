<script lang="ts">
  import { onMount, tick, untrack } from 'svelte';
  import type { DeliveryPackageContent } from '@pulsar/shared';
  import { api, ApiError } from '$lib/api/client';
  import {
    Badge,
    Button,
    Card,
    Drawer,
    ErrorNotice,
    Field,
    Input,
    Select,
    Skeleton,
    Textarea,
  } from '$lib/components/ui';
  import { confirmAction } from '$lib/stores/confirmation';
  import { formatDateTime } from '$lib/format';

  interface PackageRow {
    ref: string;
    code: string;
    label: string;
    status: string;
    version: number;
    contents: DeliveryPackageContent[];
    loadedAt: string | null;
    deliveredAt: string | null;
    incident?: { status: string; retryAt: string | null; returnLocationName: string | null } | null;
  }
  interface ShipmentRow {
    ref: string;
    shipmentNumber: string;
    status: string;
    originName: string;
    destinationName: string;
    hasPod: boolean;
    packages: PackageRow[];
  }
  interface Mission {
    loadNumber: string;
    status: string;
    updatedAt: string;
    shipments: ShipmentRow[];
  }
  type Body = {
    operationKey: string;
    expectedVersion: number;
    expectedLoadUpdatedAt: string;
    target?: 'LOADED' | 'DELIVERED';
    recipientName?: string;
    notes?: string;
    kind?: 'DAMAGE' | 'REFUSED' | 'MISSING' | 'ABSENT' | 'OTHER';
    note?: string;
  };
  type Intent = { type: 'transition' | 'exception'; ref: string; code: string; body: Body };
  type Draft = {
    type: 'LOADED' | 'DELIVERED' | 'exception';
    ref: string;
    code: string;
    version: number;
    loadUpdatedAt: string;
    shipmentRef: string;
    lastPackageWithoutPod: boolean;
  };
  let {
    token,
    refreshKey,
    onChange,
    onRequestPod,
    disabled = false,
  }: {
    token: string;
    refreshKey: number;
    onChange: () => Promise<void>;
    onRequestPod: (ref: string) => void | Promise<void>;
    disabled?: boolean;
  } = $props();
  const path = $derived(`/public/driver/${encodeURIComponent(token)}/packages`);
  let mission = $state<Mission | null>(null),
    loading = $state(true),
    busy = $state(false);
  let error = $state(''),
    actionError = $state(''),
    message = $state(''),
    storageError = $state('');
  let storageKey = $state(''),
    pending = $state<Intent | null>(null),
    inspected = $state(false);
  let scan = $state(''),
    scanMessage = $state(''),
    selectedRef = $state('');
  let online = $state(true),
    drawerOpen = $state(false),
    draft = $state<Draft | null>(null);
  let recipient = $state(''),
    notes = $state(''),
    incidentKind = $state('DAMAGE');
  let generation = 0;
  const closed = $derived(!mission || ['COMPLETED', 'CANCELLED'].includes(mission.status));
  const blocked = $derived(
    disabled ||
      loading ||
      busy ||
      !online ||
      !!error ||
      !!pending ||
      !!storageError ||
      !storageKey ||
      closed,
  );
  const packages = $derived(mission?.shipments.flatMap((s) => s.packages) ?? []);
  const active = $derived(packages.filter((p) => p.status !== 'CANCELLED'));
  const delivered = $derived(active.filter((p) => p.status === 'DELIVERED').length);
  const names: Record<string, string> = {
    PREPARED: 'Préparé',
    LOADED: 'Chargé',
    DELIVERED: 'Livré',
    CANCELLED: 'Annulé',
    RETURNED: 'Retourné',
  };
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  function validIntent(value: Intent) {
    if (
      !value ||
      !['transition', 'exception'].includes(value.type) ||
      typeof value.ref !== 'string' ||
      !value.ref ||
      value.ref.length > 200 ||
      typeof value.code !== 'string' ||
      !value.code ||
      value.code.length > 100 ||
      !value.body ||
      Object.keys(value).some((k) => !['type', 'ref', 'code', 'body'].includes(k))
    )
      return false;
    const b = value.body;
    if (
      !uuid.test(b.operationKey) ||
      !Number.isSafeInteger(b.expectedVersion) ||
      b.expectedVersion < 1 ||
      typeof b.expectedLoadUpdatedAt !== 'string' ||
      !Number.isFinite(Date.parse(b.expectedLoadUpdatedAt))
    )
      return false;
    if (value.type === 'transition')
      return (
        Object.keys(b).every((k) =>
          [
            'operationKey',
            'expectedVersion',
            'expectedLoadUpdatedAt',
            'target',
            'recipientName',
            'notes',
          ].includes(k),
        ) &&
        ['LOADED', 'DELIVERED'].includes(b.target ?? '') &&
        (b.recipientName === undefined ||
          (typeof b.recipientName === 'string' && b.recipientName.length <= 120)) &&
        (b.notes === undefined || (typeof b.notes === 'string' && b.notes.length <= 1000)) &&
        (b.target !== 'DELIVERED' || !!b.recipientName?.trim())
      );
    return (
      Object.keys(b).every((k) =>
        ['operationKey', 'expectedVersion', 'expectedLoadUpdatedAt', 'kind', 'note'].includes(k),
      ) &&
      ['DAMAGE', 'REFUSED', 'MISSING', 'ABSENT', 'OTHER'].includes(b.kind ?? '') &&
      typeof b.note === 'string' &&
      !!b.note.trim() &&
      b.note.length <= 1000
    );
  }
  async function restore(currentToken: string) {
    try {
      // The bearer link is never persisted: only a one-way scope and the minimal exact request.
      const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(currentToken));
      const key = `pulsar.driver-packages.pending.v1:${Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, '0')).join('')}`;
      if (token !== currentToken) return;
      storageKey = key;
      const saved = sessionStorage.getItem(key);
      if (!saved) return;
      const value = JSON.parse(saved) as Intent;
      if (!validIntent(value)) throw new Error('Invalid saved request');
      pending = value;
      actionError =
        'Une action attend sa confirmation. Reprenez exactement la demande conservée ou vérifiez son résultat avec la régulation.';
    } catch {
      if (currentToken === token)
        storageError =
          'La demande locale ne peut pas être vérifiée. Contactez la régulation avant de recommencer.';
    }
  }
  async function reload() {
    const currentToken = token,
      currentGeneration = ++generation;
    loading = true;
    error = '';
    try {
      const result = await api<Mission>(path);
      if (currentToken !== token || currentGeneration !== generation) return false;
      if (
        !result ||
        !Array.isArray(result.shipments) ||
        !Number.isFinite(Date.parse(result.updatedAt))
      )
        throw new Error('Invalid mission');
      mission = result;
      return true;
    } catch (e) {
      if (currentToken === token && currentGeneration === generation)
        error =
          e instanceof ApiError ? e.message : 'Mission indisponible. Aucun changement envoyé.';
      return false;
    } finally {
      if (currentToken === token && currentGeneration === generation) loading = false;
    }
  }
  $effect(() => {
    const currentToken = token;
    untrack(() => {
      ++generation;
      mission = null;
      pending = null;
      storageKey = '';
      storageError = '';
      selectedRef = '';
      scan = '';
      scanMessage = '';
      actionError = '';
      message = '';
      inspected = false;
      busy = false;
      drawerOpen = false;
      draft = null;
      void restore(currentToken);
    });
  });
  $effect(() => {
    token;
    refreshKey;
    untrack(() => {
      void reload();
    });
  });
  onMount(() => {
    const update = () => {
      online = navigator.onLine;
    };
    update();
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  });
  async function selectCode(event: SubmitEvent) {
    event.preventDefault();
    const matches = packages.filter((p) => p.code === scan.trim());
    if (matches.length !== 1) {
      scanMessage = 'Code exact introuvable dans cette mission.';
      selectedRef = '';
      return;
    }
    selectedRef = matches[0].ref;
    scanMessage = `${matches[0].code} sélectionné. Le scan ne confirme aucune action.`;
    const selected = selectedRef,
      currentToken = token;
    await tick();
    if (token !== currentToken || selected !== selectedRef) return;
    const element = document.getElementById(`driver-package-${selected}`);
    element?.focus({ preventScroll: true });
    element?.scrollIntoView({
      block: 'center',
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    });
  }
  function begin(type: Draft['type'], pkg: PackageRow, shipment: ShipmentRow) {
    if (blocked || !mission) return;
    draft = {
      type,
      ref: pkg.ref,
      code: pkg.code,
      version: pkg.version,
      loadUpdatedAt: mission.updatedAt,
      shipmentRef: shipment.ref,
      lastPackageWithoutPod:
        type === 'DELIVERED' &&
        !shipment.hasPod &&
        shipment.packages.filter((p) => !['DELIVERED', 'CANCELLED'].includes(p.status)).length ===
          1,
    };
    recipient = '';
    notes = '';
    incidentKind = 'DAMAGE';
    actionError = '';
    message = '';
    drawerOpen = true;
  }
  async function confirmDraft() {
    if (
      !draft ||
      blocked ||
      notes.trim().length > 1000 ||
      (draft.type === 'DELIVERED' && (!recipient.trim() || recipient.trim().length > 120)) ||
      (draft.type === 'exception' && !notes.trim())
    )
      return;
    const currentToken = token,
      key = storageKey,
      current = $state.snapshot(draft);
    const intent: Intent = {
      type: current.type === 'exception' ? 'exception' : 'transition',
      ref: current.ref,
      code: current.code,
      body: {
        operationKey: crypto.randomUUID(),
        expectedVersion: current.version,
        expectedLoadUpdatedAt: current.loadUpdatedAt,
        ...(current.type === 'exception'
          ? { kind: incidentKind as Body['kind'], note: notes.trim() }
          : {
              target: current.type,
              ...(current.type === 'DELIVERED' ? { recipientName: recipient.trim() } : {}),
              ...(notes.trim() ? { notes: notes.trim() } : {}),
            }),
      },
    };
    if (
      !(await confirmAction(
        current.type === 'exception'
          ? `Signaler un incident sur ${current.code} ? Le colis ne sera pas marqué livré.`
          : current.type === 'LOADED'
            ? `Confirmer que ${current.code} est physiquement dans le camion ?`
            : `Confirmer la remise de ${current.code} à ${recipient.trim()} ?`,
        { title: 'Confirmer l’action chauffeur', confirmLabel: 'Confirmer', dangerous: false },
      ))
    )
      return;
    if (currentToken !== token || blocked || storageKey !== key) return;
    try {
      sessionStorage.setItem(key, JSON.stringify(intent));
      pending = intent;
      inspected = false;
    } catch {
      actionError = 'Impossible de conserver la demande. Aucun envoi effectué.';
      return;
    }
    await sendPending();
  }
  async function sendPending() {
    if (!pending || disabled || busy || !online || !mission || error) return;
    const intent = $state.snapshot(pending),
      currentToken = token,
      key = storageKey,
      endpoint = path;
    busy = true;
    actionError = '';
    message = '';
    try {
      const receipt = await api<{
        operationKey: string;
        ref: string;
        code: string;
        version?: number;
        status?: string;
        recorded?: boolean;
      }>(`${endpoint}/${encodeURIComponent(intent.ref)}/${intent.type}`, {
        method: 'POST',
        body: intent.body,
      });
      if (
        receipt?.operationKey?.toLowerCase() !== intent.body.operationKey.toLowerCase() ||
        receipt.ref !== intent.ref ||
        receipt.code !== intent.code ||
        (intent.type === 'transition'
          ? !Number.isSafeInteger(receipt.version) ||
            receipt.version! < 1 ||
            receipt.status !== intent.body.target
          : receipt.recorded !== true)
      )
        throw new Error('Unconfirmed receipt');
      sessionStorage.removeItem(key);
      if (currentToken !== token) return;
      pending = null;
      drawerOpen = false;
      draft = null;
      message =
        intent.type === 'exception'
          ? `Incident signalé pour ${intent.code}. Son statut de livraison est inchangé.`
          : `${intent.code} : ${intent.body.target === 'LOADED' ? 'chargement confirmé' : 'remise confirmée'}.`;
      await reload();
      await onChange();
    } catch (e) {
      if (currentToken !== token) return;
      if (e instanceof ApiError && [401, 403, 404, 410].includes(e.statusCode)) {
        // A lost receipt may have committed before the link expired: retain the exact request.
        actionError = `${e.message} Contactez la régulation pour vérifier le résultat. La demande locale reste conservée.`;
        error = 'Ce lien ne permet plus de modifier la mission.';
        drawerOpen = false;
        await onChange();
      } else if (e instanceof ApiError && [400, 422].includes(e.statusCode)) {
        try {
          sessionStorage.removeItem(key);
          pending = null;
        } catch {
          storageError = 'Impossible de libérer la demande locale.';
        }
        draft = null;
        drawerOpen = false;
        actionError = `${e.message} Actualisez la mission avant une nouvelle action.`;
        await reload();
      } else {
        inspected = false;
        actionError =
          e instanceof ApiError && e.statusCode === 409
            ? `${e.message} Vérifiez la mission ou reprenez la même demande; aucun renvoi automatique.`
            : 'Réponse incertaine : l’action a peut-être été enregistrée. La demande exacte est conservée, sans renvoi automatique.';
      }
    } finally {
      if (currentToken === token) busy = false;
    }
  }
  async function inspect() {
    drawerOpen = false;
    inspected = await reload();
    await onChange();
  }
  async function acknowledge() {
    if (!inspected || busy || !online) return;
    const currentToken = token;
    if (
      !(await confirmAction(
        'Confirmez avoir vérifié le résultat avec la régulation. Oublier la demande locale n’annule aucune action déjà enregistrée.',
        { title: 'Résultat vérifié', confirmLabel: 'Terminer la vérification', dangerous: false },
      ))
    )
      return;
    if (token !== currentToken) return;
    try {
      sessionStorage.removeItem(storageKey);
      pending = null;
      storageError = '';
      actionError = '';
    } catch {
      storageError = 'Impossible de libérer la demande locale.';
    }
  }
</script>

<section aria-label="Colis de la mission" class="space-y-3 [&_button]:min-h-11">
  <Card>
    <div class="flex flex-wrap items-start justify-between gap-2">
      <div>
        <h2 class="text-base font-semibold">Colis à distribuer</h2>
        <p class="mt-1 text-sm text-ink-muted tabular-nums">
          {delivered} / {active.length} colis remis
        </p>
      </div>
      <Button
        variant="ghost"
        onclick={() => {
          void reload();
        }}
        disabled={busy || !online}>Actualiser les colis</Button
      >
    </div>
    <p class="mt-2 text-xs text-ink-muted">
      Vérifiez le contenu, chargez puis confirmez chaque remise. Les quantités restent séparées par
      article et unité.
    </p>
    {#if !online}<p role="status" class="mt-3 rounded-md bg-warn-soft p-3 text-sm">
        Hors connexion. Aucune nouvelle action ne peut être envoyée; les demandes incertaines ne
        sont jamais renvoyées automatiquement.
      </p>{/if}
    {#if pending || storageError}<div
        class="mt-3 rounded-md border border-warn/30 bg-warn-soft p-3"
        role="status"
      >
        <p class="text-sm">{storageError || `Action à vérifier pour ${pending?.code}.`}</p>
        <div class="mt-2 flex flex-wrap gap-2">
          {#if pending}<Button
              variant="secondary"
              onclick={sendPending}
              disabled={disabled || busy || !online || !mission || !!error}
              >Reprendre la même demande</Button
            >{/if}
          <Button variant="ghost" onclick={inspect} disabled={busy || !online}
            >Vérifier la mission</Button
          >
          {#if inspected}<Button variant="ghost" onclick={acknowledge} disabled={busy || !online}
              >Résultat vérifié avec la régulation</Button
            >{/if}
        </div>
      </div>{/if}
    {#if message}<p class="mt-3 rounded-md bg-ok-soft p-3 text-sm" role="status">{message}</p>{/if}
    {#if actionError && !drawerOpen}<div class="mt-3">
        <ErrorNotice message={actionError} />
      </div>{/if}
    {#if error}<div class="mt-3">
        <ErrorNotice
          message={error}
          onretry={() => {
            void reload();
          }}
        />
      </div>{/if}
    {#if !loading && mission && packages.length}<form class="mt-4 space-y-2" onsubmit={selectCode}>
        <Field label="Scanner ou saisir le code exact"
          ><Input
            bind:value={scan}
            maxlength={100}
            disabled={loading || !!error}
            placeholder="PKG-…"
          /></Field
        >
        <Button variant="secondary" type="submit" disabled={loading || !!error || !scan.trim()}
          >Repérer le colis</Button
        >
        {#if scanMessage}<p class="text-xs text-ink-muted" role="status">{scanMessage}</p>{/if}
      </form>{/if}
  </Card>
  {#if loading}<Skeleton rows={3} />
  {:else if mission && !error}
    {#if closed}<p class="rounded-md border border-edge bg-surface p-3 text-sm text-ink-muted">
        Mission clôturée : consultation seulement.
      </p>{/if}
    {#each mission.shipments as shipment (shipment.ref)}
      <Card>
        <header>
          <p class="text-xs text-ink-muted font-mono">{shipment.shipmentNumber}</p>
          <h3 class="mt-1 text-base font-semibold">{shipment.destinationName}</h3>
          <p class="mt-1 text-xs text-ink-muted">Depuis {shipment.originName}</p>
        </header>
        {#if !shipment.packages.length}<p class="mt-3 text-sm text-ink-muted">
            Aucun colis déclaré pour cette expédition. Utilisez le suivi des arrêts et la preuve de
            livraison.
          </p>{/if}
        {#each shipment.packages as pkg (pkg.ref)}
          <article
            id={`driver-package-${pkg.ref}`}
            tabindex="-1"
            aria-label={`Colis ${pkg.code}`}
            class={`mt-3 rounded-md border p-3 ${selectedRef === pkg.ref ? 'border-accent bg-accent-soft/20' : 'border-edge-soft'}`}
          >
            <div class="flex flex-wrap items-center gap-2">
              <span class="font-mono text-sm font-semibold">{pkg.code}</span><Badge
                tone={pkg.status === 'DELIVERED'
                  ? 'ok'
                  : pkg.status === 'LOADED'
                    ? 'info'
                    : 'neutral'}>{names[pkg.status] ?? pkg.status}</Badge
              >{#if selectedRef === pkg.ref}<span class="text-xs text-accent">Sélectionné</span
                >{/if}
            </div>
            {#if pkg.label}<p class="mt-1 text-sm break-words">{pkg.label}</p>{/if}
            <details open={selectedRef === pkg.ref} class="mt-2 text-sm">
              <summary class="cursor-pointer text-ink-muted"
                >Voir le contenu ({pkg.contents.length})</summary
              >
              <ul class="mt-2 space-y-2">
                {#each pkg.contents as line}<li class="text-xs">
                    <p class="break-words">
                      <span class="font-mono">{line.reference}</span> · {line.description}
                    </p>
                    <p class="mt-0.5 font-mono text-ink-muted tabular-nums">
                      {line.quantity}
                      {line.unit}
                    </p>
                  </li>{/each}
              </ul>
            </details>
            {#if pkg.loadedAt || pkg.deliveredAt}<p class="mt-2 text-xs text-ink-muted">
                {pkg.deliveredAt
                  ? `Remis : ${formatDateTime(pkg.deliveredAt)}`
                  : `Chargé : ${formatDateTime(pkg.loadedAt!)}`}
              </p>{/if}
            {#if pkg.incident}<p class="mt-2 text-sm text-warning">
                {pkg.incident.status === 'RETRY_PLANNED'
                  ? `Nouvelle tentative prévue ${pkg.incident.retryAt ? formatDateTime(pkg.incident.retryAt) : ''}`
                  : pkg.incident.status === 'RETURN_AUTHORIZED'
                    ? `Retour autorisé — ${pkg.incident.returnLocationName ?? 'lieu à confirmer'}`
                    : 'Incident à traiter par le bureau.'}
              </p>{/if}
            {#if !closed && !['CANCELLED', 'RETURNED'].includes(pkg.status) && (!pkg.incident || pkg.incident.status === 'RETRY_PLANNED')}<div
                class="mt-3 flex flex-wrap gap-2"
              >
                {#if pkg.status === 'PREPARED' && ['PLANNED', 'TENDERED', 'DISPATCHED', 'IN_TRANSIT'].includes(mission.status)}<Button
                    onclick={() => begin('LOADED', pkg, shipment)}
                    disabled={blocked}>Charger {pkg.code}</Button
                  >{/if}
                {#if pkg.status === 'LOADED' && mission.status === 'IN_TRANSIT' && shipment.status === 'IN_TRANSIT'}<Button
                    onclick={() => begin('DELIVERED', pkg, shipment)}
                    disabled={blocked}>Remettre {pkg.code}</Button
                  >{/if}
                <Button
                  variant="secondary"
                  onclick={() => begin('exception', pkg, shipment)}
                  disabled={blocked}>Incident {pkg.code}</Button
                >
              </div>{/if}
          </article>
        {/each}
      </Card>
    {:else}<p class="rounded-md bg-surface-muted p-4 text-sm text-ink-muted">
        Aucune expédition dans cette mission.
      </p>{/each}
  {/if}
</section>

<Drawer
  bind:open={drawerOpen}
  title={draft
    ? `${draft.type === 'exception' ? 'Signaler un incident' : draft.type === 'LOADED' ? 'Confirmer le chargement' : 'Confirmer la remise'} · ${draft.code}`
    : 'Action chauffeur'}
  width="md"
  dismissible={!busy}
>
  {#if actionError}<ErrorNotice message={actionError} />{/if}
  {#if draft}<div class="space-y-4">
      <p class="text-sm text-ink-muted">
        {draft.type === 'exception'
          ? 'Ce signalement est inscrit au suivi de la mission. Il ne modifie pas le statut du colis et ne confirme aucune livraison.'
          : draft.type === 'LOADED'
            ? 'Confirmez uniquement si ce colis est physiquement présent dans votre camion.'
            : 'Confirmez la remise réelle de ce colis à son destinataire.'}
      </p>
      {#if draft.lastPackageWithoutPod}<div class="rounded-md bg-warn-soft p-3 text-sm">
          <p>
            Dernier colis de cette expédition : préparez la preuve de livraison avant la remise.
            Elle peut être obligatoire selon les règles de l’entreprise.
          </p>
          <Button
            variant="secondary"
            disabled={busy || !!pending}
            onclick={async () => {
              const ref = draft!.shipmentRef;
              drawerOpen = false;
              await onRequestPod(ref);
            }}>Ouvrir la preuve de livraison</Button
          >
        </div>{/if}
      {#if draft.type === 'DELIVERED'}<Field label="Nom du destinataire"
          ><Input
            bind:value={recipient}
            required
            maxlength={120}
            disabled={busy || !!pending}
          /></Field
        >{/if}
      {#if draft.type === 'exception'}<Field label="Type d’incident"
          ><Select bind:value={incidentKind} disabled={busy || !!pending}
            ><option value="DAMAGE">Colis endommagé</option><option value="REFUSED"
              >Livraison refusée</option
            ><option value="MISSING">Colis manquant</option><option value="ABSENT"
              >Destinataire absent</option
            ><option value="OTHER">Autre incident</option></Select
          ></Field
        >{/if}
      <Field label={draft.type === 'exception' ? 'Description de l’incident' : 'Note (facultatif)'}
        ><Textarea
          bind:value={notes}
          maxlength={1000}
          required={draft.type === 'exception'}
          rows={4}
          disabled={busy || !!pending}
        /></Field
      >
    </div>{/if}
  {#snippet footer()}<div class="flex flex-wrap justify-end gap-2">
      <Button
        variant="ghost"
        onclick={() => {
          drawerOpen = false;
        }}
        disabled={busy}>Fermer</Button
      ><Button
        onclick={confirmDraft}
        loading={busy}
        disabled={blocked ||
          (draft?.type === 'DELIVERED' && !recipient.trim()) ||
          (draft?.type === 'exception' && !notes.trim())}>Confirmer</Button
      >
    </div>{/snippet}
</Drawer>
