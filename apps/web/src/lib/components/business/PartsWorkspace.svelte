<script lang="ts">
  import { onMount } from 'svelte';
  import { api, ApiError } from '$lib/api/client';
  import { auth } from '$lib/stores/auth';
  import {
    Button,
    Field,
    Input,
    Textarea,
    EntityPicker,
    Skeleton,
    Badge,
  } from '$lib/components/ui';
  import type { Paginated } from '@pulsar/shared';
  import type { ServiceJob } from './types';
  import {
    readPartIntent,
    rememberPartIntent,
    clearPartIntent,
    type PartIntent,
  } from './part-intent';
  type Part = {
    id: string;
    quantity: string;
    nameSnapshot: string;
    codeSnapshot: string;
    unitSnapshot: string;
    binSnapshot: string;
    note: string;
    createdAt: string;
    movementId: string;
    returnMovementId: string | null;
    returnedAt: string | null;
    returnReason: string | null;
  };
  let {
    job,
    busy = $bindable(false),
    formOpen = $bindable(false),
    onchanged,
    onjournal,
  }: {
    job: ServiceJob;
    busy?: boolean;
    formOpen?: boolean;
    onchanged: () => Promise<void>;
    onjournal: () => Promise<void>;
  } = $props();
  const scope = $derived(`${$auth?.tenant.id}:${$auth?.user.id}:${job.id}`);
  const permissions = $derived(($auth?.user.permissions ?? []) as string[]);
  const canWrite = $derived(
    $auth?.tenant.enabledModules.includes('wms') &&
      ['services.manage', 'wms.read', 'wms.manage'].every((p) => permissions.includes(p)),
  );
  let rows = $state<Part[]>([]),
    current = $state(1),
    total = $state(0),
    loading = $state(true),
    error = $state(''),
    storageError = $state('');
  let pending = $state<PartIntent | null>(null),
    returning = $state<Part | null>(null),
    productId = $state(''),
    binId = $state(''),
    quantity = $state<number | undefined>(1),
    note = $state(''),
    confirmed = $state(false);
  let generation = 0;
  async function load() {
    const g = ++generation;
    loading = true;
    try {
      const data = await api<Paginated<Part>>(`/services/jobs/${job.id}/parts`, {
        query: { page: current, pageSize: 10 },
      });
      if (g === generation) {
        rows = data.items;
        total = data.total;
      }
    } catch (e) {
      if (g === generation) error = e instanceof Error ? e.message : 'Pièces indisponibles.';
    } finally {
      if (g === generation) loading = false;
    }
  }
  $effect(() => {
    void load();
  });
  $effect(() => {
    void productId;
    binId = '';
  });
  onMount(() => {
    try {
      pending = readPartIntent(scope);
    } catch (e) {
      storageError = e instanceof Error ? e.message : 'Stockage indisponible.';
    }
  });
  function start(part: Part | null) {
    returning = part;
    note = '';
    productId = '';
    binId = '';
    quantity = 1;
    confirmed = false;
    error = '';
    formOpen = true;
  }
  async function send(request: PartIntent) {
    const requestScope = scope;
    busy = true;
    error = '';
    try {
      await api(
        `/services/jobs/${encodeURIComponent(request.jobId)}/parts${request.partId ? `/${encodeURIComponent(request.partId)}/return` : ''}`,
        { method: 'POST', body: request.body },
      );
      clearPartIntent(requestScope, request.body.operationKey);
      pending = null;
      formOpen = false;
      await onchanged();
      await load();
    } catch (e) {
      error = e instanceof Error ? e.message : 'Réponse incertaine.';
      if (e instanceof ApiError && e.statusCode < 500) {
        clearPartIntent(requestScope, request.body.operationKey);
        pending = null;
        // Refresh the version, but do not silently submit the revised request.
        try {
          await onchanged();
        } catch {
          /* The visible error remains; reopen to refresh. */
        }
      } else formOpen = false;
    } finally {
      busy = false;
    }
  }
  async function save() {
    if (busy || pending || storageError || !confirmed || !note.trim()) return;
    const request: PartIntent = {
      jobId: job.id,
      ...(returning ? { partId: returning.id } : {}),
      body: {
        operationKey: crypto.randomUUID(),
        expectedUpdatedAt: job.updatedAt,
        ...(returning
          ? { reason: note.trim() }
          : { catalogItemId: productId, binId, quantity, note: note.trim() }),
      },
    };
    try {
      rememberPartIntent(scope, request);
      pending = request;
    } catch (e) {
      error = e instanceof Error ? e.message : 'Stockage indisponible.';
      return;
    }
    await send(request);
  }
</script>

<section aria-label="Pièces de l’intervention" class="space-y-4">
  {#if $auth?.tenant.enabledModules.includes('wms') && permissions.includes('wms.read')}<Button
      variant="ghost"
      disabled={busy || formOpen}
      onclick={onjournal}>Ouvrir le journal WMS de cette intervention</Button
    >{/if}
  <div>
    <h3 class="font-semibold">Pièces consommées</h3>
    <p class="mt-2 text-sm leading-6 text-ink-muted">
      Une confirmation retire réellement la quantité du stock WMS. Le Catalogue identifie le
      produit; cette intervention conserve son utilisation. Aucun effet sur la facture.
    </p>
  </div>
  {#if !canWrite}<p class="text-sm text-ink-muted">
      Historique en lecture seule. Pour agir : Entrepôt activé et droits services.manage, wms.read
      et wms.manage.
    </p>{/if}
  {#if storageError}<p role="alert" class="text-sm text-danger">{storageError}</p>{/if}
  {#if error}<p role="alert" class="text-sm text-danger">{error}</p>{/if}
  {#if pending}<div class="rounded-md border border-edge bg-surface-muted p-4 text-sm">
      <p>
        Une opération attend confirmation. Ne la recréez pas : reprenez exactement la demande
        conservée, même après une coupure. Le serveur ne l’applique qu’une fois.
      </p>
      <Button
        variant="secondary"
        disabled={busy || !canWrite}
        onclick={() => {
          if (pending) return send(pending);
        }}>Vérifier / reprendre l’opération</Button
      >
    </div>{/if}
  {#if formOpen && !pending}<form
      class="space-y-4 rounded-md border border-edge p-4"
      onsubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <h4 class="font-medium">{returning ? 'Retour intégral au stock' : 'Consommer une pièce'}</h4>
      {#if returning}<p class="text-sm">
          {returning.quantity}
          {returning.unitSnapshot} · {returning.nameSnapshot} → {returning.binSnapshot}. Confirmez
          seulement si ces pièces sont physiquement revenues. Aucun retour partiel dans cette
          version.
        </p>
      {:else}<EntityPicker
          endpoint="/services/references/parts"
          label="Produit du Catalogue"
          detailKey="code"
          bind:value={productId}
        />
        {#key productId}<EntityPicker
            endpoint="/services/references/part-bins"
            label="Emplacement source"
            detailKey="available"
            filters={{ catalogItemId: productId }}
            bind:value={binId}
            disabled={!productId}
          />{/key}
        <Field label="Quantité consommée"
          ><Input
            type="number"
            min={0.001}
            max={1000000000}
            step={0.001}
            required
            bind:value={quantity}
          /></Field
        >
        <p class="text-xs text-ink-muted">
          Le disponible affiché n’est pas réservé. Il sera revérifié à la confirmation. Produit
          absent ? Vérifiez sa correspondance Stock WMS dans Catalogue.
        </p>
      {/if}
      <Field label={returning ? 'Motif du retour' : 'Utilisation des pièces'}
        ><Textarea required maxlength={1000} bind:value={note} /></Field
      >
      <label class="flex items-start gap-2 text-sm"
        ><input type="checkbox" bind:checked={confirmed} />Je confirme le mouvement physique et la
        quantité.</label
      >
      <div class="flex flex-wrap justify-end gap-2">
        <Button
          variant="secondary"
          disabled={busy}
          onclick={() => {
            formOpen = false;
          }}>Annuler la saisie</Button
        >
        <Button
          type="submit"
          loading={busy}
          disabled={!confirmed ||
            !note.trim() ||
            (!returning && (!productId || !binId || !quantity))}
          >{returning ? 'Confirmer le retour de stock' : 'Confirmer la sortie de stock'}</Button
        >
      </div>
    </form>{/if}
  {#if !formOpen && !pending && canWrite && job.status === 'IN_PROGRESS' && job.project.status === 'ACTIVE'}<Button
      disabled={busy || !!storageError}
      onclick={() => start(null)}>Consommer une pièce</Button
    >{/if}
  {#if job.status === 'PLANNED'}<p class="text-sm text-ink-muted">
      Démarrez l’intervention avant de consommer des pièces.
    </p>{/if}
  {#if loading}<Skeleton rows={2} />{:else if !rows.length}<p
      class="rounded-md border border-dashed border-edge p-4 text-sm text-ink-muted"
    >
      Aucune pièce consommée. Choisir une prestation ou démarrer le travail ne modifie pas le stock.
    </p>
  {:else}<div class="divide-y divide-edge rounded-md border border-edge">
      {#each rows as row (row.id)}<article
          class="space-y-2 p-4"
          aria-label={`Pièce ${row.codeSnapshot}`}
        >
          <div class="flex flex-wrap items-center justify-between gap-2">
            <h4 class="text-sm font-medium">{row.nameSnapshot}</h4>
            <Badge tone={row.returnMovementId ? 'neutral' : 'info'}
              >{row.returnMovementId ? 'Retourné intégralement' : 'Consommé'}</Badge
            >
          </div>
          <p class="font-mono text-sm">{row.quantity} {row.unitSnapshot} · {row.codeSnapshot}</p>
          <p class="text-xs text-ink-muted">
            {row.binSnapshot} · {new Date(row.createdAt).toLocaleString('fr-CA')}
          </p>
          <p class="whitespace-pre-wrap break-words text-sm">{row.note}</p>
          {#if row.returnReason}<p class="text-sm text-ink-muted">
              Retour : {row.returnReason}
            </p>{/if}
          <details class="text-xs text-ink-muted">
            <summary class="cursor-pointer">Traçabilité WMS</summary>
            <p class="mt-2 break-all">Sortie : {row.movementId}</p>
            {#if row.returnMovementId}<p class="break-all">Retour : {row.returnMovementId}</p>{/if}
          </details>
          {#if canWrite && job.project.status === 'ACTIVE' && !row.returnMovementId}<Button
              variant="ghost"
              disabled={formOpen || busy || !!pending || !!storageError}
              onclick={() => start(row)}>Retourner les pièces</Button
            >{/if}
        </article>{/each}
    </div>{/if}
  <div class="flex items-center justify-end gap-2 text-sm">
    <span class="mr-auto text-ink-muted"
      >{total} consommation(s) · quantités par article, sans total mélangeant les unités</span
    ><Button
      variant="ghost"
      disabled={current === 1 || loading || busy || formOpen}
      onclick={() => {
        current--;
      }}>Précédent</Button
    ><span>{current}/{Math.max(1, Math.ceil(total / 10))}</span><Button
      variant="ghost"
      disabled={current * 10 >= total || loading || busy || formOpen}
      onclick={() => {
        current++;
      }}>Suivant</Button
    >
  </div>
</section>
