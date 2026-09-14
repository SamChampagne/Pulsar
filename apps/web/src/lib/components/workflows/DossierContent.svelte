<script lang="ts">
  import type { WorkflowDossier } from '@pulsar/shared';
  import { Badge, labelFor, toneFor } from '$lib/components/ui';
  let { data }: { data: WorkflowDossier } = $props();
  const families = [
    { type: 'SALES_ORDER', label: 'Commande commerciale' },
    { type: 'TRANSPORT_ORDER', label: 'Ordres de transport' },
    { type: 'PICK_ORDER', label: 'Préparation entrepôt' },
    { type: 'SHIPMENT', label: 'Expéditions' },
    { type: 'LOAD', label: 'Chargements et livraison' },
    { type: 'CUSTOMER_INVOICE', label: 'Facturation et paiement' },
  ];
  const byKey = $derived(new Map(data.entities.map((e) => [`${e.type}:${e.id}`, e])));
  const failures = $derived(data.activity.filter((a) => a.status === 'FAILED'));
  const pending = $derived(
    data.activity.filter((a) => ['OPEN', 'IN_PROGRESS', 'PENDING', 'APPROVED'].includes(a.status)),
  );
</script>

<div class="space-y-6">
  <div class="flex flex-wrap items-center justify-between gap-3">
    <div>
      <p class="text-xs text-ink-muted">Dossier connecté</p>
      <h2 class="mt-1 font-mono text-xl font-semibold">{data.root.label}</h2>
    </div>
    <Badge tone={toneFor(data.root.status)}>{labelFor(data.root.status)}</Badge>
  </div>
  <div class="flex flex-wrap gap-4 border-y border-edge py-3 text-xs text-ink-muted">
    <span><strong class="font-mono text-ink">{data.entities.length}</strong> objets visibles</span
    ><span><strong class="font-mono text-warn">{pending.length}</strong> éléments à suivre</span
    ><span><strong class="font-mono text-danger">{failures.length}</strong> échecs enregistrés</span
    >
  </div>
  {#if failures.length}<div
      role="status"
      class="rounded-inner border-l-2 border-danger bg-danger-soft p-3 text-sm text-danger"
    >
      Un traitement a échoué. Consultez l’activité et le dossier source avant toute relance.
    </div>{/if}
  <section aria-label="Parcours métier" class="space-y-4">
    {#each families as family (family.type)}
      {@const rows = data.entities.filter((e) => e.type === family.type)}
      {#if rows.length}<section>
          <h3 class="mb-2 text-xs font-semibold text-ink-muted">{family.label}</h3>
          <div class="divide-y divide-edge-soft rounded-inner border border-edge-soft bg-surface">
            {#each rows as entity (entity.id)}<a
                href={entity.href}
                class="flex items-center justify-between gap-3 px-3 py-2.5 text-sm hover:bg-surface-muted"
                ><span class="min-w-0 truncate font-mono">{entity.label}</span><span
                  class="flex shrink-0 items-center gap-2"
                  ><Badge tone={toneFor(entity.status)}>{labelFor(entity.status)}</Badge><span
                    aria-hidden="true">↗</span
                  ></span
                ></a
              >{/each}
          </div>
        </section>{/if}
    {/each}
  </section>
  {#if data.links.length}<details class="rounded-inner border border-edge p-3">
      <summary class="cursor-pointer text-sm font-semibold"
        >Relations explicites ({data.links.length})</summary
      >
      <ul class="mt-3 space-y-2 text-xs">
        {#each data.links as relation (relation.from + relation.to + relation.label)}<li
            class="flex flex-wrap items-center gap-2"
          >
            <span class="font-mono">{byKey.get(relation.from)?.label}</span><span
              class="text-ink-muted">→ {relation.label} →</span
            ><span class="font-mono">{byKey.get(relation.to)?.label}</span>
          </li>{/each}
      </ul>
    </details>{/if}
  <section aria-labelledby="dossier-activity">
    <h3 id="dossier-activity" class="mb-3 text-sm font-semibold">
      Événements, tâches et décisions
    </h3>
    {#if data.activity.length === 0}<p
        class="rounded-inner bg-surface-muted p-3 text-sm text-ink-muted"
      >
        Aucune activité liée visible. Cela ne prouve pas que tous les traitements ont été exécutés.
      </p>{:else}
      <ol class="space-y-3 border-l border-edge pl-4">
        {#each data.activity as entry (entry.kind + entry.id)}<li>
            <div class="flex flex-wrap items-center justify-between gap-2">
              <span class="text-xs text-ink-muted"
                >{entry.kind === 'event'
                  ? 'Événement'
                  : entry.kind === 'task'
                    ? 'Tâche'
                    : entry.kind === 'action'
                      ? 'Décision agent'
                      : 'Réaction'}</span
              ><Badge tone={toneFor(entry.status)}>{labelFor(entry.status)}</Badge>
            </div>
            {#if entry.href}<a
                class="mt-1 block break-words text-sm font-medium text-accent hover:underline"
                href={entry.href}>{entry.label} ↗</a
              >{:else}<p class="mt-1 break-words text-sm">{entry.label}</p>{/if}<time
              datetime={entry.at}
              class="mt-1 block text-xs text-ink-muted"
              >{new Date(entry.at).toLocaleString('fr-CA')}</time
            >
          </li>{/each}
      </ol>
    {/if}
  </section>
  <aside class="space-y-2 rounded-inner bg-surface-muted p-3 text-xs leading-5 text-ink-muted">
    {#each data.notices as notice}<p>{notice}</p>{/each}
    <p>
      Lecture : {new Date(data.checkedAt).toLocaleString('fr-CA')}. Les états restent ceux des
      modules sources.
    </p>
  </aside>
</div>
