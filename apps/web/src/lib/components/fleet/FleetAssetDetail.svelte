<script lang="ts">
  import { api, ApiError } from '$lib/api/client';
  import { Badge, Button, Card, EmptyState, Field, Input, PageHeader, Select, Skeleton, Textarea } from '$lib/components/ui';
  import type { Tone } from '$lib/components/ui';
  import { toast } from '$lib/stores/toast';

  // assetKind drives the asset endpoint, the WO create key (vehicleId|trailerId),
  // the WO list query key, and the compliance subjectType. Reused for vehicles + trailers.
  let {
    assetKind,
    assetId,
  }: { assetKind: 'VEHICLE' | 'TRAILER'; assetId: string } = $props();

  const isTrailer = $derived(assetKind === 'TRAILER');
  const assetEndpoint = $derived(isTrailer ? 'trailers' : 'vehicles');
  const woKey = $derived(isTrailer ? 'trailerId' : 'vehicleId');
  const backLabel = $derived(isTrailer ? 'remorque' : 'véhicule');

  interface Asset {
    id: string;
    unitNumber: string;
    status: string;
    carrierId: string | null;
    make?: string | null;
    model?: string | null;
    year?: number | null;
    plate?: string | null;
  }

  interface MaintenanceOrder {
    id: string;
    type: 'PREVENTIVE' | 'REPAIR' | 'INSPECTION';
    status: 'OPEN' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
    description: string;
    odometerKm?: number | null;
    costAmount?: number | string | null;
    costCurrency?: string | null;
    vendor?: string | null;
    dueDate?: string | null;
    openedAt: string;
    completedAt?: string | null;
  }

  interface ComplianceDoc {
    id: string;
    docType: string;
    reference?: string | null;
    expiresAt: string;
    issuedAt?: string | null;
    notes?: string | null;
    status: 'VALID' | 'EXPIRING' | 'EXPIRED';
  }

  let asset = $state<Asset | null>(null);
  let workOrders = $state<MaintenanceOrder[]>([]);
  let docs = $state<ComplianceDoc[]>([]);
  let loading = $state(true);
  let error = $state('');

  // New work-order form
  let woFormOpen = $state(false);
  let woForm = $state({ type: 'PREVENTIVE', description: '', odometerKm: '', vendor: '', dueDate: '' });

  // Complete work-order sub-form (per WO id)
  let completingId = $state<string | null>(null);
  let completeForm = $state({ costAmount: '', odometerKm: '' });

  // New compliance-document form
  let docFormOpen = $state(false);
  let docForm = $state({ docType: 'REGISTRATION', reference: '', expiresAt: '', issuedAt: '', notes: '' });

  function assetTone(status: string): Tone {
    switch (status) {
      case 'AVAILABLE':
        return 'ok';
      case 'IN_SERVICE':
        return 'info';
      case 'MAINTENANCE':
        return 'warn';
      case 'RETIRED':
        return 'neutral';
      default:
        return 'neutral';
    }
  }

  function woTone(status: string): Tone {
    switch (status) {
      case 'OPEN':
        return 'info';
      case 'IN_PROGRESS':
        return 'warn';
      case 'COMPLETED':
        return 'ok';
      case 'CANCELLED':
        return 'neutral';
      default:
        return 'neutral';
    }
  }

  function complianceTone(status: string): Tone {
    return status === 'EXPIRED' ? 'danger' : status === 'EXPIRING' ? 'warn' : 'ok';
  }

  function fmtDate(d: string | null | undefined): string {
    return d ? new Date(d).toLocaleDateString() : '—';
  }

  const WO_TYPES = ['PREVENTIVE', 'REPAIR', 'INSPECTION'];
  const DOC_TYPES = ['REGISTRATION', 'INSURANCE', 'INSPECTION', 'LICENSE', 'MEDICAL', 'OTHER'];

  // Newest first by openedAt.
  const sortedWorkOrders = $derived(
    [...workOrders].sort((a, b) => new Date(b.openedAt).getTime() - new Date(a.openedAt).getTime()),
  );

  async function load() {
    loading = true;
    error = '';
    try {
      const [a, wo, cd] = await Promise.all([
        api<Asset>(`/transportation/${assetEndpoint}/${assetId}`),
        api<MaintenanceOrder[]>('/fleet/maintenance-orders', { query: { [woKey]: assetId } }),
        api<ComplianceDoc[]>('/fleet/compliance-documents', {
          query: { subjectType: assetKind, subjectId: assetId },
        }),
      ]);
      asset = a;
      workOrders = Array.isArray(wo) ? wo.slice(0, 100) : [];
      docs = Array.isArray(cd) ? cd : [];
    } catch (e) {
      error = e instanceof ApiError ? e.message : 'Échec du chargement';
      toast.error(error);
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    if (assetId) void load();
  });

  async function createWorkOrder() {
    if (!woForm.description.trim()) {
      toast.error('La description est requise');
      return;
    }
    try {
      await api('/fleet/maintenance-orders', {
        method: 'POST',
        body: {
          [woKey]: assetId,
          type: woForm.type,
          description: woForm.description.trim(),
          odometerKm: woForm.odometerKm === '' ? undefined : Number(woForm.odometerKm),
          vendor: woForm.vendor.trim() || undefined,
          dueDate: woForm.dueDate ? new Date(woForm.dueDate).toISOString() : undefined,
        },
      });
      toast.success('Work order créé');
      woFormOpen = false;
      woForm = { type: 'PREVENTIVE', description: '', odometerKm: '', vendor: '', dueDate: '' };
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Échec de la création');
    }
  }

  async function startWo(id: string) {
    try {
      await api(`/fleet/maintenance-orders/${id}/start`, { method: 'POST' });
      toast.success('Work order démarré');
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Échec du démarrage');
    }
  }

  async function cancelWo(id: string) {
    if (!confirm('Annuler ce work order ?')) return;
    try {
      await api(`/fleet/maintenance-orders/${id}/cancel`, { method: 'POST' });
      toast.success('Work order annulé');
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Échec de l'annulation");
    }
  }

  function openComplete(id: string) {
    completingId = id;
    completeForm = { costAmount: '', odometerKm: '' };
  }

  async function completeWo() {
    if (!completingId) return;
    try {
      await api(`/fleet/maintenance-orders/${completingId}/complete`, {
        method: 'POST',
        body: {
          costAmount: completeForm.costAmount === '' ? undefined : Number(completeForm.costAmount),
          odometerKm: completeForm.odometerKm === '' ? undefined : Number(completeForm.odometerKm),
        },
      });
      toast.success('Work order complété');
      completingId = null;
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Échec de la complétion');
    }
  }

  async function createDoc() {
    if (!docForm.expiresAt) {
      toast.error("La date d'expiration est requise");
      return;
    }
    try {
      await api('/fleet/compliance-documents', {
        method: 'POST',
        body: {
          subjectType: assetKind,
          subjectId: assetId,
          docType: docForm.docType,
          reference: docForm.reference.trim() || undefined,
          expiresAt: new Date(docForm.expiresAt).toISOString(),
          issuedAt: docForm.issuedAt ? new Date(docForm.issuedAt).toISOString() : undefined,
          notes: docForm.notes.trim() || undefined,
        },
      });
      toast.success('Document ajouté');
      docFormOpen = false;
      docForm = { docType: 'REGISTRATION', reference: '', expiresAt: '', issuedAt: '', notes: '' };
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Échec de l'ajout");
    }
  }

  async function deleteDoc(id: string) {
    if (!confirm('Supprimer ce document ?')) return;
    try {
      await api(`/fleet/compliance-documents/${id}`, { method: 'DELETE' });
      toast.success('Document supprimé');
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Échec de la suppression');
    }
  }
</script>

{#if loading}
  <div class="flex flex-col gap-3">
    {#each Array(3) as _, i (i)}<Skeleton />{/each}
  </div>
{:else if error}
  <Card><p class="text-sm text-danger">{error}</p></Card>
{:else if asset}
  <!-- Header -->
  <PageHeader title={asset.unitNumber}>
    {#snippet actions()}
      <Badge tone={assetTone(asset!.status)}>{asset!.status}</Badge>
    {/snippet}
  </PageHeader>

  <div class="mb-4 flex flex-wrap items-center gap-3 text-sm text-ink-muted">
    <a href="/fleet" class="text-accent hover:underline">← Flotte</a>
    {#if asset.make || asset.model}
      <span>{[asset.make, asset.model].filter(Boolean).join(' ')}</span>
    {/if}
    {#if asset.year}<span>· {asset.year}</span>{/if}
    {#if asset.plate}<span>· {asset.plate}</span>{/if}
  </div>

  <div class="grid gap-4 lg:grid-cols-2">
    <!-- Maintenance panel -->
    <Card>
      <div class="mb-3 flex items-center justify-between">
        <h2 class="font-semibold text-ink">Maintenance</h2>
        {#if !woFormOpen}
          <Button variant="secondary" onclick={() => { woFormOpen = true; }}>Nouveau work order</Button>
        {/if}
      </div>

      {#if woFormOpen}
        <div class="mb-4 flex flex-col gap-3 rounded-card border border-edge bg-surface-muted p-3">
          <Field label="Type">
            <Select bind:value={woForm.type}>
              {#each WO_TYPES as t (t)}<option value={t}>{t}</option>{/each}
            </Select>
          </Field>
          <Field label="Description">
            <Textarea bind:value={woForm.description} rows={2} placeholder="Nature de l'intervention" />
          </Field>
          <Field label="Odomètre (km)">
            <Input type="number" min="0" bind:value={woForm.odometerKm} />
          </Field>
          <Field label="Fournisseur">
            <Input bind:value={woForm.vendor} placeholder="Atelier / garage" />
          </Field>
          <Field label="Échéance">
            <Input type="date" bind:value={woForm.dueDate} />
          </Field>
          <div class="flex gap-2">
            <Button variant="primary" onclick={createWorkOrder}>Créer</Button>
            <Button variant="secondary" onclick={() => { woFormOpen = false; }}>Annuler</Button>
          </div>
        </div>
      {/if}

      {#if sortedWorkOrders.length === 0}
        <EmptyState message="Aucun work order." />
      {:else}
        <div class="divide-y divide-edge">
          {#each sortedWorkOrders as wo (wo.id)}
            <div class="py-3 text-sm">
              <div class="flex flex-wrap items-center gap-2">
                <Badge tone={woTone(wo.status)}>{wo.status}</Badge>
                <span class="font-medium text-ink">{wo.type}</span>
                <span class="ml-auto text-xs text-ink-muted">{fmtDate(wo.openedAt)}</span>
              </div>
              <p class="mt-1 text-ink">{wo.description}</p>
              <div class="mt-1 flex flex-wrap gap-3 text-xs text-ink-muted">
                {#if wo.odometerKm != null}<span>{wo.odometerKm} km</span>{/if}
                {#if wo.costAmount != null}<span>{Number(wo.costAmount).toLocaleString()} {wo.costCurrency ?? ''}</span>{/if}
                {#if wo.vendor}<span>{wo.vendor}</span>{/if}
                {#if wo.dueDate}<span>échéance {fmtDate(wo.dueDate)}</span>{/if}
              </div>

              {#if wo.status === 'OPEN' || wo.status === 'IN_PROGRESS'}
                <div class="mt-2 flex gap-2">
                  {#if wo.status === 'OPEN'}
                    <Button variant="secondary" onclick={() => startWo(wo.id)}>Démarrer</Button>
                  {/if}
                  <Button variant="primary" onclick={() => openComplete(wo.id)}>Compléter</Button>
                  <Button variant="danger" onclick={() => cancelWo(wo.id)}>Annuler</Button>
                </div>
              {/if}

              {#if completingId === wo.id}
                <div class="mt-3 flex flex-col gap-3 rounded-card border border-edge bg-surface-muted p-3">
                  <Field label="Coût">
                    <Input type="number" min="0" step="0.01" bind:value={completeForm.costAmount} />
                  </Field>
                  <Field label="Odomètre (km)">
                    <Input type="number" min="0" bind:value={completeForm.odometerKm} />
                  </Field>
                  <div class="flex gap-2">
                    <Button variant="primary" onclick={completeWo}>Confirmer</Button>
                    <Button variant="secondary" onclick={() => { completingId = null; }}>Annuler</Button>
                  </div>
                </div>
              {/if}
            </div>
          {/each}
        </div>
      {/if}
    </Card>

    <!-- Compliance panel -->
    <Card>
      <div class="mb-3 flex items-center justify-between">
        <h2 class="font-semibold text-ink">Conformité</h2>
        {#if !docFormOpen}
          <Button variant="secondary" onclick={() => { docFormOpen = true; }}>Ajouter un document</Button>
        {/if}
      </div>

      {#if docFormOpen}
        <div class="mb-4 flex flex-col gap-3 rounded-card border border-edge bg-surface-muted p-3">
          <Field label="Type de document">
            <Select bind:value={docForm.docType}>
              {#each DOC_TYPES as t (t)}<option value={t}>{t}</option>{/each}
            </Select>
          </Field>
          <Field label="Référence">
            <Input bind:value={docForm.reference} placeholder="N° de police / certificat" />
          </Field>
          <Field label="Date d'expiration">
            <Input type="date" bind:value={docForm.expiresAt} required />
          </Field>
          <Field label="Date d'émission">
            <Input type="date" bind:value={docForm.issuedAt} />
          </Field>
          <Field label="Notes">
            <Textarea bind:value={docForm.notes} rows={2} />
          </Field>
          <div class="flex gap-2">
            <Button variant="primary" onclick={createDoc}>Ajouter</Button>
            <Button variant="secondary" onclick={() => { docFormOpen = false; }}>Annuler</Button>
          </div>
        </div>
      {/if}

      {#if docs.length === 0}
        <EmptyState message="Aucun document de conformité." />
      {:else}
        <div class="divide-y divide-edge">
          {#each docs as doc (doc.id)}
            <div class="flex items-center gap-3 py-2.5 text-sm">
              <Badge tone={complianceTone(doc.status)}>{doc.status}</Badge>
              <span class="font-medium text-ink">{doc.docType}</span>
              {#if doc.reference}<span class="text-ink-faint">{doc.reference}</span>{/if}
              <span class="ml-auto text-ink-muted">expire le {fmtDate(doc.expiresAt)}</span>
              <Button variant="ghost" onclick={() => deleteDoc(doc.id)}>Supprimer</Button>
            </div>
          {/each}
        </div>
      {/if}
    </Card>
  </div>
{:else}
  <p class="text-sm text-ink-muted">Introuvable.</p>
{/if}
