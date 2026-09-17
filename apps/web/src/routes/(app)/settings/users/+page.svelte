<script lang="ts">
  import type { Paginated } from '@pulsar/shared';
  import { PERMISSIONS } from '@pulsar/shared';
  import { api, ApiError } from '$lib/api/client';
  import { auth } from '$lib/stores/auth';
  import { toast } from '$lib/stores/toast';
  import { confirmAction } from '$lib/stores/confirmation';
  import { formatDateTime } from '$lib/format';
  import {
    PageHeader,
    Button,
    Field,
    Input,
    Select,
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
    invitation: { expiresAt: string; expired: boolean } | null;
  }

  interface RoleOption {
    id: string;
    key: string;
    name: string;
  }

  let users = $state<UserRow[]>([]);
  let roles = $state<RoleOption[]>([]);
  let error = $state('');
  let showForm = $state(false);
  let loading = $state(true);
  let saving = $state(false);
  let inviteUrl = $state('');
  let statusFilter = $state('');
  let form = $state({ email: '', firstName: '', lastName: '', roleIds: [] as string[] });

  let editingUser = $state<UserRow | null>(null);
  let showEdit = $state(false);
  let editForm = $state({ firstName: '', lastName: '', roleIds: [] as string[] });
  let editError = $state('');
  let editSaving = $state(false);

  const canManage = $derived(
    ($auth?.user.permissions ?? []).includes(PERMISSIONS.CORE.USERS_MANAGE),
  );

  const hasLimitedRoles = $derived(roles.filter((r) => r.key !== 'admin').length > 0);

  const filteredUsers = $derived(
    statusFilter ? users.filter((u) => u.status === statusFilter) : users,
  );

  async function load() {
    try {
      const [usersResult, rolesResult] = await Promise.all([
        api<Paginated<UserRow>>('/users', { query: { pageSize: 100 } }),
        api<RoleOption[]>('/roles'),
      ]);
      users = usersResult.items;
      roles = rolesResult;
    } catch (e) {
      error = e instanceof ApiError ? e.message : 'Échec du chargement des utilisateurs';
    } finally {
      loading = false;
    }
  }

  function openNew() {
    form = { email: '', firstName: '', lastName: '', roleIds: [] };
    error = '';
    showForm = true;
  }

  function toggleRole(id: string) {
    form.roleIds = form.roleIds.includes(id)
      ? form.roleIds.filter((r) => r !== id)
      : [...form.roleIds, id];
  }

  function toggleEditRole(id: string) {
    editForm.roleIds = editForm.roleIds.includes(id)
      ? editForm.roleIds.filter((r) => r !== id)
      : [...editForm.roleIds, id];
  }

  async function invite(event: SubmitEvent) {
    event.preventDefault();
    error = '';
    saving = true;
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
      toast.success(`Invitation envoyée à ${form.email}`);
      form = { email: '', firstName: '', lastName: '', roleIds: [] };
      showForm = false;
      await load();
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : "Échec de l'invitation";
      error = msg;
      toast.error(msg);
    } finally {
      saving = false;
    }
  }

  async function copyInvite() {
    await navigator.clipboard.writeText(inviteUrl);
    toast.success("Lien d'invitation copié");
  }

  function openEdit(user: UserRow) {
    editingUser = user;
    editForm = {
      firstName: user.firstName,
      lastName: user.lastName,
      roleIds: user.roles.map((r) => r.role.id),
    };
    editError = '';
    showEdit = true;
  }

  function closeEdit() {
    showEdit = false;
    editingUser = null;
  }

  async function saveEdit(event: SubmitEvent) {
    event.preventDefault();
    if (!editingUser) return;
    editError = '';
    editSaving = true;
    try {
      await api(`/users/${editingUser.id}`, {
        method: 'PATCH',
        body: {
          firstName: editForm.firstName,
          lastName: editForm.lastName,
          roleIds: editForm.roleIds,
        },
      });
      toast.success('Utilisateur mis à jour');
      showEdit = false;
      editingUser = null;
      await load();
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : 'Échec de la mise à jour';
      editError = msg;
      toast.error(msg);
    } finally {
      editSaving = false;
    }
  }

  async function resendInvitation(user: UserRow) {
    try {
      const result = await api<{ inviteUrl: string }>(`/users/${user.id}/resend-invitation`, {
        method: 'POST',
      });
      inviteUrl = result.inviteUrl;
      toast.success(`Invitation renvoyée à ${user.email}`);
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Échec du renvoi de l'invitation");
    }
  }

  async function deactivate(user: UserRow) {
    if (!(await confirmAction(`Désactiver ${user.email} ?`))) return;
    try {
      await api(`/users/${user.id}`, { method: 'DELETE' });
      toast.success(`${user.email} désactivé`);
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Échec de la désactivation');
    }
  }

  async function reactivate(user: UserRow) {
    try {
      const result = await api<UserRow & { inviteUrl?: string }>(`/users/${user.id}/reactivate`, {
        method: 'POST',
      });
      if (result.inviteUrl) inviteUrl = result.inviteUrl;
      toast.success(`${user.email} réactivé`);
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Échec de la réactivation');
    }
  }

  function invitationLabel(user: UserRow): string {
    if (!user.invitation) return '';
    if (user.invitation.expired) return '';
    const ms = new Date(user.invitation.expiresAt).getTime() - Date.now();
    const hours = Math.max(0, Math.ceil(ms / (1000 * 60 * 60)));
    if (hours > 48) return `expire dans ${Math.ceil(hours / 24)}j`;
    return `expire dans ${hours}h`;
  }

  $effect(() => {
    void load();
  });
</script>

<PageHeader title="Utilisateurs" count={users.length}>
  {#snippet actions()}
    {#if canManage}
      <Button onclick={openNew}>Inviter un utilisateur</Button>
    {/if}
  {/snippet}
</PageHeader>

<p class="mb-1 text-sm text-ink-muted">
  Invitez vos collègues et attribuez-leur des rôles. L'invité reçoit un lien par courriel valide
  72 h.
</p>
<p class="mb-4 text-sm text-ink-muted">
  Les changements de rôle prennent effet à la prochaine reconnexion de l'utilisateur (au plus 15
  minutes).
</p>

{#if error && !showForm}<p class="mb-3 text-sm text-danger">{error}</p>{/if}

{#if inviteUrl}
  <Card>
    <div class="flex flex-wrap items-center gap-3">
      <div class="flex-1">
        <p class="mb-1 text-xs font-semibold tracking-wide text-ink-muted uppercase">
          Lien d'invitation
        </p>
        <code class="block break-all font-mono text-xs text-ink">{inviteUrl}</code>
      </div>
      <Button variant="secondary" onclick={copyInvite}>Copier le lien</Button>
    </div>
  </Card>
{/if}

<div class="mb-3 flex flex-wrap items-center gap-3">
  <div class="w-52">
    <Select bind:value={statusFilter} aria-label="Filtrer par statut">
      <option value="">Tous les statuts</option>
      <option value="ACTIVE">Actifs</option>
      <option value="INVITED">Invités</option>
      <option value="DISABLED">Désactivés</option>
    </Select>
  </div>
</div>

{#if loading}
  <Card padded={false}><Skeleton rows={6} /></Card>
{:else if filteredUsers.length === 0}
  <Card>
    <EmptyState message="Aucun utilisateur pour le moment.">
      {#snippet children()}
        {#if canManage}
          <Button onclick={openNew}>Inviter un utilisateur</Button>
        {/if}
      {/snippet}
    </EmptyState>
  </Card>
{:else}
  <Table>
    {#snippet head()}
      <th>Courriel</th>
      <th>Nom</th>
      <th>Rôles</th>
      <th>Statut</th>
      <th>Dernière connexion</th>
      <th></th>
    {/snippet}
    {#snippet body()}
      {#each filteredUsers as user (user.id)}
        <tr>
          <td class="font-semibold text-ink">{user.email}</td>
          <td>{user.firstName} {user.lastName}</td>
          <td class="text-ink-muted">{user.roles.map((r) => r.role.name).join(', ') || '—'}</td>
          <td>
            {#if user.status === 'ACTIVE'}
              <Badge tone="ok">Actif</Badge>
            {:else if user.status === 'INVITED'}
              {#if user.invitation?.expired}
                <Badge tone="danger">Invitation expirée</Badge>
              {:else if user.invitation}
                <Badge tone="warn">Invité · {invitationLabel(user)}</Badge>
              {:else}
                <Badge tone="warn">Invité</Badge>
              {/if}
            {:else if user.status === 'DISABLED'}
              <Badge tone="neutral">Désactivé</Badge>
            {:else}
              <Badge tone="neutral">{user.status}</Badge>
            {/if}
          </td>
          <td class="font-mono text-ink-muted">{formatDateTime(user.lastLoginAt)}</td>
          <td class="text-right whitespace-nowrap">
            {#if canManage}
              <Button variant="secondary" onclick={(e) => { e.stopPropagation(); openEdit(user); }}
                >Modifier</Button
              >
              {#if user.status === 'INVITED'}
                <Button
                  variant="secondary"
                  onclick={(e) => { e.stopPropagation(); void resendInvitation(user); }}
                  >Renvoyer l'invitation</Button
                >
              {/if}
              {#if user.status === 'DISABLED'}
                <Button
                  variant="secondary"
                  onclick={(e) => { e.stopPropagation(); void reactivate(user); }}
                  >Réactiver</Button
                >
              {:else}
                <span
                  title={user.id === $auth?.user.id
                    ? 'Vous ne pouvez pas désactiver votre propre compte'
                    : undefined}
                >
                  <Button
                    variant="danger"
                    disabled={user.id === $auth?.user.id}
                    onclick={(e) => { e.stopPropagation(); void deactivate(user); }}
                    >Désactiver</Button
                  >
                </span>
              {/if}
            {/if}
          </td>
        </tr>
      {/each}
    {/snippet}
  </Table>
{/if}

<Modal bind:open={showForm} title="Inviter un utilisateur" size="md">
  {#snippet children()}
    <form onsubmit={invite} class="space-y-3">
      {#if error}<p class="text-sm text-danger">{error}</p>{/if}
      <p class="text-sm text-ink-muted">
        L'utilisateur reçoit un courriel contenant un lien pour définir son mot de passe (valide
        72 h). Le lien s'affiche aussi ici pour que vous puissiez le transmettre vous-même.
      </p>
      <Field label="Courriel">
        <Input type="email" bind:value={form.email} required />
      </Field>
      <Field label="Prénom">
        <Input bind:value={form.firstName} required />
      </Field>
      <Field label="Nom">
        <Input bind:value={form.lastName} required />
      </Field>
      {#if roles.length > 0}
        <div>
          <span class="mb-1.5 block text-xs font-semibold tracking-wide text-ink-muted uppercase">Rôles</span>
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
      {#if !hasLimitedRoles}
        <p class="text-xs text-ink-muted">
          Aucun rôle limité n'existe encore — créez-en dans
          <a href="/settings/roles" class="text-accent hover:underline">Rôles</a>.
        </p>
      {/if}
      <div class="flex justify-end gap-2 border-t border-edge pt-3">
        <Button variant="secondary" onclick={() => { showForm = false; }}>Annuler</Button>
        <Button variant="primary" type="submit" loading={saving}>Envoyer l'invitation</Button>
      </div>
    </form>
  {/snippet}
</Modal>

<Modal bind:open={showEdit} onclose={closeEdit} title="Modifier l'utilisateur" size="md">
  {#snippet children()}
    {#if editingUser}
      <form onsubmit={saveEdit} class="space-y-3">
        {#if editError}<p class="text-sm text-danger">{editError}</p>{/if}
        <Field label="Prénom">
          <Input bind:value={editForm.firstName} required />
        </Field>
        <Field label="Nom">
          <Input bind:value={editForm.lastName} required />
        </Field>
        {#if roles.length > 0}
          <div>
            <span class="mb-1.5 block text-xs font-semibold tracking-wide text-ink-muted uppercase">Rôles</span>
            <div class="flex flex-wrap gap-3">
              {#each roles as role (role.id)}
                <label class="flex cursor-pointer items-center gap-1.5 text-sm text-ink">
                  <input
                    type="checkbox"
                    checked={editForm.roleIds.includes(role.id)}
                    onchange={() => toggleEditRole(role.id)}
                  />
                  {role.name}
                </label>
              {/each}
            </div>
          </div>
        {/if}
        {#if !hasLimitedRoles}
          <p class="text-xs text-ink-muted">
            Aucun rôle limité n'existe encore — créez-en dans
            <a href="/settings/roles" class="text-accent hover:underline">Rôles</a>.
          </p>
        {/if}
        <div class="flex justify-end gap-2 border-t border-edge pt-3">
          <Button variant="secondary" onclick={closeEdit}>Annuler</Button>
          <Button variant="primary" type="submit" loading={editSaving}>Enregistrer</Button>
        </div>
      </form>
    {/if}
  {/snippet}
</Modal>
