<script lang="ts">
  import { PERMISSIONS } from '@pulsar/shared';
  import { auth } from '$lib/stores/auth';
  import { density, toggleDensity } from '$lib/stores/density';
  let { onsearch }: { onsearch: () => void } = $props();
</script>

<nav
  aria-label="Outils de travail"
  class="mb-4 flex flex-wrap items-center gap-2 border-b border-edge pb-3 text-xs text-ink-muted"
>
  {#if $auth?.user.permissions.includes(PERMISSIONS.CORE.OPERATING_TASKS_READ)}<a
      class="rounded px-2 py-1.5 hover:bg-surface-muted hover:text-ink"
      href="/workbench">Ma file de travail</a
    >{/if}
  {#if $auth?.tenant.enabledModules.includes('analytics') && $auth.user.permissions.includes(PERMISSIONS.ANALYTICS.READ)}<a
      class="rounded px-2 py-1.5 hover:bg-surface-muted hover:text-ink"
      href="/workflows">Dossiers connectés</a
    >{/if}
  <div class="ml-auto flex items-center gap-2">
    <button
      class="rounded border border-edge bg-surface px-2 py-1.5 hover:text-ink"
      onclick={toggleDensity}
      aria-pressed={$density === 'compact'}
      >Tables : {$density === 'compact' ? 'compactes' : 'confortables'}</button
    ><button
      class="rounded border border-edge bg-surface px-2 py-1.5 hover:text-ink"
      onclick={onsearch}>Aller à… <kbd class="ml-1 font-mono">Ctrl K</kbd></button
    >
  </div>
</nav>
