# Sites Builder — Aperçu live + auto-save + UX — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Rendre le builder Sites fiable et compréhensible — aperçu live WYSIWYG + auto-sauvegarde des blocs + indicateur d'état + aide. Backend inchangé (PATCH content déjà vérifié OK).

**Architecture:** Un composant de rendu partagé `LandingPageRender.svelte` (rend heading/text/image ; délègue les blocs `form` à un snippet Svelte 5 fourni par l'appelant) utilisé par la page publique `/p/[slug]` ET le panneau d'aperçu de l'éditeur — garantit que l'aperçu = le rendu réel. L'éditeur `/sites/[id]` passe en vue scindée (éditeur | aperçu live) avec auto-sauvegarde debouncée des blocs.

**Tech Stack:** SvelteKit (Svelte 5 runes + snippets), Vitest (web, si dispo). Aucune dépendance nouvelle, aucun changement backend.

## Global Constraints

- **Aucun changement backend.** Le PATCH `/sites/pages/:id { content }` persiste déjà (vérifié 200 + round-trip). R10 page publique inchangé.
- **Fidélité de l'aperçu :** l'éditeur et `/p/[slug]` rendent les blocs via le MÊME composant `LandingPageRender` (mêmes classes) — l'aperçu doit refléter le rendu public.
- **Auto-save ≠ reload :** l'auto-sauvegarde PATCH le contenu mais ne recharge PAS la page (les `blocks` locaux restent la source de vérité — un `reload()` écraserait l'édition en cours / le focus).
- **Pas d'auto-save des champs** (titre/slug/captureListId) : restent en sauvegarde manuelle (slug = collision globale possible).
- **Web :** idiomes Svelte 5 runes existants, `api<T>()`, débounce maison (setTimeout, pas de lib). Vérifier avec `pnpm --filter @pulsar/web build` ET `pnpm typecheck` (svelte-check — pas juste vite build).
- **Comportement public inchangé :** `/p/[slug]` garde ses endpoints, son honeypot `_hp`, son message de succès. `/p/bienvenue` doit rendre comme avant.

---

### Task 1: Composant partagé `LandingPageRender.svelte` + refactor `/p/[slug]`

**Files:**
- Create: `apps/web/src/lib/components/sites/LandingPageRender.svelte`
- Modify: `apps/web/src/routes/p/[slug]/+page.svelte` (reuse the component)
- (If a barrel exists at `apps/web/src/lib/components/sites/index.ts`, export it there; else import by path.)

**Interfaces:**
- Produces: a component with props `{ blocks: LandingBlock[]; formBlock?: Snippet<[block: LandingBlock, index: number]> }`. It renders, in order: `heading`→`<h1>` (first heading) / `<h2>` (subsequent), `text`→`<p>` (preserve line breaks), `image`→`<img src alt="">` (skip if no url), `form`→ calls the `formBlock` snippet if provided, else renders a non-interactive disabled preview of the declared fields. `LandingBlock` type = `{ type: LandingBlockType; text?: string; url?: string; fields?: string[] }` (mirror the type already declared in the sites pages).

- [ ] **Step 1: Read the current public page** — Read `apps/web/src/routes/p/[slug]/+page.svelte` fully to capture the EXACT markup/classes it uses for heading/text/image and the form (inputs, labels, submit, honeypot, success state). The component must reproduce the heading/text/image markup verbatim so the public page looks identical after refactor.

- [ ] **Step 2: Write the component**

```svelte
<!-- apps/web/src/lib/components/sites/LandingPageRender.svelte -->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import { LANDING_FORM_FIELDS, type LandingBlockType } from '@pulsar/shared';

  interface LandingBlock {
    type: LandingBlockType;
    text?: string;
    url?: string;
    fields?: string[];
  }

  let { blocks = [], formBlock }: { blocks?: LandingBlock[]; formBlock?: Snippet<[LandingBlock, number]> } = $props();

  function fieldLabel(field: string): string {
    switch (field) {
      case 'name': return 'Nom';
      case 'email': return 'Courriel';
      case 'phone': return 'Téléphone';
      case 'company': return 'Société';
      case 'message': return 'Message';
      default: return field;
    }
  }

  // Track whether we've seen the first heading (h1 vs h2)
  let firstHeadingSeen = $state(false);
</script>

<div class="space-y-5">
  {#each blocks as block, i (i)}
    {#if block.type === 'heading'}
      {#if i === blocks.findIndex((b) => b.type === 'heading')}
        <h1 class="text-3xl font-bold text-ink">{block.text || 'Titre'}</h1>
      {:else}
        <h2 class="text-xl font-semibold text-ink">{block.text || 'Sous-titre'}</h2>
      {/if}
    {:else if block.type === 'text'}
      <p class="whitespace-pre-line leading-relaxed text-ink-muted">{block.text || ''}</p>
    {:else if block.type === 'image'}
      {#if block.url}
        <img src={block.url} alt="" class="max-w-full rounded-md" />
      {/if}
    {:else if block.type === 'form'}
      {#if formBlock}
        {@render formBlock(block, i)}
      {:else}
        <!-- Non-interactive preview of the form -->
        <div class="space-y-3 rounded-md border border-edge bg-surface-muted/30 p-4">
          {#each block.fields ?? [] as f (f)}
            <div>
              <label class="mb-1 block text-xs font-semibold text-ink-muted">{fieldLabel(f)}</label>
              <input disabled placeholder={fieldLabel(f)} class="w-full rounded-md border border-edge bg-surface px-2 py-1.5 text-sm text-ink-faint" />
            </div>
          {/each}
          <button disabled class="rounded-md bg-accent/60 px-4 py-2 text-sm text-white">Envoyer</button>
        </div>
      {/if}
    {/if}
  {/each}
</div>
```

(Adjust class names to match the actual public page's existing styling captured in Step 1. The heading `findIndex` approach picks the first heading as `<h1>`. If the public page used different element/classes, match those exactly.)

- [ ] **Step 3: Refactor `/p/[slug]` to use the component** — replace its inline block-rendering loop with `<LandingPageRender blocks={blocks}>` passing a `formBlock` snippet that renders the EXISTING interactive form (bound inputs + honeypot `_hp` + submit + success message). Keep all submission logic (`POST /public/sites/:slug/submit`, honeypot, `{ ok }` handling, French success) exactly as-is — only the heading/text/image rendering is delegated to the component. The form snippet contains the current `<form>`.

```svelte
<!-- in /p/[slug]/+page.svelte, replacing the block loop -->
<LandingPageRender blocks={page.blocks}>
  {#snippet formBlock(block)}
    {#if !submitted}
      <form onsubmit={handleSubmit} class="...existing classes...">
        {#each block.fields ?? [] as f (f)}
          <!-- existing field input bound to fieldValues[f], type=email for email -->
        {/each}
        <!-- existing hidden honeypot _hp input -->
        <button type="submit" ...>Envoyer</button>
      </form>
    {:else}
      <p>Merci, nous vous recontacterons.</p>
    {/if}
  {/snippet}
</LandingPageRender>
```

(Adapt to the actual variable names in the current public page — `page`/`blocks`, `fieldValues`, `_hp`, `submitted`, `handleSubmit`. Preserve them.)

- [ ] **Step 4: Build + typecheck + manual public check**

Run: `pnpm --filter @pulsar/web build && pnpm typecheck` (both green).
Manual: the dev server is running — open `http://localhost:5173/p/bienvenue` and confirm it renders the seeded page (heading + text + form with name/email/company) and the form still submits. (If you cannot open a browser, at least confirm the build is green and the markup matches the prior structure.)

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/components/sites/LandingPageRender.svelte apps/web/src/routes/p
git commit -m "feat(sites): shared LandingPageRender component + reuse in public page"
```

---

### Task 2: Éditeur `/sites/[id]` — vue scindée + aperçu live + auto-save + UX

**Files:**
- Modify: `apps/web/src/routes/(app)/sites/[id]/+page.svelte`

**Interfaces:**
- Consumes: `LandingPageRender` (Task 1). Backend `PATCH /sites/pages/:id { content }` (unchanged).

- [ ] **Step 1: Add live preview (split view)**

Wrap the existing block editor (left) and a new preview pane (right) in a responsive 2-column layout (e.g. `grid lg:grid-cols-2`, preview `sticky top-4` on large screens). The preview renders the current in-memory blocks:

```svelte
<LandingPageRender blocks={blocks} />
```

Add a small heading "Aperçu" above it. The preview updates reactively as `blocks` change (no save needed). On mobile, stack editor above preview (or a toggle).

- [ ] **Step 2: Debounced auto-save of blocks**

Replace the manual-only save with auto-save. Add a `saveState` rune (`'idle' | 'dirty' | 'saving' | 'saved' | 'error'`) and a `lastSavedAt` timestamp. Implement a debounce:

```ts
let saveState = $state<'idle' | 'dirty' | 'saving' | 'saved' | 'error'>('idle');
let lastSavedAt = $state<Date | null>(null);
let hydrated = $state(false); // guard: don't autosave on initial load
let saveTimer: ReturnType<typeof setTimeout> | null = null;

async function persistBlocks() {
  if (!sitePage) return;
  saveState = 'saving';
  blocksError = '';
  try {
    await api(`/sites/pages/${sitePage.id}`, { method: 'PATCH', body: { content: blocks } });
    // IMPORTANT: do NOT reload() — keep local blocks as source of truth (preserves edit/focus).
    // Keep the in-memory sitePage.content in sync so publish-guard / counts stay correct:
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
  saveTimer = setTimeout(() => { void persistBlocks(); }, 800);
}

// Autosave: react to blocks changes after hydration.
$effect(() => {
  // touch blocks to track it
  void blocks;
  if (!hydrated) return;
  scheduleSave();
});
```

In `syncFormState()` (after the initial load sets `blocks`), set `hydrated = true` AFTER assigning blocks so the first assignment doesn't trigger a save. Use `untrack` carefully: set `hydrated = true` in a `tick().then(...)` or set it at the end of `loadPage`'s success path after `syncFormState()`. Simplest: in `loadPage` after `syncFormState()`, do `hydrated = true` — but the `$effect` reads `blocks` which was just set; guard with a separate flag that flips only once the first effect run is skipped. A robust approach:

```ts
let initialBlocksLoaded = false;
$effect(() => {
  void blocks;
  if (!initialBlocksLoaded) { initialBlocksLoaded = true; return; } // skip the first (hydration) run
  scheduleSave();
});
```

Use this skip-first-run pattern (no `hydrated` needed). Verify it does not autosave immediately on page load, and DOES autosave after a user edit.

- [ ] **Step 3: Save-status indicator + keep manual save**

Near the "Blocs (N)" header, show the status: `dirty`→"Modifié…", `saving`→"Enregistrement…", `saved`→"Enregistré ✓" (+ relative time from `lastSavedAt`), `error`→"Échec — réessayer" with a retry button calling `persistBlocks()`. Keep the existing "Sauvegarder les blocs" button as an immediate manual save (calls `persistBlocks()` directly, clearing the debounce timer first). Remove the old `reload()` from the block-save path (the field-save path's `reload()` can stay, or also switch to in-place update — but at minimum the block path must NOT reload).

- [ ] **Step 4: Inline help + better empty state**

Add a short helper line at the top of the block editor card: "Ajoutez des blocs à gauche, voyez le résultat à droite. Vos changements sont enregistrés automatiquement." Improve the empty state: "Aucun bloc. Cliquez « + Ajouter un bloc » pour commencer — un titre, du texte, une image ou un formulaire de contact."

- [ ] **Step 5: Build + typecheck**

Run: `pnpm --filter @pulsar/web build && pnpm typecheck` (both green).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/routes/\(app\)/sites/\[id\]/+page.svelte
git commit -m "feat(sites): editor live preview + debounced block autosave + status/help"
```

---

### Task 3: Vérification + smoke

**Files:** none (verification only).

- [ ] **Step 1: Web build + typecheck** — `pnpm --filter @pulsar/web build && pnpm typecheck` (green).

- [ ] **Step 2: Manual smoke against the running dev server** (api :3000 + web :5173 are up). Using the admin token, exercise the real flow end-to-end via the API to PROVE autosave persistence semantics hold (the UI calls the same PATCH):
  - `GET /api/v1/sites/pages` → pick a page id.
  - `PATCH /api/v1/sites/pages/:id { content: [{type:'heading',text:'Smoke'}] }` → 200.
  - `GET /api/v1/sites/pages/:id` → content contains the heading (proves persistence — the UI autosave uses this exact call).
  Document the result. (The UI-level behavior — add block → preview updates → autosaved → survives reload — is delivered by Tasks 1-2; this step confirms the persistence path the UI relies on.)

- [ ] **Step 3: Note in the report** that the manual UI verification steps for the human are: open `/sites/<id>`, add a block, watch it appear in the right-hand preview, see "Enregistré ✓", reload the page, confirm the block persisted; open `/p/<slug>` to see the published rendering matches the preview.

- [ ] **Step 4: Commit (docs only, if any)** — if `docs/etat-du-projet.md` mentions the Sites builder, add a line noting live preview + autosave; else skip. Commit `docs(sites): note builder live preview + autosave` (only if a doc was touched).

---

## Self-Review

**Spec coverage:** shared render component + public reuse → T1 ; editor split-view preview + debounced autosave + status + help → T2 ; verification → T3. ✓

**Placeholder scan:** T1 component carries full code (classes to be matched to the actual public page — explicitly instructed to read it first); T2 carries the autosave/debounce/skip-first-run logic in full; the form-block rendering uses a Svelte 5 snippet prop so the public form stays interactive while the editor shows a disabled preview — concrete, not hand-wavy.

**Type consistency:** `LandingBlock` shape (`type/text/url/fields`) consistent between the component (T1) and the editor (T2, already declared there). `LandingPageRender` props (`blocks`, `formBlock` snippet) consumed identically by `/p/[slug]` (T1) and the editor preview (T2, no formBlock → disabled preview). `persistBlocks` PATCHes `{ content: blocks }` — the same endpoint/body verified working.
