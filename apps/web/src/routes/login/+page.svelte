<script lang="ts">
  import { goto } from '$app/navigation';
  import type { LoginResponse } from '@pulsar/shared';
  import { api, ApiError } from '$lib/api/client';
  import { setAuth } from '$lib/stores/auth';
  import PublicShell from '$lib/components/PublicShell.svelte';
  import { Button, Field, Input } from '$lib/components/ui';

  let email = $state('admin@pulsar.dev');
  let password = $state('');
  let tenant = $state('');
  let error = $state('');
  let loading = $state(false);

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    error = '';
    loading = true;
    try {
      const session = await api<LoginResponse>('/auth/login', {
        method: 'POST',
        body: { email, password, ...(tenant ? { tenant } : {}) },
      });
      setAuth(session);
      await goto('/dashboard');
    } catch (e) {
      error = e instanceof ApiError ? e.message : 'Unable to reach the API';
    } finally {
      loading = false;
    }
  }
</script>

<PublicShell title="Sign in" subtitle="Modular logistics platform">
  <form onsubmit={submit} class="flex flex-col gap-4">
    <Field label="Email">
      <Input type="email" bind:value={email} required name="email" />
    </Field>
    <Field label="Password">
      <Input type="password" bind:value={password} required name="password" />
    </Field>
    <Field label="Tenant (optional)">
      <Input bind:value={tenant} placeholder="acme" name="tenant" />
    </Field>

    {#if error}
      <p class="text-sm text-danger">{error}</p>
    {/if}

    <Button type="submit" {loading} disabled={loading}>
      {loading ? 'Signing in…' : 'Sign in'}
    </Button>

    {#if tenant}
      <a
        href={`/api/v1/auth/oidc/${tenant}`}
        class="block text-center text-sm text-ink-muted hover:text-ink"
      >
        Sign in with SSO ({tenant})
      </a>
    {/if}

    <p class="text-center">
      <a href="/forgot-password" class="text-xs text-ink-muted hover:text-ink">Forgot password?</a>
    </p>
  </form>
</PublicShell>
