<script lang="ts">
  let { children } = $props();
</script>

<div style="max-width: 960px; margin: 0 auto; padding: 24px;">
  <header style="display: flex; justify-content: space-between; margin-bottom: 24px;">
    <h2 style="margin: 0;">Pulsar — Platform</h2>
  </header>
  {@render children()}
</div>
