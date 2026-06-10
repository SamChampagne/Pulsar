<script lang="ts">
  let { status }: { status: string } = $props();

  const variants: Record<string, string> = {
    DRAFT: 'badge-muted',
    OPEN: 'badge-muted',
    PENDING: 'badge-muted',
    CONFIRMED: 'badge',
    PLANNED: 'badge',
    TENDERED: 'badge-warning',
    ACCEPTED: 'badge-success',
    DECLINED: 'badge-danger',
    EXPIRED: 'badge-muted',
    DISPATCHED: 'badge-warning',
    IN_EXECUTION: 'badge-warning',
    IN_TRANSIT: 'badge-warning',
    DELIVERED: 'badge-success',
    COMPLETED: 'badge-success',
    ACTIVE: 'badge-success',
    CLOSED: 'badge-muted',
    CANCELLED: 'badge-danger',
    INACTIVE: 'badge-danger',
  };
</script>

<span class="badge {variants[status] ?? 'badge-muted'}">{status.replaceAll('_', ' ')}</span>
