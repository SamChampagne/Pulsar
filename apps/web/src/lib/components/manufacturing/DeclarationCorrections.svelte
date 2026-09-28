<script lang="ts">
  import { untrack } from 'svelte';
  import { api, ApiError } from '$lib/api/client';
  import { auth } from '$lib/stores/auth';
  import { formatDateTime } from '$lib/format';
  import { Button, Field, Input, Select } from '$lib/components/ui';
  import {
    readReversalIntent,
    rememberReversalIntent,
    type ReversalIntent,
  } from './reversal-intent';
  let {
    orderId,
    declarations,
    disabled = false,
    active = $bindable(false),
    busy = $bindable(false),
    onchange,
  }: {
    orderId: string;
    declarations: {
      id: string;
      createdAt: string;
      goodQuantity: number;
      scrapQuantity: number;
      reversal?: unknown;
      evidence: { version?: number };
    }[];
    disabled?: boolean;
    active?: boolean;
    busy?: boolean;
    onchange: () => Promise<void>;
  } = $props();
  type Preview = {
    expectedUpdatedAt: string;
    reviewToken: string;
    goodQuantity: number;
    scrapQuantity: number;
    blockedReasons: string[];
    effects: {
      movementId: string;
      sku: string;
      unit: string;
      binCode: string;
      lotCode: string | null;
      quantity: string;
      direction: 'IN' | 'OUT';
    }[];
  };
  const key = $derived(
    `pulsar:production-reversal:${$auth?.tenant.id}:${$auth?.user.id}:${orderId}`,
  );
  let selected = $state(''),
    reason = $state(''),
    confirmed = $state(false),
    error = $state(''),
    fatal = $state(false);
  let preview = $state<Preview | null>(null),
    pending = $state<ReversalIntent | null>(null);
  const path = $derived(`/manufacturing/shop-floor/orders/${orderId}/declarations`);
  $effect(() => {
    const scope = key;
    untrack(() => {
      busy = false;
      preview = null;
      selected = '';
      reason = '';
      confirmed = false;
      pending = null;
      fatal = false;
      error = '';
      try {
        pending = readReversalIntent(scope);
        if (pending) {
          selected = pending.declarationId;
          reason = pending.body.reason;
        }
      } catch (e) {
        fatal = true;
        error = e instanceof Error ? e.message : 'Correction illisible.';
      }
    });
  });
  $effect(() => {
    active = busy || !!preview || !!pending || fatal;
  });
  async function inspect() {
    if (!selected || busy || disabled || pending || fatal) return;
    const scope = key;
    busy = true;
    error = '';
    preview = null;
    confirmed = false;
    try {
      const p = await api<Preview>(`${path}/${selected}/reversal-preview`);
      if (key === scope) preview = p;
    } catch (e) {
      if (key === scope) error = e instanceof Error ? e.message : 'Revue indisponible.';
    } finally {
      if (key === scope) busy = false;
    }
  }
  async function submit() {
    if (
      busy ||
      disabled ||
      fatal ||
      (!pending &&
        (!preview || preview.blockedReasons.length || !confirmed || reason.trim().length < 3))
    )
      return;
    const scope = key,
      endpoint = path,
      recovery = !!pending;
    busy = true;
    error = '';
    try {
      const request = pending ?? {
        declarationId: selected,
        body: {
          operationKey: crypto.randomUUID(),
          expectedUpdatedAt: preview!.expectedUpdatedAt,
          reviewToken: preview!.reviewToken,
          reason,
        },
      };
      rememberReversalIntent(scope, request);
      pending = request;
      await api(`${endpoint}/${request.declarationId}/reverse`, {
        method: 'POST',
        body: request.body,
      });
      localStorage.removeItem(scope);
      if (key !== scope) return;
      pending = null;
      preview = null;
      selected = '';
      reason = '';
      confirmed = false;
      await onchange();
    } catch (e) {
      if (key !== scope) return;
      if (!recovery && e instanceof ApiError && [400, 403, 404, 409].includes(e.statusCode)) {
        localStorage.removeItem(scope);
        pending = null;
        preview = null;
        confirmed = false;
      }
      error = e instanceof Error ? e.message : 'Réponse incertaine. Reprenez la même correction.';
    } finally {
      if (key === scope) busy = false;
    }
  }
</script>

<section
  aria-label="Correction de déclaration"
  class="space-y-3 rounded-md border border-edge p-4 text-sm"
>
  <h3 class="font-medium">Corriger une déclaration</h3>
  <p class="text-ink-muted">
    Erreur de saisie seulement, sur un OF en cours. La contrepassation retire les bons produits de
    leur emplacement d’origine et restitue les matières aux lots sources. Elle n’efface rien et ne
    défait pas une transformation physique.
  </p>
  {#if disabled}<p class="text-xs text-ink-muted">
      Terminez la lecture ou la déclaration en cours avant de corriger. Pour abandonner une saisie
      non envoyée, fermez puis rouvrez l’atelier.
    </p>{/if}
  {#if !declarations.some((d) => !d.reversal && d.evidence.version === 2) && !pending}<p
      class="text-xs text-ink-muted"
    >
      Aucune déclaration v2 non contrepassée à corriger. Les preuves historiques v1 ne sont pas
      reconstituées.
    </p>{/if}
  {#if error}<p role="alert" class="text-danger">{error}</p>{/if}
  {#if pending}
    <p role="status">
      Réponse incertaine. La correction exacte est conservée : ne créez pas une nouvelle demande.
    </p>
    <p class="break-words text-ink-muted">Motif : {pending.body.reason}</p>
    <Button disabled={busy || disabled || fatal} onclick={submit}
      >Reprendre la même correction</Button
    >
  {:else}
    <Field label="Déclaration à corriger"
      ><Select
        bind:value={selected}
        disabled={busy || disabled || fatal}
        onchange={() => {
          preview = null;
          confirmed = false;
        }}
      >
        <option value="">Choisir la déclaration</option>
        {#each declarations.filter((d) => !d.reversal && d.evidence.version === 2) as d}<option
            value={d.id}
            >{formatDateTime(d.createdAt)} · {d.goodQuantity} bons / {d.scrapQuantity} rebuts</option
          >{/each}
      </Select></Field
    >
    <Button variant="secondary" disabled={!selected || busy || disabled || fatal} onclick={inspect}
      >Examiner les effets de la correction</Button
    >
    {#if busy}<p role="status">Vérification de la correction…</p>{/if}
    {#if preview}
      <p>
        Retrait du décompte de l’OF : <span class="font-mono"
          >{preview.goodQuantity} bons / {preview.scrapQuantity} rebuts</span
        >. Aucune nouvelle production automatique.
      </p>
      <ul class="space-y-2">
        {#each preview.effects as effect}<li class="rounded-md bg-surface-muted p-3">
            <strong>{effect.direction === 'OUT' ? 'Retirer du stock' : 'Restituer au stock'}</strong
            >
            <p class="break-words">
              {effect.sku} · <span class="font-mono">{effect.quantity} {effect.unit}</span>
            </p>
            <p class="text-ink-muted">
              {effect.binCode} · {effect.lotCode ? `Lot ${effect.lotCode}` : 'Sans lot'}
            </p>
          </li>{:else}<li>
            Aucun mouvement : la déclaration ne portait que du rebut, sans consommation.
          </li>{/each}
      </ul>
      {#each preview.blockedReasons as message}<p role="alert" class="text-danger">
          {message}
        </p>{/each}
      {#if !preview.blockedReasons.length}
        <Field label="Motif de correction"
          ><Input
            bind:value={reason}
            maxlength={1000}
            disabled={busy || disabled}
            oninput={() => (confirmed = false)}
          /></Field
        >
        <label class="flex items-start gap-2"
          ><input type="checkbox" bind:checked={confirmed} disabled={busy || disabled} />J’ai
          vérifié l’erreur et la situation physique. Je confirme tous ces mouvements compensatoires.</label
        >
        <Button
          disabled={busy || disabled || !confirmed || reason.trim().length < 3}
          onclick={submit}>Contrepasser la déclaration</Button
        >
      {/if}
      <Button
        variant="ghost"
        disabled={busy}
        onclick={() => {
          preview = null;
          confirmed = false;
        }}>Fermer la revue sans corriger</Button
      >
    {/if}
  {/if}
</section>
