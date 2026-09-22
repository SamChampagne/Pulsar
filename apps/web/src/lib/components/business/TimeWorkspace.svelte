<script lang="ts">
  import { onMount } from 'svelte';
  import { beforeNavigate } from '$app/navigation';
  import { auth } from '$lib/stores/auth';
  import { api, ApiError } from '$lib/api/client';
  import {
    formatServiceMinutes,
    SERVICE_TIME_STATUS_LABELS,
    type ServiceTimeStatus,
    type Paginated,
  } from '@pulsar/shared';
  import TimeReviewActions from './TimeReviewActions.svelte';
  import {
    Button,
    Field,
    Input,
    Textarea,
    EntityPicker,
    Badge,
    Modal,
    Skeleton,
  } from '$lib/components/ui';
  import type { ServiceJob, ServiceTimeEntry } from './types';
  import {
    readTimeIntent,
    rememberTimeIntent,
    clearTimeIntent,
    type TimeRequest,
    serviceTimeRevision,
  } from './time-intent';
  let {
    job = undefined,
    projectId = undefined,
    formOpen = $bindable(false),
    busy = $bindable(false),
  }: { job?: ServiceJob; projectId?: string; formOpen?: boolean; busy?: boolean } = $props();
  const manager = $derived($auth?.user.permissions.includes('services.manage') ?? false);
  const writer = $derived($auth?.user.permissions.includes('services.time.write') ?? false);
  const scope = $derived(`${$auth?.tenant.id ?? ''}:${$auth?.user.id ?? ''}`);
  const canAdd = $derived(
    !!job &&
      job.project.status === 'ACTIVE' &&
      ['IN_PROGRESS', 'COMPLETED'].includes(job.status) &&
      (manager || (writer && job.assigneeUserId === $auth?.user.id)),
  );
  let rows = $state<ServiceTimeEntry[]>([]),
    total = $state(0),
    summary = $state({
      minutes: 0,
      billableMinutes: 0,
      submittedMinutes: 0,
      approvedMinutes: 0,
      approvedBillableMinutes: 0,
    });
  let status = $state<ServiceTimeStatus | ''>('');
  let current = $state(1),
    from = $state(''),
    to = $state(''),
    mine = $state(false),
    loading = $state(true),
    error = $state('');
  let editing = $state<ServiceTimeEntry | null>(null),
    workDate = $state(''),
    minutes = $state<number | null>(60),
    billable = $state(false),
    note = $state(''),
    userId = $state('');
  let pending = $state<TimeRequest | null>(null),
    storageError = $state(''),
    formError = $state(''),
    uncertain = $state(false);
  let voidEntry = $state<ServiceTimeEntry | null>(null),
    reason = $state(''),
    voidOpen = $state(false);
  let generation = 0;
  const person = (p: { firstName: string; lastName: string }) =>
    `${p.firstName} ${p.lastName}`.trim();
  function canEdit(row: ServiceTimeEntry) {
    return (
      ['RECORDED', 'REJECTED'].includes(row.status) &&
      row.job.project.status === 'ACTIVE' &&
      (manager || (writer && row.userId === $auth?.user.id))
    );
  }
  async function load() {
    const g = ++generation;
    loading = true;
    error = '';
    try {
      const data = await api<Paginated<ServiceTimeEntry> & { summary: typeof summary }>(
        '/services/time-entries',
        {
          query: {
            jobId: job?.id,
            projectId,
            page: current,
            pageSize: 20,
            from,
            to,
            status,
            userId: mine ? $auth?.user.id : undefined,
          },
        },
      );
      if (g === generation) {
        rows = data.items;
        total = data.total;
        summary = data.summary;
      }
    } catch (e) {
      if (g === generation) error = e instanceof Error ? e.message : 'Temps indisponibles.';
    } finally {
      if (g === generation) loading = false;
    }
  }
  $effect(() => {
    void $serviceTimeRevision;
    void load();
  });
  onMount(() => {
    try {
      pending = readTimeIntent(scope);
    } catch (e) {
      storageError = e instanceof Error ? e.message : 'Stockage indisponible.';
    }
  });
  beforeNavigate((n) => {
    if (formOpen || busy || voidOpen) {
      n.cancel();
      formError = 'Enregistrez ou annulez la saisie avant de quitter.';
    }
  });
  function edit(row: ServiceTimeEntry | null) {
    editing = row;
    userId = row?.userId ?? job?.assigneeUserId ?? $auth?.user.id ?? '';
    const now = new Date();
    workDate =
      row?.workDate.slice(0, 10) ??
      new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    minutes = row?.minutes ?? 60;
    billable = row?.billable ?? false;
    note = row?.note ?? '';
    formError = '';
    uncertain = false;
    formOpen = true;
  }
  async function save() {
    if (busy || uncertain || pending || storageError || !minutes || !workDate || !note.trim())
      return;
    if (!editing && (!job || !canAdd)) return;
    const requestScope = scope;
    busy = true;
    formError = '';
    try {
      if (editing)
        await api(`/services/time-entries/${editing.id}`, {
          method: 'PATCH',
          body: {
            workDate,
            minutes,
            billable,
            note: note.trim(),
            expectedUpdatedAt: editing.updatedAt,
          },
        });
      else {
        const request: TimeRequest = {
          jobId: job!.id,
          userId,
          workDate,
          minutes,
          billable,
          note: note.trim(),
          operationKey: crypto.randomUUID(),
        };
        rememberTimeIntent(requestScope, request);
        pending = request;
        await api('/services/time-entries', { method: 'POST', body: request });
        clearTimeIntent(requestScope, request.operationKey);
        pending = null;
      }
      formOpen = false;
      serviceTimeRevision.update((v) => v + 1);
    } catch (e) {
      formError = e instanceof Error ? e.message : 'Enregistrement impossible.';
      if (pending && e instanceof ApiError && [400, 403, 404, 409, 422].includes(e.statusCode)) {
        clearTimeIntent(requestScope, pending.operationKey);
        pending = null;
      }
      uncertain = !!editing && (!(e instanceof ApiError) || e.statusCode >= 500);
    } finally {
      busy = false;
    }
  }
  async function resume() {
    if (!pending || busy || storageError) return;
    const request = pending,
      requestScope = scope;
    busy = true;
    formError = '';
    try {
      await api('/services/time-entries', { method: 'POST', body: request });
      clearTimeIntent(requestScope, request.operationKey);
      pending = null;
      formOpen = false;
      serviceTimeRevision.update((v) => v + 1);
    } catch (e) {
      formError = e instanceof Error ? e.message : 'Confirmation indisponible.';
      // The server checks replay before business validation. A definitive rejection
      // (except a reused key with another fingerprint) means this intent did not post.
      if (
        e instanceof ApiError &&
        [400, 404, 409, 422].includes(e.statusCode) &&
        (e.body as { code?: string } | undefined)?.code !== 'IDEMPOTENCY_CONFLICT'
      ) {
        clearTimeIntent(requestScope, request.operationKey);
        pending = null;
      }
    } finally {
      busy = false;
    }
  }
  async function cancelEntry() {
    if (!voidEntry || busy || uncertain || !reason.trim()) return;
    busy = true;
    formError = '';
    try {
      await api(`/services/time-entries/${voidEntry.id}/void`, {
        method: 'POST',
        body: { expectedUpdatedAt: voidEntry.updatedAt, reason: reason.trim() },
      });
      voidOpen = false;
      serviceTimeRevision.update((v) => v + 1);
    } catch (e) {
      formError = e instanceof Error ? e.message : 'Annulation impossible.';
      uncertain = !(e instanceof ApiError) || e.statusCode >= 500;
    } finally {
      busy = false;
    }
  }
</script>

<section aria-label="Temps de travail" class="space-y-4">
  <div class="flex flex-wrap items-start justify-between gap-3">
    <div>
      <h3 class="font-semibold">Temps de travail</h3>
      <p class="mt-1 max-w-prose text-xs leading-5 text-ink-muted">
        Déclarez, soumettez, puis faites approuver les heures par une autre personne habilitée.
        Aucun effet sur la paie ou les factures. Les temps annulés restent dans l’historique.
      </p>
    </div>
    {#if canAdd}<Button
        disabled={formOpen || busy || !!pending || !!storageError}
        onclick={() => edit(null)}>Saisir du temps</Button
      >{/if}
  </div>
  <dl class="grid grid-cols-2 gap-3 rounded-lg border border-edge bg-surface p-4">
    <div>
      <dt class="text-xs text-ink-muted">Total enregistré</dt>
      <dd class="mt-1 font-mono text-lg" data-testid="time-total">
        {formatServiceMinutes(summary.minutes)}
      </dd>
    </div>
    <div>
      <dt class="text-xs text-ink-muted">Déclaré facturable</dt>
      <dd class="mt-1 font-mono text-lg" data-testid="time-billable">
        {formatServiceMinutes(summary.billableMinutes)}
      </dd>
    </div>
    <div>
      <dt class="text-xs text-ink-muted">À approuver</dt>
      <dd class="mt-1 font-mono text-lg" data-testid="time-submitted">
        {formatServiceMinutes(summary.submittedMinutes)}
      </dd>
    </div>
    <div>
      <dt class="text-xs text-ink-muted">Heures approuvées</dt>
      <dd class="mt-1 font-mono text-lg" data-testid="time-approved">
        {formatServiceMinutes(summary.approvedMinutes)}
      </dd>
      <p class="mt-1 text-xs text-ink-muted">
        dont {formatServiceMinutes(summary.approvedBillableMinutes)} déclarées facturables
      </p>
    </div>
  </dl>
  {#if storageError}<p role="alert" class="text-sm text-danger">{storageError}</p>{/if}
  {#if pending}<div class="rounded-md border border-warn bg-warn-soft p-4 text-sm">
      <p>
        Une saisie attend confirmation : {pending.workDate}, {formatServiceMinutes(
          pending.minutes,
        )}. La demande originale est conservée dans ce navigateur; sa reprise ne crée pas un
        deuxième temps.
      </p>
      <Button variant="secondary" loading={busy} onclick={resume}
        >Vérifier et reprendre la saisie</Button
      >
    </div>{/if}
  {#if formError && !voidOpen}<p role="alert" class="text-sm text-danger">{formError}</p>{/if}
  {#if formOpen}<form
      class="space-y-4 rounded-lg border border-accent bg-surface p-4"
      onsubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <h4 class="font-medium">{editing ? 'Corriger le temps' : 'Nouveau temps'}</h4>
      {#if editing}<p class="text-sm text-ink-muted">
          {person(editing.user)} · {editing.job.number}
        </p>{:else if manager}<div>
          <p class="mb-1.5 text-xs font-medium text-ink-muted">Intervenant</p>
          <EntityPicker
            endpoint="/services/references/people"
            label="Intervenant du temps"
            bind:value={userId}
            selectedLabel={job?.assignee ? person(job.assignee) : ''}
            disabled={busy || !!pending}
          />
        </div>{:else}<p class="text-sm text-ink-muted">Temps saisi pour vous-même.</p>{/if}
      <div class="grid gap-3 sm:grid-cols-2">
        <Field label="Date de travail"
          ><Input
            type="date"
            bind:value={workDate}
            required
            disabled={busy || !!pending || uncertain}
          /></Field
        >
        <Field label="Durée (minutes)"
          ><Input
            type="number"
            min={1}
            max={1440}
            step={1}
            bind:value={minutes}
            required
            disabled={busy || !!pending || uncertain}
          /></Field
        >
      </div>
      <p class="text-xs text-ink-muted">
        {formatServiceMinutes(Number(minutes) || 0)} · maximum 24 h par personne et date, tous projets
        Services confondus.
      </p>
      <Field label="Travail effectué"
        ><Textarea
          bind:value={note}
          maxlength={2000}
          disabled={busy || !!pending || uncertain}
        /></Field
      >
      <label class="flex items-center gap-2 text-sm"
        ><input
          type="checkbox"
          bind:checked={billable}
          disabled={busy || !!pending || uncertain}
        />Temps déclaré facturable</label
      >
      <p class="text-xs text-ink-muted">Ce classement n’est ni une approbation ni une facture.</p>
      {#if uncertain}<p class="text-sm text-warn">
          Résultat incertain. Fermez la saisie et vérifiez les temps avant une nouvelle
          modification.
        </p>{/if}
      <div class="flex flex-wrap justify-end gap-2">
        <Button
          variant="secondary"
          disabled={busy}
          onclick={() => {
            formOpen = false;
            void load();
          }}>Fermer la saisie</Button
        ><Button
          type="submit"
          loading={busy}
          disabled={!!pending ||
            !!storageError ||
            uncertain ||
            !minutes ||
            !workDate ||
            !note.trim() ||
            !userId}>Enregistrer le temps</Button
        >
      </div>
    </form>{/if}
  <div class="flex flex-wrap items-end gap-3">
    <label class="flex flex-col gap-1 text-xs text-ink-muted"
      >État des temps
      <select
        class="min-h-9 rounded-md border border-edge bg-surface px-3 text-sm text-ink"
        bind:value={status}
        onchange={() => {
          current = 1;
        }}
      >
        <option value="">Tous les états</option>
        {#each Object.entries(SERVICE_TIME_STATUS_LABELS) as [value, label]}<option {value}
            >{label}</option
          >{/each}
      </select>
    </label>
    <Button
      variant="secondary"
      disabled={busy || formOpen}
      onclick={() => {
        status = 'SUBMITTED' as ServiceTimeStatus;
        mine = false;
        current = 1;
      }}>Voir les temps à approuver</Button
    >
    <div>
      <Field label="Du"
        ><Input
          type="date"
          bind:value={from}
          oninput={() => {
            current = 1;
          }}
        /></Field
      >
    </div>
    <div>
      <Field label="Au"
        ><Input
          type="date"
          bind:value={to}
          oninput={() => {
            current = 1;
          }}
        /></Field
      >
    </div>
    <label class="flex min-h-9 items-center gap-2 text-sm"
      ><input
        type="checkbox"
        bind:checked={mine}
        onchange={() => {
          current = 1;
        }}
      />Mes temps uniquement</label
    >
  </div>
  {#if error}<p role="alert" class="text-sm text-danger">{error}</p>{/if}
  {#if loading}<Skeleton rows={3} />{:else if !rows.length}<p
      class="rounded-md border border-dashed border-edge p-5 text-sm text-ink-muted"
    >
      Aucun temps pour ces critères. Ouvrez une intervention démarrée pour saisir le travail
      effectué.
    </p>{:else}<div class="divide-y divide-edge rounded-lg border border-edge bg-surface">
      {#each rows as row (row.id)}<article
          class="p-4"
          aria-label={`Temps ${row.workDate.slice(0, 10)} ${person(row.user)}`}
        >
          <div class="flex flex-wrap justify-between gap-2">
            <div>
              <p class="text-sm font-medium">
                {person(row.user)}
                <span class="font-normal text-ink-muted">· {row.workDate.slice(0, 10)}</span>
              </p>
              {#if !job}<a
                  href={`/services/interventions?jobId=${row.jobId}`}
                  class="text-xs text-accent">{row.job.number} · {row.job.title}</a
                >{/if}
            </div>
            <div class="flex flex-wrap items-center gap-2 self-start">
              <span class="font-mono text-sm">{formatServiceMinutes(row.minutes)}</span><Badge
                tone={row.status === 'APPROVED'
                  ? 'ok'
                  : row.status === 'REJECTED'
                    ? 'danger'
                    : row.status === 'SUBMITTED'
                      ? 'info'
                      : 'neutral'}>{SERVICE_TIME_STATUS_LABELS[row.status]}</Badge
              >
              <span class="text-xs text-ink-muted"
                >{row.billable ? 'Facturable déclaré' : 'Non facturable'}</span
              >
            </div>
          </div>
          <p class="mt-2 whitespace-pre-wrap break-words text-sm text-ink-muted">{row.note}</p>
          {#if row.reviews[0]?.reason && row.status !== 'VOIDED'}<p
              class="mt-2 text-xs text-ink-muted"
            >
              Dernier motif : {row.reviews[0].reason}
            </p>{/if}
          {#if row.voidReason}<p class="mt-2 text-xs text-warn">
              Motif d’annulation : {row.voidReason}
            </p>{/if}
          <div class="mt-2 flex flex-wrap items-center justify-between gap-2">
            <span class="text-xs text-ink-muted">Saisi par {person(row.createdBy)}</span>
            {#if canEdit(row)}<div class="flex gap-2">
                <Button
                  variant="ghost"
                  disabled={formOpen || busy || !!pending}
                  onclick={() => edit(row)}>Corriger</Button
                ><Button
                  variant="ghost"
                  disabled={formOpen || busy || !!pending}
                  onclick={() => {
                    voidEntry = row;
                    reason = '';
                    formError = '';
                    uncertain = false;
                    voidOpen = true;
                  }}>Annuler le temps</Button
                >
              </div>{/if}
          </div>
          <TimeReviewActions
            {row}
            disabled={formOpen || busy || !!pending}
            onOpenChange={(open) => {
              busy = open;
              if (!open && !formOpen && !voidOpen) formError = '';
            }}
          />
        </article>{/each}
    </div>{/if}
  <div class="flex flex-wrap items-center justify-end gap-2 text-sm">
    <span class="mr-auto text-ink-muted">{total} saisie(s) · totaux sur tous les résultats</span
    ><Button
      variant="ghost"
      disabled={current === 1 || loading}
      onclick={() => {
        current--;
      }}>Précédent</Button
    ><span>{current} / {Math.max(1, Math.ceil(total / 20))}</span><Button
      variant="ghost"
      disabled={current * 20 >= total || loading}
      onclick={() => {
        current++;
      }}>Suivant</Button
    >
  </div>
</section>
<Modal bind:open={voidOpen} title="Annuler ce temps" dismissible={!busy}>
  <p class="mb-3 text-sm text-ink-muted">
    La saisie restera visible, sans compter dans les totaux. Cette action est définitive et auditée.
  </p>
  <Field label="Motif obligatoire"
    ><Textarea bind:value={reason} maxlength={1000} disabled={busy || uncertain} /></Field
  >
  {#if formError}<p role="alert" class="mt-3 text-sm text-danger">{formError}</p>{/if}
  <div class="mt-4 flex justify-end gap-2">
    <Button
      variant="secondary"
      disabled={busy}
      onclick={() => {
        voidOpen = false;
        void load();
      }}>Retour</Button
    ><Button
      variant="danger"
      loading={busy}
      disabled={!reason.trim() || uncertain}
      onclick={cancelEntry}>Confirmer l’annulation</Button
    >
  </div>
</Modal>
