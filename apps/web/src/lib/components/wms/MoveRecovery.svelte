<script lang="ts">
  import { onMount } from 'svelte';
  import { auth } from '$lib/stores/auth';
  import { api } from '$lib/api/client';
  import { Button, ErrorNotice } from '$lib/components/ui';
  import { confirmAction } from '$lib/stores/confirmation';
  import {
    pendingMove,
    moveStorageError,
    moveScope,
    syncMoveIntent,
    resolveMove,
  } from '$lib/wms/move-intent';
  import { PERMISSIONS, type WmsMoveResult } from '@pulsar/shared';
  let busy = $state(false),
    error = $state('');
  const canManage = $derived(!!$auth?.user.permissions.includes(PERMISSIONS.WMS.MANAGE));
  $effect(() => {
    $auth?.tenant.id;
    $auth?.user.id;
    syncMoveIntent();
  });
  onMount(() => {
    const sync = () => syncMoveIntent();
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  });
  async function recover() {
    const intent = $pendingMove;
    if (!intent || busy || !canManage) return;
    busy = true;
    error = '';
    try {
      if (
        !(await confirmAction(
          `Reprendre « ${intent.label} » avec sa clé originale ? Si le déplacement existe déjà, aucun stock supplémentaire ne sera déplacé. Sinon, le serveur vérifiera puis exécutera cette demande exacte.`,
          { title: 'Reprendre le déplacement', confirmLabel: 'Vérifier et reprendre' },
        ))
      )
        return;
      if (moveScope() !== intent.scope) throw new Error('La session a changé.');
      await api<WmsMoveResult>('/wms/inventory/move', { method: 'POST', body: intent.request });
      resolveMove(intent);
      window.dispatchEvent(new CustomEvent('wms:stock-changed'));
    } catch (e) {
      error = `${e instanceof Error ? e.message : 'Résultat non confirmé.'} La demande reste conservée; ne recréez pas le déplacement.`;
    } finally {
      busy = false;
    }
  }
</script>

{#if $pendingMove || $moveStorageError}
  <aside
    class="mb-5 rounded-lg border border-warn/40 bg-surface-muted p-4"
    aria-label="Déplacement à vérifier"
  >
    <p class="text-sm font-semibold">Un déplacement attend confirmation</p>
    {#if $pendingMove}<p class="mt-1 break-words text-sm text-ink-muted">{$pendingMove.label}</p>
      <p class="mt-2 text-xs text-ink-muted">
        Demande conservée dans ce navigateur. Reprendre réutilise la même clé, même après un
        rechargement.
      </p>
      <div class="mt-3 flex flex-wrap gap-3">
        {#if canManage}<Button loading={busy} onclick={recover}>Vérifier et reprendre</Button>{/if}
        <Button
          variant="secondary"
          href={`/wms/movements?itemId=${encodeURIComponent($pendingMove.request.itemId)}`}
          >Consulter le journal</Button
        >
      </div>
    {/if}
    <ErrorNotice message={$moveStorageError || error} />
  </aside>
{/if}
