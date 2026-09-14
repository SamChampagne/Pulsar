<script lang="ts">
  import { api } from '$lib/api/client';
  import { auth } from '$lib/stores/auth';
  import { ErrorNotice, Skeleton } from '$lib/components/ui';
  import {
    MODULE_KEYS,
    PERMISSIONS,
    yardStatusLabel,
    type YardDossierKind,
    type YardRelatedDossiers,
  } from '@pulsar/shared';
  let { kind, targetId }: { kind: YardDossierKind; targetId: string } = $props();
  let result = $state<YardRelatedDossiers | null>(null),
    loading = $state(false),
    error = $state(''),
    generation = 0;
  const enabled = $derived(
    !!$auth?.tenant.enabledModules.includes(MODULE_KEYS.YARD) &&
      !!$auth?.user.permissions.includes(PERMISSIONS.YARD.READ),
  );
  async function load() {
    const request = ++generation;
    loading = true;
    result = null;
    error = '';
    try {
      const data = await api<YardRelatedDossiers>(
        `/yard/dossiers/related/${kind}/${encodeURIComponent(targetId)}`,
      );
      if (request === generation) result = data;
    } catch (e) {
      if (request === generation)
        error = e instanceof Error ? e.message : 'Contexte cour indisponible.';
    } finally {
      if (request === generation) loading = false;
    }
  }
  $effect(() => {
    targetId;
    kind;
    if (enabled && targetId) void load();
    return () => {
      generation++;
    };
  });
</script>

{#if enabled}<section class="mt-4 border-t border-edge pt-4" aria-label="Passages en cour liés">
    <h3 class="mb-3 text-sm font-semibold">Passages en cour</h3>
    {#if loading}<Skeleton rows={2} />{:else if error}<ErrorNotice
        message={error}
        onretry={load}
      />{:else if result}
      {#each result.items as item (item.id)}<a
          href={item.href}
          class="mb-2 block rounded-md border border-edge p-3 transition-colors hover:bg-surface-muted"
          ><span class="text-sm font-medium text-accent">{item.number} ↗</span><span
            class="mt-1 block text-xs text-ink-muted"
            >{item.site} · {yardStatusLabel(item.status)}</span
          ></a
        >{:else}<p class="text-xs text-ink-muted">
          Aucun rendez-vous ou visite explicitement lié.
        </p>{/each}
      {#if result.truncated}<p class="text-xs text-warn">100 associations affichées.</p>{/if}
    {/if}
  </section>{/if}
