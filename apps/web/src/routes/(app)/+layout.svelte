<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { MODULE_KEYS } from '@pulsar/shared';
  import { api } from '$lib/api/client';
  import { auth, clearAuth, getRefreshToken } from '$lib/stores/auth';

  let { children } = $props();

  // Client-side auth guard for every page in the (app) group.
  $effect(() => {
    if (!$auth) void goto('/login');
  });

  const hasTransportation = $derived(
    $auth?.tenant.enabledModules.includes(MODULE_KEYS.TRANSPORTATION) ?? false,
  );

  const coreNav = [{ href: '/dashboard', label: 'Dashboard' }];
  const tmsNav = [
    { href: '/transport-orders', label: 'Transport Orders' },
    { href: '/shipments', label: 'Shipments' },
    { href: '/loads', label: 'Loads' },
    { href: '/customers', label: 'Customers' },
    { href: '/carriers', label: 'Carriers' },
  ];
  const tmsAnalyticsNav = [{ href: '/analytics', label: 'Analytics' }];
  const adminNav = [{ href: '/settings/modules', label: 'Modules' }];

  function isActive(href: string): boolean {
    return page.url.pathname.startsWith(href);
  }

  function logout() {
    const refreshToken = getRefreshToken();
    if (refreshToken) {
      void api('/auth/logout', { method: 'POST', body: { refreshToken } }).catch(() => undefined);
    }
    clearAuth();
    void goto('/login');
  }
</script>

{#if $auth}
  <div class="shell">
    <aside class="sidebar">
      <div class="brand">
        <span class="brand-dot"></span>
        Pulsar
      </div>
      <div class="tenant-name">{$auth.tenant.name}</div>

      <nav>
        {#each coreNav as item (item.href)}
          <a href={item.href} class:active={isActive(item.href)}>{item.label}</a>
        {/each}

        {#if hasTransportation}
          <div class="nav-section">Transportation</div>
          {#each tmsNav as item (item.href)}
            <a href={item.href} class:active={isActive(item.href)}>{item.label}</a>
          {/each}
          {#each tmsAnalyticsNav as item (item.href)}
            <a href={item.href} class:active={isActive(item.href)}>{item.label}</a>
          {/each}
        {/if}

        <div class="nav-section">Administration</div>
        {#each adminNav as item (item.href)}
          <a href={item.href} class:active={isActive(item.href)}>{item.label}</a>
        {/each}
      </nav>

      <div class="sidebar-footer">
        <div class="user">
          {$auth.user.firstName}
          {$auth.user.lastName}
        </div>
        <button class="btn btn-secondary btn-sm" onclick={logout}>Sign out</button>
      </div>
    </aside>

    <main class="content">
      {@render children()}
    </main>
  </div>
{/if}

<style>
  .shell {
    display: grid;
    grid-template-columns: 230px 1fr;
    min-height: 100vh;
  }

  .sidebar {
    background: #0f172a;
    color: #cbd5e1;
    display: flex;
    flex-direction: column;
    padding: 20px 14px;
  }

  .brand {
    display: flex;
    align-items: center;
    gap: 8px;
    color: #fff;
    font-weight: 700;
    font-size: 1.1rem;
  }

  .brand-dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: #60a5fa;
  }

  .tenant-name {
    font-size: 11px;
    color: #64748b;
    margin: 4px 0 20px 18px;
  }

  nav {
    display: flex;
    flex-direction: column;
    gap: 2px;
    flex: 1;
  }

  nav a {
    color: #cbd5e1;
    padding: 8px 10px;
    border-radius: 6px;
    font-size: 13px;
  }

  nav a:hover {
    background: #1e293b;
  }

  nav a.active {
    background: #1d4ed8;
    color: #fff;
  }

  .nav-section {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: #64748b;
    margin: 16px 10px 4px;
  }

  .sidebar-footer {
    border-top: 1px solid #1e293b;
    padding-top: 12px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }

  .user {
    font-size: 12px;
  }

  .content {
    padding: 28px 32px;
    max-width: 1200px;
  }
</style>
