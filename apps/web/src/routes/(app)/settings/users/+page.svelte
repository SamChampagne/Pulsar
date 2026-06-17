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
  let saving = $state(false);
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

  async function deactivate(user: UserRow) {
    try {
      await api(`/users/${user.id}`, { method: 'DELETE' });
      toast.success(`${user.email} désactivé`);
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Échec de la désactivation');
    }
  }

  $effect(() => {
    void load();
  });
</script>

<PageHeader title="Utilisateurs" count={users.length}>
  {#snippet actions()}
    <Button onclick={openNew}>Inviter un utilisateur</Button>
  {/snippet}
</PageHeader>

<p class="mb-4 text-sm text-ink-muted">
  Invitez vos collègues et attribuez-leur des rôles. L'invité reçoit un lien par courriel valide
  72 h.
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

{#if loading}
  <Card padded={false}><Skeleton rows={6} /></Card>
{:else if users.length === 0}
  <Card>
    <EmptyState message="Aucun utilisateur pour le moment.">
      {#snippet children()}
        <Button onclick={openNew}>Inviter un utilisateur</Button>
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
      {#each users as user (user.id)}
        <tr>
          <td class="font-semibold text-ink">{user.email}</td>
          <td>{user.firstName} {user.lastName}</td>
          <td class="text-ink-muted">{user.roles.map((r) => r.role.name).join(', ') || '—'}</td>
          <td>
            {#if user.status === 'ACTIVE'}
              <Badge tone="ok">Actif</Badge>
            {:else if user.status === 'INVITED'}
              <Badge tone="warn">Invité</Badge>
            {:else if user.status === 'DISABLED'}
              <Badge tone="danger">Désactivé</Badge>
            {:else}
              <Badge tone="neutral">{user.status}</Badge>
            {/if}
          </td>
          <td class="font-mono text-ink-muted">{formatDateTime(user.lastLoginAt)}</td>
          <td class="text-right">
            {#if user.status !== 'DISABLED'}
              <Button
                variant="danger"
                onclick={(e) => { e.stopPropagation(); void deactivate(user); }}
              >Désactiver</Button>
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
      <div class="flex justify-end gap-2 border-t border-edge pt-3">
        <Button variant="secondary" onclick={() => { showForm = false; }}>Annuler</Button>
        <Button variant="primary" type="submit" loading={saving}>Envoyer l'invitation</Button>
      </div>
    </form>
  {/snippet}
</Modal>
