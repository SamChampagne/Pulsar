<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import type { LoginResponse } from '@pulsar/shared';
  import { setAuth } from '$lib/stores/auth';
  import PublicShell from '$lib/components/PublicShell.svelte';

  let error = $state('');

  $effect(() => {
    const code = page.url.searchParams.get('code');
    if (!code) {
      error = 'Missing exchange code';
      return;
    }

    // Strip the one-shot code from the address bar immediately so it never
    // sits in browser history or is replayed from the Back button.
    history.replaceState(null, '', '/oidc/complete');

    void (async () => {
      try {
        const res = await fetch('/api/v1/auth/oidc/exchange', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code }),
        });
        if (!res.ok) throw new Error('Exchange failed');
        setAuth((await res.json()) as LoginResponse);
        void goto('/dashboard');
      } catch {
        error = 'SSO sign-in failed — the link may have expired. Try again.';
      }
    })();
  });
</script>

<PublicShell>
  {#if error}
    <p class="text-sm text-danger">{error}</p>
  {:else}
    <p class="text-sm text-ink-muted">Signing you in…</p>
  {/if}
</PublicShell>
