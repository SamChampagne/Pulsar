<script lang="ts">
  import type { Paginated } from '@pulsar/shared';
  import { api, ApiError } from '$lib/api/client';
  import { unseenReleaseNotes } from '$lib/stores/release-notes';
  import { Badge, EmptyState, PageHeader, Skeleton } from '$lib/components/ui';

  type Kind = 'FEATURE' | 'IMPROVEMENT' | 'FIX';

  interface ReleaseNoteView {
    id: string;
    title: string;
    body: string;
    bodyHtml: string;
    kind: Kind;
    version: string | null;
    publishedAt: string | null;
  }

  const KIND_LABELS: Record<Kind, string> = {
    FEATURE: 'Nouveauté',
    IMPROVEMENT: 'Amélioration',
    FIX: 'Correctif',
  };
  const KIND_TONES: Record<Kind, 'ok' | 'info' | 'warn'> = {
    FEATURE: 'ok',
    IMPROVEMENT: 'info',
    FIX: 'warn',
  };

  let notes = $state<ReleaseNoteView[]>([]);
  let loadingData = $state(true);
  let error = $state('');

  async function load() {
    loadingData = true;
    error = '';
    try {
      const result = await api<Paginated<ReleaseNoteView>>('/release-notes');
      notes = result.items;
      // Opening the feed marks it seen: reset the shared badge count right away
      // and tell the server, so the count stays at 0 on the next poll.
      unseenReleaseNotes.set(0);
      await api('/release-notes/seen', { method: 'POST' });
    } catch (e) {
      error = e instanceof ApiError ? e.message : 'Impossible de charger les nouveautés.';
    } finally {
      loadingData = false;
    }
  }

  $effect(() => {
    void load();
  });
</script>

<svelte:head><title>Quoi de neuf | Pulsar</title></svelte:head>
<div class="mx-auto max-w-2xl">
  <PageHeader title="Quoi de neuf" subtitle="Les dernières nouveautés et améliorations de Pulsar." />

  {#if error}
    <p class="mb-4 text-sm text-danger">{error}</p>
  {/if}

  {#if loadingData}
    <Skeleton rows={5} />
  {:else if notes.length === 0}
    <EmptyState message="Aucune nouveauté publiée pour l’instant." />
  {:else}
    <ol class="space-y-5">
      {#each notes as note (note.id)}
        <li class="rounded-card border border-edge bg-surface p-4">
          <div class="mb-2 flex flex-wrap items-center gap-2">
            <Badge tone={KIND_TONES[note.kind]}>{KIND_LABELS[note.kind]}</Badge>
            {#if note.version}<span class="font-mono text-xs text-ink-muted">{note.version}</span
              >{/if}
            {#if note.publishedAt}<span class="text-xs text-ink-faint"
                >{new Date(note.publishedAt).toLocaleDateString('fr-CA')}</span
              >{/if}
          </div>
          <h2 class="mb-2 text-sm font-semibold text-ink">{note.title}</h2>
          <!-- bodyHtml is produced server-side by the pure renderReleaseNoteBody
               (@pulsar/shared): input is HTML-escaped first, then only
               <p>/<br>/<strong>/<ul>/<li> tags are introduced, so this is safe. -->
          <div class="prose-sm max-w-none text-sm leading-6 text-ink-muted [&_strong]:text-ink [&_ul]:list-disc [&_ul]:pl-5">
            {@html note.bodyHtml}
          </div>
        </li>
      {/each}
    </ol>
  {/if}
</div>
