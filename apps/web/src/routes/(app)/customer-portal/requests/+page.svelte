<script lang="ts">
  import { PortalChangeRequestStatus } from '@pulsar/shared';
  import { api, ApiError } from '$lib/api/client';
  import {
    Badge,
    Button,
    Card,
    EmptyState,
    Field,
    Modal,
    PageHeader,
    Select,
    Skeleton,
    Table,
    Textarea,
    labelFor,
    toneFor,
  } from '$lib/components/ui';
  import { formatDate } from '$lib/format';
  import { confirmAction } from '$lib/stores/confirmation';
  import { toast } from '$lib/stores/toast';

  /** `GET /customer-portal/change-requests` — the staff projection. */
  interface StaffChangeRequestRow {
    id: string;
    kind: string;
    note: string;
    status: PortalChangeRequestStatus;
    staffResponse: string | null;
    orderNumber: string | null;
    shipmentNumber: string | null;
    createdAt: string;
    resolvedAt: string | null;
    customerName: string;
    requestedBy: string | null;
    updatedAt: string;
  }

  let requests = $state<StaffChangeRequestRow[]>([]);
  let loading = $state(true);
  let busyId = $state('');
  let statusFilter = $state<'' | PortalChangeRequestStatus>('');

  let responseOpen = $state(false);
  let responseTarget = $state<StaffChangeRequestRow | null>(null);
  let responseVerb = $state<'resolve' | 'reject'>('resolve');
  let responseText = $state('');
  let responseBusy = $state(false);

  const STATUS_OPTIONS: { value: '' | PortalChangeRequestStatus; label: string }[] = [
    { value: '', label: 'Tous les statuts' },
    { value: PortalChangeRequestStatus.OPEN, label: labelFor(PortalChangeRequestStatus.OPEN) },
    {
      value: PortalChangeRequestStatus.ACKNOWLEDGED,
      label: labelFor(PortalChangeRequestStatus.ACKNOWLEDGED),
    },
    {
      value: PortalChangeRequestStatus.RESOLVED,
      label: labelFor(PortalChangeRequestStatus.RESOLVED),
    },
    {
      value: PortalChangeRequestStatus.REJECTED,
      label: labelFor(PortalChangeRequestStatus.REJECTED),
    },
  ];

  async function load() {
    loading = true;
    try {
      requests = await api<StaffChangeRequestRow[]>('/customer-portal/change-requests', {
        query: statusFilter ? { status: statusFilter } : {},
      });
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Échec du chargement');
    } finally {
      loading = false;
    }
  }

  async function acknowledge(row: StaffChangeRequestRow) {
    if (
      !(await confirmAction(`Accuser réception de la demande de ${row.customerName} ?`, {
        dangerous: false,
        confirmLabel: 'Accuser réception',
      }))
    )
      return;
    busyId = row.id;
    try {
      await api(`/customer-portal/change-requests/${row.id}/acknowledge`, {
        method: 'POST',
        body: {},
      });
      toast.success('Demande prise en compte.');
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Échec');
    } finally {
      busyId = '';
    }
  }

  function openResponse(row: StaffChangeRequestRow, verb: 'resolve' | 'reject') {
    responseTarget = row;
    responseVerb = verb;
    responseText = '';
    responseOpen = true;
  }

  async function submitResponse() {
    if (!responseTarget) return;
    responseBusy = true;
    try {
      await api(`/customer-portal/change-requests/${responseTarget.id}/${responseVerb}`, {
        method: 'POST',
        body: responseText.trim() ? { response: responseText.trim() } : {},
      });
      toast.success(responseVerb === 'resolve' ? 'Demande résolue.' : 'Demande rejetée.');
      responseOpen = false;
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Échec');
    } finally {
      responseBusy = false;
    }
  }

  // Server-side filter: reload whenever the status filter changes.
  $effect(() => {
    void statusFilter;
    void load();
  });
</script>

<svelte:head><title>Demandes du portail client — Pulsar</title></svelte:head>

<PageHeader
  title="Demandes du portail client"
  subtitle="File des demandes de changement envoyées par vos clients depuis le portail."
  count={loading ? undefined : requests.length}
>
  {#snippet actions()}
    <div class="w-48">
      <Select bind:value={statusFilter} aria-label="Statut">
        {#each STATUS_OPTIONS as option (option.value)}
          <option value={option.value}>{option.label}</option>
        {/each}
      </Select>
    </div>
  {/snippet}
</PageHeader>

{#if loading}
  <Card padded={false}><Skeleton rows={6} /></Card>
{:else if requests.length === 0}
  <Card><EmptyState message="Aucune demande pour l’instant." /></Card>
{:else}
  <Table>
    {#snippet head()}
      <th>Client</th><th>Type</th><th>Commande</th><th>Expédition</th><th>Note</th><th
        >Demandé par</th
      ><th>Statut</th><th>Envoyée</th><th class="text-right">Actions</th>
    {/snippet}
    {#snippet body()}
      {#each requests as row (row.id)}
        <tr>
          <td class="font-medium text-ink">{row.customerName}</td>
          <td class="text-ink-muted">{labelFor(row.kind)}</td>
          <td class="text-ink-muted">{row.orderNumber ?? '—'}</td>
          <td class="text-ink-muted">{row.shipmentNumber ?? '—'}</td>
          <td class="max-w-xs truncate text-ink-muted" title={row.note}>{row.note}</td>
          <td class="text-ink-muted">{row.requestedBy ?? '—'}</td>
          <td><Badge tone={toneFor(row.status)}>{labelFor(row.status)}</Badge></td>
          <td class="text-ink-muted">{formatDate(row.createdAt)}</td>
          <td class="text-right">
            <div class="flex justify-end gap-1">
              {#if row.status === PortalChangeRequestStatus.OPEN}
                <Button
                  variant="secondary"
                  loading={busyId === row.id}
                  onclick={() => acknowledge(row)}
                >
                  Accuser réception
                </Button>
              {/if}
              {#if row.status === PortalChangeRequestStatus.OPEN || row.status === PortalChangeRequestStatus.ACKNOWLEDGED}
                <Button variant="primary" onclick={() => openResponse(row, 'resolve')}>
                  Résoudre
                </Button>
                <Button variant="secondary" onclick={() => openResponse(row, 'reject')}>
                  Rejeter
                </Button>
              {/if}
            </div>
          </td>
        </tr>
      {/each}
    {/snippet}
  </Table>
{/if}

<Modal
  bind:open={responseOpen}
  title={responseVerb === 'resolve' ? 'Résoudre la demande' : 'Rejeter la demande'}
  size="sm"
>
  {#if responseTarget}
    <p class="mb-3 text-sm text-ink-muted">
      {responseTarget.customerName} — {labelFor(responseTarget.kind)}
    </p>
  {/if}
  <Field label="Réponse (optionnel)">
    <Textarea bind:value={responseText} rows={3} placeholder="Réponse visible par le client…" />
  </Field>
  {#snippet footer()}
    <Button
      variant="secondary"
      onclick={() => {
        responseOpen = false;
      }}
      disabled={responseBusy}
    >
      Annuler
    </Button>
    <Button loading={responseBusy} disabled={responseBusy} onclick={submitResponse}>
      {responseVerb === 'resolve' ? 'Résoudre' : 'Rejeter'}
    </Button>
  {/snippet}
</Modal>
