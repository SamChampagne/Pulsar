<script lang="ts">
  import { page } from '$app/state';
  import { beforeNavigate } from '$app/navigation';
  import { api } from '$lib/api/client';
  import { auth } from '$lib/stores/auth';
  import { PageHeader, Button, Field, Textarea, Modal } from '$lib/components/ui';
  import {
    QUALITY_NC_LABELS,
    QualityNonconformityStatus,
    canTransitionQualityNonconformity,
  } from '@pulsar/shared';
  import type { Nonconformity } from '$lib/quality/types';
  import History from '$lib/quality/History.svelte';
  import Followup from '$lib/quality/Followup.svelte';
  import Evidence from '$lib/quality/Evidence.svelte';
  let followupDirty = $state(false),
    followupBusy = $state(false),
    evidenceBusy = $state(false);
  const manage = $derived($auth?.user.permissions.includes('quality.manage'));
  let row = $state<Nonconformity | null>(null),
    rootCause = $state(''),
    correctiveAction = $state(''),
    error = $state(''),
    busy = $state(false),
    loading = $state(true),
    uncertain = $state(false),
    refresh = $state(0),
    next = $state<QualityNonconformityStatus | null>(null),
    note = $state('');
  const dirty = $derived(
    !!row && (rootCause !== row.rootCause || correctiveAction !== row.correctiveAction),
  );
  const editable = $derived(!!row && ['OPEN', 'IN_PROGRESS'].includes(row!.status));
  function adopt(r: Nonconformity) {
    row = r;
    rootCause = r.rootCause;
    correctiveAction = r.correctiveAction;
    uncertain = false;
  }
  $effect(() => {
    const id = page.params.id,
      v = refresh;
    let cancelled = false;
    loading = true;
    error = '';
    void api<Nonconformity>(`/quality/nonconformities/${id}`)
      .then((r) => {
        if (!cancelled) adopt(r);
      })
      .catch((e) => {
        if (!cancelled) {
          row = null;
          error = e.message;
        }
      })
      .finally(() => {
        if (!cancelled) loading = false;
      });
    return () => {
      cancelled = true;
    };
  });
  beforeNavigate((n) => {
    if (busy || dirty || next || followupDirty || followupBusy || evidenceBusy) {
      n.cancel();
      error = 'Enregistrez l’analyse ou rechargez le dossier avant de quitter.';
    }
  });
  async function save(transition = false) {
    if (!row || busy || uncertain || followupDirty || followupBusy || evidenceBusy) return;
    busy = true;
    error = '';
    try {
      adopt(
        await api<Nonconformity>(
          `/quality/nonconformities/${row.id}${transition ? '/transition' : ''}`,
          {
            method: transition ? 'POST' : 'PATCH',
            body: {
              expectedUpdatedAt: row.updatedAt,
              ...(transition
                ? { status: next, note: note.trim() }
                : { rootCause, correctiveAction }),
            },
          },
        ),
      );
      next = null;
    } catch (e) {
      error = (e as Error).message;
      uncertain = true;
      next = null;
    } finally {
      busy = false;
    }
  }
  const actions: Record<string, string> = {
    IN_PROGRESS: 'Prendre en traitement',
    RESOLVED: 'Déclarer l’action réalisée',
    CLOSED: 'Vérifier et clôturer',
  };
</script>

{#if row && !loading}<PageHeader
    title={row.title}
    eyebrow={`${row.number} · ${QUALITY_NC_LABELS[row!.status]}`}
    subtitle="Le contrôle reste historique; ce dossier décrit la correction et sa vérification."
    >{#snippet actions()}<Button
        variant="secondary"
        href="/quality/nonconformities"
        disabled={dirty || busy}>Toutes les non-conformités</Button
      ><Button
        variant="secondary"
        href={`/quality/inspections/${row!.inspectionId}`}
        disabled={dirty || busy}>Contrôle d’origine</Button
      >{/snippet}</PageHeader
  >{/if}
{#if error}<p role="alert" class="mb-3 text-danger">{error}</p>{/if}
{#if uncertain || dirty || followupDirty || (!row && !loading)}<Button
    variant="secondary"
    disabled={busy || followupBusy || evidenceBusy}
    onclick={() => {
      refresh++;
    }}>Recharger et abandonner les changements locaux</Button
  >{/if}
{#if loading}<p class="p-6 text-ink-muted">Lecture de la non-conformité…</p>{:else if row}
  <Followup
    {row}
    manage={!!manage}
    disabled={dirty || busy || uncertain || evidenceBusy || !!next}
    bind:dirty={followupDirty}
    bind:busy={followupBusy}
    onupdated={adopt}
  />
  <section class="space-y-4 rounded-lg border border-edge bg-surface p-5">
    <Field label="Cause identifiée"
      ><Textarea
        bind:value={rootCause}
        maxlength={4000}
        disabled={!manage ||
          !editable ||
          busy ||
          uncertain ||
          followupDirty ||
          followupBusy ||
          evidenceBusy}
      /></Field
    ><Field label="Action corrective"
      ><Textarea
        bind:value={correctiveAction}
        maxlength={4000}
        disabled={!manage ||
          !editable ||
          busy ||
          uncertain ||
          followupDirty ||
          followupBusy ||
          evidenceBusy}
      /></Field
    >{#if manage && editable}<Button
        onclick={() => save()}
        loading={busy}
        disabled={!dirty || uncertain || followupDirty || followupBusy || evidenceBusy}
        >Enregistrer l’analyse</Button
      >{/if}
    <p class="text-sm text-ink-muted">
      La clôture exige une vérification motivée. Aucun stock, remboursement ou statut SAV n’est
      modifié. Cette version ne force pas une validation par une seconde personne.
    </p>
  </section>
  {#if manage}<div class="mt-4 flex flex-wrap gap-2">
      {#each Object.values(QualityNonconformityStatus) as s}{#if canTransitionQualityNonconformity(row!.status, s)}<Button
            variant={s === 'CLOSED' ? 'primary' : 'secondary'}
            disabled={busy ||
              followupDirty ||
              followupBusy ||
              evidenceBusy ||
              dirty ||
              uncertain ||
              (s === 'RESOLVED' && (!rootCause.trim() || !correctiveAction.trim()))}
            onclick={() => {
              next = s;
              note = '';
            }}
            >{s === 'IN_PROGRESS' && row!.status === 'RESOLVED'
              ? 'Rouvrir le traitement'
              : actions[s]}</Button
          >{/if}{/each}
    </div>{/if}
  <Evidence
    {row}
    manage={!!manage}
    disabled={dirty || busy || uncertain || followupDirty || followupBusy || !!next}
    bind:busy={evidenceBusy}
    onupdated={adopt}
  />
  <History id={row!.inspectionId} version={row.updatedAt} />
{/if}
<Modal
  open={!!next}
  title="Confirmer l’action corrective"
  onclose={() => {
    if (!busy) next = null;
  }}
  dismissible={!busy}
  ><p class="mb-3 text-sm text-ink-muted">
    {next === 'CLOSED'
      ? 'Expliquez comment l’efficacité de la correction a été vérifiée. La clôture est définitive.'
      : 'Consignez le travail réalisé ou le motif de cette décision.'}
  </p>
  <Field label="Vérification ou compte rendu"><Textarea bind:value={note} maxlength={2000} /></Field
  >
  <div class="mt-4 flex gap-2">
    <Button loading={busy} disabled={!note.trim()} onclick={() => save(true)}>Confirmer</Button
    ><Button
      variant="secondary"
      disabled={busy}
      onclick={() => {
        next = null;
      }}>Retour</Button
    >
  </div></Modal
>
