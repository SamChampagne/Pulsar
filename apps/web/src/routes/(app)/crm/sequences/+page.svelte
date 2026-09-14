<script lang="ts">
  import { untrack } from 'svelte';
  import {
    PERMISSIONS,
    CRM_SEQUENCE_PRESETS,
    CrmSequenceMode,
    CrmSequenceTrigger,
    type CrmSequenceStep,
    type Paginated,
  } from '@pulsar/shared';
  import { api } from '$lib/api/client';
  import { auth } from '$lib/stores/auth';
  import {
    PageHeader,
    Button,
    Field,
    Input,
    Select,
    Textarea,
    ErrorNotice,
    Skeleton,
  } from '$lib/components/ui';
  import SequenceRuns from '$lib/components/crm/SequenceRuns.svelte';
  interface Scenario {
    id: string;
    name: string;
    enabled: boolean;
    mode: CrmSequenceMode;
    trigger: CrmSequenceTrigger;
    agentId: string | null;
    steps: CrmSequenceStep[];
  }
  let scenarios = $state<Scenario[]>([]),
    total = $state(0),
    page = $state(1),
    loading = $state(true),
    saving = $state(false),
    error = $state(''),
    notice = $state('');
  let id = $state(''),
    editing = $state(false),
    name = $state(''),
    enabled = $state(false),
    mode = $state(CrmSequenceMode.SIMULATION),
    trigger = $state(CrmSequenceTrigger.MANUAL),
    agentId = $state('');
  let steps = $state<CrmSequenceStep[]>([]),
    agents = $state<{ id: string; name: string; status: string }[]>([]);
  const canEdit = $derived(
    ($auth?.user.permissions.includes('crm.manage') ?? false) &&
      ($auth?.user.permissions.includes(PERMISSIONS.EMAIL.SEND) ?? false),
  );
  async function load() {
    loading = true;
    error = '';
    try {
      const result = await api<Paginated<Scenario>>('/crm/sequences', {
        query: { page, pageSize: 25 },
      });
      scenarios = result.items;
      total = result.total;
    } catch (e) {
      error = (e as Error).message;
    } finally {
      loading = false;
    }
  }
  function select(s?: Scenario) {
    editing = true;
    notice = '';
    error = '';
    id = s?.id ?? '';
    name = s?.name ?? CRM_SEQUENCE_PRESETS[0].name;
    enabled = s?.enabled ?? false;
    mode = s?.mode ?? CrmSequenceMode.SIMULATION;
    trigger = s?.trigger ?? CrmSequenceTrigger.MANUAL;
    agentId = s?.agentId ?? '';
    steps = (s?.steps ?? CRM_SEQUENCE_PRESETS[0].steps).map((step) => ({ ...step }));
  }
  async function save() {
    saving = true;
    error = '';
    notice = '';
    try {
      const item = await api<Scenario>(`/crm/sequences${id ? `/${id}` : ''}`, {
        method: id ? 'PUT' : 'POST',
        body: {
          name,
          enabled,
          mode,
          trigger,
          ...(mode === CrmSequenceMode.GOVERNED ? { agentId } : {}),
          steps,
        },
      });
      id = item.id;
      await load();
      notice = 'Scénario enregistré. Les suivis déjà inscrits conservent leur contenu.';
    } catch (e) {
      error = (e as Error).message;
    } finally {
      saving = false;
    }
  }
  $effect(() => {
    page;
    untrack(() => void load());
  });
  $effect(() => {
    if (mode === CrmSequenceMode.GOVERNED && $auth?.user.permissions.includes('core.agents.read'))
      untrack(
        () =>
          void api<typeof agents>('/agents')
            .then((r) => (agents = r.filter((a) => a.status === 'ACTIVE')))
            .catch((e) => (error = e.message)),
      );
  });
</script>

<svelte:head><title>Automatisations CRM · Pulsar</title></svelte:head>
<PageHeader
  title="Automatisations CRM"
  eyebrow="Communications"
  subtitle="Définissez le suivi, vérifiez son contenu et gardez la main sur chaque envoi."
>
  {#snippet actions()}<Button href="/crm/contacts" variant="secondary">Ouvrir les contacts</Button
    >{#if canEdit}<Button onclick={() => select()}>Nouveau scénario</Button>{/if}{/snippet}
</PageHeader>
{#if error}<ErrorNotice message={error} />{/if}
{#if notice}<p role="status" class="mb-4 rounded-md bg-surface-muted p-3 text-sm text-ink">
    {notice}
  </p>{/if}
<div class="grid min-w-0 items-start gap-6 xl:grid-cols-[18rem_minmax(0,1fr)]">
  <aside aria-label="Scénarios de suivi" class="min-w-0 rounded-lg border border-edge bg-surface">
    <div class="border-b border-edge p-4">
      <h2 class="font-semibold text-ink">Scénarios</h2>
      <p class="mt-1 text-xs text-ink-muted">{total} configuré(s) · courriel</p>
    </div>
    {#if loading}<Skeleton rows={4} />{:else if !scenarios.length}<p
        class="p-4 text-sm text-ink-muted"
      >
        Commencez avec le modèle « Premier contact et relance ». Il est désactivé et en simulation
        par défaut.
      </p>
    {:else}<nav class="p-2">
        {#each scenarios as s (s.id)}<button
            class="mb-1 w-full rounded-md p-3 text-left transition hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-accent"
            class:bg-surface-muted={id === s.id}
            aria-pressed={id === s.id}
            onclick={() => select(s)}
            ><span class="block text-sm font-semibold text-ink">{s.name}</span><span
              class="mt-1 block text-xs text-ink-muted"
              >{s.enabled ? 'Actif' : 'Désactivé'} · {s.mode === 'SIMULATION'
                ? 'Simulation'
                : 'Gouverné'} · {s.steps.length} étapes</span
            ></button
          >{/each}
      </nav>{/if}
    {#if total > 25}<div class="flex items-center justify-between p-2">
        <Button
          variant="ghost"
          disabled={page === 1}
          onclick={() => {
            page--;
          }}>Précédent</Button
        ><Button
          variant="ghost"
          disabled={page * 25 >= total}
          onclick={() => {
            page++;
          }}>Suivant</Button
        >
      </div>{/if}
  </aside>
  <div class="min-w-0 space-y-6">
    {#if editing}
      <form
        class="space-y-5 rounded-lg border border-edge bg-surface p-5"
        onsubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <div>
          <h2 class="text-lg font-semibold text-ink">
            {id ? 'Configurer le scénario' : 'Nouveau scénario'}
          </h2>
          <p class="mt-1 text-sm text-ink-muted">
            Arrêt sur réponse connue, retrait du consentement ou changement d’adresse.
          </p>
        </div>
        <fieldset disabled={!canEdit || saving} class="min-w-0 space-y-5">
          <Field label="Nom du scénario"><Input bind:value={name} required maxlength={120} /></Field
          >
          <div class="grid gap-4 md:grid-cols-2">
            <Field label="Déclenchement"
              ><Select bind:value={trigger}
                ><option value="MANUAL">Depuis la fiche contact</option><option
                  value="CONTACT_CREATED">À la création d’un contact</option
                ></Select
              ></Field
            >
            <Field label="Mode d’exécution"
              ><Select bind:value={mode}
                ><option value="SIMULATION">Simulation — aucun envoi</option><option
                  value="GOVERNED">Envois gouvernés par un agent</option
                ></Select
              ></Field
            >
          </div>
          {#if mode === CrmSequenceMode.GOVERNED}
            <div class="rounded-md border border-edge bg-surface-muted p-4 text-sm">
              <Field label="Agent responsable"
                ><Select bind:value={agentId}
                  ><option value="">Choisir un agent autorisé</option>{#each agents as agent}<option
                      value={agent.id}>{agent.name}</option
                    >{/each}</Select
                ></Field
              >
              <p class="mt-2 text-xs text-ink-muted">
                Permissions requises : CRM gérer + courriel envoyer. Les politiques existantes
                décident entre approbation, envoi automatique et refus. Aucun droit n’est ajouté
                ici.
              </p>
              <a href="/agents" class="text-xs text-accent hover:underline">Configurer les agents</a
              >
            </div>
          {/if}
          {#if trigger === CrmSequenceTrigger.CONTACT_CREATED}<p class="text-xs text-ink-muted">
              Nouveaux contacts uniquement, sans reprise de l’historique. En mode gouverné, les
              adresses sans accord déjà enregistré sont ignorées et journalisées.
            </p>{/if}
          <div class="flex flex-wrap items-center justify-between gap-2">
            <h3 class="font-semibold text-ink">Étapes du suivi</h3>
            <span class="text-xs text-ink-muted">Variables : {'{{name}}'} et {'{{company}}'}</span>
          </div>
          {#each steps as step, index}
            <section
              class="space-y-3 border-l-2 border-edge pl-4"
              aria-label={`Étape ${index + 1}`}
            >
              <div class="flex items-center justify-between">
                <h4 class="font-mono text-xs text-ink-muted">ÉTAPE {index + 1}</h4>
                {#if steps.length > 1}<Button
                    variant="ghost"
                    onclick={() => {
                      steps = steps.filter((_, i) => i !== index);
                    }}>Retirer l’étape {index + 1}</Button
                  >{/if}
              </div>
              <Field
                label={index === 0
                  ? 'Délai après inscription (minutes)'
                  : 'Délai après réussite précédente (minutes)'}
                ><Input
                  type="number"
                  bind:value={step.delayMinutes}
                  min={0}
                  max={43200}
                  step={1}
                  required
                /></Field
              >
              <Field label={`Objet du courriel ${index + 1}`}
                ><Input bind:value={step.subject} maxlength={200} required /></Field
              >
              <Field label={`Message ${index + 1}`}
                ><Textarea bind:value={step.body} rows={4} /></Field
              >
            </section>
          {/each}
          {#if steps.length < 5}<Button
              variant="secondary"
              onclick={() => {
                steps = [
                  ...steps,
                  {
                    delayMinutes: 1440,
                    subject: 'Suivi de votre demande',
                    body: 'Bonjour {{name}},\nAvez-vous eu le temps de consulter notre message ?',
                  },
                ];
              }}>Ajouter une étape</Button
            >{/if}
          <label class="flex items-start gap-2 text-sm text-ink"
            ><input type="checkbox" bind:checked={enabled} class="mt-1 accent-accent" /><span
              >Activer ce scénario<span class="mt-1 block text-xs text-ink-muted"
                >En simulation, aucune communication n’est envoyée. Un scénario désactivé suspend
                aussi ses suivis en cours.</span
              ></span
            ></label
          >
          <div class="flex flex-wrap gap-2">
            <Button type="submit" loading={saving}>Enregistrer le scénario</Button><Button
              variant="ghost"
              onclick={() => {
                editing = false;
              }}>Fermer l’éditeur</Button
            >
          </div>
        </fieldset>
      </form>
    {:else}<div class="rounded-lg bg-surface-muted p-6">
        <h2 class="text-lg font-semibold text-ink">Un suivi clair, étape par étape</h2>
        <p class="mt-2 max-w-2xl text-sm leading-6 text-ink-muted">
          Choisissez un scénario pour le configurer. Pour le tester, activez-le en simulation puis
          démarrez un suivi depuis un contact. Le journal ci-dessous affiche les prochaines étapes
          et les décisions.
        </p>
        <p class="mt-3 text-xs text-ink-muted">
          SMS et déclencheurs rendez-vous / facturation : prochain lot, non disponibles ici.
        </p>
      </div>{/if}
    {#key id}<SequenceRuns sequenceId={id} />{/key}
  </div>
</div>
