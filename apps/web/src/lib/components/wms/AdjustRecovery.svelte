<script lang="ts">
  import { onMount } from 'svelte';
  import { auth } from '$lib/stores/auth';
  import { api } from '$lib/api/client';
  import { Button, ErrorNotice } from '$lib/components/ui';
  import { confirmAction } from '$lib/stores/confirmation';
  import {
    pendingAdjust,
    adjustStorageError,
    adjustScope,
    syncAdjustIntent,
    resolveAdjust,
  } from '$lib/wms/adjust-intent';
  let busy = $state(false),
    error = $state('');
  const canManage = $derived(!!$auth?.user.permissions.includes('wms.manage'));
  $effect(() => {
    $auth?.tenant.id;
    $auth?.user.id;
    syncAdjustIntent();
  });
  onMount(() => {
    const sync = () => syncAdjustIntent();
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  });
  async function recover() {
    const intent = $pendingAdjust;
    if (!intent || busy || !canManage) return;
    busy = true;
    error = '';
    try {
      if (
        !(await confirmAction(
          `Reprendre « ${intent.label} » ? La même clé et la même quantité seront envoyées. Un ajustement déjà enregistré ne sera pas appliqué deux fois.`,
          { title: 'Reprendre l’ajustement', confirmLabel: 'Vérifier et reprendre' },
        ))
      )
        return;
      if (adjustScope() !== intent.scope) throw new Error('La session a changé.');
      await api('/wms/inventory/adjust', { method: 'POST', body: intent.request });
      resolveAdjust(intent);
      window.dispatchEvent(new CustomEvent('wms:stock-changed'));
    } catch (e) {
      error = `${e instanceof Error ? e.message : 'Résultat non confirmé.'} La demande reste conservée. Ne recréez pas l’ajustement.`;
    } finally {
      busy = false;
    }
  }
</script>

{#if $pendingAdjust || $adjustStorageError}
  <aside
    class="mb-5 rounded-lg border border-warn/40 bg-surface-muted p-4"
    aria-label="Ajustement à vérifier"
  >
    <p class="text-sm font-semibold">Un ajustement attend confirmation</p>
    {#if $pendingAdjust}
      <p class="mt-1 break-words text-sm text-ink-muted">{$pendingAdjust.label}</p>
      <p class="mt-2 text-xs text-ink-muted">
        Demande conservée dans ce navigateur, même après rechargement. Aucune reprise automatique.
      </p>
      <div class="mt-3 flex flex-wrap gap-3">
        {#if canManage}<Button loading={busy} onclick={recover}>Vérifier et reprendre</Button>{/if}
        <Button
          variant="secondary"
          href={`/wms/movements?itemId=${encodeURIComponent($pendingAdjust.request.itemId)}`}
          >Consulter le journal</Button
        >
      </div>
    {/if}
    <ErrorNotice message={$adjustStorageError || error} />
  </aside>
{/if}
