<script lang="ts">
  import { PageHeader, Card } from '$lib/components/ui';
  import { appearance, setTheme, setAccent } from '$lib/stores/appearance';
  import { APPEARANCE_THEMES, type AppearanceTheme } from '@pulsar/shared';

  const THEME_META: Record<AppearanceTheme, { label: string; hint: string; bg: string; surface: string; accent: string; ink: string }> = {
    warm: { label: 'Chaud', hint: 'Orange & crème (défaut)', bg: '#faf6f0', surface: '#ffffff', accent: '#f1700f', ink: '#221913' },
    cool: { label: 'Ardoise', hint: 'Bleu & gris froid', bg: '#f1f5f9', surface: '#ffffff', accent: '#2150d4', ink: '#0f172a' },
    dark: { label: 'Nuit', hint: 'Sombre chaud', bg: '#17130f', surface: '#211b16', accent: '#f1700f', ink: '#f4ede4' },
  };

  const PRESET_ACCENTS = ['#f1700f', '#2150d4', '#0f766e', '#be123c', '#7e22ce', '#0ea5e9'];

  let accentInput = $state($appearance.accent ?? '#f1700f');
</script>

<PageHeader title="Apparence" />

<Card>
  <h2 class="text-sm font-bold text-ink">Thème</h2>
  <p class="mt-0.5 mb-4 text-sm text-ink-muted">Change l'apparence de toute l'interface. Enregistré sur ton compte.</p>

  <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
    {#each APPEARANCE_THEMES as id (id)}
      {@const active = ($appearance.theme ?? 'warm') === id}
      {@const s = THEME_META[id]}
      <button type="button" onclick={() => setTheme(id)} aria-pressed={active}
        class={`rounded-card border p-3 text-left transition hover:-translate-y-0.5 hover:shadow-card ${active ? 'border-accent ring-2 ring-accent/40' : 'border-edge-soft shadow-sm'}`}>
        <div class="flex h-16 overflow-hidden rounded-inner border border-edge-soft" style={`background:${s.bg}`}>
          <div class="w-1/4" style={`background:${s.accent}`}></div>
          <div class="flex-1 p-2">
            <div class="h-2 w-2/3 rounded-full" style={`background:${s.ink};opacity:.85`}></div>
            <div class="mt-1.5 h-5 rounded" style={`background:${s.surface};border:1px solid rgba(0,0,0,.06)`}></div>
          </div>
        </div>
        <div class="mt-2.5 flex items-center justify-between">
          <span class="text-sm font-semibold text-ink">{s.label}</span>
          {#if active}<span class="text-xs font-semibold text-accent">Actif</span>{/if}
        </div>
        <div class="text-xs text-ink-muted">{s.hint}</div>
      </button>
    {/each}
  </div>
</Card>

<div class="mt-4">
  <Card>
    <h2 class="text-sm font-bold text-ink">Couleur d'accent</h2>
    <p class="mt-0.5 mb-4 text-sm text-ink-muted">Personnalise la couleur principale, appliquée par-dessus le thème.</p>

    <div class="flex flex-wrap items-center gap-3">
      {#each PRESET_ACCENTS as c (c)}
        <button type="button" aria-label={`Accent ${c}`} onclick={() => { accentInput = c; setAccent(c); }}
          class={`size-8 rounded-full ring-2 transition ${($appearance.accent ?? '') === c ? 'ring-ink' : 'ring-transparent hover:ring-edge'}`}
          style={`background:${c}`}></button>
      {/each}

      <label class="ml-1 inline-flex items-center gap-2 text-sm text-ink-muted">
        Perso
        <input type="color" bind:value={accentInput} onchange={() => setAccent(accentInput)}
          class="size-8 cursor-pointer rounded border border-edge bg-transparent" />
      </label>

      {#if $appearance.accent}
        <button type="button" onclick={() => setAccent(null)}
          class="rounded-full border border-edge px-3 py-1 text-sm text-ink-faint transition hover:text-ink">
          Réinitialiser
        </button>
      {/if}
    </div>
  </Card>
</div>
