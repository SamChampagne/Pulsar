<script lang="ts">
  import MasterDataEdit from '$lib/components/transportation/MasterDataEdit.svelte';
  import PartyDirectory from '$lib/components/reference-data/PartyDirectory.svelte';
  import PartyDossier from '$lib/components/reference-data/PartyDossier.svelte';
  import { enterNext } from '$lib/forms/enter-next';
  import { getAccessToken } from '$lib/stores/auth';
  import type { Paginated } from '@pulsar/shared';
  import { MODULE_KEYS, isValidPhone } from '@pulsar/shared';
  import { api, ApiError } from '$lib/api/client';
  import { auth } from '$lib/stores/auth';
  import { toast } from '$lib/stores/toast';
  import {
    PageHeader,
    Button,
    FilterBar,
    Field,
    Input,
    Table,
    Badge,
    EmptyState,
    Card,
    Skeleton,
    Modal,
  } from '$lib/components/ui';

  interface CustomerRow {
    id: string;
    code: string;
    name: string;
    contactName: string | null;
    email: string | null;
    isActive: boolean;
  }

  let customers = $state<CustomerRow[]>([]);
  let directory = $state<CustomerRow | null>(null);
  let total = $state(0);
  let page = $state(1);
  const pageSize = 25;
  const totalPages = $derived(Math.max(1, Math.ceil(total / pageSize)));
  let search = $state('');
  let error = $state('');
  let showForm = $state(false);
  let loading = $state(true);
  let saving = $state(false);
  let form = $state({ code: '', name: '', contactName: '', email: '', phone: '' });

  const hasPortal = $derived(
    $auth?.tenant.enabledModules.includes(MODULE_KEYS.CUSTOMER_PORTAL) ?? false,
  );

  const canManageLinks = $derived(
    ($auth?.user.permissions ?? []).includes('customer-portal.links.manage') ?? false,
  );

  let brandLogoUrl = $state('');
  let brandAccentColor = $state('#000000');
  let brandSaving = $state(false);
  let brandLoading = $state(false);
  let brandLoaded = $state(false);
  let brandError = $state('');
  async function uploadLogo(event: Event) {
    if (!brandLoaded || brandSaving) return;
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    if (
      !['image/png', 'image/jpeg', 'image/webp'].includes(file.type) ||
      file.size > 2 * 1024 * 1024
    ) {
      toast.error('Logo : PNG, JPEG ou WebP, 2 Mo maximum.');
      input.value = '';
      return;
    }
    brandSaving = true;
    brandError = '';
    try {
      const body = new FormData();
      body.append('file', file);
      const response = await fetch('/api/v1/customer-portal/branding/logo', {
        method: 'POST',
        headers: { Authorization: `Bearer ${getAccessToken()}` },
        body,
      });
      if (!response.ok) throw new Error((await response.json()).message ?? 'Import impossible');
      const branding = await response.json();
      brandLogoUrl = branding.logoUrl;
      toast.success('Logo importé et enregistré');
    } catch (e) {
      brandError = e instanceof Error ? e.message : 'Import impossible';
    } finally {
      brandSaving = false;
      input.value = '';
    }
  }

  async function portalLink(customer: CustomerRow) {
    try {
      const { url } = await api<{ url: string }>(
        `/customer-portal/customers/${customer.id}/portal-link`,
        { method: 'POST' },
      );
      await navigator.clipboard.writeText(url);
      toast.success(`Lien portail de ${customer.name} copié`);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Échec de la création du lien portail');
    }
  }

  async function load() {
    loading = true;
    try {
      const result = await api<Paginated<CustomerRow>>('/transportation/customers', {
        query: { search, page, pageSize },
      });
      customers = result.items;
      total = result.total;
    } catch (e) {
      error = e instanceof ApiError ? e.message : 'Échec du chargement des clients';
    } finally {
      loading = false;
    }
  }

  function openNew() {
    form = { code: '', name: '', contactName: '', email: '', phone: '' };
    error = '';
    showForm = true;
  }

  async function create(event: SubmitEvent) {
    event.preventDefault();
    if (saving) return;
    error = '';
    if (!isValidPhone(form.phone.trim())) {
      error = 'Téléphone invalide : utilisez 7 à 15 chiffres et une extension facultative.';
      return;
    }
    saving = true;
    try {
      await api('/transportation/customers', {
        method: 'POST',
        body: {
          code: form.code,
          name: form.name,
          contactName: form.contactName || undefined,
          email: form.email || undefined,
          phone: form.phone || undefined,
        },
      });
      showForm = false;
      form = { code: '', name: '', contactName: '', email: '', phone: '' };
      toast.success('Client créé');
      await load();
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : 'Échec de la création du client';
      error = msg;
      toast.error(msg);
    } finally {
      saving = false;
    }
  }

  async function loadBranding() {
    brandLoading = true;
    brandLoaded = false;
    brandError = '';
    try {
      const b = await api<{ logoUrl?: string; accentColor?: string }>('/customer-portal/branding');
      brandLogoUrl = b.logoUrl ?? '';
      brandAccentColor = b.accentColor ?? '#000000';
      brandLoaded = true;
    } catch {
      brandError = 'Impossible de charger le branding existant. Rechargez avant de le modifier.';
    } finally {
      brandLoading = false;
    }
  }

  async function saveBranding() {
    if (!brandLoaded || brandSaving) return;
    brandSaving = true;
    try {
      await api('/customer-portal/branding', {
        method: 'PUT',
        body: { logoUrl: brandLogoUrl, accentColor: brandAccentColor || undefined },
      });
      toast.success('Branding mis à jour');
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Échec de la mise à jour du branding');
    } finally {
      brandSaving = false;
    }
  }

  // Reset to page 1 whenever search changes.
  $effect(() => {
    search;
    page = 1;
  });

  $effect(() => {
    void load();
  });
  $effect(() => {
    if (hasPortal && canManageLinks) void loadBranding();
  });
</script>

<PageHeader title="Clients" count={total}>
  {#snippet actions()}
    {#if $auth?.user.permissions.includes('transportation.master-data.manage')}<Button
        onclick={openNew}>Nouveau client</Button
      >{/if}
  {/snippet}
</PageHeader>

{#if error && !showForm}<p class="mb-3 text-sm text-danger">{error}</p>{/if}

<FilterBar>
  <div class="w-72">
    <input
      placeholder="Rechercher nom ou code…"
      bind:value={search}
      onkeydown={(e) => {
        if (e.key === 'Enter') void load();
      }}
      class="w-full rounded-md border border-edge bg-surface px-3 py-1.5 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
    />
  </div>
</FilterBar>

{#if loading}
  <Card padded={false}><Skeleton rows={6} /></Card>
{:else if customers.length === 0}
  <Card>
    <EmptyState message="Aucun client pour le moment.">
      {#snippet children()}
        {#if $auth?.user.permissions.includes('transportation.master-data.manage')}<Button
            onclick={openNew}>Nouveau client</Button
          >{/if}
      {/snippet}
    </EmptyState>
  </Card>
{:else}
  <Table>
    {#snippet head()}
      <th>Code</th><th>Nom</th><th>Contact</th><th>Courriel</th><th>Actif</th>
      <th>Actions</th>
    {/snippet}
    {#snippet body()}
      {#each customers as customer (customer.id)}
        <tr>
          <td class="font-mono font-semibold text-ink">{customer.code}</td>
          <td
            ><a href={`/customers/${customer.id}`} class="hover:underline text-accent font-medium"
              >{customer.name}</a
            ></td
          >
          <td>{customer.contactName ?? '—'}</td>
          <td class="text-ink-muted">{customer.email ?? '—'}</td>
          <td>
            <Badge tone={customer.isActive ? 'ok' : 'danger'}>
              {customer.isActive ? 'Actif' : 'Inactif'}
            </Badge>
          </td>
          <td
            ><div class="flex flex-wrap justify-end gap-2">
              <PartyDossier endpoint={`/transportation/customers/${customer.id}`} name={customer.name} />
              <MasterDataEdit kind="customers" id={customer.id} onsaved={load} />
              <Button
                variant="secondary"
                aria-label={`Carnet de ${customer.name}`}
                onclick={() => {
                  directory = customer;
                }}>Carnet</Button
              >
              {#if hasPortal && canManageLinks}
                <Button variant="secondary" onclick={() => portalLink(customer)}
                  >Lien portail</Button
                >
              {/if}
            </div></td
          >
        </tr>
      {/each}
    {/snippet}
  </Table>
{/if}

{#if total > pageSize}
  <div class="mt-3 flex items-center justify-between text-sm text-ink-muted">
    <span class="font-mono text-xs"
      >{(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} sur {total}</span
    >
    <div class="flex items-center gap-2">
      <Button
        variant="secondary"
        disabled={page <= 1}
        onclick={() => {
          page = Math.max(1, page - 1);
          void load();
        }}>Précédent</Button
      >
      <span class="font-mono text-xs">Page {page} / {totalPages}</span>
      <Button
        variant="secondary"
        disabled={page >= totalPages}
        onclick={() => {
          page = Math.min(totalPages, page + 1);
          void load();
        }}>Suivant</Button
      >
    </div>
  </div>
{/if}

{#if hasPortal && canManageLinks}
  <div class="mt-6">
    <Card>
      <h2 class="mb-4 text-base font-semibold text-ink">Branding du portail</h2>
      {#if brandError}<p role="alert" class="mb-3 text-sm text-danger">{brandError}</p>{/if}
      {#if !brandLoaded && !brandLoading}<Button variant="secondary" onclick={loadBranding}
          >Réessayer le chargement</Button
        >{/if}
      <div class="flex flex-col gap-4">
        {#if brandLogoUrl}<img
            src={brandLogoUrl}
            alt="Logo du portail client"
            class="h-16 max-w-52 object-contain object-left"
          />{/if}
        <Field label="Importer depuis l’ordinateur"
          ><input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            disabled={brandSaving || !brandLoaded}
            onchange={uploadLogo}
            class="text-sm"
          /></Field
        >
        <p class="text-xs text-ink-muted">
          PNG, JPEG ou WebP · 2 Mo maximum. Le logo est visible publiquement sur le portail.
        </p>
        <Field label="URL du logo">
          <Input
            bind:value={brandLogoUrl}
            disabled={!brandLoaded || brandSaving}
            placeholder="https://...logo.png"
          />
        </Field>
        <Field label="Couleur d'accent">
          <input
            type="color"
            bind:value={brandAccentColor}
            disabled={!brandLoaded || brandSaving}
            class="h-9 w-16 cursor-pointer rounded border border-edge"
          />
        </Field>
        <div class="flex justify-end">
          <Button onclick={saveBranding} disabled={!brandLoaded} loading={brandSaving}
            >Enregistrer</Button
          >
        </div>
      </div>
    </Card>
  </div>
{/if}

<Modal bind:open={showForm} title="Nouveau client" size="md">
  {#snippet children()}
    <form onsubmit={create} use:enterNext class="space-y-3">
      {#if error}<p class="text-sm text-danger">{error}</p>{/if}
      <Field label="Code">
        <Input bind:value={form.code} required maxlength={50} placeholder="CUST-002" />
      </Field>
      <Field label="Nom">
        <Input bind:value={form.name} required maxlength={200} />
      </Field>
      <Field label="Contact">
        <Input bind:value={form.contactName} maxlength={150} />
      </Field>
      <Field label="Courriel">
        <Input type="email" bind:value={form.email} maxlength={254} />
      </Field>
      <Field label="Téléphone"
        ><Input
          type="tel"
          bind:value={form.phone}
          maxlength={40}
          placeholder="+1 514 555-0123"
        /></Field
      >
      <div class="flex justify-end gap-2 border-t border-edge pt-3">
        <Button
          variant="secondary"
          onclick={() => {
            showForm = false;
          }}>Annuler</Button
        >
        <Button variant="primary" type="submit" loading={saving}>Créer</Button>
      </div>
    </form>
  {/snippet}
</Modal>
{#if directory}{#key directory.id}<PartyDirectory
      endpoint={`/transportation/customers/${directory.id}/directory`}
      name={directory.name}
      canManage={$auth?.user.permissions.includes('transportation.master-data.manage') ?? false}
      onclose={() => (directory = null)}
    />{/key}{/if}
