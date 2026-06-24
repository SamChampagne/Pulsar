<script lang="ts">
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { api, ApiError } from '$lib/api/client';
  import { toast } from '$lib/stores/toast';
  import { formatDate } from '$lib/format';
  import {
    LANDING_BLOCK_TYPES,
    LANDING_FORM_FIELDS,
    type LandingBlockType,
  } from '@pulsar/shared';
  import {
    Button,
    Badge,
    Card,
    Skeleton,
    ErrorNotice,
    type Tone,
  } from '$lib/components/ui';
  import LandingPageRender from '$lib/components/sites/LandingPageRender.svelte';

  // ── Types ────────────────────────────────────────────────────────────────────

  interface LandingBlock {
    type: LandingBlockType;
    text?: string;
    url?: string;
    fields?: string[];
  }

  interface SitePage {
    id: string;
    title: string;
    slug: string;
    status: string;
    content: LandingBlock[];
    captureListId: string | null;
    _count: { submissions: number };
    updatedAt: string;
  }

  interface CrmList {
    id: string;
    name: string;
  }

  interface Submission {
    id: string;
    data: Record<string, unknown>;
    contactId: string | null;
    createdAt: string;
  }

  // ── State ────────────────────────────────────────────────────────────────────

  let sitePage = $state<SitePage | null>(null);
  let loading = $state(true);
  let notFound = $state(false);
  let error = $state('');

  // Page fields form state
  let editTitle = $state('');
  let editSlug = $state('');
  let editCaptureListId = $state('');
  let savingFields = $state(false);
  let fieldsError = $state('');

  // Block editor state
  let blocks = $state<LandingBlock[]>([]);
  let blocksError = $state('');
  let addBlockType = $state<LandingBlockType>('heading');
  let showAddBlock = $state(false);

  // Autosave state
  type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';
  let saveState = $state<SaveState>('idle');
  let lastSavedAt = $state<Date | null>(null);
  let saveTimer: ReturnType<typeof setTimeout> | null = null;

  // Skip-first-run guard: prevent autosave on initial hydration
  let initialBlocksLoaded = false;

  // Publish state
  let publishing = $state(false);

  // CRM lists
  let crmLists = $state<CrmList[]>([]);
  let crmListsLoaded = $state(false);

  // Submissions
  let submissions = $state<Submission[]>([]);
  let submissionsLoading = $state(false);
  let submissionsError = $state('');

  // ── Data loading ─────────────────────────────────────────────────────────────

  async function loadPage() {
    loading = true;
    error = '';
    notFound = false;
    try {
      sitePage = await api<SitePage>(`/sites/pages/${page.params.id}`);
      syncFormState();
    } catch (e) {
      if (e instanceof ApiError && e.statusCode === 404) {
        notFound = true;
      } else {
        error = e instanceof ApiError ? e.message : 'Impossible de charger la page';
      }
    } finally {
      loading = false;
    }
  }

  function syncFormState() {
    if (!sitePage) return;
    editTitle = sitePage.title;
    editSlug = sitePage.slug;
    editCaptureListId = sitePage.captureListId ?? '';
    // Cancel any pending autosave and treat the upcoming blocks assignment as
    // a fresh hydration (not a user edit) so it does NOT trigger an autosave.
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    saveState = 'idle';
    initialBlocksLoaded = false;
    // Deep clone so block editor is independent from the loaded data
    blocks = sitePage.content.map((b) => ({ ...b, fields: b.fields ? [...b.fields] : undefined }));
  }

  async function loadCrmLists() {
    if (crmListsLoaded) return;
    try {
      const result = await api<{ items: CrmList[] }>('/crm/lists', {
        query: { pageSize: 100 },
      });
      crmLists = result.items;
    } catch {
      // Non-blocking: CRM module may not be active
    } finally {
      crmListsLoaded = true;
    }
  }

  async function loadSubmissions() {
    if (!sitePage) return;
    submissionsLoading = true;
    submissionsError = '';
    try {
      const result = await api<{ items: Submission[] }>(`/sites/pages/${sitePage.id}/submissions`, {
        query: { pageSize: 50 },
      });
      submissions = result.items;
    } catch (e) {
      submissionsError = e instanceof ApiError ? e.message : 'Impossible de charger les soumissions';
    } finally {
      submissionsLoading = false;
    }
  }

  async function reload() {
    if (!sitePage) return;
    try {
      sitePage = await api<SitePage>(`/sites/pages/${sitePage.id}`);
      syncFormState();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Erreur lors du rechargement');
    }
  }

  // ── Page fields mutations ────────────────────────────────────────────────────

  async function saveFields() {
    if (!sitePage) return;
    savingFields = true;
    fieldsError = '';
    try {
      await api(`/sites/pages/${sitePage.id}`, {
        method: 'PATCH',
        body: {
          title: editTitle.trim() || undefined,
          slug: editSlug.trim() || undefined,
          captureListId: editCaptureListId.trim() || null,
        },
      });
      toast.success('Informations sauvegardées');
      await reload();
    } catch (e) {
      fieldsError = e instanceof ApiError ? e.message : 'Erreur lors de la sauvegarde';
    } finally {
      savingFields = false;
    }
  }

  // ── Block editor mutations ───────────────────────────────────────────────────

  function addBlock() {
    const newBlock: LandingBlock = { type: addBlockType };
    if (addBlockType === 'form') newBlock.fields = ['name', 'email'];
    blocks = [...blocks, newBlock];
    showAddBlock = false;
  }

  function removeBlock(index: number) {
    blocks = blocks.filter((_, i) => i !== index);
  }

  function moveBlockUp(index: number) {
    if (index === 0) return;
    const arr = [...blocks];
    [arr[index - 1], arr[index]] = [arr[index], arr[index - 1]];
    blocks = arr;
  }

  function moveBlockDown(index: number) {
    if (index === blocks.length - 1) return;
    const arr = [...blocks];
    [arr[index], arr[index + 1]] = [arr[index + 1], arr[index]];
    blocks = arr;
  }

  function updateBlockText(index: number, value: string) {
    blocks = blocks.map((b, i) => (i === index ? { ...b, text: value } : b));
  }

  function updateBlockUrl(index: number, value: string) {
    blocks = blocks.map((b, i) => (i === index ? { ...b, url: value } : b));
  }

  function toggleFormField(index: number, field: string) {
    blocks = blocks.map((b, i) => {
      if (i !== index) return b;
      const current = b.fields ?? [];
      const next = current.includes(field)
        ? current.filter((f) => f !== field)
        : [...current, field];
      return { ...b, fields: next };
    });
  }

  // ── Autosave (blocks only) ───────────────────────────────────────────────────

  async function persistBlocks() {
    if (!sitePage) return;
    // Clear any pending debounce timer
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    saveState = 'saving';
    blocksError = '';
    try {
      await api(`/sites/pages/${sitePage.id}`, {
        method: 'PATCH',
        body: { content: blocks },
      });
      // Do NOT reload() — keep local blocks as source of truth (preserves edit/focus).
      // Keep in-memory sitePage.content in sync so publish-guard/counts stay correct:
      if (sitePage) sitePage = { ...sitePage, content: blocks };
      saveState = 'saved';
      lastSavedAt = new Date();
    } catch (e) {
      saveState = 'error';
      blocksError = e instanceof ApiError ? e.message : 'Échec de la sauvegarde automatique';
    }
  }

  function scheduleSave() {
    saveState = 'dirty';
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      void persistBlocks();
    }, 800);
  }

  // Autosave effect: react to blocks changes after the first (hydration) run.
  // The skip-first-run pattern uses a plain mutable flag (not $state) so flipping
  // it inside the effect does NOT schedule a re-run. On the very first execution
  // (triggered by the initial blocks = [...] assignment in syncFormState), the flag
  // is still false → we flip it and return without scheduling a save. Every
  // subsequent run (user edits) proceeds to scheduleSave().
  $effect(() => {
    void blocks; // touch blocks so Svelte tracks it as a dependency
    if (!initialBlocksLoaded) {
      initialBlocksLoaded = true;
      return;
    }
    scheduleSave();
  });

  // ── Publish / Unpublish ──────────────────────────────────────────────────────

  async function publish() {
    if (!sitePage) return;
    publishing = true;
    try {
      await api(`/sites/pages/${sitePage.id}/publish`, { method: 'POST' });
      toast.success('Page publiée');
      await reload();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Erreur lors de la publication');
    } finally {
      publishing = false;
    }
  }

  async function unpublish() {
    if (!sitePage) return;
    publishing = true;
    try {
      await api(`/sites/pages/${sitePage.id}/unpublish`, { method: 'POST' });
      toast.success('Page dépubliée');
      await reload();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Erreur lors de la dépublication');
    } finally {
      publishing = false;
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────────

  function formatRelativeTime(date: Date): string {
    const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
    if (seconds < 5) return "à l'instant";
    if (seconds < 60) return `il y a ${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `il y a ${minutes}min`;
    return formatDate(date.toISOString());
  }

  function statusTone(status: string): Tone {
    if (status === 'PUBLISHED') return 'ok';
    return 'neutral';
  }

  function statusLabel(status: string): string {
    if (status === 'PUBLISHED') return 'Publié';
    return 'Brouillon';
  }

  function blockTypeLabel(type: LandingBlockType): string {
    switch (type) {
      case 'heading': return 'Titre';
      case 'text':    return 'Texte';
      case 'image':   return 'Image';
      case 'form':    return 'Formulaire';
      default:        return type;
    }
  }

  function fieldLabel(field: string): string {
    switch (field) {
      case 'name':    return 'Nom';
      case 'email':   return 'Courriel';
      case 'phone':   return 'Téléphone';
      case 'company': return 'Société';
      case 'message': return 'Message';
      default:        return field;
    }
  }

  function submissionDataSummary(data: Record<string, unknown>): string {
    const parts: string[] = [];
    if (data.name)    parts.push(String(data.name));
    if (data.email)   parts.push(String(data.email));
    if (data.company) parts.push(String(data.company));
    return parts.join(' · ') || JSON.stringify(data);
  }

  // ── Init ─────────────────────────────────────────────────────────────────────

  $effect(() => {
    void loadPage();
  });

  $effect(() => {
    if (sitePage) {
      void loadSubmissions();
      void loadCrmLists();
    }
  });
</script>

{#if loading}
  <div class="mb-4 flex items-center gap-2">
    <Button variant="secondary" onclick={() => goto('/sites')}>← Sites</Button>
  </div>
  <Card padded={false}><Skeleton rows={8} /></Card>
{:else if notFound}
  <div class="mb-4 flex items-center gap-2">
    <Button variant="secondary" onclick={() => goto('/sites')}>← Sites</Button>
  </div>
  <ErrorNotice message="Cette page n'existe pas ou vous n'y avez pas accès." />
{:else if error}
  <div class="mb-4 flex items-center gap-2">
    <Button variant="secondary" onclick={() => goto('/sites')}>← Sites</Button>
  </div>
  <ErrorNotice message={error} onretry={loadPage} />
{:else if sitePage}
  <!-- ── Header ─────────────────────────────────────────────────────────────── -->
  <div class="mb-6 flex items-start justify-between gap-4">
    <div class="min-w-0">
      <div class="mb-1">
        <Button variant="secondary" onclick={() => goto('/sites')}>← Sites</Button>
      </div>
      <h1 class="mt-2 truncate text-2xl font-bold text-ink">{sitePage.title}</h1>
      <div class="mt-1 flex flex-wrap items-center gap-2">
        <Badge tone={statusTone(sitePage.status)}>{statusLabel(sitePage.status)}</Badge>
        <span class="font-mono text-xs text-ink-muted">/p/{sitePage.slug}</span>
        <a
          href="/p/{sitePage.slug}"
          target="_blank"
          rel="noopener noreferrer"
          class="text-xs text-accent hover:underline"
        >
          Voir la page ↗
        </a>
      </div>
    </div>

    <!-- Publish / Unpublish -->
    <div class="flex shrink-0 gap-2">
      {#if sitePage.status === 'PUBLISHED'}
        <Button variant="secondary" loading={publishing} onclick={() => void unpublish()}>
          Dépublier
        </Button>
      {:else}
        <Button
          variant="primary"
          loading={publishing}
          disabled={blocks.length === 0}
          onclick={() => void publish()}
        >
          Publier
        </Button>
      {/if}
    </div>
  </div>

  <!-- ── Main content: editor (left) + settings (right) ───────────────────── -->
  <div class="grid grid-cols-1 gap-6 lg:grid-cols-3">
    <!-- ── Left column (2/3) ── -->
    <div class="space-y-6 lg:col-span-2">

      <!-- ── Block editor + live preview (split view) ─────────────────── -->
      <div class="grid grid-cols-1 gap-4 lg:grid-cols-2">

        <!-- Block editor (left pane) -->
        <Card>
          <!-- Header row: title + save-state indicator + add button -->
          <div class="mb-1 flex items-center justify-between gap-2">
            <div class="flex min-w-0 items-center gap-2">
              <h2 class="shrink-0 text-sm font-semibold text-ink">Blocs ({blocks.length})</h2>
              <!-- Save state indicator -->
              {#if saveState === 'dirty'}
                <span class="text-[11px] text-ink-faint">Modifié…</span>
              {:else if saveState === 'saving'}
                <span class="text-[11px] text-ink-muted">Enregistrement…</span>
              {:else if saveState === 'saved'}
                <span class="text-[11px] text-ok">
                  Enregistré ✓{#if lastSavedAt}&nbsp;{formatRelativeTime(lastSavedAt)}{/if}
                </span>
              {:else if saveState === 'error'}
                <span class="flex items-center gap-1 text-[11px] text-danger">
                  Échec —
                  <button
                    class="underline hover:no-underline"
                    onclick={() => void persistBlocks()}
                  >réessayer</button>
                </span>
              {/if}
            </div>
            {#if !showAddBlock}
              <Button variant="primary" onclick={() => { showAddBlock = true; }}>
                + Ajouter un bloc
              </Button>
            {/if}
          </div>

          <!-- Inline help -->
          <p class="mb-3 text-[11px] text-ink-faint">
            Ajoutez des blocs à gauche, voyez le résultat à droite. Vos changements sont enregistrés automatiquement.
          </p>

          <!-- Add block form -->
          {#if showAddBlock}
            <div class="mb-4 flex items-end gap-2 rounded-md border border-edge bg-surface-muted/40 p-3">
              <div class="flex-1">
                <label class="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
                  Type de bloc
                </label>
                <select
                  bind:value={addBlockType}
                  class="w-full rounded-md border border-edge bg-surface px-2 py-1.5 text-xs text-ink focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                >
                  {#each LANDING_BLOCK_TYPES as t (t)}
                    <option value={t}>{blockTypeLabel(t)}</option>
                  {/each}
                </select>
              </div>
              <Button variant="primary" onclick={addBlock}>Ajouter</Button>
              <Button variant="secondary" onclick={() => { showAddBlock = false; }}>Annuler</Button>
            </div>
          {/if}

          <!-- Blocks list -->
          {#if blocks.length === 0}
            <p class="text-xs text-ink-faint">
              Aucun bloc. Cliquez « + Ajouter un bloc » pour commencer — un titre, du texte, une image ou un formulaire de contact.
            </p>
          {:else}
            <div class="space-y-2">
              {#each blocks as block, i (i)}
                <div class="rounded-md border border-edge bg-surface p-3">
                  <!-- Block header -->
                  <div class="mb-2 flex items-center justify-between gap-2">
                    <span class="rounded bg-surface-muted px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
                      {blockTypeLabel(block.type)}
                    </span>
                    <div class="flex items-center gap-1">
                      <button
                        disabled={i === 0}
                        onclick={() => moveBlockUp(i)}
                        class="rounded p-1 text-ink-faint transition-colors hover:bg-surface-muted hover:text-ink disabled:opacity-30"
                        title="Monter"
                      >↑</button>
                      <button
                        disabled={i === blocks.length - 1}
                        onclick={() => moveBlockDown(i)}
                        class="rounded p-1 text-ink-faint transition-colors hover:bg-surface-muted hover:text-ink disabled:opacity-30"
                        title="Descendre"
                      >↓</button>
                      <button
                        onclick={() => removeBlock(i)}
                        class="rounded p-1 text-ink-faint transition-colors hover:bg-danger/10 hover:text-danger"
                        title="Supprimer"
                      >✕</button>
                    </div>
                  </div>

                  <!-- Block content editor -->
                  {#if block.type === 'heading'}
                    <div>
                      <label class="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
                        Texte du titre
                      </label>
                      <input
                        type="text"
                        value={block.text ?? ''}
                        oninput={(e) => updateBlockText(i, (e.target as HTMLInputElement).value)}
                        placeholder="Titre de la section…"
                        class="w-full rounded-md border border-edge bg-surface-muted/40 px-2 py-1.5 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                      />
                    </div>

                  {:else if block.type === 'text'}
                    <div>
                      <label class="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
                        Contenu
                      </label>
                      <textarea
                        rows="3"
                        value={block.text ?? ''}
                        oninput={(e) => updateBlockText(i, (e.target as HTMLTextAreaElement).value)}
                        placeholder="Votre texte…"
                        class="w-full resize-y rounded-md border border-edge bg-surface-muted/40 px-2 py-1.5 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                      ></textarea>
                    </div>

                  {:else if block.type === 'image'}
                    <div>
                      <label class="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
                        URL de l'image
                      </label>
                      <input
                        type="url"
                        value={block.url ?? ''}
                        oninput={(e) => updateBlockUrl(i, (e.target as HTMLInputElement).value)}
                        placeholder="https://…"
                        class="w-full rounded-md border border-edge bg-surface-muted/40 px-2 py-1.5 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                      />
                    </div>

                  {:else if block.type === 'form'}
                    <div>
                      <label class="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
                        Champs du formulaire
                      </label>
                      <div class="flex flex-wrap gap-x-4 gap-y-1.5">
                        {#each LANDING_FORM_FIELDS as f (f)}
                          <label class="flex cursor-pointer items-center gap-1.5 text-xs text-ink">
                            <input
                              type="checkbox"
                              checked={block.fields?.includes(f) ?? false}
                              onchange={() => toggleFormField(i, f)}
                              class="rounded border-edge accent-accent"
                            />
                            {fieldLabel(f)}
                          </label>
                        {/each}
                      </div>
                    </div>
                  {/if}
                </div>
              {/each}
            </div>
          {/if}

          {#if blocksError}
            <p class="mt-2 text-xs text-danger">{blocksError}</p>
          {/if}

          <!-- Manual save button (immediate, clears debounce) -->
          <div class="mt-4 flex gap-2">
            <Button
              loading={saveState === 'saving'}
              onclick={() => void persistBlocks()}
            >
              Sauvegarder les blocs
            </Button>
          </div>
        </Card>

        <!-- Live preview (right pane) — sticky on lg -->
        <div class="lg:sticky lg:top-4 lg:self-start">
          <Card>
            <h2 class="mb-3 text-sm font-semibold text-ink">Aperçu</h2>
            {#if blocks.length === 0}
              <p class="text-xs text-ink-faint">L'aperçu s'affichera ici une fois que vous aurez ajouté des blocs.</p>
            {:else}
              <div class="rounded-md border border-edge bg-canvas p-4">
                <LandingPageRender blocks={blocks} />
              </div>
            {/if}
          </Card>
        </div>
      </div>

      <!-- ── Submissions ─────────────────────────────────────────────────── -->
      <Card>
        <h2 class="mb-3 text-sm font-semibold text-ink">
          Soumissions ({sitePage._count.submissions})
        </h2>
        {#if submissionsLoading}
          <Skeleton rows={3} />
        {:else if submissionsError}
          <p class="text-xs text-danger">{submissionsError}</p>
        {:else if submissions.length === 0}
          <p class="text-xs text-ink-faint">Aucune soumission pour le moment.</p>
        {:else}
          <div class="overflow-x-auto">
            <table class="w-full text-xs">
              <thead>
                <tr class="border-b border-edge text-[11px] uppercase tracking-wide text-ink-muted">
                  <th class="py-2 pr-4 text-left font-semibold">Données</th>
                  <th class="py-2 px-2 text-left font-semibold">Contact</th>
                  <th class="py-2 pl-2 text-left font-semibold">Date</th>
                </tr>
              </thead>
              <tbody>
                {#each submissions as sub (sub.id)}
                  <tr class="border-b border-edge/50 last:border-0 hover:bg-surface-muted/40">
                    <td class="py-2 pr-4 text-ink">{submissionDataSummary(sub.data)}</td>
                    <td class="py-2 px-2">
                      {#if sub.contactId}
                        <a
                          href="/crm/contacts/{sub.contactId}"
                          class="font-mono text-[11px] text-accent hover:underline"
                        >
                          {sub.contactId.slice(0, 8)}…
                        </a>
                      {:else}
                        <span class="text-ink-faint">—</span>
                      {/if}
                    </td>
                    <td class="py-2 pl-2 text-ink-muted">{formatDate(sub.createdAt)}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        {/if}
      </Card>
    </div>

    <!-- ── Right column (1/3) ── -->
    <div class="space-y-6">

      <!-- ── Page settings ──────────────────────────────────────────────── -->
      <Card>
        <h2 class="mb-3 text-sm font-semibold text-ink">Paramètres de la page</h2>
        <div class="space-y-3">
          <div>
            <label class="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
              Titre
            </label>
            <input
              type="text"
              bind:value={editTitle}
              class="w-full rounded-md border border-edge bg-surface px-2 py-1.5 text-sm text-ink focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
            />
          </div>

          <div>
            <label class="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
              Slug
            </label>
            <div class="flex items-center gap-1.5">
              <span class="text-xs text-ink-faint">/p/</span>
              <input
                type="text"
                bind:value={editSlug}
                class="min-w-0 flex-1 rounded-md border border-edge bg-surface px-2 py-1.5 font-mono text-xs text-ink focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
              />
            </div>
            <p class="mt-0.5 text-[11px] text-ink-faint">URL publique de la page.</p>
          </div>

          <div>
            <label class="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
              Liste de capture (CRM)
            </label>
            {#if crmListsLoaded && crmLists.length > 0}
              <select
                bind:value={editCaptureListId}
                class="w-full rounded-md border border-edge bg-surface px-2 py-1.5 text-xs text-ink focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
              >
                <option value="">— Aucune —</option>
                {#each crmLists as l (l.id)}
                  <option value={l.id}>{l.name}</option>
                {/each}
              </select>
            {:else}
              <input
                type="text"
                bind:value={editCaptureListId}
                placeholder="ID de la liste…"
                class="w-full rounded-md border border-edge bg-surface px-2 py-1.5 font-mono text-xs text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
              />
            {/if}
          </div>
        </div>

        {#if fieldsError}
          <p class="mt-2 text-xs text-danger">{fieldsError}</p>
        {/if}

        <div class="mt-4">
          <Button loading={savingFields} onclick={() => void saveFields()}>
            Sauvegarder
          </Button>
        </div>
      </Card>

      <!-- ── Status & actions ──────────────────────────────────────────── -->
      <Card>
        <h2 class="mb-2 text-sm font-semibold text-ink">Statut</h2>
        <div class="mb-3 flex items-center gap-2">
          <Badge tone={statusTone(sitePage.status)}>{statusLabel(sitePage.status)}</Badge>
          <span class="text-xs text-ink-muted">
            Modifié le {formatDate(sitePage.updatedAt)}
          </span>
        </div>
        <div class="space-y-2">
          {#if sitePage.status === 'PUBLISHED'}
            <Button variant="secondary" loading={publishing} onclick={() => void unpublish()}>
              Dépublier
            </Button>
            <a
              href="/p/{sitePage.slug}"
              target="_blank"
              rel="noopener noreferrer"
              class="flex items-center gap-2 rounded-md border border-edge bg-surface px-3 py-2 text-xs text-ink transition-colors hover:border-accent hover:text-accent"
            >
              Voir la page publiée ↗
            </a>
          {:else}
            <Button
              variant="primary"
              loading={publishing}
              disabled={blocks.length === 0}
              onclick={() => void publish()}
            >
              Publier
            </Button>
            {#if blocks.length === 0}
              <p class="text-[11px] text-ink-faint">Ajoutez au moins un bloc avant de publier.</p>
            {/if}
          {/if}
        </div>
      </Card>
    </div>
  </div>
{/if}
