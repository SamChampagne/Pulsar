<script lang="ts">
  import { Modal, Input } from '$lib/components/ui';
  import type { NavDomain } from '$lib/modules/navigation';

  /** What the picker can add back to the desk. */
  export type DeskAddPick =
    | { kind: 'module'; moduleKey: string; label: string }
    | { kind: 'link'; href: string; label: string };

  let {
    open = $bindable(false),
    domains = [] as NavDomain[],
    presentModuleKeys = [] as string[],
    presentLinkHrefs = [] as string[],
    onpick,
  } = $props<{
    open?: boolean;
    domains?: NavDomain[];
    presentModuleKeys?: string[];
    presentLinkHrefs?: string[];
    onpick: (pick: DeskAddPick) => void;
  }>();

  let q = $state('');

  // Modules currently removed from the desk → offered for restore.
  const modules = $derived(
    domains
      .filter((d: NavDomain) => d.key !== 'dashboard' && !presentModuleKeys.includes(d.key))
      .map((d: NavDomain) => ({ moduleKey: d.key, label: d.label })),
  );

  interface FlatLink {
    href: string;
    label: string;
    domainLabel: string;
  }

  // All nav links, de-duplicated by href (the same page can live in several
  // domains, e.g. "Clés API" under both Connect and Réglages — leaving duplicate
  // keys would crash the keyed #each).
  const links = $derived.by<FlatLink[]>(() => {
    const seen = new Set<string>(presentLinkHrefs);
    const out: FlatLink[] = [];
    for (const d of domains as NavDomain[]) {
      for (const s of d.sections) {
        for (const l of s.links) {
          if (seen.has(l.href)) continue;
          seen.add(l.href);
          out.push({ href: l.href, label: l.label, domainLabel: d.label });
        }
      }
    }
    return out;
  });

  const term = $derived(q.trim().toLowerCase());
  const filteredModules = $derived(
    term === ''
      ? modules
      : modules.filter((m: { label: string }) => m.label.toLowerCase().includes(term)),
  );
  const filteredLinks = $derived(
    term === ''
      ? links
      : links.filter((f) => `${f.domainLabel} ${f.label} ${f.href}`.toLowerCase().includes(term)),
  );

  function pickModule(m: { moduleKey: string; label: string }) {
    onpick({ kind: 'module', moduleKey: m.moduleKey, label: m.label });
    open = false;
    q = '';
  }

  function pickLink(f: FlatLink) {
    onpick({ kind: 'link', href: f.href, label: f.label });
    open = false;
    q = '';
  }
</script>

<Modal bind:open title="Ajouter au bureau" size="md">
  <div class="space-y-3">
    <Input bind:value={q} placeholder="Rechercher une app ou une page…" />
    <div class="max-h-[55vh] space-y-4 overflow-y-auto">
      {#if filteredModules.length > 0}
        <div>
          <div class="px-1 pb-1 text-[10px] font-semibold tracking-[0.18em] text-ink-faint uppercase">
            Applications
          </div>
          <div class="space-y-1">
            {#each filteredModules as m (m.moduleKey)}
              <button
                type="button"
                class="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm hover:bg-surface-muted"
                onclick={() => pickModule(m)}
              >
                <span class="font-medium text-ink">{m.label}</span>
                <span class="text-xs text-ink-faint">Restaurer l'app</span>
              </button>
            {/each}
          </div>
        </div>
      {/if}

      <div>
        <div class="px-1 pb-1 text-[10px] font-semibold tracking-[0.18em] text-ink-faint uppercase">
          Pages
        </div>
        <div class="space-y-1">
          {#each filteredLinks as f (f.href)}
            <button
              type="button"
              class="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm hover:bg-surface-muted"
              onclick={() => pickLink(f)}
            >
              <span class="font-medium text-ink">{f.label}</span>
              <span class="text-xs text-ink-faint">{f.domainLabel}</span>
            </button>
          {:else}
            <p class="px-3 py-4 text-center text-sm text-ink-faint">Aucune page.</p>
          {/each}
        </div>
      </div>
    </div>
  </div>
</Modal>
