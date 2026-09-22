<script lang="ts">
  import { page } from '$app/state';
  import { beforeNavigate } from '$app/navigation';
  import { api } from '$lib/api/client';
  import { auth } from '$lib/stores/auth';
  import { PageHeader, Button, Field, Input, Textarea, Select, Modal } from '$lib/components/ui';
  import {
    QUALITY_INSPECTION_LABELS,
    QualityInspectionStatus,
    evaluateQualityResults,
    type QualityResult,
  } from '@pulsar/shared';
  import type { Inspection } from '$lib/quality/types';
  import History from '$lib/quality/History.svelte';
  const manage = $derived($auth?.user.permissions.includes('quality.manage'));
  let row = $state<Inspection | null>(null),
    values = $state<Record<string, string | number | null>>({}),
    notes = $state<Record<string, string>>({}),
    baseline = $state(''),
    error = $state(''),
    busy = $state(false),
    loading = $state(true),
    uncertain = $state(false),
    refresh = $state(0),
    next = $state<QualityInspectionStatus | null>(null),
    note = $state('');
  const dirty = $derived(JSON.stringify({ values, notes }) !== baseline);
  const resultDraft = $derived(
    (row?.criteria
      .filter((c) => values[c.key] !== '' && values[c.key] !== null && values[c.key] !== undefined)
      .map((c) => ({
        key: c.key,
        value: c.kind === 'NUMBER' ? Number(values[c.key]) : (values[c.key] as 'PASS' | 'FAIL'),
        note: notes[c.key] ?? '',
      })) as QualityResult[]) ?? [],
  );
  const evaluation = $derived.by(() => {
    if (!row) return null;
    try {
      return evaluateQualityResults(row.criteria, resultDraft);
    } catch {
      return null;
    }
  });
  function adopt(r: Inspection) {
    row = r;
    values = Object.fromEntries(
      r.criteria.map((c) => [c.key, r.results.find((v) => v.key === c.key)?.value ?? '']),
    );
    notes = Object.fromEntries(
      r.criteria.map((c) => [c.key, r.results.find((v) => v.key === c.key)?.note ?? '']),
    );
    baseline = JSON.stringify({ values, notes });
    uncertain = false;
  }
  $effect(() => {
    const id = page.params.id,
      v = refresh;
    let cancelled = false;
    loading = true;
    error = '';
    void api<Inspection>(`/quality/inspections/${id}`)
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
    if (busy || dirty || next) {
      n.cancel();
      error = 'Enregistrez les résultats ou rechargez le contrôle avant de quitter.';
    }
  });
  async function save() {
    if (!row || busy || uncertain) return;
    busy = true;
    error = '';
    try {
      adopt(
        await api<Inspection>(`/quality/inspections/${row.id}/results`, {
          method: 'PATCH',
          body: { expectedUpdatedAt: row.updatedAt, results: resultDraft },
        }),
      );
    } catch (e) {
      error = (e as Error).message;
      uncertain = true;
    } finally {
      busy = false;
    }
  }
  async function decide() {
    if (!row || !next || busy || uncertain) return;
    busy = true;
    error = '';
    try {
      adopt(
        await api<Inspection>(`/quality/inspections/${row.id}/transition`, {
          method: 'POST',
          body: { expectedUpdatedAt: row.updatedAt, status: next, note: note.trim() },
        }),
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
  function propose(s: QualityInspectionStatus) {
    next = s;
    note = '';
  }
</script>

{#if row && !loading}
  <PageHeader
    title={row.title}
    eyebrow={`${row.number} · ${QUALITY_INSPECTION_LABELS[row!.status]}`}
    subtitle={`${row.planName} — version figée ${row.planRevision}`}
  >
    {#snippet actions()}<Button variant="secondary" href="/quality" disabled={busy || dirty}
        >Tous les contrôles</Button
      >{#if manage && row!.status === 'DRAFT'}<Button
          disabled={busy || uncertain}
          onclick={() => propose(QualityInspectionStatus.IN_PROGRESS)}>Démarrer le contrôle</Button
        >{/if}{#if manage && row!.status === 'IN_PROGRESS'}<Button
          disabled={busy || uncertain || !dirty || !evaluation}
          loading={busy}
          onclick={save}>Enregistrer les résultats</Button
        ><Button
          variant="secondary"
          disabled={busy || uncertain || dirty || !evaluation || evaluation.missing > 0}
          onclick={() => propose(QualityInspectionStatus.COMPLETED)}>Terminer le contrôle</Button
        >{/if}{/snippet}
  </PageHeader>
{/if}
{#if error}<p role="alert" class="mb-3 text-danger">{error}</p>{/if}
{#if uncertain || dirty || (!row && !loading)}<Button
    variant="secondary"
    disabled={busy}
    onclick={() => {
      next = null;
      refresh++;
    }}>Recharger et abandonner les changements locaux</Button
  >{/if}
{#if loading}<p class="p-6 text-ink-muted">Lecture du contrôle…</p>{:else if row}
  <div class="mb-5 grid gap-4 lg:grid-cols-[1fr_18rem]">
    <section class="rounded-lg border border-edge bg-surface p-4">
      <h2 class="font-semibold">Consignes et contexte</h2>
      <p class="mt-2 whitespace-pre-wrap text-sm text-ink-muted">
        {row.instructions || 'Aucune consigne complémentaire.'}
      </p>
      <div class="mt-3 text-sm">
        {#if row.source.href}<a class="text-accent hover:underline" href={row.source.href}
            >Ouvrir le dossier source : {row.source.label}</a
          >{:else if !row.source.available}Dossier source masqué : module ou droit de lecture
          manquant.{:else}Contrôle indépendant — l’objet est décrit dans le titre.{/if}
      </div>
      <p class="mt-3 text-xs text-ink-muted">
        Ce contrôle ne bloque ni ne libère du stock, et ne change pas le statut du dossier source.
      </p>
    </section>
    <section class="rounded-lg border border-edge bg-surface-muted p-4">
      <h2 class="text-xs font-semibold uppercase tracking-wide text-ink-muted">Avancement</h2>
      <div class="mt-2 text-3xl font-semibold tabular-nums">
        {evaluation?.completed ?? 0}<span class="text-base text-ink-muted">
          / {row.criteria.length}</span
        >
      </div>
      <div
        role="progressbar"
        class="mt-3 h-1.5 overflow-hidden rounded-full bg-edge"
        aria-label="Critères renseignés"
        aria-valuemin={0}
        aria-valuenow={evaluation?.completed ?? 0}
        aria-valuemax={row.criteria.length}
      >
        <div
          class="h-full rounded-full bg-ink-muted"
          style:width={`${(100 * (evaluation?.completed ?? 0)) / row.criteria.length}%`}
        ></div>
      </div>
      <p class="mt-2 text-sm">
        {row.outcome === 'PASS'
          ? 'Contrôle conforme'
          : row.outcome === 'FAIL'
            ? 'Contrôle non conforme'
            : `${evaluation?.failed ?? 0} écart(s) · résultat non final`}
      </p>
    </section>
  </div>
  {#if row.nonconformity}<div class="mb-4 rounded-lg border border-danger/30 bg-surface p-4">
      <strong
        >{row.nonconformity.status === 'CLOSED'
          ? 'Action corrective clôturée'
          : 'Une action corrective est à suivre'}</strong
      >
      <p class="mt-1 text-sm text-ink-muted">
        Les résultats restent figés. La non-conformité conserve l’analyse et la vérification.
      </p>
      <Button variant="secondary" href={`/quality/nonconformities/${row.nonconformity.id}`}
        >Ouvrir {row.nonconformity.number}</Button
      >
    </div>{/if}
  <div class="space-y-3">
    {#each row.criteria as c, i (c.key)}{@const check = evaluation?.checks.find(
        (result) => result.key === c.key,
      )}
      <section
        class={`rounded-lg border bg-surface p-4 ${check?.outcome === 'FAIL' ? 'border-danger/40' : 'border-edge'}`}
      >
        <div class="mb-3 flex flex-wrap justify-between gap-2">
          <h2 class="font-semibold">
            <span class="mr-2 text-ink-muted">{String(i + 1).padStart(2, '0')}</span>{c.label}
            {#if check?.outcome === 'FAIL'}<span
                class="ml-2 rounded bg-danger/10 px-2 py-0.5 text-xs font-medium text-danger"
                >Écart</span
              >{/if}
          </h2>
          <span class="text-sm text-ink-muted"
            >{c.kind === 'NUMBER'
              ? `${c.min} à ${c.max} ${c.unit} (inclus)`
              : 'Vérification visuelle ou fonctionnelle'}</span
          >
        </div>
        <div class="grid gap-3 md:grid-cols-2">
          <Field label="Résultat"
            >{#if c.kind === 'NUMBER'}<Input
                type="number"
                aria-label={`Mesure : ${c.label}`}
                min={-1e9}
                max={1e9}
                bind:value={values[c.key]}
                disabled={!manage || row!.status !== 'IN_PROGRESS' || busy || uncertain}
              />{:else}<Select
                aria-label={`Résultat : ${c.label}`}
                bind:value={values[c.key] as string}
                disabled={!manage || row!.status !== 'IN_PROGRESS' || busy || uncertain}
                ><option value="">Non renseigné</option><option value="PASS">Conforme</option
                ><option value="FAIL">Non conforme</option></Select
              >{/if}</Field
          ><Field label="Observation"
            ><Input
              aria-label={`Observation : ${c.label}`}
              bind:value={notes[c.key]}
              maxlength={2000}
              disabled={!manage || row!.status !== 'IN_PROGRESS' || busy || uncertain}
            /></Field
          >
        </div>
      </section>{/each}
  </div>
  {#if manage && ['DRAFT', 'IN_PROGRESS'].includes(row!.status)}<div class="mt-4">
      <Button
        variant="ghost"
        disabled={busy || dirty || uncertain}
        onclick={() => propose(QualityInspectionStatus.CANCELLED)}
        >Annuler le contrôle avec un motif</Button
      >
    </div>{/if}
  <History id={row.id} version={row.updatedAt} />
{/if}
<Modal
  open={!!next}
  title="Confirmer la décision"
  onclose={() => {
    if (!busy) next = null;
  }}
  dismissible={!busy}
>
  <p class="mb-3 text-sm text-ink-muted">
    {next === 'COMPLETED'
      ? 'Les résultats seront définitifs. Tout critère non conforme ouvrira une non-conformité, sans mouvement de stock.'
      : next === 'CANCELLED'
        ? 'Le contrôle sera annulé et ne pourra plus être modifié.'
        : 'Le contrôle passe en cours; vous pourrez saisir les résultats.'}
  </p>
  <Field label="Compte rendu ou motif"><Textarea bind:value={note} maxlength={2000} /></Field>
  <div class="mt-4 flex gap-2">
    <Button loading={busy} disabled={!note.trim()} onclick={decide}>Confirmer</Button><Button
      variant="secondary"
      disabled={busy}
      onclick={() => {
        next = null;
      }}>Retour</Button
    >
  </div>
</Modal>
