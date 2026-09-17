<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { PortalUserRole } from '@pulsar/shared';
  import PublicShell from '$lib/components/PublicShell.svelte';
  import { Button } from '$lib/components/ui';
  import { portalApi, PortalApiError } from '$lib/portal/api';
  import { sessionClient } from '$lib/portal/client';
  import {
    endPortalSession,
    portalSession,
    portalView,
    syncPortalSession,
  } from '$lib/portal/session';
  import type { PortalView } from '$lib/portal/types';

  let { children } = $props();

  let error = $state('');
  let loggingOut = $state(false);
  // Plain (non-reactive) latch: the guard and the single `/portal/view` fetch
  // must run once on entry, never re-trigger when the stores they write settle.
  let bootstrapped = false;

  const client = sessionClient();

  const links = $derived(
    [
      { href: '/portal/orders', label: 'Commandes' },
      { href: '/portal/invoices', label: 'Factures' },
      { href: '/portal/documents', label: 'Documents' },
      { href: '/portal/requests', label: 'Demandes' },
      ...($portalSession?.user.role === PortalUserRole.ADMIN
        ? [{ href: '/portal/users', label: 'Utilisateurs' }]
        : []),
    ].map((link) => ({ ...link, active: page.url.pathname === link.href })),
  );

  async function loadView() {
    try {
      portalView.set(await client.get<PortalView>('/view'));
    } catch (e) {
      // A 401 already redirected to the login page inside `portalApi`.
      error = e instanceof PortalApiError ? e.message : 'Portail indisponible.';
    }
  }

  async function logout() {
    loggingOut = true;
    const refreshToken = $portalSession?.refreshToken;
    if (refreshToken) {
      // Best-effort revocation: a dead network must never trap the session.
      await portalApi('/portal/auth/logout', { method: 'POST', body: { refreshToken } }).catch(
        () => undefined,
      );
    }
    endPortalSession();
    await goto('/portal/login');
  }

  $effect(() => {
    if (bootstrapped) return;
    bootstrapped = true;
    if (!syncPortalSession()) {
      void goto('/portal/login');
      return;
    }
    void loadView();
  });
</script>

<PublicShell maxWidth="max-w-4xl" brand={$portalSession?.branding}>
  {#if $portalSession}
    <p class="mb-1 text-sm text-ink-muted">Portail client · {$portalSession.shipper.name}</p>
    <div class="mb-4 flex flex-wrap items-center justify-between gap-2">
      <h1 class="text-xl font-bold text-ink">
        Bonjour {$portalSession.user.firstName} · {$portalSession.customer.name}
      </h1>
      <Button variant="ghost" onclick={logout} disabled={loggingOut}>Se déconnecter</Button>
    </div>

    <nav aria-label="Portail client" class="mb-6 overflow-x-auto border-b border-edge">
      <div class="flex w-max gap-4">
        {#each links as link (link.href)}
          <a
            href={link.href}
            aria-current={link.active ? 'page' : undefined}
            class={`shrink-0 pb-2 text-sm whitespace-nowrap transition-colors ${
              link.active
                ? 'border-b-2 border-accent font-semibold text-accent'
                : 'text-ink-muted hover:text-ink'
            }`}
          >
            {link.label}
          </a>
        {/each}
      </div>
    </nav>

    {#if error}
      <p class="mb-4 text-sm text-danger" role="alert">{error}</p>
    {/if}

    {@render children()}

    <p class="mt-6 text-center text-xs text-ink-faint">Powered by Pulsar</p>
  {:else}
    <p class="text-sm text-ink-muted">Chargement…</p>
  {/if}
</PublicShell>
