<script lang="ts">
  import { untrack } from 'svelte';
  import { api } from '$lib/api/client';
  import { Button, Card } from '$lib/components/ui';
  import { Bot, RefreshCw } from 'lucide-svelte';
  let {
    runId,
    canRequest,
    canReadAgents,
    canReadApprovals,
    onitem,
  }: {
    runId: string;
    canRequest: boolean;
    canReadAgents: boolean;
    canReadApprovals: boolean;
    onitem: (id: string) => void;
  } = $props();
  type State = {
    stale: boolean;
    task: { id: string; status: string; assigneeAgentId: string | null } | null;
    event: { status: string } | null;
    workers: { id: string; name: string; status: string; eligible: boolean }[];
    runs: { id: string; status: string; createdAt: string }[];
    proposals: { id: string; tool: string; status: string }[];
    reviews: {
      id: string;
      summary: string;
      itemIds: string[];
      staleAtReview: boolean;
      createdAt: string;
      agentId: string;
    }[];
  };
  let assistance = $state<State | null>(null),
    busy = $state(false),
    error = $state(''),
    uncertain = $state(false);
  let generation = 0;
  const statuses: Record<string, string> = {
    OPEN: 'À traiter',
    IN_PROGRESS: 'En cours',
    RESOLVED: 'Terminée',
    CANCELLED: 'Annulée',
    PENDING: 'En attente',
    PROCESSED: 'Prise en charge',
    FAILED: 'Échec',
    QUEUED: 'En file',
    RUNNING: 'En cours',
    SUCCEEDED: 'Terminé',
    COMPLETED: 'Terminé',
    SKIPPED: 'Non exécuté',
    APPROVED: 'Approuvée',
    EXECUTED: 'Exécutée',
    REJECTED: 'Refusée',
    EXPIRED: 'Expirée',
  };
  async function load(id = runId) {
    const request = ++generation;
    busy = true;
    error = '';
    try {
      const next = await api<State>(`/manufacturing/mrp/runs/${id}/assistance`);
      if (request === generation) {
        assistance = next;
        uncertain = false;
      }
    } catch (e) {
      if (request === generation) error = e instanceof Error ? e.message : 'Suivi IA indisponible';
    } finally {
      if (request === generation) busy = false;
    }
  }
  $effect(() => {
    const id = runId;
    untrack(() => {
      assistance = null;
      uncertain = false;
      void load(id);
    });
  });
  async function requestReview() {
    const request = ++generation;
    busy = true;
    error = '';
    try {
      const next = await api<State>(`/manufacturing/mrp/runs/${runId}/request-review`, {
        method: 'POST',
      });
      if (request === generation) assistance = next;
    } catch (e) {
      if (request === generation) {
        uncertain = true;
        error = `${e instanceof Error ? e.message : 'Demande incertaine'}. Actualisez le suivi avant de reprendre.`;
      }
    } finally {
      if (request === generation) busy = false;
    }
  }
</script>

<Card>
  <div class="flex flex-wrap items-start justify-between gap-3">
    <div>
      <h2 class="flex items-center gap-2 font-medium text-ink"><Bot size={18} /> Assistance MRP</h2>
      <p class="mt-1 max-w-2xl text-sm text-ink-muted">
        Le moteur calcule les besoins. L’agent les explique et propose une synthèse ou un recalcul,
        selon ses droits et sa politique d’approbation.
      </p>
    </div>
    <Button
      variant="ghost"
      disabled={busy}
      onclick={() => load()}
      aria-label="Actualiser le suivi IA"><RefreshCw size={16} /> Actualiser</Button
    >
  </div>
  {#if error}<p role="alert" class="mt-3 text-sm text-danger">{error}</p>{/if}
  {#if !assistance && busy}<p class="mt-4 text-sm text-ink-muted" role="status">
      Chargement du suivi…
    </p>{/if}
  {#if assistance}
    <div class="mt-4 grid gap-3 sm:grid-cols-3">
      <div class="rounded-md border border-edge p-3">
        <p class="text-xs text-ink-muted">1 · Demande de revue</p>
        <p class="mt-1 text-sm font-medium">
          {assistance.task
            ? (statuses[assistance.task.status] ?? assistance.task.status)
            : assistance.event
              ? (statuses[assistance.event.status] ?? assistance.event.status)
              : 'Non demandée'}
        </p>
      </div>
      <div class="rounded-md border border-edge p-3">
        <p class="text-xs text-ink-muted">2 · Worker</p>
        <p class="mt-1 text-sm font-medium">
          {assistance.runs[0]
            ? (statuses[assistance.runs[0].status] ?? assistance.runs[0].status)
            : assistance.task?.assigneeAgentId
              ? 'Affecté — exécution en attente'
              : 'Aucune exécution'}
        </p>
      </div>
      <div class="rounded-md border border-edge p-3">
        <p class="text-xs text-ink-muted">3 · Synthèse enregistrée</p>
        <p class="mt-1 text-sm font-medium">
          {assistance.reviews.length
            ? `${assistance.reviews.length} synthèse(s)`
            : assistance.proposals.some((p) => p.status === 'PENDING')
              ? 'Approbation en attente'
              : 'Aucune synthèse'}
        </p>
      </div>
    </div>
    {#if !assistance.workers.some((w) => w.eligible)}<p class="mt-3 text-sm text-ink-muted">
        Aucun worker MRP admissible. Créez un agent avec le rôle « Analyste MRP (worker) », puis
        configurez son runtime. Une demande reste visible dans les tâches; elle n’est pas une
        analyse réalisée.
      </p>{:else}<p class="mt-3 text-xs text-ink-muted">
        Workers admissibles : {assistance.workers
          .filter((w) => w.eligible)
          .map((w) => w.name)
          .join(', ')}. Admissible ne garantit pas la disponibilité du runtime.
      </p>{/if}
    {#if assistance.stale}<p class="mt-3 text-sm text-warn">
        Ce calcul n’est plus à jour. Les synthèses portent sur son instantané; consultez ou
        produisez un nouveau calcul avant une décision.
      </p>{/if}
    <div class="mt-4 flex flex-wrap gap-2">
      {#if canRequest && !assistance.task && !assistance.event}<Button
          disabled={busy || uncertain}
          onclick={requestReview}>Demander une revue IA</Button
        >{/if}
      <Button variant="secondary" href="/workbench">Tâches opérationnelles</Button>
      {#if canReadApprovals}<Button variant="secondary" href="/agent-actions"
          >Approbations IA</Button
        >{/if}
      {#if canReadAgents}<Button variant="ghost" href="/agents">Configurer les workers</Button>{/if}
    </div>
    {#if assistance.proposals.length}<p class="mt-3 text-xs text-ink-muted">
        {assistance.proposals
          .map(
            (p) =>
              `${p.tool === 'submit_mrp_review' ? 'Synthèse' : 'Recalcul'} : ${statuses[p.status] ?? p.status}`,
          )
          .join(' · ')}
      </p>{/if}
    {#each assistance.reviews as review (review.id)}<article class="mt-4 border-t border-edge pt-4">
        <div class="flex flex-wrap items-center justify-between gap-2 text-xs text-ink-muted">
          <span
            >Synthèse IA enregistrée · {assistance.workers.find((w) => w.id === review.agentId)
              ?.name ?? 'Agent'}</span
          ><time datetime={review.createdAt}
            >{new Date(review.createdAt).toLocaleString('fr-CA')}</time
          >
        </div>
        {#if review.staleAtReview}<p class="mt-2 text-xs text-warn">
            Calcul déjà périmé lors de l’enregistrement.
          </p>{/if}
        <p class="mt-3 whitespace-pre-wrap text-sm leading-6 text-ink">{review.summary}</p>
        <div class="mt-2 flex flex-wrap gap-2">
          {#each review.itemIds as id, i (id)}<Button variant="ghost" onclick={() => onitem(id)}
              >Voir l’article cité {i + 1}</Button
            >{/each}
        </div>
      </article>{/each}
    <p class="mt-4 text-xs text-ink-muted">
      Aucun achat, OF, mouvement de stock ou résolution de manque n’est exécuté par ce rôle. Les
      revues automatiques sont désactivées par défaut dans les réglages Fabrication.
    </p>
  {/if}
</Card>
