<script lang="ts">
  let props = $props();
</script>

<div class="rounded-card border border-edge bg-surface p-3 text-sm text-ink-faint">
  Side panel (stub){props.selectedLoad ? ` — ${props.selectedLoad.loadNumber}` : ''}
</div>
