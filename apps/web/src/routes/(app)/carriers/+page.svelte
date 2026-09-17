<script lang="ts">
  import type { Paginated } from '@pulsar/shared';
  import { MODULE_KEYS } from '@pulsar/shared';
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
    toneFor,
    labelFor,
  } from '$lib/components/ui';

  interface CarrierRow {
    id: string;
    code: string;
    name: string;
    scacCode: string | null;
    contactName: string | null;
    phone: string | null;
    status: string;
  }

  let carriers = $state<CarrierRow[]>([]);
  let total = $state(0);
  let page = $state(1);
  const pageSize = 25;
  const totalPages = $derived(Math.max(1, Math.ceil(total / pageSize)));
  let search = $state('');
  let error = $state('');
  let showForm = $state(false);
  let loading = $state(true);
  let saving = $state(false);
  let form = $state({ code: '', name: '', scacCode: '', contactName: '', phone: '' });

  // Carrier portal link modal
  const hasCarrierPortal = $derived(
    $auth?.tenant.enabledModules.includes(MODULE_KEYS.CARRIER_PORTAL) ?? false,
  );
  const canManageCarrierLinks = $derived(
    ($auth?.user?.permissions ?? []).includes('carrier-portal.links.manage'),
  );
  let showPortalModal = $state(false);
  let portalModal = $state<{ carrierId: string; carrierName: string; url: string | null } | null>(
    null,
  );
  let portalLoading = $state(false);

  async function load() {
    loading = true;
    try {
      const result = await api<Paginated<CarrierRow>>('/transportation/carriers', {
        query: { search, page, pageSize },
      });
      carriers = result.items;
      total = result.total;
    } catch (e) {
      error = e instanceof ApiError ? e.message : 'Échec du chargement des transporteurs';
    } finally {
      loading = false;
    }
  }

  function openNew() {
    form = { code: '', name: '', scacCode: '', contactName: '', phone: '' };
    error = '';
    showForm = true;
  }

  async function create(event: SubmitEvent) {
    event.preventDefault();
    error = '';
    saving = true;
    try {
      await api('/transportation/carriers', {
        method: 'POST',
        body: {
          code: form.code,
          name: form.name,
          scacCode: form.scacCode || undefined,
          contactName: form.contactName || undefined,
          phone: form.phone || undefined,
        },
      });
      showForm = false;
      form = { code: '', name: '', scacCode: '', contactName: '', phone: '' };
      toast.success('Transporteur créé');
      await load();
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : 'Échec de la création du transporteur';
      error = msg;
      toast.error(msg);
    } finally {
      saving = false;
    }
  }

  async function openPortalLink(carrier: CarrierRow) {
    portalModal = { carrierId: carrier.id, carrierName: carrier.name, url: null };
    showPortalModal = true;
    portalLoading = true;
    try {
      const result = await api<{ url: string }>(
        `/carrier-portal/carriers/${carrier.id}/portal-link`,
        { method: 'POST' },
      );
      portalModal.url = result.url;
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : 'Échec de la génération du lien';
      toast.error(msg);
      portalModal = null;
      showPortalModal = false;
    } finally {
      portalLoading = false;
    }
  }

  async function revokePortalLink() {
    if (!portalModal) return;
    portalLoading = true;
    try {
      await api(`/carrier-portal/carriers/${portalModal.carrierId}/portal-link`, {
        method: 'DELETE',
      });
      toast.success('Lien portail révoqué');
      portalModal = null;
      showPortalModal = false;
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : 'Échec de la révocation';
      toast.error(msg);
    } finally {
      portalLoading = false;
    }
  }

  async function copyPortalUrl() {
    if (!portalModal?.url) return;
    await navigator.clipboard.writeText(portalModal.url);
    toast.success('Lien copié');
  }

  // Reset to page 1 whenever search changes.
  $effect(() => {
    search;
    page = 1;
  });

  $effect(() => {
    void load();
  });
</script>

<PageHeader title="Transporteurs" count={total}>
  {#snippet actions()}
    <Button onclick={openNew}>Nouveau transporteur</Button>
  {/snippet}
</PageHeader>

{#if error && !showForm}<p class="mb-3 text-sm text-danger">{error}</p>{/if}

<FilterBar>
  <div class="w-72">
    <input
      placeholder="Rechercher nom, code, SCAC…"
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
{:else if carriers.length === 0}
  <Card>
    <EmptyState message="Aucun transporteur pour le moment.">
      {#snippet children()}
        <Button onclick={openNew}>Nouveau transporteur</Button>
      {/snippet}
    </EmptyState>
  </Card>
{:else}
  <Table>
    {#snippet head()}
      <th>Code</th><th>Nom</th><th>SCAC</th><th>Contact</th><th>Téléphone</th><th>Statut</th>
      {#if hasCarrierPortal && canManageCarrierLinks}<th></th>{/if}
    {/snippet}
    {#snippet body()}
      {#each carriers as carrier (carrier.id)}
        <tr>
          <td class="font-mono font-semibold text-ink">{carrier.code}</td>
          <td
            ><a href={`/carriers/${carrier.id}`} class="hover:underline text-accent font-medium"
              >{carrier.name}</a
            ></td
          >
          <td class="font-mono text-ink-muted">{carrier.scacCode ?? '—'}</td>
          <td>{carrier.contactName ?? '—'}</td>
          <td class="font-mono text-ink-muted">{carrier.phone ?? '—'}</td>
          <td><Badge tone={toneFor(carrier.status)}>{labelFor(carrier.status)}</Badge></td>
          {#if hasCarrierPortal && canManageCarrierLinks}
            <td class="text-right">
              <Button variant="secondary" onclick={() => openPortalLink(carrier)}>Portail</Button>
            </td>
          {/if}
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

<Modal bind:open={showForm} title="Nouveau transporteur" size="md">
  {#snippet children()}
    <form onsubmit={create} class="space-y-3">
      {#if error}<p class="text-sm text-danger">{error}</p>{/if}
      <Field label="Code">
        <Input bind:value={form.code} required placeholder="CARR-002" />
      </Field>
      <Field label="Nom">
        <Input bind:value={form.name} required />
      </Field>
      <Field label="SCAC">
        <Input bind:value={form.scacCode} pattern={'[A-Z]{2,4}'} placeholder="ex. ABCD" />
      </Field>
      <p class="-mt-2 text-xs text-ink-faint">
        2 à 4 lettres majuscules (Standard Carrier Alpha Code).
      </p>
      <Field label="Contact">
        <Input bind:value={form.contactName} />
      </Field>
      <Field label="Téléphone">
        <Input bind:value={form.phone} />
      </Field>
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

<Modal
  bind:open={showPortalModal}
  title="Portail transporteur — {portalModal?.carrierName ?? ''}"
  size="md"
>
  {#snippet children()}
    {#if portalModal}
      {#if portalModal.url}
        <p class="mb-2 text-sm text-ink-muted">Lien actif :</p>
        <div class="mb-4 flex items-center gap-2 rounded border border-edge bg-canvas px-3 py-2">
          <span class="flex-1 truncate font-mono text-xs text-ink">{portalModal.url}</span>
          <Button variant="secondary" onclick={copyPortalUrl}>Copier</Button>
        </div>
        <div class="flex justify-end gap-2 border-t border-edge pt-3">
          <Button variant="danger" onclick={revokePortalLink} loading={portalLoading}
            >Révoquer</Button
          >
          <Button
            variant="secondary"
            onclick={() => {
              portalModal = null;
              showPortalModal = false;
            }}>Fermer</Button
          >
        </div>
      {:else}
        <p class="text-sm text-ink-muted">Génération du lien…</p>
      {/if}
    {/if}
  {/snippet}
</Modal>
