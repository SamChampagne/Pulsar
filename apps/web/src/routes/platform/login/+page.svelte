<script lang="ts">
  import { goto } from '$app/navigation';
  import { platformApi, PlatformApiError, setPlatformToken } from '$lib/api/platform';

  let email = $state('');
  let password = $state('');
  let error = $state('');

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    error = '';
    try {
      const result = await platformApi<{ accessToken: string }>('/platform/auth/login', {
        method: 'POST',
        body: { email, password },
      });
      setPlatformToken(result.accessToken);
      void goto('/platform/tenants');
    } catch (e) {
      error = e instanceof PlatformApiError ? e.message : 'Login failed';
    }
  }
</script>

<div class="card" style="max-width: 360px; margin: 64px auto; padding: 24px;">
  <h1>Platform sign-in</h1>
  <form onsubmit={submit}>
    <label>Email <input type="email" bind:value={email} required /></label>
    <label>Password <input type="password" bind:value={password} required /></label>
    {#if error}<p class="error-text">{error}</p>{/if}
    <button class="btn" type="submit">Sign in</button>
  </form>
</div>
