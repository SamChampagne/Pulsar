<script lang="ts">
  import type { Paginated } from '@pulsar/shared';
  import { api, ApiError } from '$lib/api/client';
  import { goto } from '$app/navigation';
  import { toast } from '$lib/stores/toast';
  import {
    PageHeader,
    Button,
    FilterBar,
    Select,
    Table,
    Badge,
    EmptyState,
    Card,
    Skeleton,
    ErrorNotice,
    Modal,
    Field,
    Input,
    type Tone,
  } from '$lib/components/ui';
  import { untrack } from 'svelte';

  // ── Types ───────────────────────────────────────────────────────────────────

  interface PageRow {
    id: string;
    title: string;
    slug: string;
    status: string;
    _count: { submissions: number };
    updatedAt: string;
  }

  // ── State — list ─────────────────────────────────────────────────────────────

  let pages = $state<PageRow[]>([]);
  let total = $state(0);
  let page = $state(1);
  const pageSize = 25;
  const totalPages = $derived(Math.max(1, Math.ceil(total / pageSize)));
  let search = $state('');
  let statusFilter = $state('');
  let loading = $state(true);
  let error = $state('');

  // ── State — create modal ──────────────────────────────────────────────────────

  let createOpen = $state(false);
  let createTitle = $state('');
  let createSaving = $state(false);

  // ── Data loading ─────────────────────────────────────────────────────────────

  async function load() {
    loading = true;
    error = '';
    try {
      const result = await api<Paginated<PageRow>>('/sites/pages', {
        query: {
          search: search || undefined,
          status: statusFilter || undefined,
          page,
          pageSize,
        },
      });
      pages = result.items;
      total = result.total;
    } catch (e) {
      error = e instanceof ApiError ? e.message : 'Impossible de charger les pages';
    } finally {
      loading = false;
    }
  }

  // ── Create ────────────────────────────────────────────────────────────────────

  function openCreate() {
    createTitle = '';
    createOpen = true;
  }

  async function submitCreate() {
    if (!createTitle.trim()) {
      toast.error('Le titre est obligatoire');
      return;
    }
    createSaving = true;
    try {
      const created = await api<PageRow>('/sites/pages', {
        method: 'POST',
        body: { title: createTitle.trim() },
      });
      toast.success('Page créée');
      createOpen = false;
      await goto(`/sites/${created.id}`);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Échec de la création');
    } finally {
      createSaving = false;
    }
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────

  function statusTone(status: string): Tone {
    if (status === 'PUBLISHED') return 'ok';
    return 'neutral';
  }

  function statusLabel(status: string): string {
    if (status === 'PUBLISHED') return 'Publié';
    return 'Brouillon';
  }

  // ── Reactive load ─────────────────────────────────────────────────────────────

  $effect(() => {
    const _s = search;
    const _sf = statusFilter;
    untrack(() => {
      page = 1;
      void load();
    });
  });
</script>

<PageHeader title="Sites & Pages" subtitle="Gérez vos pages d'atterrissage et collectez des soumissions." count={total}>
  {#snippet actions()}
    <Button onclick={openCreate}>Nouvelle page</Button>
  {/snippet}
</PageHeader>

<ErrorNotice message={error} onretry={load} />

<FilterBar>
  <div class="w-64">
    <input
      placeholder="Rechercher par titre ou slug…"
      bind:value={search}
      onkeydown={(e) => { if (e.key === 'Enter') void load(); }}
      class="w-full rounded-md border border-edge bg-surface px-3 py-1.5 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
    />
  </div>
  <div class="w-44">
    <Select bind:value={statusFilter}>
      <option value="">Tous les statuts</option>
      <option value="PUBLISHED">Publiées</option>
      <option value="DRAFT">Brouillons</option>
    </Select>
  </div>
</FilterBar>

{#if loading}
  <Card padded={false}><Skeleton rows={6} /></Card>
{:else if pages.length === 0}
  <Card>
    <EmptyState message="Aucune page pour le moment." />
  </Card>
{:else}
  <Table>
    {#snippet head()}
      <th>Titre</th><th>Slug</th><th>Statut</th><th>Soumissions</th><th>Voir</th>
    {/snippet}
    {#snippet body()}
      {#each pages as p (p.id)}
        <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
        <tr
          class="cursor-pointer transition-colors hover:bg-surface-muted"
          onclick={() => void goto(`/sites/${p.id}`)}
        >
          <td class="font-semibold text-ink">{p.title}</td>
          <td class="font-mono text-xs text-ink-muted">{p.slug}</td>
          <td>
            <Badge tone={statusTone(p.status)}>
              {statusLabel(p.status)}
            </Badge>
          </td>
          <td class="text-ink-muted">{p._count.submissions}</td>
          <td>
            <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
            <span
              class="text-accent hover:underline text-xs"
              onclick={(e) => { e.stopPropagation(); window.open(`/p/${p.slug}`, '_blank'); }}
            >
              /p/{p.slug} ↗
            </span>
          </td>
        </tr>
      {/each}
    {/snippet}
  </Table>
{/if}

{#if total > pageSize}
  <div class="mt-3 flex items-center justify-between text-sm text-ink-muted">
    <span class="font-mono text-xs">
      {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} sur {total}
    </span>
    <div class="flex items-center gap-2">
      <Button
        variant="secondary"
        disabled={page <= 1}
        onclick={() => { page = Math.max(1, page - 1); void load(); }}
      >Précédent</Button>
      <span class="font-mono text-xs">Page {page} / {totalPages}</span>
      <Button
        variant="secondary"
        disabled={page >= totalPages}
        onclick={() => { page = Math.min(totalPages, page + 1); void load(); }}
      >Suivant</Button>
    </div>
  </div>
{/if}

<!-- Create modal -->
<Modal bind:open={createOpen} title="Nouvelle page">
  <div class="flex flex-col gap-4">
    <Field label="Titre *">
      <Input bind:value={createTitle} placeholder="Ex. : Page d'accueil campagne printemps" />
    </Field>
  </div>
  {#snippet footer()}
    <Button variant="secondary" onclick={() => { createOpen = false; }}>Annuler</Button>
    <Button loading={createSaving} onclick={submitCreate}>Créer</Button>
  {/snippet}
</Modal>
