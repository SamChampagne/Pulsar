<script lang="ts">
  import MasterDataEdit from '$lib/components/transportation/MasterDataEdit.svelte';
  import { page } from '$app/state';
  import type { Paginated } from '@pulsar/shared';
  import { MODULE_KEYS, PERMISSIONS, PortalUserRole } from '@pulsar/shared';
  import { api, ApiError } from '$lib/api/client';
  import { auth } from '$lib/stores/auth';
  import { toast } from '$lib/stores/toast';
  import { confirmAction } from '$lib/stores/confirmation';
  import { formatDate, formatDateTime } from '$lib/format';
  import {
    Badge,
    Card,
    PageHeader,
    ErrorNotice,
    Skeleton,
    toneFor,
    labelFor,
    Table,
    Button,
    Modal,
    Field,
    Input,
    Select,
  } from '$lib/components/ui';

  interface CustomerDetail {
    id: string;
    code: string;
    name: string;
    contactName: string | null;
    email: string | null;
    phone: string | null;
    isActive: boolean;
    createdAt: string;
    locations: { id: string; code: string; name: string; city: string }[];
  }

  interface OrderRow {
    id: string;
    orderNumber: string;
    status: string;
    createdAt: string;
    customer: { id: string; code: string; name: string };
    originLocation: { id: string; code: string; name: string; city: string };
    destinationLocation: { id: string; code: string; name: string; city: string };
    shipments: { id: string }[];
  }

  interface PortalUserRow {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    role: 'ADMIN' | 'MEMBER';
    status: 'INVITED' | 'ACTIVE' | 'DISABLED';
    lastLoginAt: string | null;
    createdAt: string;
    invitation: { expiresAt: string; expired: boolean } | null;
  }

  const customerId = $derived(page.params.id);

  let customer = $state<CustomerDetail | null>(null);
  let orders = $state<OrderRow[]>([]);
  let error = $state('');
  let ordersError = $state('');

  // Portail client
  let portalUsers = $state<PortalUserRow[]>([]);
  let portalUsersError = $state('');
  let portalUsersLoading = $state(true);
  let portalInviteUrl = $state('');
  let showInvite = $state(false);
  let inviteForm = $state({
    email: '',
    firstName: '',
    lastName: '',
    role: PortalUserRole.MEMBER as string,
  });
  let inviteError = $state('');
  let inviteSaving = $state(false);

  const portalModuleEnabled = $derived(
    $auth?.tenant.enabledModules.includes(MODULE_KEYS.CUSTOMER_PORTAL) ?? false,
  );
  const canManagePortalUsers = $derived(
    ($auth?.user.permissions ?? []).includes(PERMISSIONS.CUSTOMER_PORTAL.USERS_MANAGE),
  );

  function fmtDate(v: string | null): string {
    return formatDate(v);
  }

  function fmtDateTime(v: string | null): string {
    return formatDateTime(v);
  }

  async function load() {
    error = '';
    ordersError = '';
    try {
      customer = await api<CustomerDetail>(`/transportation/customers/${customerId}`);
    } catch (e) {
      error = e instanceof ApiError ? e.message : `Échec du chargement du client — ${String(e)}`;
      return;
    }

    // Ordres de transport : recherche par nom de client (pas de filtre customerId
    // côté serveur), puis on ne garde que ceux qui appartiennent à ce client.
    try {
      const result = await api<Paginated<OrderRow>>('/transportation/transport-orders', {
        query: { pageSize: 100, search: customer.name },
      });
      orders = result.items.filter((o) => o.customer.id === customerId);
    } catch (e) {
      ordersError =
        e instanceof ApiError ? e.message : `Échec du chargement des commandes — ${String(e)}`;
      orders = [];
    }
  }

  async function loadPortalUsers() {
    if (!portalModuleEnabled) {
      portalUsersLoading = false;
      return;
    }
    portalUsersError = '';
    portalUsersLoading = true;
    try {
      portalUsers = await api<PortalUserRow[]>(`/customer-portal/customers/${customerId}/users`);
    } catch (e) {
      portalUsersError =
        e instanceof ApiError
          ? e.message
          : `Échec du chargement des utilisateurs du portail — ${String(e)}`;
      portalUsers = [];
    } finally {
      portalUsersLoading = false;
    }
  }

  function openInvite() {
    inviteForm = { email: '', firstName: '', lastName: '', role: PortalUserRole.MEMBER };
    inviteError = '';
    showInvite = true;
  }

  async function invite(event: SubmitEvent) {
    event.preventDefault();
    inviteError = '';
    inviteSaving = true;
    try {
      const created = await api<PortalUserRow & { inviteUrl?: string }>(
        `/customer-portal/customers/${customerId}/users`,
        {
          method: 'POST',
          body: {
            email: inviteForm.email,
            firstName: inviteForm.firstName,
            lastName: inviteForm.lastName,
            role: inviteForm.role,
          },
        },
      );
      portalInviteUrl = created.inviteUrl ?? '';
      toast.success(`Invitation envoyée à ${inviteForm.email}`);
      showInvite = false;
      await loadPortalUsers();
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : "Échec de l'invitation";
      inviteError = msg;
      toast.error(msg);
    } finally {
      inviteSaving = false;
    }
  }

  async function copyPortalInvite() {
    await navigator.clipboard.writeText(portalInviteUrl);
    toast.success("Lien d'invitation copié");
  }

  async function resendPortalInvitation(user: PortalUserRow) {
    try {
      const result = await api<{ inviteUrl: string }>(
        `/customer-portal/customers/${customerId}/users/${user.id}/resend-invitation`,
        { method: 'POST' },
      );
      portalInviteUrl = result.inviteUrl;
      toast.success(`Invitation renvoyée à ${user.email}`);
      await loadPortalUsers();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Échec du renvoi de l'invitation");
    }
  }

  async function deactivatePortalUser(user: PortalUserRow) {
    if (!(await confirmAction(`Désactiver ${user.email} ?`))) return;
    try {
      await api(`/customer-portal/customers/${customerId}/users/${user.id}`, {
        method: 'DELETE',
      });
      toast.success(`${user.email} désactivé`);
      await loadPortalUsers();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Échec de la désactivation');
    }
  }

  async function reactivatePortalUser(user: PortalUserRow) {
    try {
      const result = await api<PortalUserRow & { inviteUrl?: string }>(
        `/customer-portal/customers/${customerId}/users/${user.id}/reactivate`,
        { method: 'POST' },
      );
      if (result.inviteUrl) portalInviteUrl = result.inviteUrl;
      toast.success(`${user.email} réactivé`);
      await loadPortalUsers();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Échec de la réactivation');
    }
  }

  function invitationLabel(user: PortalUserRow): string {
    if (!user.invitation) return '';
    if (user.invitation.expired) return '';
    const ms = new Date(user.invitation.expiresAt).getTime() - Date.now();
    const hours = Math.max(0, Math.ceil(ms / (1000 * 60 * 60)));
    if (hours > 48) return `expire dans ${Math.ceil(hours / 24)}j`;
    return `expire dans ${hours}h`;
  }

  $effect(() => {
    if (customerId) void load();
  });

  $effect(() => {
    if (customerId) void loadPortalUsers();
  });
</script>

{#if error}
  <ErrorNotice message={error} onretry={load} />
{:else if customer}
  <PageHeader title={customer.name}>
    {#snippet actions()}
      <MasterDataEdit kind="customers" id={customerId!} onsaved={load} />
      <Badge tone={customer!.isActive ? 'ok' : 'danger'}>
        {customer!.isActive ? 'Actif' : 'Inactif'}
      </Badge>
    {/snippet}
  </PageHeader>

  <div class="grid gap-4 lg:grid-cols-3">
    <!-- Colonne gauche 2/3 -->
    <div class="flex flex-col gap-4 lg:col-span-2">
      <!-- Ordres de transport récents -->
      <Card>
        <h2 class="mb-3 font-semibold text-ink">Ordres de transport</h2>
        {#if ordersError}
          <ErrorNotice message={ordersError} onretry={load} />
        {:else if orders.length === 0}
          <p class="text-sm text-ink-muted">Aucun ordre de transport pour ce client.</p>
        {:else}
          <div class="overflow-x-auto">
            <table class="w-full text-sm">
              <thead>
                <tr class="border-b border-edge text-xs text-ink-muted uppercase tracking-wide">
                  <th class="pb-2 text-left font-semibold">N° d'ordre</th>
                  <th class="pb-2 text-left font-semibold">Statut</th>
                  <th class="pb-2 text-left font-semibold">Origine</th>
                  <th class="pb-2 text-left font-semibold">Destination</th>
                  <th class="pb-2 text-left font-semibold">Expéditions</th>
                  <th class="pb-2 text-left font-semibold">Créé le</th>
                </tr>
              </thead>
              <tbody>
                {#each orders as o (o.id)}
                  <tr class="border-b border-edge last:border-0 hover:bg-canvas/60">
                    <td class="py-2 pr-3">
                      <a
                        href={`/transport-orders/${o.id}`}
                        class="font-mono font-semibold text-accent hover:underline"
                      >
                        {o.orderNumber}
                      </a>
                    </td>
                    <td class="py-2 pr-3">
                      <Badge tone={toneFor(o.status)}>{labelFor(o.status)}</Badge>
                    </td>
                    <td class="py-2 pr-3 text-ink-muted">
                      {o.originLocation.city}
                    </td>
                    <td class="py-2 pr-3 text-ink-muted">
                      {o.destinationLocation.city}
                    </td>
                    <td class="py-2 pr-3 text-ink-muted">{o.shipments.length}</td>
                    <td class="py-2 text-ink-muted">{fmtDate(o.createdAt)}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        {/if}
      </Card>

      {#if portalModuleEnabled}
        <!-- Utilisateurs du portail -->
        <Card>
          <div class="mb-3 flex items-center justify-between gap-2">
            <h2 class="font-semibold text-ink">Utilisateurs du portail</h2>
            <div class="flex items-center gap-2">
              <a
                href="/customer-portal/requests"
                class="text-sm font-medium text-accent hover:underline"
              >
                Demandes du portail
              </a>
              {#if canManagePortalUsers}
                <Button onclick={openInvite}>Inviter un utilisateur</Button>
              {/if}
            </div>
          </div>

          {#if portalInviteUrl}
            <div class="mb-3 rounded-md border border-edge bg-surface-muted p-3">
              <div class="flex flex-wrap items-center gap-3">
                <div class="flex-1">
                  <p class="mb-1 text-xs font-semibold tracking-wide text-ink-muted uppercase">
                    Lien d'invitation
                  </p>
                  <code class="block break-all font-mono text-xs text-ink">{portalInviteUrl}</code>
                </div>
                <Button variant="secondary" onclick={copyPortalInvite}>Copier le lien</Button>
              </div>
            </div>
          {/if}

          {#if portalUsersError}
            <ErrorNotice message={portalUsersError} onretry={loadPortalUsers} />
          {:else if portalUsersLoading}
            <Skeleton rows={3} />
          {:else if portalUsers.length === 0}
            <p class="text-sm text-ink-muted">Aucun utilisateur du portail pour ce client.</p>
          {:else}
            <Table>
              {#snippet head()}
                <th>Courriel</th>
                <th>Nom</th>
                <th>Rôle</th>
                <th>Statut</th>
                <th>Dernière connexion</th>
                <th></th>
              {/snippet}
              {#snippet body()}
                {#each portalUsers as user (user.id)}
                  <tr>
                    <td class="font-semibold text-ink">{user.email}</td>
                    <td>{user.firstName} {user.lastName}</td>
                    <td class="text-ink-muted">
                      {user.role === 'ADMIN' ? 'Administrateur' : 'Membre'}
                    </td>
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
                    <td class="font-mono text-ink-muted">{fmtDateTime(user.lastLoginAt)}</td>
                    <td class="text-right whitespace-nowrap">
                      {#if canManagePortalUsers}
                        {#if user.status === 'INVITED'}
                          <Button
                            variant="secondary"
                            onclick={() => void resendPortalInvitation(user)}>Renvoyer</Button
                          >
                        {/if}
                        {#if user.status === 'DISABLED'}
                          <Button
                            variant="secondary"
                            onclick={() => void reactivatePortalUser(user)}>Réactiver</Button
                          >
                        {:else}
                          <Button variant="danger" onclick={() => void deactivatePortalUser(user)}
                            >Désactiver</Button
                          >
                        {/if}
                      {/if}
                    </td>
                  </tr>
                {/each}
              {/snippet}
            </Table>
          {/if}
        </Card>
      {/if}
    </div>

    <!-- Colonne droite 1/3 : résumé -->
    <div class="flex flex-col gap-4">
      <Card>
        <h2 class="mb-3 font-semibold text-ink">Détails</h2>
        <dl class="flex flex-col gap-2 text-sm">
          <div class="flex items-center justify-between gap-2">
            <dt class="text-ink-muted shrink-0">Code</dt>
            <dd class="font-mono font-semibold">{customer.code}</dd>
          </div>
          {#if customer.contactName}
            <div class="flex items-center justify-between gap-2">
              <dt class="text-ink-muted">Contact</dt>
              <dd class="font-medium">{customer.contactName}</dd>
            </div>
          {/if}
          {#if customer.email}
            <div class="flex items-center justify-between gap-2">
              <dt class="text-ink-muted">Courriel</dt>
              <dd class="font-medium">{customer.email}</dd>
            </div>
          {/if}
          {#if customer.phone}
            <div class="flex items-center justify-between gap-2">
              <dt class="text-ink-muted">Téléphone</dt>
              <dd class="font-mono">{customer.phone}</dd>
            </div>
          {/if}
          <div class="flex items-center justify-between gap-2">
            <dt class="text-ink-muted">Lieux</dt>
            <dd class="font-medium">{customer.locations.length}</dd>
          </div>
          <div class="flex items-center justify-between gap-2">
            <dt class="text-ink-muted">Commandes</dt>
            <dd class="font-medium">{orders.length}</dd>
          </div>
          <div class="flex items-center justify-between gap-2">
            <dt class="text-ink-muted">Depuis</dt>
            <dd class="font-medium">{fmtDate(customer.createdAt)}</dd>
          </div>
        </dl>
      </Card>

      {#if customer.locations.length > 0}
        <Card>
          <h2 class="mb-3 font-semibold text-ink">Lieux ({customer.locations.length})</h2>
          <ul class="flex flex-col gap-1 text-sm">
            {#each customer.locations as loc (loc.id)}
              <li class="flex items-center justify-between gap-2">
                <span class="font-mono text-xs text-ink-muted">{loc.code}</span>
                <span class="text-ink">{loc.name}, {loc.city}</span>
              </li>
            {/each}
          </ul>
        </Card>
      {/if}
    </div>
  </div>
{:else}
  <Card padded={false}><div class="p-4"><Skeleton rows={6} /></div></Card>
{/if}

<Modal bind:open={showInvite} title="Inviter un utilisateur du portail" size="md">
  {#snippet children()}
    <form onsubmit={invite} class="space-y-3">
      {#if inviteError}<p class="text-sm text-danger">{inviteError}</p>{/if}
      <p class="text-sm text-ink-muted">
        L'utilisateur reçoit un courriel contenant un lien pour définir son mot de passe (valide 72
        h). Le lien s'affiche aussi ici pour que vous puissiez le transmettre vous-même.
      </p>
      <Field label="Courriel">
        <Input type="email" bind:value={inviteForm.email} required />
      </Field>
      <Field label="Prénom">
        <Input bind:value={inviteForm.firstName} required />
      </Field>
      <Field label="Nom">
        <Input bind:value={inviteForm.lastName} required />
      </Field>
      <Field label="Rôle">
        <Select bind:value={inviteForm.role}>
          <option value={PortalUserRole.MEMBER}>Membre</option>
          <option value={PortalUserRole.ADMIN}>Administrateur</option>
        </Select>
      </Field>
      <div class="flex justify-end gap-2 border-t border-edge pt-3">
        <Button
          variant="secondary"
          onclick={() => {
            showInvite = false;
          }}>Annuler</Button
        >
        <Button variant="primary" type="submit" loading={inviteSaving}>Envoyer l'invitation</Button>
      </div>
    </form>
  {/snippet}
</Modal>
