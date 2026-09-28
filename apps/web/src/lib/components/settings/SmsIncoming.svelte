<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '$lib/api/client';
  import { formatDateTime } from '$lib/format';
  import { isSmsStop } from '@pulsar/shared';
  import { Button, Card, Badge, EmptyState, ErrorNotice, Skeleton } from '$lib/components/ui';
  type Row = {
    id: string;
    fromNumber?: string;
    toNumber?: string;
    text?: string;
    occurredAt?: string;
    phoneNumber?: string;
    createdAt?: string;
  };
  let tab = $state<'inbox' | 'suppressions'>('inbox'),
    page = $state(1),
    total = $state(0),
    rows = $state<Row[]>([]),
    loading = $state(false),
    error = $state('');
  async function load() {
    loading = true;
    error = '';
    try {
      const data = await api<{ items: Row[]; total: number }>(`/sms/${tab}`, { query: { page } });
      rows = data.items;
      total = data.total;
    } catch (e) {
      error = (e as Error).message;
      rows = [];
    } finally {
      loading = false;
    }
  }
  async function choose(next: typeof tab) {
    tab = next;
    page = 1;
    await load();
  }
  onMount(load);
</script>

<section class="space-y-3 border-t border-edge pt-5" aria-label="Réponses SMS et désabonnements">
  <div class="flex flex-wrap items-center justify-between gap-2">
    <div class="flex gap-2">
      <Button
        variant={tab === 'inbox' ? 'primary' : 'secondary'}
        disabled={loading}
        onclick={() => choose('inbox')}>Réponses reçues</Button
      >
      <Button
        variant={tab === 'suppressions' ? 'primary' : 'secondary'}
        disabled={loading}
        onclick={() => choose('suppressions')}>Désabonnements STOP</Button
      >
    </div>
    <Button variant="ghost" disabled={loading} onclick={load}>Actualiser les réponses</Button>
  </div>
  <p class="text-sm text-ink-muted">
    Un STOP bloque ce numéro pour toute l’entreprise, même si vous changez de numéro d’envoi. START
    ne le réactive pas automatiquement. Aucun bouton ne contourne cette protection.
  </p>
  <ErrorNotice message={error} onretry={load} />
  {#if loading}<Skeleton rows={2} />{:else}
    {#each rows as row (row.id)}
      <Card
        ><div class="flex flex-wrap items-center justify-between gap-2">
          <p class="font-medium">{row.fromNumber ?? row.phoneNumber}</p>
          {#if tab === 'suppressions' || isSmsStop(row.text ?? '')}<Badge tone="warn"
              >STOP · envois bloqués</Badge
            >{/if}
        </div>
        {#if row.text}<p class="my-2 text-sm break-words whitespace-pre-wrap">{row.text}</p>{/if}
        <p class="mt-2 text-xs text-ink-muted">
          {formatDateTime((row.occurredAt ?? row.createdAt)!)}{row.toNumber
            ? ` · Vers ${row.toNumber}`
            : ''}
        </p>
      </Card>
    {:else}<EmptyState
        title={tab === 'inbox' ? 'Aucune réponse reçue' : 'Aucun désabonnement reçu'}
        message="Seuls les retours Telnyx signés sont enregistrés. Une simulation ne valide pas cette connexion."
      />{/each}
    <div class="flex items-center justify-end gap-3">
      <Button
        variant="secondary"
        disabled={page <= 1}
        onclick={() => {
          page--;
          void load();
        }}>Précédent</Button
      ><span class="text-sm">Page {page} · {total}</span><Button
        variant="secondary"
        disabled={page * 20 >= total}
        onclick={() => {
          page++;
          void load();
        }}>Suivant</Button
      >
    </div>
  {/if}
</section>
