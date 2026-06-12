<script lang="ts">
  import { goto } from '$app/navigation';
  import { platformApi, PlatformApiError, setPlatformToken } from '$lib/api/platform';
  import PublicShell from '$lib/components/PublicShell.svelte';
  import { Badge, Button, Field, Input } from '$lib/components/ui';

  let email = $state('');
  let password = $state('');
  let error = $state('');
  let loading = $state(false);

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    error = '';
    loading = true;
    try {
      const result = await platformApi<{ accessToken: string }>('/platform/auth/login', {
        method: 'POST',
        body: { email, password },
      });
      setPlatformToken(result.accessToken);
      void goto('/platform/tenants');
    } catch (e) {
      error = e instanceof PlatformApiError ? e.message : 'Login failed';
    } finally {
      loading = false;
    }
  }
</script>

<PublicShell title="Platform sign-in">
  <div class="mb-4 flex justify-start">
    <Badge tone="danger">Platform admin</Badge>
  </div>

  <form onsubmit={submit} class="space-y-4">
    <Field label="Email">
      <Input type="email" bind:value={email} required placeholder="admin@example.com" />
    </Field>

    <Field label="Password">
      <Input type="password" bind:value={password} required placeholder="••••••••" />
    </Field>

    {#if error}
      <p class="text-sm text-danger">{error}</p>
    {/if}

    <Button type="submit" variant="primary" {loading} disabled={loading}>
      Sign in
    </Button>
  </form>
</PublicShell>
