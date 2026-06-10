<script lang="ts">
  import type { Paginated } from '@pulsar/shared';
  import { api, ApiError } from '$lib/api/client';
  import StatusBadge from '$lib/components/StatusBadge.svelte';
  import { toast } from '$lib/stores/toast';

  interface UserRow {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    status: string;
    lastLoginAt: string | null;
    roles: { role: { id: string; key: string; name: string } }[];
  }

  interface RoleOption {
    id: string;
    name: string;
  }

  let users = $state<UserRow[]>([]);
  let roles = $state<RoleOption[]>([]);
  let error = $state('');
  let showForm = $state(false);
  let inviteUrl = $state('');
  let form = $state({ email: '', firstName: '', lastName: '', roleIds: [] as string[] });

  async function load() {
    try {
      const [usersResult, rolesResult] = await Promise.all([
        api<Paginated<UserRow>>('/users', { query: { pageSize: 100 } }),
        api<RoleOption[]>('/roles'),
      ]);
      users = usersResult.items;
      roles = rolesResult;
    } catch (e) {
      error = e instanceof ApiError ? e.message : 'Failed to load users';
    }
  }

  function toggleRole(id: string) {
    form.roleIds = form.roleIds.includes(id)
      ? form.roleIds.filter((r) => r !== id)
      : [...form.roleIds, id];
  }

  async function invite(event: SubmitEvent) {
    event.preventDefault();
    try {
      const created = await api<UserRow & { inviteUrl?: string }>('/users', {
        method: 'POST',
        body: {
          email: form.email,
          firstName: form.firstName,
          lastName: form.lastName,
          roleIds: form.roleIds.length > 0 ? form.roleIds : undefined,
        },
      });
      inviteUrl = created.inviteUrl ?? '';
      toast.success(`Invitation sent to ${form.email}`);
      form = { email: '', firstName: '', lastName: '', roleIds: [] };
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to invite');
    }
  }

  async function copyInvite() {
    await navigator.clipboard.writeText(inviteUrl);
    toast.success('Invitation link copied');
  }

  async function deactivate(user: UserRow) {
    try {
      await api(`/users/${user.id}`, { method: 'DELETE' });
      toast.success(`${user.email} deactivated`);
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to deactivate');
    }
  }

  $effect(() => {
    void load();
  });
</script>

<div class="page-header">
  <h1>Users</h1>
  <button class="btn" onclick={() => (showForm = !showForm)}>Invite user</button>
</div>

{#if error}
  <p class="error-text">{error}</p>
{/if}

{#if showForm}
  <form class="card" style="margin-bottom: 20px;" onsubmit={invite}>
    <h2 style="margin-top: 0;">Invite a user</h2>
    <p class="muted">
      The user receives an email with a link to set their password (valid 72 h). The link is also
      shown here so you can forward it yourself.
    </p>
    <div class="form-grid">
      <div class="field">
        <label for="email">Email</label>
        <input id="email" type="email" bind:value={form.email} required />
      </div>
      <div class="field">
        <label for="firstName">First name</label>
        <input id="firstName" bind:value={form.firstName} required />
      </div>
      <div class="field">
        <label for="lastName">Last name</label>
        <input id="lastName" bind:value={form.lastName} required />
      </div>
    </div>
    <div class="field">
      <span class="muted" style="font-size: 12px; font-weight: 550;">Roles</span>
      <div class="roles-row">
        {#each roles as role (role.id)}
          <label class="role-check">
            <input
              type="checkbox"
              checked={form.roleIds.includes(role.id)}
              onchange={() => toggleRole(role.id)}
            />
            {role.name}
          </label>
        {/each}
      </div>
    </div>
    <div style="display: flex; gap: 8px;">
      <button class="btn" type="submit">Send invitation</button>
      <button class="btn btn-secondary" type="button" onclick={() => (showForm = false)}>
        Close
      </button>
    </div>
    {#if inviteUrl}
      <p style="margin-bottom: 0;">
        <button class="btn btn-secondary btn-sm" type="button" onclick={copyInvite}>
          Copy invitation link
        </button>
      </p>
    {/if}
  </form>
{/if}

<div class="card" style="padding: 0;">
  <table>
    <thead>
      <tr>
        <th>Email</th>
        <th>Name</th>
        <th>Roles</th>
        <th>Status</th>
        <th>Last login</th>
        <th></th>
      </tr>
    </thead>
    <tbody>
      {#each users as user (user.id)}
        <tr>
          <td><strong>{user.email}</strong></td>
          <td>{user.firstName} {user.lastName}</td>
          <td>{user.roles.map((r) => r.role.name).join(', ') || '—'}</td>
          <td><StatusBadge status={user.status} /></td>
          <td>{user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString() : '—'}</td>
          <td style="text-align: right;">
            {#if user.status !== 'DISABLED'}
              <button class="btn btn-danger btn-sm" onclick={() => deactivate(user)}>
                Deactivate
              </button>
            {/if}
          </td>
        </tr>
      {/each}
    </tbody>
  </table>
</div>

<style>
  .form-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 0 16px;
  }

  .roles-row {
    display: flex;
    gap: 16px;
    flex-wrap: wrap;
    margin-top: 6px;
  }

  .role-check {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 13px;
    color: var(--color-text);
  }

  .role-check input {
    width: auto;
  }
</style>
