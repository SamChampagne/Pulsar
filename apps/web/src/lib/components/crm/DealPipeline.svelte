<script lang="ts">
  import { untrack } from 'svelte';
  import { api } from '$lib/api/client';
  import { auth } from '$lib/stores/auth';
  import { CrmDealStage, isDealOpen, PERMISSIONS, type Paginated } from '@pulsar/shared';
  import { Button, Field, Input, Select, ErrorNotice } from '$lib/components/ui';
  import SequenceRuns from './SequenceRuns.svelte';
  let {
    deal,
    onchanged,
  }: {
    deal: {
      id: string;
      companyId: string;
      stage: string;
      pipelineId?: string | null;
      pipelineStageId?: string | null;
      stageRevision?: number;
      primaryContactId?: string | null;
      stageEntries?: {
        id: string;
        createdAt: string;
        processedAt: string | null;
        reason: string | null;
        runId: string | null;
      }[];
    };
    onchanged: () => void;
  } = $props();
  let contacts = $state<{ id: string; name: string; email: string | null }[]>([]),
    total = $state(0),
    search = $state('');
  let contactId = $state(untrack(() => deal.primaryContactId ?? '')),
    error = $state(''),
    busy = $state(false);
  let pipelines = $state<
    { id: string; name: string; stages: { id: string; name: string; kind: string }[] }[]
  >([]);
  const pipeline = $derived(pipelines.find((p) => p.id === deal.pipelineId) ?? pipelines[0]);
  const selectedStage = $derived(
    deal.pipelineStageId ?? pipeline?.stages.find((s) => s.kind === deal.stage)?.id ?? '',
  );
  const manage = $derived(!!$auth?.user.permissions.includes(PERMISSIONS.CRM.MANAGE));
  async function findContacts() {
    try {
      const result = await api<Paginated<(typeof contacts)[number]>>('/crm/contacts', {
        query: { companyId: deal.companyId, search, pageSize: 100 },
      });
      contacts = result.items;
      total = result.total;
    } catch (e) {
      error = (e as Error).message;
    }
  }
  $effect(() => {
    deal.id;
    untrack(() => {
      void findContacts();
      void api<typeof pipelines>('/crm/pipelines')
        .then((r) => (pipelines = r))
        .catch((e) => (error = e.message));
    });
  });
  async function mutate(path: string, method: 'PATCH' | 'POST', body: unknown) {
    busy = true;
    error = '';
    try {
      await api(path, { method, body });
      onchanged();
    } catch (e) {
      error = (e as Error).message;
    } finally {
      busy = false;
    }
  }
</script>

<section
  aria-label="Étape et suivi de l’opportunité"
  class="mb-5 space-y-4 rounded-lg border border-edge bg-surface p-5"
>
  <div class="flex flex-wrap items-center justify-between gap-3">
    <h2 class="text-lg font-semibold">Pipeline et prochaines actions</h2>
    <Button
      href={'/crm/pipeline' + (pipeline ? '?pipelineId=' + pipeline.id : '')}
      variant="secondary">Voir le pipeline</Button
    >
  </div>
  <ErrorNotice message={error} />
  <div class="grid gap-5 lg:grid-cols-2">
    <div class="space-y-3">
      <Field label="Étape de l’opportunité"
        ><Select
          value={selectedStage}
          disabled={!manage || busy || !isDealOpen(deal.stage as CrmDealStage)}
          onchange={(e) =>
            void mutate('/crm/deals/' + deal.id + '/advance', 'POST', {
              pipelineStageId: e.currentTarget.value,
              expectedRevision: deal.stageRevision ?? 0,
            })}
          >{#each pipeline?.stages ?? [] as stage}<option value={stage.id}>{stage.name}</option
            >{/each}</Select
        ></Field
      >
      <p class="text-xs text-ink-muted">
        Entrer dans une colonne active son suivi configuré. Sortir de la colonne annule ses relances
        en attente.
      </p>
    </div>
    <div class="space-y-3">
      <Field label="Contact principal des suivis"
        ><Select bind:value={contactId} disabled={!manage || busy}
          ><option value="">Aucun destinataire</option
          >{#if contactId && !contacts.some((c) => c.id === contactId)}<option value={contactId}
              >Contact actuel (hors recherche)</option
            >{/if}{#each contacts as contact}<option value={contact.id}
              >{contact.name}{contact.email ? ' · ' + contact.email : ' · Sans courriel'}</option
            >{/each}</Select
        ></Field
      >
      {#if manage}<div class="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            disabled={busy}
            onclick={() =>
              void mutate('/crm/deals/' + deal.id, 'PATCH', {
                primaryContactId: contactId || null,
              })}>Enregistrer le contact principal</Button
          >{#if contactId}<Button href="/crm/contacts" variant="ghost">Gérer le consentement</Button
            >{/if}
        </div>
        <details>
          <summary class="cursor-pointer text-xs text-ink-muted"
            >Rechercher un contact{total > 100 ? ' (liste limitée à 100)' : ''}</summary
          >
          <div class="mt-2 flex gap-2">
            <Input aria-label="Recherche de contact principal" bind:value={search} /><Button
              variant="ghost"
              onclick={findContacts}>Rechercher</Button
            >
          </div>
        </details>{/if}
      <p class="text-xs text-ink-muted">
        Choisir un contact ne redémarre pas une ancienne entrée. Le prochain changement de colonne
        déclenchera le suivi. Le consentement courriel reste obligatoire pour un envoi réel.
      </p>
    </div>
  </div>
  {#if deal.stageEntries?.length}<div class="rounded-md bg-surface-muted p-3 text-sm">
      <p class="font-medium">Dernière entrée dans une colonne</p>
      <p class="mt-1 text-ink-muted">
        {deal.stageEntries[0].reason ??
          (deal.stageEntries[0].runId
            ? 'Suivi démarré — détails ci-dessous'
            : 'En attente du moteur de suivi (environ une minute)')}
      </p>
    </div>{/if}
  <SequenceRuns dealId={deal.id} />
</section>
