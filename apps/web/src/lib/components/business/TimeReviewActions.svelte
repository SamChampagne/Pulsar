<script lang="ts">
  import { formatDateTime as fmtUserInstant } from '$lib/format';
  import { onDestroy } from 'svelte';
  import { beforeNavigate } from '$app/navigation';
  import { auth } from '$lib/stores/auth';
  import { api, ApiError } from '$lib/api/client';
  import { Button, Field, Textarea, Modal, Skeleton } from '$lib/components/ui';
  import {
    ServiceTimeReviewAction as A,
    SERVICE_TIME_ACTION_LABELS as labels,
    SERVICE_TIME_STATUS_LABELS as statuses,
    formatServiceMinutes,
    type Paginated,
  } from '@pulsar/shared';
  import type { ServiceTimeEntry, ServiceTimeReview } from './types';
  import { serviceTimeRevision } from './time-intent';
  let {
    row,
    disabled = false,
    onOpenChange,
  }: {
    row: ServiceTimeEntry;
    disabled?: boolean;
    onOpenChange: (open: boolean) => void;
  } = $props();
  const owner = $derived(
    $auth?.user.permissions.includes('services.manage') ||
      ($auth?.user.id === row.userId && $auth.user.permissions.includes('services.time.write')),
  );
  const approver = $derived($auth?.user.permissions.includes('services.time.approve') ?? false);
  const independent = $derived(
    row.userId !== $auth?.user.id && row.createdBy.id !== $auth?.user.id,
  );
  const active = $derived(row.job.project.status === 'ACTIVE');
  const actions = $derived.by(() => {
    const result: A[] = [];
    if (!active) return result;
    if (owner && ['RECORDED', 'REJECTED'].includes(row.status)) result.push(A.SUBMIT);
    if (owner && row.status === 'SUBMITTED') result.push(A.WITHDRAW);
    if (approver && independent && row.status === 'SUBMITTED') result.push(A.APPROVE, A.REJECT);
    if (approver && independent && row.status === 'APPROVED') result.push(A.REOPEN);
    return result;
  });
  let open = $state(false),
    saving = $state(false),
    uncertain = $state(false),
    error = $state('');
  let action = $state<A | null>(null),
    target = $state<ServiceTimeEntry | null>(null),
    reason = $state('');
  let history = $state<ServiceTimeReview[]>([]),
    historyPage = $state(1),
    historyTotal = $state(0),
    loading = $state(false);
  let held = false,
    generation = 0;
  const requiresReason = $derived(action === A.REJECT || action === A.REOPEN);
  const explanations: Partial<Record<A, string>> = {
    SUBMIT:
      'La saisie sera figée et placée dans la file À approuver. Vous pourrez retirer la soumission tant qu’elle n’est pas traitée.',
    WITHDRAW: 'Le temps redevient modifiable. Il faudra le soumettre de nouveau après correction.',
    APPROVE:
      'Vous validez cette version des heures et son classement facturable. Aucun paiement, facture ou mouvement de stock ne sera créé.',
    REJECT:
      'Expliquez la correction attendue. Le temps restera compté comme déclaré, mais ne sera pas approuvé.',
    REOPEN:
      'L’approbation actuelle sera retirée des totaux approuvés. L’ancienne décision reste dans l’historique; une nouvelle soumission et validation seront nécessaires.',
  };
  function release() {
    if (held) {
      held = false;
      onOpenChange(false);
    }
  }
  onDestroy(release);
  beforeNavigate((n) => {
    if (open || saving) n.cancel();
  });
  function close(refresh = true) {
    open = false;
    release();
    if (refresh) serviceTimeRevision.update((v) => v + 1);
  }
  function show(next: A | null) {
    target = row;
    action = next;
    reason = '';
    error = '';
    uncertain = false;
    open = true;
    held = true;
    onOpenChange(true);
    if (!next) {
      history = [];
      historyPage = 1;
      void loadHistory();
    }
  }
  async function loadHistory() {
    if (!target) return;
    const g = ++generation;
    loading = true;
    error = '';
    try {
      const data = await api<Paginated<ServiceTimeReview>>(
        `/services/time-entries/${target.id}/reviews`,
        { query: { page: historyPage, pageSize: 10 } },
      );
      if (g === generation) {
        history = data.items;
        historyTotal = data.total;
      }
    } catch (e) {
      if (g === generation) error = e instanceof Error ? e.message : 'Historique indisponible.';
    } finally {
      if (g === generation) loading = false;
    }
  }
  async function confirm() {
    if (!target || !action || saving || uncertain || (requiresReason && !reason.trim())) return;
    saving = true;
    error = '';
    try {
      await api(`/services/time-entries/${target.id}/review`, {
        method: 'POST',
        body: {
          action,
          expectedUpdatedAt: target.updatedAt,
          ...(reason.trim() ? { reason: reason.trim() } : {}),
        },
      });
      close();
    } catch (e) {
      error = e instanceof Error ? e.message : 'Décision impossible.';
      uncertain = !(e instanceof ApiError) || e.statusCode >= 500;
    } finally {
      saving = false;
    }
  }
</script>

<div class="mt-3 flex flex-wrap items-center gap-2 border-t border-edge-soft pt-3">
  {#each actions as next}<Button
      variant={next === A.APPROVE || next === A.SUBMIT ? 'secondary' : 'ghost'}
      {disabled}
      onclick={() => show(next)}>{labels[next]}</Button
    >{/each}
  <Button variant="ghost" {disabled} onclick={() => show(null)}
    >Historique ({row._count.reviews})</Button
  >
</div>
{#if active && row.status === 'SUBMITTED' && approver && !independent}
  <p class="mt-2 text-xs text-ink-muted">
    Une autre personne habilitée doit approuver ces heures : vous êtes l’intervenant ou l’auteur de
    la saisie.
  </p>
{/if}
<Modal
  bind:open
  title={action ? labels[action] : 'Historique du temps'}
  size="lg"
  dismissible={!saving}
  onclose={() => close()}
>
  {#if target}<div class="mb-4 rounded-md bg-surface-muted p-3 text-sm">
      <p class="font-medium">
        {target.user.firstName}
        {target.user.lastName} · {formatServiceMinutes(target.minutes)}
      </p>
      <p class="mt-1 text-ink-muted">
        {target.workDate.slice(0, 10)} · {target.job.number} · {statuses[target.status]}
      </p>
      <p class="mt-2 whitespace-pre-wrap break-words">{target.note}</p>
    </div>{/if}
  {#if action}
    <p class="mb-4 max-w-prose text-sm leading-6 text-ink-muted">{explanations[action]}</p>
    {#if requiresReason}<Field label="Motif obligatoire"
        ><Textarea bind:value={reason} maxlength={1000} disabled={saving || uncertain} /></Field
      >{/if}
    {#if uncertain}<p class="mt-3 text-sm text-warn">
        Résultat incertain. Fermez ce panneau et consultez l’état et l’historique avant une nouvelle
        action. Ne renvoyez pas la décision.
      </p>{/if}
  {:else if loading}<Skeleton rows={3} />{:else if !history.length}
    <p class="text-sm text-ink-muted">
      Aucune décision ni correction enregistrée dans ce journal. Les saisies antérieures à ce
      workflow ne sont pas approuvées automatiquement.
    </p>
  {:else}<ol class="divide-y divide-edge">
      {#each history as event}<li class="py-3">
          <p class="text-sm font-medium">
            {labels[event.action]} · {event.actor.firstName}
            {event.actor.lastName}
          </p>
          <p class="mt-1 text-xs text-ink-muted">
            {fmtUserInstant(event.createdAt)} · {statuses[event.fromStatus]} → {statuses[
              event.toStatus
            ]}
          </p>
          {#if event.reason}<p class="mt-2 whitespace-pre-wrap break-words text-sm">
              {event.reason}
            </p>{/if}
          <details class="mt-2 text-xs text-ink-muted">
            <summary class="cursor-pointer">Version concernée</summary>
            {#if event.action === A.CORRECT}<p class="mt-2">
                Avant : {event.snapshot.before.workDate} · {formatServiceMinutes(
                  event.snapshot.before.minutes,
                )} · {event.snapshot.before.billable ? 'Facturable déclaré' : 'Non facturable'}
              </p>
              <p class="whitespace-pre-wrap break-words">{event.snapshot.before.note}</p>{/if}
            <p class="mt-2">
              {event.action === A.CORRECT ? 'Après : ' : ''}{event.snapshot.after.workDate} · {formatServiceMinutes(
                event.snapshot.after.minutes,
              )} · {event.snapshot.after.billable ? 'Facturable déclaré' : 'Non facturable'}
            </p>
            <p class="whitespace-pre-wrap break-words">{event.snapshot.after.note}</p>
          </details>
        </li>{/each}
    </ol>
    <div class="mt-3 flex items-center justify-end gap-2 text-sm">
      <Button
        variant="ghost"
        disabled={historyPage <= 1}
        onclick={() => {
          historyPage--;
          void loadHistory();
        }}>Précédent</Button
      >
      <span>{historyPage} / {Math.max(1, Math.ceil(historyTotal / 10))}</span>
      <Button
        variant="ghost"
        disabled={historyPage * 10 >= historyTotal}
        onclick={() => {
          historyPage++;
          void loadHistory();
        }}>Suivant</Button
      >
    </div>{/if}
  {#if error}<p role="alert" class="mt-3 text-sm text-danger">{error}</p>{/if}
  <div class="mt-5 flex justify-end gap-2">
    <Button variant="secondary" disabled={saving} onclick={() => close()}>Retour</Button>
    {#if action}<Button
        loading={saving}
        disabled={uncertain || (requiresReason && !reason.trim())}
        onclick={confirm}>Confirmer : {labels[action]}</Button
      >{/if}
  </div>
</Modal>
