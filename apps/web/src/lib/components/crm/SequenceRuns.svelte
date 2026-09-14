<script lang="ts">
  import { untrack } from 'svelte';
  import { api } from '$lib/api/client';
  import { auth } from '$lib/stores/auth';
  import { formatDateTime } from '$lib/format';
  import { Button, Field, Input, Select, ErrorNotice, Skeleton } from '$lib/components/ui';
  import { PERMISSIONS, type Paginated } from '@pulsar/shared';
  let { contactId = '', sequenceId = '' }: { contactId?: string; sequenceId?: string } = $props();
  interface Step {
    id: string;
    position: number;
    subject: string;
    body: string;
    status: string;
    dueAt: string | null;
    detail: string | null;
    proposalId: string | null;
    emailId: string | null;
  }
  interface Run {
    id: string;
    contactId: string;
    email: string;
    mode: string;
    status: string;
    reason: string | null;
    sequence: { name: string; enabled: boolean };
    steps: Step[];
  }
  let runs = $state<Run[]>([]),
    loading = $state(true),
    error = $state(''),
    busy = $state(false),
    total = $state(0),
    page = $state(1);
  let scenarios = $state<{ id: string; name: string; enabled: boolean; mode: string }[]>([]),
    picked = $state('');
  let preference = $state<{ email: string; consent: string; source: string | null } | null>(null);
  let consent = $state('UNKNOWN'),
    source = $state('');
  const manage = $derived($auth?.user.permissions.includes('crm.manage') ?? false);
  const send = $derived(
    manage && ($auth?.user.permissions.includes(PERMISSIONS.EMAIL.SEND) ?? false),
  );
  const labels: Record<string, string> = {
    ACTIVE: 'En cours',
    PAUSED: 'En pause',
    STOPPED: 'Arrêté',
    COMPLETED: 'Terminé',
    FAILED: 'Échec',
    PENDING: 'Programmé',
    PROPOSED: 'À approuver',
    QUEUED: 'Mis en file',
    SENT: 'Accepté par le transport',
    SIMULATED: 'Simulé',
    CANCELLED: 'Annulé',
  };
  let requestId = 0;
  async function load() {
    const request = ++requestId;
    loading = true;
    error = '';
    try {
      const result = await api<Paginated<Run>>('/crm/sequences/runs', {
        query: { contactId, sequenceId, page, pageSize: 10 },
      });
      if (request !== requestId) return;
      runs = result.items;
      total = result.total;
    } catch (e) {
      if (request === requestId) error = (e as Error).message;
    } finally {
      if (request === requestId) loading = false;
    }
  }
  async function loadContact(id: string) {
    preference = null;
    scenarios = [];
    picked = '';
    source = '';
    if (!id) return;
    try {
      const [pref, list] = await Promise.all([
        api<{ email: string; consent: string; source: string | null }>(
          `/crm/contacts/${id}/email-preference`,
        ),
        api<Paginated<{ id: string; name: string; enabled: boolean; mode: string }>>(
          '/crm/sequences',
          { query: { pageSize: 100 } },
        ),
      ]);
      if (contactId !== id) return;
      preference = pref;
      consent = pref.consent;
      source = pref.source ?? '';
      scenarios = list.items.filter((s) => s.enabled);
    } catch (e) {
      if (contactId === id) error = (e as Error).message;
    }
  }
  async function action(work: () => Promise<unknown>) {
    busy = true;
    error = '';
    try {
      await work();
      await load();
    } catch (e) {
      error = (e as Error).message;
    } finally {
      busy = false;
    }
  }
  async function setPreference() {
    await action(async () => {
      preference = await api(`/crm/contacts/${contactId}/email-preference`, {
        method: 'PATCH',
        body: { consent, source },
      });
    });
  }
  $effect(() => {
    contactId;
    sequenceId;
    page;
    untrack(() => void load());
  });
  $effect(() => {
    const id = contactId;
    untrack(() => void loadContact(id));
  });
</script>

<section aria-label="Suivis automatiques" class="min-w-0 space-y-4">
  <div class="flex flex-wrap items-center justify-between gap-2">
    <h2 class="text-base font-semibold text-ink">Suivis automatiques</h2>
    <Button variant="ghost" onclick={() => void load()} disabled={loading}
      >Actualiser les suivis</Button
    >
  </div>
  {#if error}<ErrorNotice message={error} />{/if}
  {#if contactId && preference}
    <details class="rounded-md border border-edge p-3">
      <summary class="cursor-pointer text-sm font-medium text-ink"
        >Consentement courriel · {preference.consent === 'GRANTED'
          ? 'Accord enregistré'
          : preference.consent === 'REVOKED'
            ? 'Désabonné'
            : 'À documenter'}</summary
      >
      <p class="my-3 break-all text-xs text-ink-muted">
        Lié à {preference.email}. Une nouvelle adresse nécessite un nouvel accord.
      </p>
      {#if manage}
        <form
          class="space-y-3"
          onsubmit={(e) => {
            e.preventDefault();
            void setPreference();
          }}
        >
          <Field label="Accord pour les suivis par courriel"
            ><Select bind:value={consent}
              ><option value="UNKNOWN">Non documenté</option><option value="GRANTED"
                >Accord explicite</option
              ><option value="REVOKED">Retiré / désabonné</option></Select
            ></Field
          >
          <Field label="Source ou preuve de l’accord"
            ><Input
              bind:value={source}
              required
              minlength={3}
              maxlength={300}
              placeholder="Formulaire, date et référence de l’accord"
            /></Field
          >
          <Button type="submit" variant="secondary" loading={busy}
            >Enregistrer le consentement</Button
          >
        </form>
      {/if}
    </details>
    {#if send}
      <form
        class="flex flex-wrap items-end gap-2"
        onsubmit={(e) => {
          e.preventDefault();
          if (picked)
            void action(() =>
              api(`/crm/sequences/${picked}/enroll`, { method: 'POST', body: { contactId } }),
            );
        }}
      >
        <div class="min-w-0 flex-1">
          <Field label="Scénario à démarrer"
            ><Select bind:value={picked}
              ><option value="">Choisir un scénario actif</option>{#each scenarios as s}<option
                  value={s.id}
                  >{s.name} · {s.mode === 'SIMULATION' ? 'Simulation' : 'Gouverné'}</option
                >{/each}</Select
            ></Field
          >
        </div>
        <Button type="submit" loading={busy} disabled={!picked}>Démarrer le suivi</Button>
      </form>
      <p class="text-xs text-ink-muted">
        Une inscription par scénario et contact. Le premier traitement a lieu au prochain passage du
        worker (environ une minute).
      </p>
      <a class="text-sm text-accent hover:underline" href="/crm/sequences"
        >Configurer les scénarios</a
      >
    {/if}
  {/if}
  {#if loading}<Skeleton rows={3} />
  {:else if !runs.length}<p class="rounded-md bg-surface-muted p-4 text-sm text-ink-muted">
      Aucun suivi pour cette sélection. Les envois restent désactivés tant qu’un scénario n’est pas
      activé.
    </p>
  {:else}
    {#each runs as run (run.id)}
      <article class="min-w-0 rounded-md border border-edge p-4">
        <div class="flex flex-wrap items-start justify-between gap-2">
          <div class="min-w-0">
            <h3 class="text-sm font-semibold text-ink">{run.sequence.name}</h3>
            <p class="break-all text-xs text-ink-muted">
              {run.email} · {run.mode === 'SIMULATION'
                ? 'Simulation — aucun envoi'
                : 'Envois gouvernés'}
            </p>
          </div>
          <span class="text-xs font-semibold text-ink">{labels[run.status] ?? run.status}</span>
        </div>
        {#if !run.sequence.enabled && run.status === 'ACTIVE'}<p class="mt-2 text-xs text-warn">
            Scénario désactivé : prochaines étapes suspendues.
          </p>{/if}
        {#if run.reason}<p class="mt-2 text-sm text-ink-muted">{run.reason}</p>{/if}
        <ol class="my-3 space-y-3 border-l border-edge pl-4">
          {#each run.steps as step (step.id)}
            <li>
              <div class="flex flex-wrap justify-between gap-1 text-xs">
                <span class="font-mono text-ink-muted">Étape {step.position + 1}</span><span
                  >{labels[step.status] ?? step.status}</span
                >
              </div>
              <details>
                <summary class="cursor-pointer break-words text-sm font-medium text-ink"
                  >{step.subject}</summary
                >
                <p class="my-2 whitespace-pre-wrap break-words text-sm text-ink-muted">
                  {step.body}
                </p>
              </details>
              <p class="text-xs text-ink-muted">
                {step.detail ??
                  (step.dueAt
                    ? `À partir du ${formatDateTime(step.dueAt)}`
                    : 'Après la réussite de l’étape précédente')}
              </p>
              {#if step.proposalId && $auth?.user.permissions.includes('core.agents.actions.read')}<a
                  class="text-xs text-accent hover:underline"
                  href="/agent-actions">Voir les actions à approuver</a
                >{/if}
              {#if step.emailId && $auth?.user.permissions.includes(PERMISSIONS.EMAIL.READ)}<a
                  class="ml-2 text-xs text-accent hover:underline"
                  href={`/emails?relatedType=crm-sequence-step&relatedId=${step.id}`}
                  >Historique courriel</a
                >{/if}
            </li>
          {/each}
        </ol>
        {#if manage && ['ACTIVE', 'PAUSED'].includes(run.status)}
          <div class="flex flex-wrap gap-2">
            {#if run.status === 'ACTIVE'}<Button
                variant="secondary"
                disabled={busy}
                onclick={() =>
                  void action(() => api(`/crm/sequences/runs/${run.id}/pause`, { method: 'POST' }))}
                >Mettre en pause</Button
              >
            {:else if send}<Button
                variant="secondary"
                disabled={busy}
                onclick={() =>
                  void action(() =>
                    api(`/crm/sequences/runs/${run.id}/resume`, { method: 'POST' }),
                  )}>Reprendre</Button
              >{/if}
            <Button
              variant="ghost"
              disabled={busy}
              onclick={() =>
                void action(() => api(`/crm/sequences/runs/${run.id}/stop`, { method: 'POST' }))}
              >Arrêter définitivement</Button
            >
          </div>
        {/if}
      </article>
    {/each}
  {/if}
  {#if total > 10}<div class="flex items-center gap-2">
      <Button
        variant="ghost"
        disabled={page === 1}
        onclick={() => {
          page--;
        }}>Précédent</Button
      ><span class="font-mono text-xs">{page} / {Math.ceil(total / 10)}</span><Button
        variant="ghost"
        disabled={page * 10 >= total}
        onclick={() => {
          page++;
        }}>Suivant</Button
      >
    </div>{/if}
  <p class="text-xs text-ink-faint">
    Une pause ou un arrêt ne rappelle pas un message déjà remis au fournisseur. « Accepté » ne
    prouve pas sa livraison.
  </p>
</section>
