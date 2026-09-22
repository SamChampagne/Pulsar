<script lang="ts">
  import { api } from '$lib/api/client';
  import { Button } from '$lib/components/ui';
  import type { Paginated } from '@pulsar/shared';
  let { id, version }: { id: string; version: string } = $props();
  type Event = {
    id: string;
    action: string;
    note: string;
    createdAt: string;
    snapshot: unknown;
    actor: { firstName: string; lastName: string };
  };
  let rows = $state<Event[]>([]),
    current = $state(1),
    total = $state(0),
    error = $state(''),
    loading = $state(false);
  $effect(() => {
    const path = id,
      v = version,
      p = current;
    let cancelled = false;
    loading = true;
    error = '';
    void api<Paginated<Event>>(`/quality/inspections/${path}/history`, {
      query: { page: p, pageSize: 10 },
    })
      .then((r) => {
        if (!cancelled) {
          rows = r.items;
          total = r.total;
        }
      })
      .catch((e) => {
        if (!cancelled) error = e.message;
      })
      .finally(() => {
        if (!cancelled) loading = false;
      });
    return () => {
      cancelled = true;
    };
  });
</script>

<section class="mt-6 border-t border-edge pt-4" aria-label="Historique qualité">
  <h2 class="mb-3 font-semibold text-ink">Historique du contrôle et des actions</h2>
  {#if error}<p role="alert" class="text-danger">{error}</p>{/if}
  {#if loading}<p class="text-sm text-ink-muted">Lecture du journal…</p>{/if}
  {#each rows as e (e.id)}<div class="border-b border-edge py-3 text-sm">
      <div class="flex flex-wrap justify-between gap-2">
        <strong>{e.note}</strong><time class="text-ink-muted"
          >{new Date(e.createdAt).toLocaleString('fr-CA')}</time
        >
      </div>
      <p class="text-ink-muted">{e.actor.firstName} {e.actor.lastName} · {e.action}</p>
      <details class="mt-1 text-ink-muted">
        <summary class="cursor-pointer">Voir les valeurs enregistrées</summary>
        <pre
          class="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded bg-surface-muted p-3 text-xs">{JSON.stringify(
            e.snapshot,
            null,
            2,
          )}</pre>
      </details>
    </div>{/each}
  <div class="mt-3 flex items-center gap-3">
    <Button
      variant="secondary"
      disabled={loading || current === 1}
      onclick={() => {
        current--;
      }}>Précédent</Button
    ><span class="text-xs text-ink-muted">{total} événements · page {current}</span><Button
      variant="secondary"
      disabled={loading || current * 10 >= total}
      onclick={() => {
        current++;
      }}>Suivant</Button
    >
  </div>
</section>
