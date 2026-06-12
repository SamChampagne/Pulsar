<script lang="ts">
  import { api } from '$lib/api/client';
  import PublicShell from '$lib/components/PublicShell.svelte';
  import { Button, Field, Input } from '$lib/components/ui';

  let email = $state('');
  let tenant = $state('');
  let sent = $state(false);
  let loading = $state(false);

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    loading = true;
    try {
      await api('/auth/forgot-password', {
        method: 'POST',
        body: { email, ...(tenant ? { tenant } : {}) },
      });
    } finally {
      // Always show the same outcome — the API never discloses whether the account exists.
      sent = true;
      loading = false;
    }
  }
</script>

<PublicShell title="Reset your password" subtitle="Enter your email and we will send you a reset link.">
  {#if sent}
    <p class="mb-4 text-sm text-ink-muted">
      If an account exists for <strong>{email}</strong>, a reset link is on its way. The link
      expires in 1 hour.
    </p>
    <a href="/login" class="text-sm text-accent hover:underline">← Back to sign in</a>
  {:else}
    <form onsubmit={submit} class="flex flex-col gap-4">
      <Field label="Email">
        <Input type="email" bind:value={email} required name="email" />
      </Field>
      <Field label="Tenant (optional)">
        <Input bind:value={tenant} placeholder="acme" name="tenant" />
      </Field>
      <Button type="submit" {loading} disabled={loading}>
        {loading ? 'Sending…' : 'Send reset link'}
      </Button>
    </form>
  {/if}
</PublicShell>
