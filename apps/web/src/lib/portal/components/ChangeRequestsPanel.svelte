<!--
  Demandes section: history of change requests (`GET /change-requests`) plus
  the existing form, opened from a header button (spec B5). Shared by the
  session workspace (`/portal/requests`) and the capability-link plane
  (`/portal/:token`) — the single implementation both doors render.

  `active` gates the fetch the way `InvoicesPanel` does: on the capability-link
  plane this panel stays mounted-but-hidden as one tab among others.
-->
<script lang="ts">
  import {
    Badge,
    Button,
    Card,
    EmptyState,
    ErrorNotice,
    Modal,
    PageHeader,
    Skeleton,
    Table,
    labelFor,
    toneFor,
  } from '$lib/components/ui';
  import { formatDate } from '$lib/format';
  import { PortalApiError } from '../api';
  import type { PortalClient } from '../client';
  import type { PortalChangeRequest, PortalView } from '../types';
  import ChangeRequestForm from './ChangeRequestForm.svelte';

  let {
    client,
    view,
    active = true,
    initialOrderId = '',
    initialShipmentId = '',
  }: {
    client: PortalClient;
    view: PortalView;
    active?: boolean;
    /** From the session route's `?orderId=`/`?shipmentId=` query, if present. */
    initialOrderId?: string;
    initialShipmentId?: string;
  } = $props();

  let requests = $state<PortalChangeRequest[]>([]);
  let loading = $state(false);
  let loaded = $state(false);
  let error = $state('');
  let formOpen = $state(false);

  async function load() {
    if (loading) return;
    loading = true;
    error = '';
    try {
      requests = await client.get<PortalChangeRequest[]>('/change-requests');
      loaded = true;
    } catch (e) {
      requests = [];
      error = e instanceof PortalApiError ? e.message : 'Impossible de charger les demandes.';
    } finally {
      loading = false;
    }
  }

  // Lazy load: fetch only once the tab (or page) is first activated.
  $effect(() => {
    if (active && !loaded && !loading) void load();
  });

  function openForm() {
    formOpen = true;
  }
</script>

<PageHeader
  title="Demandes"
  subtitle="Historique de vos demandes de changement et leur avancement."
  count={loaded ? requests.length : undefined}
>
  {#snippet actions()}
    <Button onclick={openForm}>Nouvelle demande</Button>
  {/snippet}
</PageHeader>

<ErrorNotice message={error} onretry={load} />

{#if loading && !loaded}
  <Card padded={false}><Skeleton rows={5} /></Card>
{:else if loaded && requests.length === 0}
  <Card>
    <EmptyState
      title="Aucune demande"
      message="Envoyez une demande de changement (date, adresse, annulation…) depuis le bouton ci-dessus ou une commande."
    >
      <Button onclick={openForm}>Nouvelle demande</Button>
    </EmptyState>
  </Card>
{:else}
  <Table>
    {#snippet head()}
      <th>Type</th><th>Commande</th><th>Expédition</th><th>Note</th><th>Statut</th><th>Réponse</th
      ><th>Envoyée</th><th>Résolue</th>
    {/snippet}
    {#snippet body()}
      {#each requests as request (request.id)}
        <tr>
          <td class="text-ink">{labelFor(request.kind)}</td>
          <td class="text-ink-muted">{request.orderNumber ?? '—'}</td>
          <td class="text-ink-muted">{request.shipmentNumber ?? '—'}</td>
          <td class="max-w-xs truncate text-ink-muted" title={request.note}>{request.note}</td>
          <td><Badge tone={toneFor(request.status)}>{labelFor(request.status)}</Badge></td>
          <td class="max-w-xs truncate text-ink-muted" title={request.staffResponse ?? ''}>
            {request.staffResponse ?? '—'}
          </td>
          <td class="text-ink-muted">{formatDate(request.createdAt)}</td>
          <td class="text-ink-muted">
            {request.resolvedAt ? formatDate(request.resolvedAt) : '—'}
          </td>
        </tr>
      {/each}
    {/snippet}
  </Table>
{/if}

<Modal bind:open={formOpen} title="Nouvelle demande de changement" size="md">
  <ChangeRequestForm
    {client}
    {view}
    {initialOrderId}
    {initialShipmentId}
    onsent={() => {
      formOpen = false;
      void load();
    }}
  />
</Modal>
