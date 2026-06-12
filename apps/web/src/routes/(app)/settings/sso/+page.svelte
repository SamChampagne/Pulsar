<script lang="ts">
  import { api, ApiError } from '$lib/api/client';
  import { toast } from '$lib/stores/toast';
  import {
    PageHeader,
    Button,
    Field,
    Input,
    Select,
    Card,
    Skeleton,
  } from '$lib/components/ui';

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
  let loading = $state(true);

  async function load() {
    try {
      // GET /roles returns a plain array (not paginated)
      [config, roles] = await Promise.all([
        api<OidcConfigView>('/auth/oidc-config'),
        api<RoleOption[]>('/roles'),
      ]);
    } catch (e) {
      error = e instanceof ApiError ? e.message : 'Failed to load SSO config';
    } finally {
      loading = false;
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

<PageHeader title="Single sign-on (OIDC)" />

<p class="mb-4 text-sm text-ink-muted">
  Connect an OpenID Connect provider to let users sign in with your organisation's identity
  system.
</p>

{#if error}<p class="mb-3 text-sm text-danger">{error}</p>{/if}

{#if loading}
  <Card padded={false}><Skeleton rows={6} /></Card>
{:else}
  <form onsubmit={save} class="max-w-lg">
    <Card>
      <div class="space-y-3">
        <label class="flex cursor-pointer items-center gap-2 text-sm text-ink">
          <input type="checkbox" bind:checked={config.enabled} />
          Enable SSO for this organisation
        </label>
        <Field label="Issuer URL">
          <Input bind:value={config.issuer} placeholder="https://login.example.com" />
        </Field>
        <Field label="Client ID">
          <Input bind:value={config.clientId} />
        </Field>
        <Field label="Client secret">
          <Input
            bind:value={config.clientSecret}
            placeholder="*** (unchanged if left masked)"
          />
        </Field>
        <Field label="Default role for provisioned users">
          <Select bind:value={config.defaultRoleId}>
            <option value="" disabled>Choose a role…</option>
            {#each roles as role (role.id)}
              <option value={role.id}>{role.name}</option>
            {/each}
          </Select>
        </Field>
      </div>
      <div class="mt-4 flex justify-end border-t border-edge pt-3">
        <Button type="submit">Save</Button>
      </div>
    </Card>
  </form>
{/if}
