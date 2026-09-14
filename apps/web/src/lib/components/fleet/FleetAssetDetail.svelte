<script lang="ts">
  import { confirmAction } from '$lib/stores/confirmation';
  import { api, ApiError } from '$lib/api/client';
  import {
    Badge,
    Button,
    Card,
    EmptyState,
    Field,
    Input,
    PageHeader,
    RelatedEntities,
    Select,
    Skeleton,
    Textarea,
    ErrorNotice,
  } from '$lib/components/ui';
  import type { RelatedGroup, Tone } from '$lib/components/ui';
  import { toast } from '$lib/stores/toast';
  import CustomFieldInputs from '$lib/components/CustomFieldInputs.svelte';

  // assetKind drives the asset endpoint, the WO create key (vehicleId|trailerId),
  // the WO list query key, and the compliance subjectType. Reused for vehicles + trailers.
  let { assetKind, assetId }: { assetKind: 'VEHICLE' | 'TRAILER'; assetId: string } = $props();

  const isTrailer = $derived(assetKind === 'TRAILER');
  const assetEndpoint = $derived(isTrailer ? 'trailers' : 'vehicles');
  const woKey = $derived(isTrailer ? 'trailerId' : 'vehicleId');
  const backLabel = $derived(isTrailer ? 'remorque' : 'véhicule');

  interface CustomFieldDef {
    key: string;
    label: string;
    type: 'TEXT' | 'NUMBER' | 'DATE' | 'BOOLEAN' | 'SELECT';
    options?: { value: string; label: string }[];
    required: boolean;
    showInList?: boolean;
  }

  interface Asset {
    id: string;
    unitNumber: string;
    status: string;
    carrierId: string | null;
    make?: string | null;
    model?: string | null;
    year?: number | null;
    plate?: string | null;
    capacityWeightKg?: number | null;
    capacityVolumeM3?: number | null;
    capacityPallets?: number | null;
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

  // Descriptive edit (never status — asset status changes only via the maintenance workflow).
  let editOpen = $state(false);
  let savingEdit = $state(false);
  let editForm = $state({
    unitNumber: '',
    plate: '',
    make: '',
    model: '',
    year: '',
    capacityWeightKg: '',
    capacityVolumeM3: '',
    capacityPallets: '',
  });

  // New work-order form
  let woFormOpen = $state(false);
  let woForm = $state({
    type: 'PREVENTIVE',
    description: '',
    odometerKm: '',
    vendor: '',
    dueDate: '',
  });
  let woFieldDefs = $state<CustomFieldDef[]>([]);
  let woCustomData = $state<Record<string, unknown>>({});

  // Complete work-order sub-form (per WO id)
  let completingId = $state<string | null>(null);
  let completeForm = $state({ costAmount: '', odometerKm: '' });

  // New compliance-document form
  let docFormOpen = $state(false);
  let docForm = $state({
    docType: 'REGISTRATION',
    reference: '',
    expiresAt: '',
    issuedAt: '',
    notes: '',
  });

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

  // "Lié à" — open/in-progress work orders (or the most recent one if none are
  // active), and compliance documents that need attention (EXPIRING/EXPIRED).
  // No detail route exists yet for a single MaintenanceOrder or ComplianceDocument,
  // so items are informational (no href) — the full lists are already below.
  const relatedGroups = $derived.by<RelatedGroup[]>(() => {
    const active = sortedWorkOrders.filter(
      (w) => w.status === 'OPEN' || w.status === 'IN_PROGRESS',
    );
    const woItems = (active.length > 0 ? active : sortedWorkOrders.slice(0, 1)).map((w) => ({
      label: w.type,
      sublabel: `${w.status} · ${fmtDate(w.openedAt)}`,
      tone: woTone(w.status),
    }));
    const attentionDocs = docs.filter((d) => d.status !== 'VALID');
    const docItems = attentionDocs.map((d) => ({
      label: d.docType,
      sublabel: `expire le ${fmtDate(d.expiresAt)}`,
      tone: complianceTone(d.status),
    }));
    return [
      { label: 'Maintenance', items: woItems },
      { label: 'Conformité', items: docItems },
    ];
  });

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

  function openEdit() {
    if (!asset) return;
    editForm = {
      unitNumber: asset.unitNumber,
      plate: asset.plate ?? '',
      make: asset.make ?? '',
      model: asset.model ?? '',
      year: asset.year != null ? String(asset.year) : '',
      capacityWeightKg: asset.capacityWeightKg != null ? String(asset.capacityWeightKg) : '',
      capacityVolumeM3: asset.capacityVolumeM3 != null ? String(asset.capacityVolumeM3) : '',
      capacityPallets: asset.capacityPallets != null ? String(asset.capacityPallets) : '',
    };
    editOpen = true;
  }

  async function saveEdit() {
    if (!editForm.unitNumber.trim()) {
      toast.error('Le numéro d’unité est requis');
      return;
    }
    savingEdit = true;
    try {
      const body: Record<string, unknown> = {
        unitNumber: editForm.unitNumber.trim(),
        plate: editForm.plate.trim() || undefined,
      };
      if (isTrailer) {
        body.capacityWeightKg =
          editForm.capacityWeightKg === '' ? undefined : Number(editForm.capacityWeightKg);
        body.capacityVolumeM3 =
          editForm.capacityVolumeM3 === '' ? undefined : Number(editForm.capacityVolumeM3);
        body.capacityPallets =
          editForm.capacityPallets === '' ? undefined : Number(editForm.capacityPallets);
      } else {
        body.make = editForm.make.trim() || undefined;
        body.model = editForm.model.trim() || undefined;
        body.year = editForm.year === '' ? undefined : Number(editForm.year);
      }
      await api(`/transportation/${assetEndpoint}/${assetId}`, { method: 'PATCH', body });
      toast.success('Asset mis à jour');
      editOpen = false;
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Échec de la mise à jour');
    } finally {
      savingEdit = false;
    }
  }

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
          customData: Object.keys(woCustomData).length > 0 ? woCustomData : undefined,
        },
      });
      toast.success('Work order créé');
      woFormOpen = false;
      woForm = { type: 'PREVENTIVE', description: '', odometerKm: '', vendor: '', dueDate: '' };
      woFieldDefs = [];
      woCustomData = {};
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
    if (!(await confirmAction('Annuler ce work order ?'))) return;
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
    if (!(await confirmAction('Supprimer ce document ?'))) return;
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
  <ErrorNotice message={error} onretry={load} />
{:else if asset}
  <!-- Header -->
  <PageHeader title={asset.unitNumber}>
    {#snippet actions()}
      <Badge tone={assetTone(asset!.status)}>{asset!.status}</Badge>
      {#if !editOpen}<Button variant="secondary" onclick={openEdit}>Éditer</Button>{/if}
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

  <div class="mb-4">
    <Card>
      <RelatedEntities groups={relatedGroups} />
    </Card>
  </div>

  {#if editOpen}
    <Card>
      <h2 class="mb-3 font-semibold text-ink">Éditer le {backLabel}</h2>
      <div class="grid gap-3 sm:grid-cols-2">
        <Field label="Numéro d’unité"><Input bind:value={editForm.unitNumber} /></Field>
        <Field label="Plaque"><Input bind:value={editForm.plate} /></Field>
        {#if isTrailer}
          <Field label="Capacité poids (kg)"
            ><Input type="number" min="0" bind:value={editForm.capacityWeightKg} /></Field
          >
          <Field label="Capacité volume (m³)"
            ><Input
              type="number"
              min="0"
              step="0.1"
              bind:value={editForm.capacityVolumeM3}
            /></Field
          >
          <Field label="Capacité palettes"
            ><Input type="number" min="0" bind:value={editForm.capacityPallets} /></Field
          >
        {:else}
          <Field label="Marque"><Input bind:value={editForm.make} /></Field>
          <Field label="Modèle"><Input bind:value={editForm.model} /></Field>
          <Field label="Année"><Input type="number" bind:value={editForm.year} /></Field>
        {/if}
      </div>
      <p class="mt-2 text-xs text-ink-faint">
        Le statut de l’asset n’est pas modifiable ici : il suit le workflow de maintenance.
      </p>
      <div class="mt-3 flex gap-2">
        <Button variant="primary" onclick={saveEdit} loading={savingEdit}>Enregistrer</Button>
        <Button
          variant="secondary"
          onclick={() => {
            editOpen = false;
          }}>Annuler</Button
        >
      </div>
    </Card>
  {/if}

  <div class="mt-4 grid gap-4 lg:grid-cols-2">
    <!-- Maintenance panel -->
    <Card>
      <div class="mb-3 flex items-center justify-between">
        <h2 class="font-semibold text-ink">Maintenance</h2>
        {#if !woFormOpen}
          <Button
            variant="secondary"
            onclick={async () => {
              woCustomData = {};
              woFieldDefs = await api<CustomFieldDef[]>('/fleet/custom-fields', {
                query: { entityType: 'MAINTENANCE_ORDER' },
              }).catch(() => [] as CustomFieldDef[]);
              woFormOpen = true;
            }}>Nouveau work order</Button
          >
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
            <Textarea
              bind:value={woForm.description}
              rows={2}
              placeholder="Nature de l'intervention"
            />
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
          {#if woFieldDefs.length > 0}
            <CustomFieldInputs definitions={woFieldDefs} bind:data={woCustomData} />
          {/if}
          <div class="flex gap-2">
            <Button variant="primary" onclick={createWorkOrder}>Créer</Button>
            <Button
              variant="secondary"
              onclick={() => {
                woFormOpen = false;
              }}>Annuler</Button
            >
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
                {#if wo.costAmount != null}<span
                    >{Number(wo.costAmount).toLocaleString()} {wo.costCurrency ?? ''}</span
                  >{/if}
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
                <div
                  class="mt-3 flex flex-col gap-3 rounded-card border border-edge bg-surface-muted p-3"
                >
                  <Field label="Coût">
                    <Input type="number" min="0" step="0.01" bind:value={completeForm.costAmount} />
                  </Field>
                  <Field label="Odomètre (km)">
                    <Input type="number" min="0" bind:value={completeForm.odometerKm} />
                  </Field>
                  <div class="flex gap-2">
                    <Button variant="primary" onclick={completeWo}>Confirmer</Button>
                    <Button
                      variant="secondary"
                      onclick={() => {
                        completingId = null;
                      }}>Annuler</Button
                    >
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
          <Button
            variant="secondary"
            onclick={() => {
              docFormOpen = true;
            }}>Ajouter un document</Button
          >
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
            <Button
              variant="secondary"
              onclick={() => {
                docFormOpen = false;
              }}>Annuler</Button
            >
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
