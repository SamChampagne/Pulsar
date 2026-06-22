<script lang="ts">
  import { Badge, Button, Card } from '$lib/components/ui';
  import { toneFor, labelFor } from '$lib/components/ui';
  import { toast } from '$lib/stores/toast';
  import type { TenderRow } from './types';

  interface Props {
    tender: TenderRow;
    onCopyLink: (text: string, label: string) => Promise<void>;
  }

  const { tender, onCopyLink }: Props = $props();
</script>

<Card>
  <h2 class="mb-3 font-semibold text-ink">Tender</h2>
  <div class="flex flex-wrap items-center gap-2 text-sm">
    <Badge tone={toneFor(tender.status)}>{labelFor(tender.status)}</Badge>
    <span>{tender.carrier.name}</span>
    <span class="text-ink-muted">expires {new Date(tender.expiresAt).toLocaleString()}</span>
  </div>
  {#if tender.declineReason}
    <p class="mt-2 text-sm text-danger">Declined: {tender.declineReason}</p>
  {/if}
  {#if tender.status === 'PENDING'}
    <div class="mt-3">
      <Button
        variant="secondary"
        onclick={() => onCopyLink(`${location.origin}/tender/${tender.token}`, 'Tender link')}
      >
        Copy carrier link
      </Button>
    </div>
  {/if}
</Card>
