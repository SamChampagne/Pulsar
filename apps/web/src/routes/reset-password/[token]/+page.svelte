<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { api, ApiError } from '$lib/api/client';
  import { toast } from '$lib/stores/toast';
  import PublicShell from '$lib/components/PublicShell.svelte';
  import { Button, Field, Input } from '$lib/components/ui';

  const token = $derived(page.params.token);

  let password = $state('');
  let confirm = $state('');
  let error = $state('');
  let loading = $state(false);

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    error = '';
    if (password !== confirm) {
      error = 'Passwords do not match';
      return;
    }
    loading = true;
    try {
      await api('/auth/reset-password', { method: 'POST', body: { token, password } });
      toast.success('Password set — you can sign in now');
      await goto('/login');
    } catch (e) {
      error = e instanceof ApiError ? e.message : 'This link is invalid or expired';
    } finally {
      loading = false;
    }
  }
</script>

<PublicShell title="Choose a password" subtitle="This activates your account or replaces your previous password.">
  <form onsubmit={submit} class="flex flex-col gap-4">
    <Field label="New password (min. 8 characters)">
      <Input type="password" bind:value={password} required name="password" minlength={8} />
    </Field>
    <Field label="Confirm password">
      <Input type="password" bind:value={confirm} required name="confirm" />
    </Field>
    {#if error}
      <p class="text-sm text-danger">{error}</p>
    {/if}
    <Button type="submit" {loading} disabled={loading}>
      {loading ? 'Saving…' : 'Set password'}
    </Button>
  </form>
</PublicShell>
