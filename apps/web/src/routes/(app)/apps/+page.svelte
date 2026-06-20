<script lang="ts">
  import { onDestroy } from 'svelte';
  import { auth } from '$lib/stores/auth';
  import { visibleDomains } from '$lib/modules/navigation';
  import { deskSearch } from '$lib/stores/desk';
  import { getPreferences, putDeskLayout } from '$lib/api/preferences';
  import { defaultDeskLayout, reconcileDeskLayout, deskBackgroundIsDark } from '@pulsar/shared';
  import type { DeskLayout } from '@pulsar/shared';
  import { toast } from '$lib/stores/toast';
  import DeskCanvas from '$lib/components/desk/DeskCanvas.svelte';

  // Build visible domains from auth caps — mirrors +layout.svelte exactly.
  const domains = $derived(
    visibleDomains({
      enabledModules: ($auth?.tenant.enabledModules ?? []) as string[],
      can: (p) => (($auth?.user.permissions ?? []) as string[]).includes(p),
    }),
  );

  let layout = $state<DeskLayout>(defaultDeskLayout([]));
  let loaded = $state(false);
  let fetchedOnce = $state(false);
  const bgIsDark = $derived(deskBackgroundIsDark(layout.background));

  // Fetch preferences once; reconcile against current domains.
  $effect(() => {
    if (fetchedOnce) return;
    fetchedOnce = true;
    const snap = domains;
    void (async () => {
      try {
        layout = reconcileDeskLayout((await getPreferences()).deskLayout, snap);
      } catch {
        layout = defaultDeskLayout(snap);
      } finally {
        loaded = true;
        lastDomainSig = snap.map((d) => d.key).sort().join('|');
      }
    })();
  });

  // When the set of visible modules changes, reconcile from the CURRENT layout so
  // live positions/folders/background are preserved.
  let lastDomainSig = $state('');
  $effect(() => {
    if (!loaded) return;
    const sig = domains.map((d) => d.key).sort().join('|');
    if (sig === lastDomainSig) return;
    lastDomainSig = sig;
    layout = reconcileDeskLayout(layout, domains);
  });

  // The desk is a read-only launcher; the only thing it persists is a reconcile
  // that added/removed a module tile (so the saved layout stays in sync).
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  function persist() {
    if (!loaded) return;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      void putDeskLayout(layout).catch(() => toast.error('Échec de la sauvegarde du bureau'));
    }, 500);
  }
  onDestroy(() => {
    if (saveTimer) { clearTimeout(saveTimer); void putDeskLayout(layout).catch(() => {}); }
  });
</script>

<svelte:head><title>Pulsar Desk</title></svelte:head>

{#snippet deskHeader()}
  <div class="px-4 pt-14 pb-2 text-center sm:px-8 lg:px-12">
    <p class={`text-xs font-semibold tracking-[0.26em] uppercase ${bgIsDark ? 'text-white/70 [text-shadow:0_1px_3px_rgba(0,0,0,0.55)]' : 'text-ink-faint'}`}>Pulsar Desk</p>
    <h1 class={`mt-2 text-xl font-semibold tracking-tight ${bgIsDark ? 'text-white [text-shadow:0_1px_3px_rgba(0,0,0,0.55)]' : 'text-ink'}`}>Toutes les pages</h1>
  </div>
{/snippet}

{#if !loaded}
  <div class="flex min-h-[calc(100vh-3.5rem)] items-center justify-center">
    <span class="text-sm text-ink-faint">Chargement…</span>
  </div>
{:else}
  <DeskCanvas
    bind:layout
    {domains}
    editing={false}
    search={$deskSearch}
    minHeight="calc(100vh - 3.5rem)"
    header={deskHeader}
    onchange={persist}
  />
{/if}
