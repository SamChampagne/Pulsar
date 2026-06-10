<script lang="ts">
  import { api } from '$lib/api/client';

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

<div class="public-page">
  <form class="card public-card" onsubmit={submit}>
    <h1 style="margin-bottom: 4px;">Reset your password</h1>
    {#if sent}
      <p class="muted">
        If an account exists for <strong>{email}</strong>, a reset link is on its way. The link
        expires in 1 hour.
      </p>
      <a href="/login">← Back to sign in</a>
    {:else}
      <p class="muted">Enter your email and we will send you a reset link.</p>
      <div class="field">
        <label for="email">Email</label>
        <input id="email" type="email" bind:value={email} required autocomplete="email" />
      </div>
      <div class="field">
        <label for="tenant">Tenant (optional)</label>
        <input id="tenant" bind:value={tenant} placeholder="acme" />
      </div>
      <button class="btn" type="submit" disabled={loading} style="width: 100%; justify-content: center;">
        {loading ? 'Sending…' : 'Send reset link'}
      </button>
    {/if}
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
