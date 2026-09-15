<script lang="ts">
  import { untrack } from 'svelte';
  import { api } from '$lib/api/client';
  import { auth } from '$lib/stores/auth';
  import { CRM_SEQUENCE_PRESETS, PERMISSIONS, type CrmSequenceStep } from '@pulsar/shared';
  import { Button, Field, Input, Select, Textarea, ErrorNotice } from '$lib/components/ui';
  import SequenceRuns from './SequenceRuns.svelte';
  type Automation = {
    id: string;
    enabled: boolean;
    mode: string;
    agentId: string | null;
    steps: CrmSequenceStep[];
  };
  let {
    stage,
    onsaved,
    onclose,
    saving = $bindable(false),
    dirty = $bindable(false),
  }: {
    stage: { id: string; name: string; automation: Automation | null };
    onsaved: () => void;
    onclose: () => void;
    saving?: boolean;
    dirty?: boolean;
  } = $props();
  let enabled = $state(untrack(() => stage.automation?.enabled ?? false)),
    mode = $state(untrack(() => stage.automation?.mode ?? 'SIMULATION')),
    agentId = $state(untrack(() => stage.automation?.agentId ?? ''));
  let steps = $state(
    untrack(() =>
      (stage.automation?.steps ?? CRM_SEQUENCE_PRESETS[0].steps).map((s) => ({
        ...s,
        delay:
          s.delayMinutes && s.delayMinutes % 1440 === 0 ? s.delayMinutes / 1440 : s.delayMinutes,
        unit: s.delayMinutes && s.delayMinutes % 1440 === 0 ? '1440' : '1',
      })),
    ),
  );
  let agents = $state<{ id: string; name: string; status: string }[]>([]),
    error = $state('');
  const initialSnapshot = untrack(() => JSON.stringify({ enabled, mode, agentId, steps }));
  $effect(() => {
    dirty = JSON.stringify({ enabled, mode, agentId, steps }) !== initialSnapshot;
  });
  const canEdit = $derived(
    !!$auth?.user.permissions.includes(PERMISSIONS.CRM.MANAGE) &&
      !!$auth?.user.permissions.includes(PERMISSIONS.EMAIL.SEND),
  );
  $effect(() => {
    if (mode === 'GOVERNED' && $auth?.user.permissions.includes(PERMISSIONS.CORE.AGENTS_READ))
      untrack(
        () =>
          void api<typeof agents>('/agents')
            .then((items) => (agents = items.filter((a) => a.status === 'ACTIVE')))
            .catch((e) => (error = e.message)),
      );
  });
  async function save() {
    saving = true;
    error = '';
    try {
      await api(`/crm/sequences${stage.automation ? `/${stage.automation.id}` : ''}`, {
        method: stage.automation ? 'PUT' : 'POST',
        body: {
          name: `${stage.name} — suivi`,
          enabled,
          mode,
          trigger: 'DEAL_STAGE_ENTERED',
          pipelineStageId: stage.id,
          ...(mode === 'GOVERNED' ? { agentId } : {}),
          steps: steps.map((s) => ({
            subject: s.subject,
            body: s.body,
            delayMinutes: Number(s.delay) * Number(s.unit),
          })),
        },
      });
      onsaved();
    } catch (e) {
      error = (e as Error).message;
    } finally {
      saving = false;
    }
  }
</script>

<section aria-label={`Automatisations de ${stage.name}`} class="min-w-0">
  <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
    <div>
      <p class="text-xs text-ink-muted">À l’entrée dans la colonne</p>
      <h2 class="text-xl font-semibold text-ink">{stage.name}</h2>
    </div>
    <Button variant="ghost" onclick={onclose} disabled={saving}>Fermer les actions</Button>
  </div>
  <ErrorNotice message={error} />
  <div class="grid min-w-0 gap-6">
    <form
      class="min-w-0 space-y-4"
      onsubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <fieldset disabled={!canEdit || saving} class="min-w-0 space-y-4">
        <div class="grid gap-3 sm:grid-cols-2">
          <Field label="Mode des actions"
            ><Select bind:value={mode}
              ><option value="SIMULATION">Simulation — aucun envoi</option><option value="GOVERNED"
                >Courriels gouvernés par un agent</option
              ></Select
            ></Field
          >{#if mode === 'GOVERNED'}<Field label="Agent responsable des envois"
              ><Select bind:value={agentId} required
                ><option value="">Choisir un agent autorisé</option>{#each agents as a}<option
                    value={a.id}>{a.name}</option
                  >{/each}</Select
              ></Field
            >{/if}
        </div>
        <ol class="space-y-3">
          {#each steps as step, i}
            <li class="min-w-0 rounded-md border border-edge p-4">
              <div class="mb-3 flex items-center justify-between">
                <h3 class="font-semibold">{i + 1}. Envoyer un courriel</h3>
                {#if steps.length > 1}<Button
                    variant="ghost"
                    onclick={() => {
                      steps = steps.filter((_, index) => index !== i);
                    }}>Retirer l’action {i + 1}</Button
                  >{/if}
              </div>
              <div class="grid gap-3 sm:grid-cols-[minmax(0,1fr)_8rem]">
                <Field
                  label={i === 0
                    ? 'Délai après entrée dans la colonne'
                    : 'Délai après le courriel précédent'}
                  ><Input
                    type="number"
                    min={0}
                    max={43200 / Number(step.unit)}
                    step={1}
                    required
                    bind:value={step.delay}
                  /></Field
                ><Field label={`Unité du délai ${i + 1}`}
                  ><Select bind:value={step.unit}
                    ><option value="1">Minutes</option><option value="60">Heures</option><option
                      value="1440">Jours</option
                    ></Select
                  ></Field
                >
              </div>
              <div class="mt-3 space-y-3">
                <Field label={`Objet du courriel ${i + 1}`}
                  ><Input bind:value={step.subject} required maxlength={200} /></Field
                ><Field label={`Message ${i + 1}`}
                  ><Textarea bind:value={step.body} required rows={4} maxlength={10000} /></Field
                >
              </div>
            </li>
          {/each}
        </ol>
        <Button
          variant="secondary"
          disabled={steps.length >= 5}
          onclick={() => {
            steps = [
              ...steps,
              {
                delay: 2,
                unit: '1440',
                delayMinutes: 2880,
                subject: 'Suivi de votre demande',
                body: 'Bonjour {{name}},\nSouhaitez-vous poursuivre notre échange ?',
              },
            ];
          }}>Ajouter une relance</Button
        >
        <label class="flex items-start gap-2 text-sm"
          ><input type="checkbox" bind:checked={enabled} class="mt-1" /><span
            >Activer pour les prochaines entrées dans cette colonne. Aucun démarrage rétroactif.</span
          ></label
        >
        {#if canEdit}<Button type="submit" disabled={saving}>Enregistrer les actions</Button>{/if}
      </fieldset>
    </form>
    <aside class="space-y-4 text-sm text-ink-muted">
      <div class="rounded-md bg-surface-muted p-4">
        <h3 class="font-semibold text-ink">Conditions de suivi</h3>
        <ul class="mt-2 list-disc space-y-2 pl-4">
          <li>Destinataire : contact principal de l’opportunité.</li>
          <li>
            Arrêt si l’opportunité quitte la colonne, si une réponse est reçue dans Pulsar ou si le
            consentement est retiré.
          </li>
          <li>
            Les délais suivants commencent après l’envoi ou la simulation de l’action précédente.
          </li>
          <li>
            Les envois réels suivent les permissions et politiques de l’agent. Aucun droit
            supplémentaire n’est accordé ici.
          </li>
        </ul>
      </div>
      <p>Variables disponibles : <code>{'{{name}}'}</code> et <code>{'{{company}}'}</code>.</p>
      <a href="/connect" class="block font-medium text-accent hover:underline"
        >Configurer la connexion courriel →</a
      >
      <p class="text-xs">
        SMS : connecteur et traitement des réponses STOP à ajouter. Aucun SMS n’est envoyé par ce
        formulaire.
      </p>
      <p class="text-xs">Un message déjà transmis au fournisseur ne peut pas être rappelé.</p>
    </aside>
  </div>
  {#if stage.automation}<div class="mt-6 border-t border-edge pt-5">
      <SequenceRuns sequenceId={stage.automation.id} />
    </div>{/if}
</section>
