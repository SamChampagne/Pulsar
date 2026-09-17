<script lang="ts">
  import { goto } from '$app/navigation';
  import { PortalUserRole } from '@pulsar/shared';
  import {
    FileText,
    Folder,
    LayoutDashboard,
    MessageSquareWarning,
    Package,
    Star,
    Users,
  } from 'lucide-svelte';
  import { portalApi, PortalApiError } from '$lib/portal/api';
  import { sessionClient } from '$lib/portal/client';
  import PortalShell, { type PortalNavItem } from '$lib/portal/components/PortalShell.svelte';
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

  const nav = $derived<PortalNavItem[]>([
    {
      key: 'dashboard',
      label: 'Tableau de bord',
      href: '/portal/dashboard',
      icon: LayoutDashboard,
    },
    { key: 'orders', label: 'Commandes', href: '/portal/orders', icon: Package },
    { key: 'invoices', label: 'Factures', href: '/portal/invoices', icon: FileText },
    { key: 'documents', label: 'Documents', href: '/portal/documents', icon: Folder },
    { key: 'requests', label: 'Demandes', href: '/portal/requests', icon: MessageSquareWarning },
    { key: 'templates', label: 'Modèles', href: '/portal/templates', icon: Star },
    ...($portalSession?.user.role === PortalUserRole.ADMIN
      ? [{ key: 'users', label: 'Utilisateurs', href: '/portal/users', icon: Users }]
      : []),
  ]);

  async function loadView() {
    try {
      portalView.set(await client.get<PortalView>('/view'));
    } catch (e) {
      // A 401 already redirected to the login page inside `portalApi`.
      error = e instanceof PortalApiError ? e.message : 'Portail indisponible.';
    }
  }

  async function logout() {
    if (loggingOut) return;
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

{#if $portalSession}
  <PortalShell
    branding={$portalSession.branding}
    shipperName={$portalSession.shipper.name}
    customerName={$portalSession.customer.name}
    user={$portalSession.user}
    {nav}
    onLogout={logout}
  >
    {#if error}
      <p class="mb-4 text-sm text-danger" role="alert">{error}</p>
    {/if}
    {@render children()}
  </PortalShell>
{:else}
  <p class="p-6 text-sm text-ink-muted">Chargement…</p>
{/if}
