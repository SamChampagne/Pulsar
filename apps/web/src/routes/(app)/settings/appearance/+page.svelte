<script lang="ts">
  import { PageHeader, Card } from '$lib/components/ui';
  import { theme, setTheme, THEMES, type Theme } from '$lib/stores/theme';

  // Swatch colors per theme (purely illustrative for the picker).
  const swatches: Record<Theme, { bg: string; surface: string; accent: string; ink: string }> = {
    warm: { bg: '#faf6f0', surface: '#ffffff', accent: '#f1700f', ink: '#221913' },
    cool: { bg: '#f1f5f9', surface: '#ffffff', accent: '#2150d4', ink: '#0f172a' },
    dark: { bg: '#17130f', surface: '#211b16', accent: '#f1700f', ink: '#f4ede4' },
  };
</script>

<PageHeader title="Apparence" />

<Card>
  <h2 class="text-sm font-bold text-ink">Thème</h2>
  <p class="mt-0.5 mb-4 text-sm text-ink-muted">
    Change l’apparence de toute l’interface. Le choix est enregistré sur cet appareil.
  </p>

  <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
    {#each THEMES as t (t.id)}
      {@const active = $theme === t.id}
      {@const s = swatches[t.id]}
      <button
        type="button"
        onclick={() => setTheme(t.id)}
        class={`rounded-card border p-3 text-left transition hover:-translate-y-0.5 hover:shadow-card ${active ? 'border-accent ring-2 ring-accent/40' : 'border-edge-soft shadow-sm'}`}
        aria-pressed={active}
      >
        <!-- mini preview -->
        <div class="flex h-16 overflow-hidden rounded-inner border border-edge-soft" style={`background:${s.bg}`}>
          <div class="w-1/4" style={`background:${s.accent}`}></div>
          <div class="flex-1 p-2">
            <div class="h-2 w-2/3 rounded-full" style={`background:${s.ink};opacity:.85`}></div>
            <div class="mt-1.5 h-5 rounded" style={`background:${s.surface};border:1px solid rgba(0,0,0,.06)`}></div>
          </div>
        </div>
        <div class="mt-2.5 flex items-center justify-between">
          <span class="text-sm font-semibold text-ink">{t.label}</span>
          {#if active}<span class="text-xs font-semibold text-accent">Actif</span>{/if}
        </div>
        <div class="text-xs text-ink-muted">{t.hint}</div>
      </button>
    {/each}
  </div>
</Card>
