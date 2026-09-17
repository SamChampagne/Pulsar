<script lang="ts">
  import { goto } from '$app/navigation';
  import { PortalUserRole, PortalUserStatus } from '@pulsar/shared';
  import { Badge, Button, Field, Input, Modal, Select, Table } from '$lib/components/ui';
  import { formatDate } from '$lib/format';
  import { PortalApiError } from '$lib/portal/api';
  import { sessionClient } from '$lib/portal/client';
  import { portalSession } from '$lib/portal/session';
  import { confirmAction } from '$lib/stores/confirmation';
  import { toast } from '$lib/stores/toast';

  /** Projection returned by `GET /portal/users` (no hash, no internal ids). */
  interface PortalUserRow {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    role: PortalUserRole;
    status: PortalUserStatus;
    lastLoginAt: string | null;
    createdAt: string;
    invitation: { expiresAt: string; expired: boolean } | null;
  }

  const client = sessionClient();

  let users = $state<PortalUserRow[]>([]);
  let loading = $state(true);
  let error = $state('');
  let busyId = $state('');

  let showInvite = $state(false);
  let inviting = $state(false);
  let inviteError = $state('');
  let invite = $state({
    email: '',
    firstName: '',
    lastName: '',
    role: PortalUserRole.MEMBER as string,
  });
  // Shown after an invite or a resend so an admin can forward the link by hand
  // (the invitation email is also queued server-side).
  let inviteLink = $state('');

  const selfId = $derived($portalSession?.user.id ?? '');
  let bootstrapped = false;

  function message(e: unknown, fallback: string): string {
    return e instanceof PortalApiError ? e.message : fallback;
  }

  async function load() {
    loading = true;
    error = '';
    try {
      users = await client.get<PortalUserRow[]>('/users');
    } catch (e) {
      error = message(e, 'Impossible de charger les comptes.');
    } finally {
      loading = false;
    }
  }

  async function submitInvite(event?: SubmitEvent) {
    event?.preventDefault();
    inviteError = '';
    inviting = true;
    try {
      const created = await client.post<PortalUserRow & { inviteUrl: string }>('/users', {
        email: invite.email.trim(),
        firstName: invite.firstName.trim(),
        lastName: invite.lastName.trim(),
        role: invite.role,
      });
      inviteLink = created.inviteUrl;
      showInvite = false;
      invite = { email: '', firstName: '', lastName: '', role: PortalUserRole.MEMBER };
      toast.success('Invitation envoyée.');
      await load();
    } catch (e) {
      inviteError = message(e, "Échec de l'invitation.");
      toast.error(inviteError);
    } finally {
      inviting = false;
    }
  }

  async function resend(user: PortalUserRow) {
    busyId = user.id;
    error = '';
    try {
      const { inviteUrl } = await client.post<{ inviteUrl: string }>(
        `/users/${user.id}/resend-invitation`,
      );
      inviteLink = inviteUrl;
      toast.success('Invitation renvoyée.');
      await load();
    } catch (e) {
      error = message(e, "Échec de l'envoi.");
      toast.error(error);
    } finally {
      busyId = '';
    }
  }

  async function deactivate(user: PortalUserRow) {
    if (!(await confirmAction(`Désactiver l’accès de ${user.email} ?`))) return;
    busyId = user.id;
    error = '';
    try {
      await client.del(`/users/${user.id}`);
      toast.success('Compte désactivé.');
      await load();
    } catch (e) {
      error = message(e, 'Échec de la désactivation.');
      toast.error(error);
    } finally {
      busyId = '';
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(inviteLink);
      toast.success('Lien copié.');
    } catch {
      toast.error('Copie impossible — sélectionnez le lien manuellement.');
    }
  }

  function statusBadge(user: PortalUserRow): {
    tone: 'ok' | 'warn' | 'danger' | 'neutral';
    label: string;
  } {
    if (user.status === PortalUserStatus.ACTIVE) return { tone: 'ok', label: 'Actif' };
    if (user.status === PortalUserStatus.DISABLED) return { tone: 'neutral', label: 'Désactivé' };
    return user.invitation?.expired
      ? { tone: 'danger', label: 'Invitation expirée' }
      : { tone: 'warn', label: 'Invitation en attente' };
  }

  // Colleague management is ADMIN-only (the API answers 403 to a MEMBER);
  // the page bounces rather than showing a wall of errors.
  $effect(() => {
    if (bootstrapped) return;
    const session = $portalSession;
    if (!session) return;
    bootstrapped = true;
    if (session.user.role !== PortalUserRole.ADMIN) {
      void goto('/portal/dashboard');
      return;
    }
    void load();
  });
</script>

<div class="mb-4 flex flex-wrap items-center justify-between gap-2">
  <h2 class="text-sm font-bold text-ink">Comptes de votre entreprise</h2>
  <Button
    onclick={() => {
      inviteError = '';
      showInvite = true;
    }}>Inviter un collègue</Button
  >
</div>

{#if inviteLink}
  <div class="mb-4 rounded-card border border-edge bg-surface-muted p-3" role="status">
    <p class="mb-1 text-xs text-ink-muted">Lien d’activation (valide 72 heures) :</p>
    <p class="break-all font-mono text-xs text-ink">{inviteLink}</p>
    <div class="mt-2 flex gap-2">
      <Button variant="secondary" onclick={copyLink}>Copier le lien</Button>
      <Button
        variant="ghost"
        onclick={() => {
          inviteLink = '';
        }}>Masquer</Button
      >
    </div>
  </div>
{/if}

{#if error}
  <p class="mb-4 text-sm text-danger" role="alert">{error}</p>
{/if}

{#if loading}
  <p class="text-sm text-ink-muted">Chargement…</p>
{:else if users.length === 0}
  <p class="text-sm text-ink-muted">Aucun compte pour l’instant.</p>
{:else}
  <Table>
    {#snippet head()}
      <th>Nom</th>
      <th>Courriel</th>
      <th>Rôle</th>
      <th>Statut</th>
      <th>Dernière connexion</th>
      <th><span class="sr-only">Actions</span></th>
    {/snippet}
    {#snippet body()}
      {#each users as user (user.id)}
        {@const badge = statusBadge(user)}
        <tr>
          <td class="text-ink">{user.firstName} {user.lastName}</td>
          <td class="text-ink-muted">{user.email}</td>
          <td class="text-ink-muted">
            {user.role === PortalUserRole.ADMIN ? 'Administrateur' : 'Membre'}
          </td>
          <td><Badge tone={badge.tone}>{badge.label}</Badge></td>
          <td class="text-ink-muted">{formatDate(user.lastLoginAt)}</td>
          <td>
            <div class="flex flex-wrap justify-end gap-2">
              {#if user.status === PortalUserStatus.INVITED}
                <Button
                  variant="secondary"
                  disabled={busyId === user.id}
                  onclick={() => resend(user)}
                >
                  Renvoyer l’invitation
                </Button>
              {/if}
              {#if user.status !== PortalUserStatus.DISABLED}
                <span
                  title={user.id === selfId
                    ? 'Vous ne pouvez pas désactiver votre compte'
                    : undefined}
                >
                  <Button
                    variant="danger"
                    disabled={busyId === user.id || user.id === selfId}
                    onclick={() => deactivate(user)}
                  >
                    Désactiver
                  </Button>
                </span>
              {/if}
            </div>
          </td>
        </tr>
      {/each}
    {/snippet}
  </Table>
{/if}

<Modal bind:open={showInvite} title="Inviter un collègue" size="sm">
  <form id="portal-invite-form" onsubmit={submitInvite} class="flex flex-col gap-4">
    <Field label="Courriel">
      <Input type="email" bind:value={invite.email} required name="email" aria-label="Courriel" />
    </Field>
    <Field label="Prénom">
      <Input bind:value={invite.firstName} required name="firstName" aria-label="Prénom" />
    </Field>
    <Field label="Nom">
      <Input bind:value={invite.lastName} required name="lastName" aria-label="Nom" />
    </Field>
    <Field label="Rôle">
      <Select bind:value={invite.role} name="role" aria-label="Rôle">
        <option value={PortalUserRole.MEMBER}>Membre</option>
        <option value={PortalUserRole.ADMIN}>Administrateur</option>
      </Select>
    </Field>
    {#if inviteError}
      <p class="text-sm text-danger" role="alert">{inviteError}</p>
    {/if}
  </form>
  {#snippet footer()}
    <Button
      variant="secondary"
      onclick={() => {
        showInvite = false;
      }}
      disabled={inviting}
    >
      Annuler
    </Button>
    <Button onclick={() => submitInvite()} loading={inviting} disabled={inviting}>
      Envoyer l’invitation
    </Button>
  {/snippet}
</Modal>
