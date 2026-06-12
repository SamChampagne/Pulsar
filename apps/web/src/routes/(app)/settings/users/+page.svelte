<script lang="ts">
  import type { Paginated } from '@pulsar/shared';
  import { api, ApiError } from '$lib/api/client';
  import { toast } from '$lib/stores/toast';
  import { formatDateTime } from '$lib/format';
  import {
    PageHeader,
    Button,
    Field,
    Input,
    Table,
    Badge,
    EmptyState,
    Card,
    Skeleton,
    Modal,
  } from '$lib/components/ui';

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
  let loading = $state(true);
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
    } finally {
      loading = false;
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
      showForm = false;
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

<PageHeader title="Users" count={users.length}>
  {#snippet actions()}
    <Button onclick={() => { showForm = true; inviteUrl = ''; }}>Invite user</Button>
  {/snippet}
</PageHeader>

<p class="mb-4 text-sm text-ink-muted">
  Invite team members and assign roles. Invited users receive an email link valid for 72 h.
</p>

{#if error}<p class="mb-3 text-sm text-danger">{error}</p>{/if}

{#if inviteUrl}
  <div class="mb-4 flex items-center gap-3 rounded-card border border-edge bg-surface p-3">
    <code class="flex-1 truncate text-xs text-ink-muted">{inviteUrl}</code>
    <Button variant="secondary" onclick={copyInvite}>Copy invitation link</Button>
  </div>
{/if}

{#if loading}
  <Card padded={false}><Skeleton rows={6} /></Card>
{:else}
  <Table>
    {#snippet head()}
      <th>Email</th>
      <th>Name</th>
      <th>Roles</th>
      <th>Status</th>
      <th>Last login</th>
      <th></th>
    {/snippet}
    {#snippet body()}
      {#each users as user (user.id)}
        <tr>
          <td class="font-semibold">{user.email}</td>
          <td>{user.firstName} {user.lastName}</td>
          <td class="text-ink-muted">{user.roles.map((r) => r.role.name).join(', ') || '—'}</td>
          <td>
            {#if user.status === 'ACTIVE'}
              <Badge tone="ok">Active</Badge>
            {:else if user.status === 'INVITED'}
              <Badge tone="warn">Invited</Badge>
            {:else if user.status === 'DISABLED'}
              <Badge tone="danger">Disabled</Badge>
            {:else}
              <Badge tone="neutral">{user.status}</Badge>
            {/if}
          </td>
          <td class="text-ink-muted">{formatDateTime(user.lastLoginAt)}</td>
          <td class="text-right">
            {#if user.status !== 'DISABLED'}
              <Button
                variant="danger"
                onclick={(e) => { e.stopPropagation(); void deactivate(user); }}
              >Deactivate</Button>
            {/if}
          </td>
        </tr>
      {:else}
        <tr>
          <td colspan={6}><EmptyState message="No users yet." /></td>
        </tr>
      {/each}
    {/snippet}
  </Table>
{/if}

<Modal bind:open={showForm} title="Invite a user">
  {#snippet children()}
    <form onsubmit={invite}>
      <p class="mb-3 text-sm text-ink-muted">
        The user receives an email with a link to set their password (valid 72 h). The link is also
        shown here so you can forward it yourself.
      </p>
      <div class="grid grid-cols-2 gap-x-4 gap-y-3">
        <div class="col-span-2">
          <Field label="Email">
            <Input type="email" bind:value={form.email} required />
          </Field>
        </div>
        <Field label="First name">
          <Input bind:value={form.firstName} required />
        </Field>
        <Field label="Last name">
          <Input bind:value={form.lastName} required />
        </Field>
      </div>
      {#if roles.length > 0}
        <div class="mt-3">
          <span class="mb-1.5 block text-xs font-semibold tracking-wide text-ink-muted uppercase">Roles</span>
          <div class="flex flex-wrap gap-3">
            {#each roles as role (role.id)}
              <label class="flex cursor-pointer items-center gap-1.5 text-sm text-ink">
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
      {/if}
      <div class="mt-4 flex justify-end gap-2 border-t border-edge pt-3">
        <Button variant="secondary" onclick={() => { showForm = false; }}>Cancel</Button>
        <Button variant="primary" type="submit">Send invitation</Button>
      </div>
    </form>
  {/snippet}
</Modal>
