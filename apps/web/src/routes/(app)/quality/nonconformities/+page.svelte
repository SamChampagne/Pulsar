<script lang="ts">
  import { api } from '$lib/api/client';
  import { PageHeader, Button, Input, Select, EmptyState } from '$lib/components/ui';
  import { QUALITY_NC_LABELS, type Paginated } from '@pulsar/shared';
  import type { Nonconformity } from '$lib/quality/types';
  let rows = $state<Nonconformity[]>([]),
    total = $state(0),
    current = $state(1),
    search = $state(''),
    ncStatus = $state(''),
    assignment = $state(''),
    overdue = $state(false),
    loading = $state(true),
    error = $state(''),
    refresh = $state(0);
  $effect(() => {
    const q = {
        search,
        ncStatus: ncStatus || undefined,
        assignment: assignment || undefined,
        overdue: overdue ? 'true' : undefined,
        page: current,
        pageSize: 20,
      },
      v = refresh;
    let cancelled = false;
    loading = true;
    error = '';
    void api<Paginated<Nonconformity>>('/quality/nonconformities', { query: q })
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

<PageHeader
  title="Non-conformités"
  subtitle="Analyser la cause, réaliser une correction, puis consigner sa vérification."
  >{#snippet actions()}<Button variant="secondary" href="/quality">Contrôles</Button
    >{/snippet}</PageHeader
>
<p class="mb-4 text-sm text-ink-muted">
  Un contrôle terminé avec un échec crée une non-conformité. Sa clôture ne remet pas le contrôle en
  conformité.
</p>
<div class="mb-4 flex flex-wrap gap-3">
  <Input
    aria-label="Rechercher les non-conformités"
    bind:value={search}
    oninput={() => (current = 1)}
  /><Select
    aria-label="État des non-conformités"
    bind:value={ncStatus}
    onchange={() => (current = 1)}
    ><option value="">Tous les états</option
    >{#each Object.entries(QUALITY_NC_LABELS) as [key, label]}<option value={key}>{label}</option
      >{/each}</Select
  >
</div>
<div class="mb-4 flex flex-wrap items-center gap-3">
  <Select
    aria-label="Responsable des non-conformités"
    bind:value={assignment}
    onchange={() => (current = 1)}
    ><option value="">Tous les responsables</option><option value="mine">Mes dossiers</option
    ><option value="unassigned">Sans responsable</option></Select
  >
  <label class="flex items-center gap-2 text-sm"
    ><input type="checkbox" bind:checked={overdue} onchange={() => (current = 1)} />Échéance
    dépassée (jour UTC)</label
  >
</div>
{#if error}<p role="alert" class="text-danger">{error}</p>
  <Button
    variant="secondary"
    onclick={() => {
      refresh++;
    }}>Réessayer</Button
  >{/if}
{#if loading}<p class="p-6 text-ink-muted">
    Chargement des actions…
  </p>{:else if !rows.length}<EmptyState
    title="Aucune non-conformité dans cette vue"
    message="Les écarts apparaissent ici après la clôture d’un contrôle échoué."
  />{:else}<div class="overflow-x-auto rounded-lg border border-edge">
    <table class="w-full text-left text-sm">
      <thead class="bg-surface-muted text-xs text-ink-muted"
        ><tr
          ><th class="p-3">Dossier</th><th class="p-3">État</th><th class="p-3"
            >Responsable / échéance</th
          ><th class="p-3">Analyse</th></tr
        ></thead
      ><tbody
        >{#each rows as r (r.id)}<tr class="border-t border-edge hover:bg-surface-muted"
            ><td class="p-3"
              ><a
                class="font-medium text-accent hover:underline"
                href={`/quality/nonconformities/${r.id}`}>{r.number} · {r.title}</a
              ></td
            ><td class="p-3">{QUALITY_NC_LABELS[r.status]}</td><td class="p-3"
              ><p>
                {r.assignee ? `${r.assignee.firstName} ${r.assignee.lastName}` : 'Non affecté'}
              </p>
              <p class="text-xs text-ink-muted">{r.dueDate?.slice(0, 10) || 'Sans échéance'}</p></td
            ><td class="p-3"
              >{r.rootCause && r.correctiveAction
                ? 'Cause et action documentées'
                : 'À compléter'}</td
            ></tr
          >{/each}</tbody
      >
    </table>
  </div>{/if}
<div class="mt-4 flex items-center gap-3">
  <Button
    variant="secondary"
    disabled={loading || current === 1}
    onclick={() => {
      current--;
    }}>Précédent</Button
  ><span class="text-sm text-ink-muted">{total} dossiers · page {current}</span><Button
    variant="secondary"
    disabled={loading || current * 20 >= total}
    onclick={() => {
      current++;
    }}>Suivant</Button
  >
</div>
