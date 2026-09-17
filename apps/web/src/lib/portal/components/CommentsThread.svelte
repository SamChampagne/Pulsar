<script lang="ts">
  import { Badge, Button, Textarea } from '$lib/components/ui';
  import { formatDate } from '$lib/format';
  import { PortalApiError } from '../api';
  import type { PortalClient } from '../client';
  import type { ShipmentComment } from '../types';

  let {
    client,
    shipmentId,
    open,
    count = $bindable<number | null>(null),
  }: {
    client: PortalClient;
    shipmentId: string;
    open: boolean;
    count?: number | null;
  } = $props();

  let comments = $state<ShipmentComment[]>([]);
  let loaded = $state(false);
  let loading = $state(false);
  let draft = $state('');
  let sending = $state(false);
  let notice = $state('');
  let error = $state('');

  async function load() {
    if (loading) return;
    loading = true;
    try {
      comments = await client.get<ShipmentComment[]>(`/shipments/${shipmentId}/comments`);
      loaded = true;
      count = comments.length;
    } catch {
      comments = [];
    } finally {
      loading = false;
    }
  }

  async function submit() {
    const body = draft.trim();
    if (!body) return;
    notice = '';
    error = '';
    sending = true;
    try {
      await client.post(`/shipments/${shipmentId}/comments`, { body });
      draft = '';
      notice = 'Commentaire envoyé.';
      await load();
    } catch (e) {
      error = e instanceof PortalApiError ? e.message : "Échec de l'envoi";
    } finally {
      sending = false;
    }
  }

  // Lazy load: only fetch once the thread is first opened.
  $effect(() => {
    if (open && !loaded && !loading) void load();
  });
</script>

{#if open}
  <tr class="border-b border-edge last:border-0">
    <td colspan="4" class="py-2">
      {#if loading}
        <p class="text-xs text-ink-muted">Chargement…</p>
      {:else}
        {#if comments.length === 0}
          <p class="text-xs text-ink-muted">Aucun commentaire pour le moment.</p>
        {:else}
          <ul class="mb-3 flex flex-col gap-2">
            {#each comments as comment (comment.id)}
              <li class="rounded bg-surface-muted px-3 py-2">
                <div class="mb-1 flex items-center gap-2">
                  <span class="text-sm font-semibold text-ink">{comment.authorName}</span>
                  <Badge tone={comment.authorType === 'STAFF' ? 'info' : 'neutral'}>
                    {comment.authorType === 'STAFF' ? 'Équipe' : 'Client'}
                  </Badge>
                  <span class="text-xs text-ink-faint">{formatDate(comment.createdAt)}</span>
                </div>
                <p class="whitespace-pre-wrap text-sm text-ink">
                  {comment.body}
                </p>
              </li>
            {/each}
          </ul>
        {/if}

        {#if notice}
          <p class="mb-2 text-sm text-ok">{notice}</p>
        {/if}
        {#if error}
          <p class="mb-2 text-sm text-danger">
            {error}
          </p>
        {/if}

        <div class="flex flex-col gap-2">
          <Textarea bind:value={draft} rows={2} placeholder="Écrire un commentaire…" />
          <div class="flex justify-end">
            <Button
              type="button"
              loading={sending}
              disabled={!draft.trim()}
              onclick={() => submit()}
            >
              Envoyer
            </Button>
          </div>
        </div>
      {/if}
    </td>
  </tr>
{/if}
