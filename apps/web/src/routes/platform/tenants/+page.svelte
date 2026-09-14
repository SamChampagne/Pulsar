<script lang="ts">
  import { goto } from '$app/navigation';
  import { MODULE_CATALOG, type PlatformTenantDiagnostics } from '@pulsar/shared';
  import { Drawer, ErrorNotice } from '$lib/components/ui';
  import ServiceStateBadge from '$lib/components/operations/ServiceStateBadge.svelte';
  import { getPlatformToken, platformApi, PlatformApiError } from '$lib/api/platform';
  import {
    Badge,
    Button,
    EmptyState,
    Field,
    Input,
    Modal,
    PageHeader,
    Skeleton,
    Table,
    toneFor,
    labelFor,
  } from '$lib/components/ui';

  interface TenantRow {
    id: string;
    slug: string;
    name: string;
    status: string;
    userCount: number;
    enabledModules: string[];
  }

  let tenants = $state<TenantRow[]>([]);
  let error = $state('');
  let inviteUrl = $state('');
  let showForm = $state(false);
  let loadingData = $state(true);
  let search = $state('');
  let statusFilter = $state('');
  let busy = $state(false);
  let statusTarget = $state<TenantRow | null>(null);
  let confirmStatus = $state(false);
  let diagnostic = $state<PlatformTenantDiagnostics | null>(null);
  let diagnosticOpen = $state(false);
  let diagnosticLoading = $state(false);
  let diagnosticError = $state('');
  let diagnosticRequest = 0;
  async function inspectTenant(id: string) {
    const request = ++diagnosticRequest;
    diagnostic = null;
    diagnosticOpen = true;
    diagnosticLoading = true;
    diagnosticError = '';
    try {
      const value = await platformApi<PlatformTenantDiagnostics>(
        `/platform/operations/tenants/${id}`,
      );
      if (request === diagnosticRequest) diagnostic = value;
    } catch {
      if (request === diagnosticRequest)
        diagnosticError = 'Impossible de lire le diagnostic de cette entreprise.';
    } finally {
      if (request === diagnosticRequest) diagnosticLoading = false;
    }
  }
  const filtered = $derived(
    tenants.filter(
      (t) =>
        (!statusFilter || t.status === statusFilter) &&
        `${t.name} ${t.slug}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()),
    ),
  );

  let slug = $state('');
  let name = $state('');
  let adminEmail = $state('');
  let adminFirstName = $state('');
  let adminLastName = $state('');
  let modules = $state<string[]>(['transportation']);
  const availableModules = MODULE_CATALOG.filter((m) => m.available && !m.isCore);

  async function load() {
    if (!getPlatformToken()) {
      void goto('/platform/login');
      return;
    }
    loadingData = true;
    error = '';
    try {
      tenants = await platformApi<TenantRow[]>('/platform/tenants');
    } catch (e) {
      error = e instanceof PlatformApiError ? e.message : 'Failed to load tenants';
    } finally {
      loadingData = false;
    }
  }

  async function createTenant(event: SubmitEvent) {
    event.preventDefault();
    if (busy) return;
    busy = true;
    error = '';
    try {
      const created = await platformApi<TenantRow & { inviteUrl: string }>('/platform/tenants', {
        method: 'POST',
        body: {
          slug,
          name,
          modules,
          admin: { email: adminEmail, firstName: adminFirstName, lastName: adminLastName },
        },
      });
      inviteUrl = created.inviteUrl;
      showForm = false;
      slug = '';
      name = '';
      adminEmail = '';
      adminFirstName = '';
      adminLastName = '';
      modules = ['transportation'];
      await load();
    } catch (e) {
      error = e instanceof PlatformApiError ? e.message : 'Failed to create tenant';
    } finally {
      busy = false;
    }
  }

  async function setStatus(tenant: TenantRow, action: 'suspend' | 'reactivate') {
    if (busy) return;
    busy = true;
    error = '';
    try {
      await platformApi(`/platform/tenants/${tenant.id}/${action}`, { method: 'POST' });
      confirmStatus = false;
      await load();
    } catch (e) {
      error = e instanceof PlatformApiError ? e.message : `Failed to ${action}`;
    } finally {
      busy = false;
    }
  }

  $effect(() => {
    void load();
  });
</script>

<svelte:head><title>Entreprises | Pulsar</title></svelte:head>
<div>
  <div>
    <PageHeader
      title="Entreprises"
      subtitle="Activation des espaces, modules et accès administrateur."
      count={loadingData ? undefined : filtered.length}
    >
      {#snippet actions()}
        <Button
          variant="primary"
          onclick={() => {
            error = '';
            showForm = true;
          }}>Nouvelle entreprise</Button
        >
      {/snippet}
    </PageHeader>
    <div class="mb-4 flex flex-wrap gap-3">
      <label class="flex flex-col gap-1 text-xs text-ink-muted"
        >Rechercher<input
          class="rounded-inner border border-edge bg-surface px-3 py-2 text-sm text-ink"
          bind:value={search}
          placeholder="Nom ou identifiant"
        /></label
      >
      <label class="flex flex-col gap-1 text-xs text-ink-muted"
        >Statut<select
          class="rounded-inner border border-edge bg-surface px-3 py-2 text-sm text-ink"
          bind:value={statusFilter}
          ><option value="">Tous</option><option value="ACTIVE">Actives</option><option
            value="TRIAL">Essai</option
          ><option value="SUSPENDED">Suspendues</option></select
        ></label
      >
    </div>

    {#if error}
      <p class="mb-4 text-sm text-danger">{error}</p>
    {/if}

    {#if inviteUrl}
      <div class="mb-4 rounded-card border border-ok bg-ok-soft p-4">
        <p class="mb-1 text-sm font-semibold text-ok">
          Entreprise créée. Lien d’invitation administrateur (livraison du courriel selon
          configuration) :
        </p>
        <code class="break-all text-xs text-ink">{inviteUrl}</code>
      </div>
    {/if}

    {#if loadingData}
      <Skeleton rows={5} />
    {:else}
      <Table>
        {#snippet head()}
          <th>Slug</th>
          <th>Nom</th>
          <th>Statut</th>
          <th>Utilisateurs</th>
          <th>Modules</th>
          <th></th>
        {/snippet}
        {#snippet body()}
          {#each filtered as tenant (tenant.id)}
            <tr>
              <td><span class="font-mono text-xs font-semibold text-ink">{tenant.slug}</span></td>
              <td class="font-medium text-ink"
                ><button
                  class="text-left text-accent hover:underline"
                  onclick={() => inspectTenant(tenant.id)}>{tenant.name}</button
                ></td
              >
              <td><Badge tone={toneFor(tenant.status)}>{labelFor(tenant.status)}</Badge></td>
              <td class="text-ink-muted">{tenant.userCount}</td>
              <td class="text-xs text-ink-muted">{tenant.enabledModules.join(', ')}</td>
              <td class="text-right">
                {#if tenant.status === 'SUSPENDED'}
                  <Button
                    variant="secondary"
                    onclick={() => {
                      statusTarget = tenant;
                      confirmStatus = true;
                    }}
                  >
                    Réactiver
                  </Button>
                {:else}
                  <Button
                    variant="ghost"
                    onclick={() => {
                      statusTarget = tenant;
                      confirmStatus = true;
                    }}
                  >
                    Suspendre
                  </Button>
                {/if}
              </td>
            </tr>
          {:else}
            <tr>
              <td colspan="6">
                <EmptyState
                  message={tenants.length
                    ? 'Aucune entreprise ne correspond aux filtres.'
                    : 'Créez votre première entreprise pour configurer ses modules.'}
                />
              </td>
            </tr>
          {/each}
        {/snippet}
      </Table>
    {/if}
  </div>
</div>

<!-- Create tenant modal -->
<Modal bind:open={showForm} title="Nouvelle entreprise">
  <form onsubmit={createTenant} class="space-y-4">
    <Field label="Slug">
      <Input bind:value={slug} required placeholder="acme" />
    </Field>
    <Field label="Nom">
      <Input bind:value={name} required placeholder="Acme Corp" />
    </Field>

    <fieldset class="space-y-2">
      <legend class="mb-1 block text-xs font-semibold tracking-wide text-ink-muted uppercase"
        >Modules</legend
      >
      <div class="flex flex-wrap gap-3">
        {#each availableModules as module (module.key)}
          <label class="flex cursor-pointer items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              value={module.key}
              bind:group={modules}
              class="rounded border-edge accent-accent"
            />
            {module.name}
          </label>
        {/each}
      </div>
    </fieldset>

    <Field label="Courriel administrateur">
      <Input type="email" bind:value={adminEmail} required placeholder="admin@acme.com" />
    </Field>
    <Field label="Prénom administrateur">
      <Input bind:value={adminFirstName} required placeholder="Jane" />
    </Field>
    <Field label="Nom administrateur">
      <Input bind:value={adminLastName} required placeholder="Doe" />
    </Field>

    {#if error}
      <p class="text-sm text-danger">{error}</p>
    {/if}

    <div class="flex justify-end gap-2 pt-2">
      <Button
        variant="secondary"
        disabled={busy}
        onclick={() => {
          showForm = false;
        }}>Annuler</Button
      >
      <Button type="submit" variant="primary" loading={busy}>Créer l’entreprise</Button>
    </div>
  </form>
</Modal>
<Drawer bind:open={diagnosticOpen} title={diagnostic?.name ?? 'Diagnostic entreprise'} width="xl">
  <ErrorNotice message={diagnosticError} />
  {#if diagnosticLoading}<Skeleton rows={6} />{:else if diagnostic}
    <p class="mb-4 font-mono text-sm">{diagnostic.slug} · {diagnostic.status}</p>
    <div class="mb-5 flex flex-wrap gap-5 text-sm">
      <span>{diagnostic.users} utilisateurs</span><span>{diagnostic.agents} agents</span><span
        >{diagnostic.integrations} connecteurs enregistrés</span
      >
    </div>
    <h3 class="mb-2 text-sm font-semibold">Configuration IA</h3>
    <ServiceStateBadge
      state={!diagnostic.runtime.configured
        ? 'NOT_CONFIGURED'
        : diagnostic.runtime.lastTestOk === false
          ? 'DEGRADED'
          : 'UNVERIFIED'}
    />
    <p class="mt-2 text-xs leading-5 text-ink-muted">
      {diagnostic.runtime.lastTestAt
        ? `Dernier test enregistré : ${new Date(diagnostic.runtime.lastTestAt).toLocaleString('fr-CA')} (${diagnostic.runtime.lastTestOk ? 'réussi' : 'échec'}). Ce résultat historique ne garantit pas la disponibilité actuelle.`
        : 'Aucun test de connexion enregistré.'}
    </p>
    <h3 class="mb-2 mt-5 text-sm font-semibold">Modules activés</h3>
    <div class="flex flex-wrap gap-2">
      {#each diagnostic.modules as module}<span
          class="rounded bg-surface-muted px-2 py-1 font-mono text-xs">{module}</span
        >{/each}
    </div>
    <h3 class="mb-2 mt-5 text-sm font-semibold">Traitements de cette entreprise</h3>
    <Table
      >{#snippet head()}<th>File</th><th>En attente</th><th>Échecs conservés</th
        >{/snippet}{#snippet body()}{#each diagnostic?.queues ?? [] as queue}<tr
            ><td>{queue.label}</td><td class="font-mono">{queue.pending}</td><td class="font-mono"
              >{queue.failed}</td
            ></tr
          >{/each}{/snippet}</Table
    >
    <p class="mt-4 text-xs leading-5 text-ink-muted">
      Cette vue ne permet pas d’usurper une session utilisateur. Les réglages métier et connexions
      se configurent dans l’espace de l’entreprise.
    </p>
  {/if}
</Drawer>
<Modal
  bind:open={confirmStatus}
  title={statusTarget?.status === 'SUSPENDED' ? 'Réactiver l’entreprise' : 'Suspendre l’entreprise'}
>
  {#if statusTarget}<p class="text-sm leading-6">{statusTarget.name} ({statusTarget.slug})</p>
    <p class="mt-2 text-sm text-ink-muted">
      {statusTarget.status === 'SUSPENDED'
        ? 'L’entreprise pourra à nouveau utiliser ses accès.'
        : 'Les sessions renouvelables seront révoquées. Les jetons d’accès déjà émis peuvent rester valides jusqu’à leur expiration.'}
    </p>
    <div class="mt-5 flex justify-end gap-2">
      <Button
        variant="secondary"
        disabled={busy}
        onclick={() => {
          confirmStatus = false;
        }}>Annuler</Button
      ><Button
        variant={statusTarget.status === 'SUSPENDED' ? 'primary' : 'danger'}
        loading={busy}
        onclick={() => {
          if (statusTarget)
            void setStatus(
              statusTarget,
              statusTarget.status === 'SUSPENDED' ? 'reactivate' : 'suspend',
            );
        }}>Confirmer</Button
      >
    </div>{/if}
</Modal>
