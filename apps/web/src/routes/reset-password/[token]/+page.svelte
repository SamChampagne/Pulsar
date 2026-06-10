<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { api, ApiError } from '$lib/api/client';
  import { toast } from '$lib/stores/toast';

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

<div class="public-page">
  <form class="card public-card" onsubmit={submit}>
    <h1 style="margin-bottom: 4px;">Choose a password</h1>
    <p class="muted">This activates your account or replaces your previous password.</p>
    <div class="field">
      <label for="password">New password (min. 8 characters)</label>
      <input id="password" type="password" bind:value={password} required minlength="8" autocomplete="new-password" />
    </div>
    <div class="field">
      <label for="confirm">Confirm password</label>
      <input id="confirm" type="password" bind:value={confirm} required autocomplete="new-password" />
    </div>
    {#if error}
      <p class="error-text">{error}</p>
    {/if}
    <button class="btn" type="submit" disabled={loading} style="width: 100%; justify-content: center;">
      {loading ? 'Saving…' : 'Set password'}
    </button>
  </form>
</div>

<style>
  .public-page {
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .public-card {
    width: 380px;
    padding: 32px;
  }
</style>
