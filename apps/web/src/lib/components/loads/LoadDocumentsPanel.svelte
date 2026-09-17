<script lang="ts">
  import { Button, Card } from '$lib/components/ui';
  import { api, ApiError } from '$lib/api/client';
  import { toast } from '$lib/stores/toast';
  import { formatDateTime } from '$lib/format';
  import type { LoadDocument } from './types';

  interface Props {
    loadId: string;
    documents: LoadDocument[];
    canBol: boolean;
    onDocumentsChange: (docs: LoadDocument[]) => void;
  }

  const { loadId, documents, canBol, onDocumentsChange }: Props = $props();

  async function generateBol() {
    try {
      await api(`/transportation/loads/${loadId}/bol`, { method: 'POST' });
      toast.success('BOL generated');
      const updated = await api<LoadDocument[]>(`/transportation/loads/${loadId}/documents`);
      onDocumentsChange(updated);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to generate BOL');
    }
  }
</script>

<Card>
  <div class="mb-3 flex items-center justify-between">
    <h2 class="font-semibold text-ink">Documents</h2>
    {#if canBol}
      <Button variant="secondary" onclick={generateBol}>Generate BOL</Button>
    {/if}
  </div>
  {#if documents.length === 0}
    <p class="text-sm text-ink-muted">No documents yet.</p>
  {:else}
    <div class="overflow-x-auto">
      <table class="w-full text-sm">
        <thead>
          <tr class="border-b border-edge text-xs text-ink-muted uppercase tracking-wide">
            <th class="pb-2 text-left font-semibold">File</th>
            <th class="pb-2 text-left font-semibold">Date</th>
            <th class="pb-2"></th>
          </tr>
        </thead>
        <tbody>
          {#each documents as doc (doc.id)}
            <tr class="border-b border-edge last:border-0">
              <td class="py-2 pr-2">{doc.fileName}</td>
              <td class="py-2 pr-2 text-xs text-ink-muted">{formatDateTime(doc.createdAt)}</td>
              <td class="py-2 text-right">
                <a
                  href={`/api/v1/documents/${doc.id}/download`}
                  target="_blank"
                  class="inline-flex items-center justify-center gap-1.5 rounded-md border border-edge bg-surface px-3 py-1.5 text-sm font-medium text-ink transition-colors hover:bg-surface-muted"
                  >Download</a
                >
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</Card>
