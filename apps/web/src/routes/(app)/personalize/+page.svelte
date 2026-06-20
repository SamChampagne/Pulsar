<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { PageHeader, Card } from '$lib/components/ui';
  import { appearance, setTheme, setAccent } from '$lib/stores/appearance';
  import {
    APPEARANCE_THEMES,
    type AppearanceTheme,
    DESK_GRADIENTS,
    DESK_MODES,
    type DeskBackground,
    type DeskLayout,
    type DeskMode,
    type DeskTileSize,
    reconcileDeskLayout,
    defaultDeskLayout,
  } from '@pulsar/shared';
  import { getPreferences, putDeskLayout } from '$lib/api/preferences';
  import { uploadDocument } from '$lib/api/files';
  import { auth } from '$lib/stores/auth';
  import { visibleDomains } from '$lib/modules/navigation';
  import { toast } from '$lib/stores/toast';
  import DeskCanvas from '$lib/components/desk/DeskCanvas.svelte';

  const THEME_META: Record<AppearanceTheme, { label: string; hint: string; bg: string; surface: string; accent: string; ink: string }> = {
    warm: { label: 'Chaud', hint: 'Orange & crème (défaut)', bg: '#faf6f0', surface: '#ffffff', accent: '#f1700f', ink: '#221913' },
    cool: { label: 'Ardoise', hint: 'Bleu & gris froid', bg: '#f1f5f9', surface: '#ffffff', accent: '#2150d4', ink: '#0f172a' },
    dark: { label: 'Nuit', hint: 'Sombre chaud', bg: '#17130f', surface: '#211b16', accent: '#f1700f', ink: '#f4ede4' },
  };

  const PRESET_ACCENTS = ['#f1700f', '#2150d4', '#0f766e', '#be123c', '#7e22ce', '#0ea5e9'];
  const BG_COLORS = ['#f8f8f7', '#0f172a', '#1e293b', '#fdf2e9', '#ecfeff', '#241c15'];
  const TILE_LABEL: Record<DeskTileSize, string> = { sm: 'Petites', md: 'Moyennes', lg: 'Grandes' };
  const MODE_LABEL: Record<DeskMode, string> = { auto: 'Grille auto', free: 'Libre', reorder: 'Réordonnable' };

  let accentInput = $state($appearance.accent ?? '#f1700f');
  let uploading = $state(false);

  const domains = $derived(
    visibleDomains({
      enabledModules: ($auth?.tenant.enabledModules ?? []) as string[],
      can: (p) => (($auth?.user.permissions ?? []) as string[]).includes(p),
    }),
  );

  // Full reconciled layout — drives the live preview and is what we persist.
  let desk = $state<DeskLayout>(defaultDeskLayout([]));
  let loaded = $state(false);

  onMount(() => {
    void getPreferences()
      .then((p) => {
        desk = reconcileDeskLayout(p.deskLayout, domains);
      })
      .catch(() => {
        desk = defaultDeskLayout(domains);
      })
      .finally(() => (loaded = true));
  });

  // Debounced persist — used both by the control panel and by direct edits
  // (drag / remove / add) coming from the interactive desk canvas.
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  function persistDesk() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      void putDeskLayout(desk).catch(() => toast.error('Échec de la sauvegarde'));
    }, 400);
  }
  onDestroy(() => {
    if (saveTimer) { clearTimeout(saveTimer); void putDeskLayout(desk).catch(() => {}); }
  });

  function save(next: DeskLayout) {
    desk = next;
    persistDesk();
  }

  function setBackground(bg: DeskBackground | null) {
    const next = { ...desk } as DeskLayout;
    if (bg) next.background = bg;
    else delete next.background;
    save(next);
  }

  function setTileSize(size: DeskTileSize) {
    save({ ...desk, tileSize: size });
  }

  function setMode(mode: DeskMode) {
    save({ ...desk, mode });
  }

  async function onWallpaperChange(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast.error('Choisis une image');
      return;
    }
    uploading = true;
    try {
      const doc = await uploadDocument(file, 'desk-wallpaper', $auth?.user.id ?? 'self');
      setBackground({ type: 'image', value: doc.id });
    } catch {
      toast.error("Échec de l'upload");
    } finally {
      uploading = false;
      input.value = '';
    }
  }

  function resetLayout() {
    if (!confirm('Réinitialiser entièrement la disposition du bureau ?')) return;
    save(defaultDeskLayout(domains));
  }
</script>

<svelte:head><title>Personnaliser — Pulsar</title></svelte:head>

<PageHeader
  title="Personnaliser le bureau"
  subtitle="Thème, couleur, fond et tuiles — déplacez, supprimez et restaurez vos tuiles directement dans l'aperçu."
/>

<div class="grid gap-4 lg:grid-cols-[minmax(320px,380px)_minmax(0,1fr)]">
  <!-- Controls -->
  <div class="flex flex-col gap-4">
    <Card>
      <h2 class="text-sm font-bold text-ink">Thème</h2>
      <p class="mt-0.5 mb-4 text-sm text-ink-muted">Change l'apparence de toute l'interface. Enregistré sur votre compte.</p>
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

    <Card>
      <h2 class="text-sm font-bold text-ink">Couleur d'accent</h2>
      <p class="mt-0.5 mb-4 text-sm text-ink-muted">La couleur principale, appliquée par-dessus le thème.</p>
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

    <Card>
      <h2 class="text-sm font-bold text-ink">Fond du bureau</h2>
      <p class="mt-0.5 mb-4 text-sm text-ink-muted">Couleur, dégradé ou image.</p>
      <div class="space-y-4">
        <div>
          <p class="mb-2 text-xs font-semibold tracking-wide text-ink-faint uppercase">Couleur</p>
          <div class="flex flex-wrap items-center gap-2">
            {#each BG_COLORS as c (c)}
              {@const active = desk.background?.type === 'color' && desk.background.value === c}
              <button type="button" aria-label={`Fond ${c}`} onclick={() => setBackground({ type: 'color', value: c })}
                class={`size-8 rounded-lg ring-1 transition hover:ring-ink ${active ? 'ring-2 ring-ink' : 'ring-edge'}`} style={`background:${c}`}></button>
            {/each}
          </div>
        </div>
        <div>
          <p class="mb-2 text-xs font-semibold tracking-wide text-ink-faint uppercase">Dégradé</p>
          <div class="flex flex-wrap items-center gap-2">
            {#each DESK_GRADIENTS as g (g.id)}
              {@const active = desk.background?.type === 'gradient' && desk.background.value === g.id}
              <button type="button" aria-label={g.label} onclick={() => setBackground({ type: 'gradient', value: g.id })}
                class={`h-8 w-14 rounded-lg ring-1 transition hover:ring-ink ${active ? 'ring-2 ring-ink' : 'ring-edge'}`} style={`background:${g.css}`}></button>
            {/each}
          </div>
        </div>
        <div>
          <p class="mb-2 text-xs font-semibold tracking-wide text-ink-faint uppercase">Image</p>
          <label class="inline-flex cursor-pointer items-center gap-2 rounded-full border border-edge px-3 py-1 text-sm text-ink-faint transition hover:text-ink">
            {uploading ? 'Téléversement…' : 'Téléverser une image'}
            <input type="file" accept="image/*" class="hidden" onchange={onWallpaperChange} disabled={uploading} />
          </label>
        </div>
        <button type="button" onclick={() => setBackground(null)}
          class="rounded-full border border-edge px-3 py-1 text-sm text-ink-faint transition hover:text-ink">
          Réinitialiser le fond
        </button>
      </div>
    </Card>

    <Card>
      <h2 class="text-sm font-bold text-ink">Tuiles & disposition</h2>
      <p class="mt-0.5 mb-4 text-sm text-ink-muted">Taille des icônes et mode d'agencement du bureau.</p>
      <div class="space-y-4">
        <div>
          <p class="mb-2 text-xs font-semibold tracking-wide text-ink-faint uppercase">Taille des tuiles</p>
          <div class="inline-flex items-center gap-1 rounded-md border border-edge bg-surface p-0.5">
            {#each (['sm','md','lg'] as DeskTileSize[]) as sz (sz)}
              <button type="button"
                class={`rounded px-3 py-1 text-sm font-medium transition-colors ${(desk.tileSize ?? 'md') === sz ? 'bg-accent text-white' : 'text-ink-muted hover:text-ink'}`}
                onclick={() => setTileSize(sz)}>{TILE_LABEL[sz]}</button>
            {/each}
          </div>
        </div>
        <div>
          <p class="mb-2 text-xs font-semibold tracking-wide text-ink-faint uppercase">Disposition</p>
          <div class="inline-flex items-center gap-1 rounded-md border border-edge bg-surface p-0.5">
            {#each DESK_MODES as m (m)}
              <button type="button"
                class={`rounded px-3 py-1 text-sm font-medium transition-colors ${desk.mode === m ? 'bg-accent text-white' : 'text-ink-muted hover:text-ink'}`}
                onclick={() => setMode(m)}>{MODE_LABEL[m]}</button>
            {/each}
          </div>
          <p class="mt-2 text-xs text-ink-faint">Choisissez « Libre » ou « Réordonnable » pour glisser les tuiles dans l'aperçu.</p>
        </div>
        <button type="button" onclick={resetLayout}
          class="rounded-full border border-edge px-3 py-1 text-sm text-ink-faint transition hover:border-red-400 hover:text-red-600">
          Réinitialiser la disposition
        </button>
      </div>
    </Card>
  </div>

  <!-- Interactive desk editor -->
  <div>
    <Card>
      <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 class="text-sm font-bold text-ink">Aperçu du bureau</h2>
        <span class="text-xs text-ink-faint">Glissez pour déplacer · × pour retirer · « Ajouter » pour restaurer</span>
      </div>
      {#if loaded}
        <DeskCanvas bind:layout={desk} {domains} editing={true} framed minHeight="480px" onchange={persistDesk} />
      {:else}
        <div class="aspect-[16/10] w-full animate-pulse rounded-card bg-surface-muted"></div>
      {/if}
      <p class="mt-3 text-xs text-ink-muted">
        Le thème et l'accent s'appliquent à toute l'interface ; le fond et les tuiles concernent le bureau.
        Pour glisser les tuiles, choisissez la disposition « Libre » ou « Réordonnable ».
      </p>
    </Card>
  </div>
</div>
