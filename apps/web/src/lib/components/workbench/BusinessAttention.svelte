<script lang="ts">
  import {
    ATTENTION_KINDS,
    ATTENTION_LABELS,
    PERMISSIONS,
    type AttentionFeed,
    type BusinessAttentionKind as AttentionKind,
    type ConnectedOperationsSettings,
  } from '@pulsar/shared';
  import { api } from '$lib/api/client';
  import { auth } from '$lib/stores/auth';
  import BusinessAssistant from '$lib/components/business/BusinessAssistant.svelte';
  import { Button, ErrorNotice, EmptyState, Skeleton, Modal } from '$lib/components/ui';
  let feed = $state<AttentionFeed | null>(null),
    kind = $state<AttentionKind | ''>(''),
    scope = $state('all');
  let page = $state(1),
    loading = $state(false),
    error = $state(''),
    settingsOpen = $state(false),
    saving = $state(false);
  let settings = $state<ConnectedOperationsSettings | null>(null);
  let request = 0;
  const canConfigure = $derived($auth?.user.permissions.includes(PERMISSIONS.CORE.TENANT_MANAGE));
  async function load() {
    const seq = ++request;
    loading = true;
    error = '';
    try {
      const result = await api<AttentionFeed>('/operational-attention', {
        query: { kind: kind || undefined, scope, page, pageSize: 10 },
      });
      if (seq === request) feed = result;
    } catch (e) {
      if (seq === request) {
        feed = null;
        error = e instanceof Error ? e.message : 'Suivi indisponible.';
      }
    } finally {
      if (seq === request) loading = false;
    }
  }
  $effect(() => {
    kind;
    scope;
    page;
    void load();
  });
  async function saveSettings() {
    if (!settings || !feed || saving) return;
    saving = true;
    try {
      await api('/operational-attention/settings', {
        method: 'PUT',
        body: { ...settings, expectedUpdatedAt: feed.settingsVersion },
      });
      settingsOpen = false;
      kind = '';
      page = 1;
      await load();
    } catch (e) {
      error = e instanceof Error ? e.message : 'Réglages non enregistrés.';
    } finally {
      saving = false;
    }
  }
</script>

<section
  class="mb-8 rounded-xl border border-edge bg-surface p-4 sm:p-5"
  aria-label="Suivi métier connecté"
>
  <div class="flex flex-wrap items-start justify-between gap-3">
    <div>
      <h2 class="text-base font-semibold">À traiter dans mes modules</h2>
      <p class="mt-1 max-w-2xl text-sm text-ink-muted">
        Situations calculées depuis les dossiers actuels. Traitez la source puis actualisez : aucun
        statut métier n’est changé ici.
      </p>
    </div>
    <div class="flex flex-wrap gap-2">
      <Button variant="secondary" onclick={load} disabled={loading}>Actualiser le suivi</Button>
      <BusinessAssistant
        permission="core.operating.tasks.read"
        prompt="Consulte business_attention et propose les trois priorités opérationnelles avec leurs liens sources. Ne modifie aucun dossier, ne prends aucune décision RH et signale les modules non accessibles."
      />
      {#if canConfigure && feed}<Button
          variant="ghost"
          onclick={() => {
            settings = structuredClone(feed!.settings);
            settingsOpen = true;
          }}>Réglages des alertes</Button
        >{/if}
    </div>
  </div>
  <ErrorNotice message={error} onretry={load} />
  {#if feed}
    <div class="my-4 flex flex-wrap gap-2" aria-label="Sources du suivi">
      {#each feed.available as source}<button
          type="button"
          aria-pressed={feed.kind === source.kind}
          class={`rounded-md border px-3 py-2 text-sm transition-colors ${feed.kind === source.kind ? 'border-accent bg-accent-soft text-accent' : 'border-edge hover:bg-surface-muted'}`}
          onclick={() => {
            kind = source.kind;
            page = 1;
          }}>{source.label} <span class="ml-2 font-mono text-xs">{source.total}</span></button
        >{/each}
    </div>
    <div class="mb-3 flex flex-wrap items-center justify-between gap-3 text-xs text-ink-muted">
      <label
        >Portée <select
          class="ml-2 rounded-md border border-edge bg-surface p-2 text-ink"
          bind:value={scope}
          onchange={() => (page = 1)}
          ><option value="all">Tous les dossiers autorisés</option><option value="mine"
            >Mes responsabilités</option
          ></select
        ></label
      >
      <span
        >Calcul au {new Date(feed.checkedAt).toLocaleTimeString()} · {feed.settings.timeZone}</span
      >
    </div>
  {/if}
  {#if loading}<Skeleton rows={3} />
  {:else if feed && feed.items.length}
    <ul class="divide-y divide-edge">
      {#each feed.items as item (item.id)}<li
          class="flex flex-wrap items-center justify-between gap-3 py-3"
        >
          <div class="min-w-0">
            <a href={item.href} class="font-medium text-ink hover:text-accent">{item.title}</a>
            <p class="mt-1 text-sm text-ink-muted">
              {item.reason}{item.dueDate ? ` · ${item.dueDate}` : ''}{item.assignee
                ? ` · ${item.assignee}`
                : ''}
            </p>
          </div>
          <Button variant="secondary" href={item.href}>{item.action}</Button>
        </li>{/each}
    </ul>
    <div class="mt-3 flex items-center justify-between gap-2 text-sm">
      <span>{feed.total} dossier(s)</span>
      <div class="flex gap-2">
        <Button
          variant="ghost"
          disabled={page <= 1}
          onclick={() => {
            page--;
          }}>Précédent</Button
        ><Button
          variant="ghost"
          disabled={page * feed!.pageSize >= feed!.total}
          onclick={() => {
            page++;
          }}>Suivant</Button
        >
      </div>
    </div>
  {:else if feed}<EmptyState
      title={feed.available.length
        ? 'Rien à traiter dans cette sélection'
        : 'Aucune source métier accessible'}
      message={feed.available.length
        ? 'Le suivi disparaît lorsque la situation est corrigée dans son module.'
        : 'Les modules, permissions et réglages déterminent les sources affichées.'}
    />{/if}
</section>

<Modal bind:open={settingsOpen} title="Réglages des alertes métier" size="sm">
  {#if settings}<form
      class="flex flex-col gap-4"
      onsubmit={(event) => {
        event.preventDefault();
        void saveSettings();
      }}
    >
      <p class="text-sm text-ink-muted">
        Réglages partagés par l’entreprise. Le fuseau sert aux échéances et au planning Services.
      </p>
      <label class="text-sm"
        >Fuseau de l’entreprise<input
          class="mt-1 w-full rounded-md border border-edge bg-surface p-2"
          aria-label="Fuseau de l’entreprise"
          bind:value={settings.timeZone}
          required
          maxlength="100"
          placeholder="America/Toronto"
        /></label
      >
      <label class="text-sm"
        >Préavis des habilitations (jours)<input
          class="mt-1 w-full rounded-md border border-edge bg-surface p-2"
          aria-label="Préavis des habilitations"
          type="number"
          min="0"
          max="365"
          bind:value={settings.qualificationDays}
          required
        /></label
      >
      {#each ATTENTION_KINDS as source}<label class="flex items-center gap-2 text-sm"
          ><input type="checkbox" bind:checked={settings.enabled[source]} />{ATTENTION_LABELS[
            source
          ]}</label
        >{/each}
      <ErrorNotice message={error} />
      <Button type="submit" loading={saving}>Enregistrer les alertes</Button>
    </form>{/if}
</Modal>
