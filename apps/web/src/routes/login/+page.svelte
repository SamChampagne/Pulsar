<script lang="ts">
  import { goto } from '$app/navigation';
  import type { LoginResponse } from '@pulsar/shared';
  import { api, ApiError } from '$lib/api/client';
  import { setAuth } from '$lib/stores/auth';

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

<div class="login-page">
  <form class="card login-card" onsubmit={submit}>
    <div class="logo">
      <span class="logo-dot"></span>
      <span class="logo-text">Pulsar</span>
    </div>
    <p class="muted">Modular logistics platform</p>

    <div class="field">
      <label for="email">Email</label>
      <input id="email" type="email" bind:value={email} required autocomplete="email" />
    </div>
    <div class="field">
      <label for="password">Password</label>
      <input id="password" type="password" bind:value={password} required autocomplete="current-password" />
    </div>
    <div class="field">
      <label for="tenant">Tenant (optional)</label>
      <input id="tenant" type="text" bind:value={tenant} placeholder="acme" />
    </div>

    {#if error}
      <p class="error-text">{error}</p>
    {/if}

    <button class="btn" type="submit" disabled={loading} style="width: 100%; justify-content: center;">
      {loading ? 'Signing in…' : 'Sign in'}
    </button>
  </form>
</div>

<style>
  .login-page {
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .login-card {
    width: 360px;
    padding: 32px;
  }

  .logo {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .logo-dot {
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: var(--color-primary);
    box-shadow: 0 0 0 4px color-mix(in srgb, var(--color-primary) 20%, transparent);
  }

  .logo-text {
    font-size: 1.3rem;
    font-weight: 700;
  }
</style>
