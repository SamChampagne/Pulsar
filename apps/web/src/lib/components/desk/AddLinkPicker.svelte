<script lang="ts">
  import { Modal, Input } from '$lib/components/ui';
  import type { NavDomain } from '$lib/modules/navigation';

  let {
    open = $bindable(false),
    domains = [] as NavDomain[],
    onpick,
  } = $props<{ open?: boolean; domains?: NavDomain[]; onpick: (l: { href: string; label: string }) => void }>();

  let q = $state('');

  interface Flat { href: string; label: string; domainLabel: string }

  const all = $derived<Flat[]>(
    domains.flatMap((d: NavDomain) =>
      d.sections.flatMap((s) =>
        s.links.map((l) => ({ href: l.href, label: l.label, domainLabel: d.label })),
      ),
    ),
  );

  const filtered = $derived(
    q.trim() === ''
      ? all
      : all.filter((f) =>
          `${f.domainLabel} ${f.label} ${f.href}`.toLowerCase().includes(q.toLowerCase()),
        ),
  );

  function choose(f: Flat) {
    onpick({ href: f.href, label: f.label });
    open = false;
    q = '';
  }
</script>

<Modal bind:open title="Ajouter un lien rapide" size="md">
  <div class="space-y-3">
    <Input bind:value={q} placeholder="Rechercher une page…" />
    <div class="max-h-[50vh] space-y-1 overflow-y-auto">
      {#each filtered as f (f.href + f.label)}
        <button
          type="button"
          class="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm hover:bg-surface-muted"
          onclick={() => choose(f)}
        >
          <span class="font-medium text-ink">{f.label}</span>
          <span class="text-xs text-ink-faint">{f.domainLabel}</span>
        </button>
      {:else}
        <p class="px-3 py-4 text-center text-sm text-ink-faint">Aucune page.</p>
      {/each}
    </div>
  </div>
</Modal>
