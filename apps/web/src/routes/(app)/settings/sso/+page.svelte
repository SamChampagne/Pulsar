<script lang="ts">
  import { api, ApiError } from '$lib/api/client';
  import { toast } from '$lib/stores/toast';

  interface OidcConfigView {
    enabled: boolean;
    issuer: string;
    clientId: string;
    clientSecret: string;
    defaultRoleId: string;
  }
  interface RoleOption {
    id: string;
    name: string;
  }

  let config = $state<OidcConfigView>({
    enabled: false,
    issuer: '',
    clientId: '',
    clientSecret: '',
    defaultRoleId: '',
  });
  let roles = $state<RoleOption[]>([]);
  let error = $state('');

  async function load() {
    try {
      // GET /roles returns a plain array (not paginated)
      [config, roles] = await Promise.all([
        api<OidcConfigView>('/auth/oidc-config'),
        api<RoleOption[]>('/roles'),
      ]);
    } catch (e) {
      error = e instanceof ApiError ? e.message : 'Failed to load SSO config';
    }
  }

  async function save(event: SubmitEvent) {
    event.preventDefault();
    try {
      config = await api<OidcConfigView>('/auth/oidc-config', { method: 'PUT', body: config });
      toast.success('SSO configuration saved');
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to save');
    }
  }

  $effect(() => {
    void load();
  });
</script>

<div class="page-header"><h1>Single sign-on (OIDC)</h1></div>
{#if error}<p class="error-text">{error}</p>{/if}

<form class="card" style="padding: 16px; max-width: 560px;" onsubmit={save}>
  <label style="display: flex; gap: 8px; align-items: center;">
    <input type="checkbox" bind:checked={config.enabled} /> Enable SSO for this organization
  </label>
  <label>Issuer URL <input bind:value={config.issuer} placeholder="https://login.example.com" /></label>
  <label>Client ID <input bind:value={config.clientId} /></label>
  <label>
    Client secret
    <input bind:value={config.clientSecret} placeholder="*** (unchanged if left masked)" />
  </label>
  <label>
    Default role for provisioned users
    <select bind:value={config.defaultRoleId}>
      <option value="" disabled>Choose a role…</option>
      {#each roles as role (role.id)}<option value={role.id}>{role.name}</option>{/each}
    </select>
  </label>
  <button class="btn" type="submit">Save</button>
</form>
