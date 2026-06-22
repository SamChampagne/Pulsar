<script lang="ts">
  import { Button, Card } from '$lib/components/ui';
  import { api, ApiError } from '$lib/api/client';
  import { toast } from '$lib/stores/toast';
  import type { CatalogAccessorial } from './types';

  interface Props {
    loadId: string;
    loadStatus: string;
    accessorialCatalog: CatalogAccessorial[];
    accessorialChecked: Record<string, boolean>;
    accessorialQty: Record<string, number>;
    onCheckedChange: (checked: Record<string, boolean>) => void;
    onQtyChange: (qty: Record<string, number>) => void;
    onReload: () => Promise<void>;
  }

  const {
    loadId,
    loadStatus,
    accessorialCatalog,
    accessorialChecked,
    accessorialQty,
    onCheckedChange,
    onQtyChange,
    onReload,
  }: Props = $props();

  async function saveAccessorials() {
    try {
      const items = accessorialCatalog
        .filter((cat) => accessorialChecked[cat.id])
        .map((cat) => ({
          accessorialId: cat.id,
          quantity: cat.unit === 'FLAT' ? undefined : (accessorialQty[cat.id] ?? 1),
        }));
      await api(`/transportation/loads/${loadId}/accessorials`, {
        method: 'PUT',
        body: { items },
      });
      toast.success('Accessorials updated — cost recomputed');
      await onReload();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to update accessorials');
    }
  }
</script>

<Card>
  <h2 class="mb-3 font-semibold text-ink">Accessorials</h2>
  {#if accessorialCatalog.length === 0}
    <p class="text-sm text-ink-muted">No accessorials configured.</p>
  {:else}
    <div class="overflow-x-auto">
      <table class="w-full text-sm">
        <thead>
          <tr class="border-b border-edge text-xs text-ink-muted uppercase tracking-wide">
            <th class="pb-2"></th>
            <th class="pb-2 text-left font-semibold">Code</th>
            <th class="pb-2 text-left font-semibold">Name</th>
            <th class="pb-2 text-left font-semibold">Qty</th>
            <th class="pb-2 text-left font-semibold">Unit</th>
          </tr>
        </thead>
        <tbody>
          {#each accessorialCatalog as cat (cat.id)}
            <tr class="border-b border-edge last:border-0">
              <td class="py-2 pr-2">
                <input
                  type="checkbox"
                  checked={accessorialChecked[cat.id] ?? false}
                  disabled={loadStatus === 'COMPLETED' || loadStatus === 'CANCELLED'}
                  onchange={(e) => {
                    onCheckedChange({
                      ...accessorialChecked,
                      [cat.id]: (e.currentTarget as HTMLInputElement).checked,
                    });
                  }}
                />
              </td>
              <td class="py-2 pr-2 text-xs text-ink-muted">{cat.code}</td>
              <td class="py-2 pr-2">{cat.name}</td>
              <td class="py-2 pr-2">
                <input
                  type="number"
                  min="1"
                  class="w-16 rounded-md border border-edge bg-surface px-2 py-1 text-sm text-ink"
                  value={accessorialQty[cat.id] ?? 1}
                  disabled={cat.unit === 'FLAT' ||
                    !(accessorialChecked[cat.id] ?? false) ||
                    loadStatus === 'COMPLETED' ||
                    loadStatus === 'CANCELLED'}
                  oninput={(e) => {
                    const v = Number((e.currentTarget as HTMLInputElement).value);
                    if (!isNaN(v) && v > 0) {
                      onQtyChange({ ...accessorialQty, [cat.id]: v });
                    }
                  }}
                />
              </td>
              <td class="py-2 text-xs text-ink-muted">{cat.unit}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
    {#if loadStatus !== 'COMPLETED' && loadStatus !== 'CANCELLED'}
      <div class="mt-3">
        <Button variant="primary" onclick={saveAccessorials}>Save accessorials</Button>
      </div>
    {/if}
  {/if}
</Card>
