<script lang="ts">
  import { api, ApiError } from '$lib/api/client';
  import { auth } from '$lib/stores/auth';
  import { formatDateTime } from '$lib/format';
  import { SERVICE_ACCEPTANCE_LABELS, type ServiceAcceptanceStatus } from '@pulsar/shared';
  import {
    Badge,
    Button,
    ErrorNotice,
    Field,
    Input,
    Select,
    Skeleton,
    Textarea,
  } from '$lib/components/ui';
  type Decision = {
    operationKey: string;
    expectedUpdatedAt: string;
    status: 'RESERVATIONS' | 'ACCEPTED';
    representative: string;
    reference: string;
    note: string;
    confirm: true;
  };
  type History = {
    job: {
      number: string;
      title: string;
      report: string;
      status: string;
      acceptanceStatus: ServiceAcceptanceStatus;
      updatedAt: string;
      project: { status: string; acceptanceRequired: boolean };
    };
    total: number;
    items: {
      id: string;
      toStatus: ServiceAcceptanceStatus;
      representative: string;
      reference: string;
      note: string;
      createdAt: string;
      actor: { firstName: string; lastName: string };
      snapshot: { report: string; title: string };
    }[];
  };
  let {
    jobId,
    busy = $bindable(false),
    formOpen = $bindable(false),
    onchanged = () => {},
  }: { jobId: string; busy?: boolean; formOpen?: boolean; onchanged?: () => void } = $props();
  const key = $derived(`pulsar:work-acceptance:${$auth?.tenant.id}:${$auth?.user.id}:${jobId}`);
  const allowed = $derived(
    ($auth?.user.permissions as string[] | undefined)?.includes('services.work.accept') ?? false,
  );
  let data = $state<History | null>(null),
    loading = $state(true),
    error = $state(''),
    current = $state(1);
  let decision = $state<'RESERVATIONS' | 'ACCEPTED'>('RESERVATIONS'),
    representative = $state(''),
    reference = $state(''),
    note = $state(''),
    confirm = $state(false);
  let pending = $state<Decision | null>(null),
    storageError = $state(false);
  let generation = 0;
  const editable = $derived(
    allowed &&
      data?.job.status === 'COMPLETED' &&
      data.job.project.status === 'ACTIVE' &&
      data.job.acceptanceStatus !== 'ACCEPTED',
  );
  $effect(() => {
    formOpen =
      !!editable &&
      !pending &&
      !!(representative || reference || note || confirm || decision !== 'RESERVATIONS');
  });
  function cancelForm() {
    representative = '';
    reference = '';
    note = '';
    confirm = false;
    decision = 'RESERVATIONS';
  }
  async function load() {
    const seq = ++generation;
    loading = true;
    error = '';
    data = null;
    try {
      const result = await api<History>(`/services/jobs/${jobId}/acceptance`, {
        query: { page: current },
      });
      if (seq === generation) data = result;
    } catch (e) {
      if (seq === generation) error = (e as Error).message;
    } finally {
      if (seq === generation) loading = false;
    }
  }
  $effect(() => {
    jobId;
    current;
    void load();
  });
  $effect(() => {
    try {
      const stored = sessionStorage.getItem(key);
      pending = stored ? JSON.parse(stored) : null;
      storageError = false;
    } catch {
      storageError = true;
      error = 'La reprise locale est indisponible. Aucun envoi autorisé avant sa restauration.';
    }
  });
  async function send() {
    if (busy || storageError || !allowed || (!pending && (!editable || !confirm || !data))) return;
    busy = true;
    error = '';
    try {
      if (!pending) {
        const intent: Decision = {
          operationKey: crypto.randomUUID(),
          expectedUpdatedAt: data!.job.updatedAt,
          status: decision,
          representative,
          reference,
          note,
          confirm: true,
        };
        // Persist before the request; never invent a replacement key after an uncertain response.
        sessionStorage.setItem(key, JSON.stringify(intent));
        pending = intent;
      }
      await api(`/services/jobs/${jobId}/acceptance`, { method: 'POST', body: pending });
      sessionStorage.removeItem(key);
      pending = null;
      representative = '';
      reference = '';
      note = '';
      confirm = false;
      current = 1;
      await load();
      onchanged();
    } catch (e) {
      error = (e as Error).message;
      if (e instanceof ApiError && e.statusCode < 500) {
        sessionStorage.removeItem(key);
        pending = null;
      }
    } finally {
      busy = false;
    }
  }
</script>

<section class="space-y-5" aria-label="Acceptation des travaux">
  <header class="flex flex-wrap items-start justify-between gap-3">
    <div>
      <h3 class="font-semibold">Acceptation des travaux</h3>
      <p class="mt-1 max-w-prose text-sm leading-6 text-ink-muted">
        Consignez la réponse du client au compte rendu. Les heures, pièces, prix et taxes suivent
        leurs contrôles séparés.
      </p>
    </div>
    <Button variant="ghost" disabled={busy || loading} onclick={load}
      >Actualiser l’acceptation</Button
    >
  </header>
  <ErrorNotice message={error} />
  {#if pending}<aside class="space-y-2 rounded-lg bg-warn-soft p-3 text-sm">
      <p>
        Une décision non confirmée est conservée : {SERVICE_ACCEPTANCE_LABELS[pending.status]} · {pending.representative}.
        Reprenez exactement cette demande avant d’en saisir une autre.
      </p>
      <Button variant="secondary" disabled={busy || !allowed || storageError} onclick={send}
        >Reprendre la décision conservée</Button
      >
    </aside>{/if}
  {#if loading}<Skeleton rows={3} />{:else if data}
    <div class="space-y-2 border-b border-edge pb-4">
      <Badge tone={data.job.acceptanceStatus === 'ACCEPTED' ? 'ok' : 'warn'}
        >{SERVICE_ACCEPTANCE_LABELS[data.job.acceptanceStatus]}</Badge
      >
      <p class="text-xs text-ink-muted">
        {data.job.project.acceptanceRequired
          ? 'Requise avant facturation des sources et clôture du projet.'
          : 'Facultative sur ce projet : aucun blocage de facturation ajouté.'}
      </p>
    </div>
    <section class="rounded-lg bg-surface-muted p-4">
      <h4 class="text-sm font-medium">Compte rendu à examiner</h4>
      <p class="mt-2 whitespace-pre-wrap text-sm leading-6">
        {data.job.report ||
          'Terminez l’intervention avec son compte rendu avant de recueillir la décision.'}
      </p>
    </section>
    {#if editable && !pending}
      <form
        class="space-y-4"
        onsubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        <fieldset disabled={busy || storageError} class="space-y-4">
          <Field label="Réponse du client"
            ><Select bind:value={decision}
              ><option value="RESERVATIONS">Réserves à traiter</option><option value="ACCEPTED"
                >Travaux acceptés sans réserve</option
              ></Select
            ></Field
          >
          <Field label="Représentant du client"
            ><Input bind:value={representative} required maxlength={200} /></Field
          >
          <Field label="Référence de l’échange"
            ><Input
              bind:value={reference}
              required
              maxlength={500}
              placeholder="Ex. courriel du 27 septembre, référence du procès-verbal"
            /></Field
          >
          <Field
            label={decision === 'RESERVATIONS'
              ? 'Réserves et suites attendues'
              : 'Conclusion et levée des réserves'}
            ><Textarea bind:value={note} required maxlength={4000} /></Field
          >
          <label class="flex items-start gap-3 text-sm leading-6"
            ><input type="checkbox" class="mt-1.5" bind:checked={confirm} />Je confirme avoir
            recueilli cette réponse. L’acceptation finale sera conservée sans modification.</label
          >
          <p class="text-xs leading-5 text-ink-muted">
            Déclaration interne avec auteur et historique, pas une signature électronique ni un
            accord sur la facture. Après acceptation, une correction passe par le SAV ou une
            nouvelle intervention.
          </p>
          <Button variant="ghost" disabled={busy} onclick={cancelForm}>Annuler la saisie</Button>
          <Button
            type="submit"
            loading={busy}
            disabled={!confirm ||
              !representative.trim() ||
              !reference.trim() ||
              !note.trim() ||
              storageError}>Consigner la décision</Button
          >
        </fieldset>
      </form>
    {:else if !allowed}<p class="text-sm text-ink-muted">
        Lecture seule. Le droit « Consigner les réserves et l’acceptation des travaux » est
        nécessaire.
      </p>{/if}
    <section class="space-y-3 border-t border-edge pt-4">
      <h4 class="text-sm font-semibold">Historique · {data.total}</h4>
      {#each data.items as record (record.id)}<article
          class="space-y-2 border-l-2 border-edge pl-4"
        >
          <p class="text-sm font-medium">
            {SERVICE_ACCEPTANCE_LABELS[record.toStatus]} · {record.representative}
          </p>
          <p class="text-xs text-ink-muted">
            Consigné par {record.actor.firstName}
            {record.actor.lastName} · {formatDateTime(record.createdAt)}
          </p>
          <p class="break-words text-sm">{record.reference}</p>
          <p class="whitespace-pre-wrap text-sm">{record.note}</p>
          <details class="text-xs text-ink-muted">
            <summary class="cursor-pointer py-2">Compte rendu capturé</summary>
            <p class="whitespace-pre-wrap leading-5">
              {record.snapshot.title} — {record.snapshot.report}
            </p>
          </details>
        </article>{:else}<p class="text-sm text-ink-muted">
          Aucune réponse client consignée.
        </p>{/each}
      {#if data.total > 20}<nav
          class="flex items-center justify-between"
          aria-label="Pages de l’acceptation"
        >
          <Button
            variant="ghost"
            disabled={busy || current === 1}
            onclick={() => {
              current--;
            }}>Précédent</Button
          ><span class="text-xs">{current} / {Math.ceil(data.total / 20)}</span><Button
            variant="ghost"
            disabled={busy || current * 20 >= data.total}
            onclick={() => {
              current++;
            }}>Suivant</Button
          >
        </nav>{/if}
    </section>
  {/if}
</section>
