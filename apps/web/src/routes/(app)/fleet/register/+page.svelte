<script lang="ts">
  import { confirmAction } from '$lib/stores/confirmation';
  import type { Paginated } from '@pulsar/shared';
  import { api, ApiError } from '$lib/api/client';
  import { formatDate } from '$lib/format';
  import {
    Badge,
    Button,
    Card,
    EmptyState,
    ErrorNotice,
    Input,
    Modal,
    PageHeader,
    Select,
    Skeleton,
    Tabs,
    ViewToggle,
    type ViewId,
  } from '$lib/components/ui';
  import type { Tone } from '$lib/components/ui';
  import { toast } from '$lib/stores/toast';
  import CustomFieldInputs from '$lib/components/CustomFieldInputs.svelte';

  interface ComplianceDoc {
    id: string;
    subjectType: 'VEHICLE' | 'TRAILER' | 'DRIVER';
    subjectId: string;
    docType: string;
    expiresAt: string;
    reference?: string | null;
    status: 'VALID' | 'EXPIRING' | 'EXPIRED';
  }

  interface MaintenanceOrder {
    id: string;
    status: string;
    description: string;
    dueDate: string | null;
  }

  interface Overview {
    openWorkOrders: number;
    maintenanceDue: MaintenanceOrder[];
    complianceExpiring: ComplianceDoc[];
    complianceExpired: ComplianceDoc[];
  }

  interface Asset {
    id: string;
    unitNumber: string;
    status: string;
    carrierId: string | null;
  }

  interface Driver {
    id: string;
    firstName: string;
    lastName: string;
    status: string;
    licenseNumber?: string | null;
    carrierId: string | null;
  }

  type AssetKind = 'vehicle' | 'trailer' | 'driver';
  interface AssetForm {
    kind: AssetKind;
    unitNumber: string;
    type: string;
    plate: string;
    make: string;
    model: string;
    year: string;
    capacityPallets: string;
    // Driver fields
    firstName: string;
    lastName: string;
    licenseNumber: string;
    phone: string;
    email: string;
  }

  interface CustomFieldDef {
    key: string;
    label: string;
    type: 'TEXT' | 'NUMBER' | 'DATE' | 'BOOLEAN' | 'SELECT';
    options?: { value: string; label: string }[];
    required: boolean;
    showInList?: boolean;
  }

  const vehicleTypes = ['TRACTOR', 'STRAIGHT_TRUCK', 'VAN', 'OTHER'];
  const trailerTypes = ['DRY_VAN', 'REEFER', 'FLATBED', 'TANKER', 'OTHER'];

  let overview = $state<Overview | null>(null);
  let vehicles = $state<Asset[]>([]);
  let trailers = $state<Asset[]>([]);
  let drivers = $state<Driver[]>([]);
  let loading = $state(true);
  let savingAsset = $state(false);
  let error = $state('');
  let activeTab = $state('vehicles');
  let assetForm = $state<AssetForm>(emptyAssetForm('vehicle'));
  let showCreate = $state(false);
  let showSchedule = $state(false);
  let assetFieldDefs = $state<CustomFieldDef[]>([]);
  let assetCustomData = $state<Record<string, unknown>>({});

  function emptyAssetForm(kind: AssetKind): AssetForm {
    return {
      kind,
      unitNumber: '',
      type: kind === 'vehicle' ? 'TRACTOR' : 'DRY_VAN',
      plate: '',
      make: '',
      model: '',
      year: '',
      capacityPallets: '',
      firstName: '',
      lastName: '',
      licenseNumber: '',
      phone: '',
      email: '',
    };
  }

  // AssetStatus → visual tone. Drivers use ACTIVE/INACTIVE (handled separately).
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

  function driverTone(status: string): Tone {
    return status === 'ACTIVE' ? 'ok' : 'neutral';
  }

  function complianceTone(status: string): Tone {
    return status === 'EXPIRED' ? 'danger' : status === 'EXPIRING' ? 'warn' : 'ok';
  }

  function fmtDate(d: string | null): string {
    return formatDate(d);
  }

  // Internal fleet = no carrier assigned.
  const internalVehicles = $derived(vehicles.filter((v) => v.carrierId === null));
  const internalTrailers = $derived(trailers.filter((t) => t.carrierId === null));
  const internalDrivers = $derived(drivers.filter((d) => d.carrierId === null));

  // Expired first (red), then expiring (amber).
  const complianceAttention = $derived(
    overview ? [...overview.complianceExpired, ...overview.complianceExpiring] : [],
  );

  // --- Preventive maintenance schedules --------------------------------------
  interface ScheduleDue {
    status: 'OK' | 'DUE_SOON' | 'DUE' | 'OVERDUE';
    nextDueDate: string | null;
    nextDueKm: number | null;
    daysUntilDue: number | null;
    kmUntilDue: number | null;
    isDue: boolean;
  }
  interface Schedule {
    id: string;
    name: string;
    type: string;
    intervalDays: number | null;
    intervalKm: number | null;
    leadDays: number;
    isActive: boolean;
    vehicleId: string | null;
    trailerId: string | null;
    currentOdometerKm: number | null;
    due: ScheduleDue;
  }

  let schedules = $state<Schedule[]>([]);
  let savingSchedule = $state(false);
  let mxView = $state<ViewId>('table');

  const MX_KANBAN_COLS: { status: string; label: string }[] = [
    { status: 'OVERDUE', label: 'En retard' },
    { status: 'DUE', label: 'Dû' },
    { status: 'DUE_SOON', label: 'Bientôt' },
    { status: 'OK', label: 'OK' },
  ];
  // asset value encodes kind+id: "vehicle:<id>" | "trailer:<id>"
  let scheduleForm = $state({
    asset: '',
    name: '',
    intervalDays: '',
    intervalKm: '',
    leadDays: '7',
  });

  function scheduleTone(s: string): Tone {
    return s === 'OVERDUE' ? 'danger' : s === 'DUE' ? 'warn' : s === 'DUE_SOON' ? 'info' : 'ok';
  }
  function assetLabel(s: Schedule): string {
    if (s.vehicleId) return vehicles.find((v) => v.id === s.vehicleId)?.unitNumber ?? 'véhicule';
    if (s.trailerId) return trailers.find((t) => t.id === s.trailerId)?.unitNumber ?? 'remorque';
    return '—';
  }
  function intervalLabel(s: Schedule): string {
    const parts: string[] = [];
    if (s.intervalDays) parts.push(`${s.intervalDays} j`);
    if (s.intervalKm) parts.push(`${s.intervalKm.toLocaleString('fr-CA')} km`);
    return parts.join(' · ') || '—';
  }
  function nextDueLabel(s: Schedule): string {
    const parts: string[] = [];
    if (s.due.nextDueDate) parts.push(fmtDate(s.due.nextDueDate));
    if (s.due.nextDueKm != null) parts.push(`${s.due.nextDueKm.toLocaleString('fr-CA')} km`);
    return parts.join(' · ') || '—';
  }

  const pmOverdue = $derived(
    schedules.filter((s) => s.isActive && s.due.status === 'OVERDUE').length,
  );
  const pmDue = $derived(schedules.filter((s) => s.isActive && s.due.status === 'DUE').length);
  const pmDueSoon = $derived(
    schedules.filter((s) => s.isActive && s.due.status === 'DUE_SOON').length,
  );
  const pmActionable = $derived(
    [...schedules]
      .filter((s) => s.isActive)
      .sort(
        (a, b) =>
          (b.due.isDue ? 1 : 0) - (a.due.isDue ? 1 : 0) ||
          (a.due.daysUntilDue ?? 9999) - (b.due.daysUntilDue ?? 9999),
      ),
  );

  async function loadSchedules() {
    try {
      schedules = await api<Schedule[]>('/fleet/maintenance-schedules');
    } catch {
      /* non-critical */
    }
  }

  async function createSchedule(e: SubmitEvent) {
    e.preventDefault();
    if (!scheduleForm.asset || !scheduleForm.name.trim()) return;
    if (!scheduleForm.intervalDays && !scheduleForm.intervalKm) {
      toast.error('Renseigne au moins un intervalle (jours ou km)');
      return;
    }
    savingSchedule = true;
    try {
      const [kind, id] = scheduleForm.asset.split(':');
      await api('/fleet/maintenance-schedules', {
        method: 'POST',
        body: {
          [kind === 'vehicle' ? 'vehicleId' : 'trailerId']: id,
          name: scheduleForm.name.trim(),
          intervalDays: scheduleForm.intervalDays ? Number(scheduleForm.intervalDays) : undefined,
          intervalKm: scheduleForm.intervalKm ? Number(scheduleForm.intervalKm) : undefined,
          leadDays: scheduleForm.leadDays ? Number(scheduleForm.leadDays) : undefined,
        },
      });
      toast.success("Plan d'entretien créé");
      scheduleForm = { asset: '', name: '', intervalDays: '', intervalKm: '', leadDays: '7' };
      showSchedule = false;
      await loadSchedules();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Échec de la création du plan');
    } finally {
      savingSchedule = false;
    }
  }

  async function generateFromSchedule(id: string) {
    try {
      await api(`/fleet/maintenance-schedules/${id}/generate-order`, { method: 'POST' });
      toast.success('Work order généré — asset en maintenance');
      await Promise.all([loadSchedules(), load()]);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Échec de la génération');
    }
  }
  async function toggleSchedule(s: Schedule) {
    try {
      await api(`/fleet/maintenance-schedules/${s.id}`, {
        method: 'PATCH',
        body: { isActive: !s.isActive },
      });
      await loadSchedules();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Échec');
    }
  }
  async function deleteSchedule(id: string) {
    if (!(await confirmAction("Supprimer ce plan d'entretien ?"))) return;
    try {
      await api(`/fleet/maintenance-schedules/${id}`, { method: 'DELETE' });
      await loadSchedules();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Échec');
    }
  }

  async function load() {
    loading = true;
    error = '';
    try {
      const [ov, veh, trl, drv] = await Promise.all([
        api<Overview>('/fleet/overview'),
        api<Paginated<Asset>>('/fleet/data/vehicles', { query: { pageSize: 100 } }),
        api<Paginated<Asset>>('/fleet/data/trailers', { query: { pageSize: 100 } }),
        api<Paginated<Driver>>('/fleet/data/drivers', { query: { pageSize: 100 } }),
      ]);
      overview = ov;
      vehicles = veh.items;
      trailers = trl.items;
      drivers = drv.items;
      void loadSchedules();
    } catch (e) {
      error = e instanceof ApiError ? e.message : 'Failed to load fleet';
      toast.error(error);
    } finally {
      loading = false;
    }
  }

  async function fetchAssetFieldDefs(kind: AssetKind) {
    if (kind === 'driver') {
      assetFieldDefs = [];
      assetCustomData = {};
      return;
    }
    const entityType = kind === 'vehicle' ? 'VEHICLE' : 'TRAILER';
    assetFieldDefs = await api<CustomFieldDef[]>('/fleet/custom-fields', {
      query: { entityType },
    }).catch(() => [] as CustomFieldDef[]);
    assetCustomData = {};
  }

  function setAssetKind(kind: AssetKind) {
    assetForm.kind = kind;
    assetForm.type = kind === 'vehicle' ? 'TRACTOR' : 'DRY_VAN';
    activeTab = kind === 'vehicle' ? 'vehicles' : kind === 'trailer' ? 'trailers' : 'drivers';
    void fetchAssetFieldDefs(kind);
  }

  function resetAssetForm(kind: AssetKind = assetForm.kind) {
    assetForm = emptyAssetForm(kind);
    assetCustomData = {};
  }

  function clean<T extends Record<string, unknown>>(payload: T): T {
    return Object.fromEntries(
      Object.entries(payload).filter(
        ([, value]) => value !== '' && value !== undefined && value !== null,
      ),
    ) as T;
  }

  const assetFormValid = $derived(
    assetForm.kind === 'driver'
      ? assetForm.firstName.trim() !== '' && assetForm.lastName.trim() !== ''
      : assetForm.unitNumber.trim() !== '',
  );

  async function createAsset(event: SubmitEvent) {
    event.preventDefault();
    if (!assetFormValid) return;
    savingAsset = true;
    error = '';
    try {
      let label: string;
      if (assetForm.kind === 'vehicle') {
        await api('/fleet/data/vehicles', {
          method: 'POST',
          body: clean({
            unitNumber: assetForm.unitNumber.trim(),
            type: assetForm.type,
            plate: assetForm.plate.trim(),
            make: assetForm.make.trim(),
            model: assetForm.model.trim(),
            year: assetForm.year ? Number(assetForm.year) : undefined,
            customData: Object.keys(assetCustomData).length > 0 ? assetCustomData : undefined,
          }),
        });
        activeTab = 'vehicles';
        label = assetForm.unitNumber.trim();
      } else if (assetForm.kind === 'trailer') {
        await api('/fleet/data/trailers', {
          method: 'POST',
          body: clean({
            unitNumber: assetForm.unitNumber.trim(),
            type: assetForm.type,
            plate: assetForm.plate.trim(),
            capacityPallets: assetForm.capacityPallets
              ? Number(assetForm.capacityPallets)
              : undefined,
            customData: Object.keys(assetCustomData).length > 0 ? assetCustomData : undefined,
          }),
        });
        activeTab = 'trailers';
        label = assetForm.unitNumber.trim();
      } else {
        await api('/fleet/data/drivers', {
          method: 'POST',
          body: clean({
            firstName: assetForm.firstName.trim(),
            lastName: assetForm.lastName.trim(),
            licenseNumber: assetForm.licenseNumber.trim(),
            phone: assetForm.phone.trim(),
            email: assetForm.email.trim(),
          }),
        });
        activeTab = 'drivers';
        label = `${assetForm.firstName.trim()} ${assetForm.lastName.trim()}`;
      }
      toast.success(`${label} ajouté à la flotte`);
      resetAssetForm(assetForm.kind);
      showCreate = false;
      await load();
    } catch (e) {
      error = e instanceof ApiError ? e.message : "Impossible d'ajouter l'asset";
      toast.error(error);
    } finally {
      savingAsset = false;
    }
  }

  $effect(() => {
    void load();
  });

  const tabs = [
    { id: 'vehicles', label: 'Vehicles' },
    { id: 'trailers', label: 'Trailers' },
    { id: 'drivers', label: 'Drivers' },
  ];
</script>

<PageHeader
  title="Registre et plans préventifs"
  subtitle="Référentiel existant : actifs, conformité et récurrences."
>
  {#snippet actions()}
    <Button variant="secondary" href="/fleet">Poste flotte</Button>
    <Button
      onclick={() => {
        showSchedule = true;
      }}
      variant="secondary">Planifier un entretien</Button
    >
    <Button
      onclick={() => {
        showCreate = true;
        void fetchAssetFieldDefs(assetForm.kind);
      }}>Ajouter</Button
    >
  {/snippet}
</PageHeader>

{#if loading}
  <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
    {#each Array(4) as _, i (i)}<Skeleton />{/each}
  </div>
{:else if error}
  <ErrorNotice message={error} onretry={load} />
{:else if overview}
  <!-- A. Attention cards -->
  <div class="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
    <a href="#compliance" class="block">
      <Card>
        <div class="text-xs font-medium text-ink-muted">Work orders ouverts</div>
        <div class="mt-1 text-3xl font-bold text-ink">{overview.openWorkOrders}</div>
      </Card>
    </a>
    <a href="#compliance" class="block">
      <Card>
        <div class="text-xs font-medium text-ink-muted">Maintenance due (7j)</div>
        <div class="mt-1 text-3xl font-bold text-ink">{overview.maintenanceDue.length}</div>
      </Card>
    </a>
    <a href="#compliance" class="block">
      <Card>
        <div class="text-xs font-medium text-warn">Conformité expirante (30j)</div>
        <div class="mt-1 text-3xl font-bold text-warn">{overview.complianceExpiring.length}</div>
      </Card>
    </a>
    <a href="#compliance" class="block">
      <Card>
        <div class="text-xs font-medium text-danger">Conformité expirée</div>
        <div class="mt-1 text-3xl font-bold text-danger">{overview.complianceExpired.length}</div>
      </Card>
    </a>
  </div>

  <Modal bind:open={showCreate} title="Ajouter un asset" size="lg">
    <form id="asset-create-form" onsubmit={createAsset}>
      <div class="mb-3 flex flex-wrap items-center gap-3">
        <p class="text-xs font-semibold tracking-[0.18em] text-ink-faint uppercase">Type</p>
        <div class="flex rounded-lg bg-surface-muted p-1 text-xs font-semibold">
          <button
            type="button"
            class={`rounded-md px-3 py-1 ${assetForm.kind === 'vehicle' ? 'bg-surface text-ink shadow-sm' : 'text-ink-muted'}`}
            onclick={() => setAssetKind('vehicle')}>Véhicule</button
          >
          <button
            type="button"
            class={`rounded-md px-3 py-1 ${assetForm.kind === 'trailer' ? 'bg-surface text-ink shadow-sm' : 'text-ink-muted'}`}
            onclick={() => setAssetKind('trailer')}>Remorque</button
          >
          <button
            type="button"
            class={`rounded-md px-3 py-1 ${assetForm.kind === 'driver' ? 'bg-surface text-ink shadow-sm' : 'text-ink-muted'}`}
            onclick={() => setAssetKind('driver')}>Chauffeur</button
          >
        </div>
      </div>

      {#if assetForm.kind === 'driver'}
        <div class="grid gap-3 sm:grid-cols-2">
          <label class="space-y-1 text-xs font-semibold text-ink-muted">
            Prénom
            <Input bind:value={assetForm.firstName} placeholder="Jean" required />
          </label>
          <label class="space-y-1 text-xs font-semibold text-ink-muted">
            Nom
            <Input bind:value={assetForm.lastName} placeholder="Tremblay" required />
          </label>
          <label class="space-y-1 text-xs font-semibold text-ink-muted">
            Permis #
            <Input bind:value={assetForm.licenseNumber} placeholder="T1234-5678" />
          </label>
          <label class="space-y-1 text-xs font-semibold text-ink-muted">
            Téléphone
            <Input bind:value={assetForm.phone} placeholder="514-555-0199" />
          </label>
          <label class="space-y-1 text-xs font-semibold text-ink-muted sm:col-span-2">
            Courriel
            <Input
              bind:value={assetForm.email}
              type="email"
              placeholder="jean.tremblay@flotte.dev"
            />
          </label>
        </div>
      {:else}
        <div class="grid gap-3 sm:grid-cols-2">
          <label class="space-y-1 text-xs font-semibold text-ink-muted">
            Unit #
            <Input
              bind:value={assetForm.unitNumber}
              placeholder={assetForm.kind === 'vehicle' ? 'TRK-104' : 'TRL-204'}
              required
            />
          </label>
          <label class="space-y-1 text-xs font-semibold text-ink-muted">
            Type
            <Select bind:value={assetForm.type}>
              {#each assetForm.kind === 'vehicle' ? vehicleTypes : trailerTypes as type (type)}
                <option value={type}>{type}</option>
              {/each}
            </Select>
          </label>
          <label class="space-y-1 text-xs font-semibold text-ink-muted">
            Plaque
            <Input bind:value={assetForm.plate} placeholder="QC-4821" />
          </label>
          {#if assetForm.kind === 'vehicle'}
            <label class="space-y-1 text-xs font-semibold text-ink-muted">
              Marque
              <Input bind:value={assetForm.make} placeholder="Freightliner" />
            </label>
            <label class="space-y-1 text-xs font-semibold text-ink-muted">
              Modèle
              <Input bind:value={assetForm.model} placeholder="Cascadia" />
            </label>
            <label class="space-y-1 text-xs font-semibold text-ink-muted">
              Année
              <Input bind:value={assetForm.year} type="number" placeholder="2024" />
            </label>
          {:else}
            <label class="space-y-1 text-xs font-semibold text-ink-muted">
              Palettes
              <Input bind:value={assetForm.capacityPallets} type="number" placeholder="26" />
            </label>
          {/if}
        </div>
        {#if assetFieldDefs.length > 0}
          <div class="mt-3">
            <CustomFieldInputs definitions={assetFieldDefs} bind:data={assetCustomData} />
          </div>
        {/if}
      {/if}
    </form>
    {#snippet footer()}
      <Button
        variant="secondary"
        onclick={() => {
          showCreate = false;
        }}>Annuler</Button
      >
      <Button
        variant="primary"
        loading={savingAsset}
        disabled={!assetFormValid}
        onclick={(e) => {
          const form = document.getElementById('asset-create-form') as HTMLFormElement | null;
          form?.requestSubmit();
        }}>Ajouter</Button
      >
    {/snippet}
  </Modal>

  <!-- B. Compliance attention list -->
  <div id="compliance" class="mb-5">
    <h2 class="mb-2 text-sm font-semibold text-ink">Conformité à surveiller</h2>
    <Card padded={false}>
      {#if complianceAttention.length === 0}
        <EmptyState message="Aucun document à surveiller." />
      {:else}
        <div class="divide-y divide-edge">
          {#each complianceAttention as doc (doc.id)}
            <div class="flex items-center gap-3 px-4 py-2.5 text-sm">
              <Badge tone={complianceTone(doc.status)}>{doc.status}</Badge>
              <span class="font-medium text-ink">{doc.docType}</span>
              <span class="text-ink-muted">
                {doc.subjectType.toLowerCase()} · {doc.subjectId}
              </span>
              {#if doc.reference}<span class="text-ink-faint">{doc.reference}</span>{/if}
              <span class="ml-auto text-ink-muted">expire le {fmtDate(doc.expiresAt)}</span>
            </div>
          {/each}
        </div>
      {/if}
    </Card>
  </div>

  <!-- B2. Preventive maintenance schedules -->
  <Modal bind:open={showSchedule} title="Planifier un entretien préventif" size="md">
    <form id="schedule-create-form" class="grid gap-3" onsubmit={createSchedule}>
      <label class="space-y-1 text-xs font-semibold text-ink-muted">
        Asset
        <Select bind:value={scheduleForm.asset}>
          <option value="">Choisir…</option>
          {#each internalVehicles as v (v.id)}<option value={`vehicle:${v.id}`}
              >{v.unitNumber} (véh.)</option
            >{/each}
          {#each internalTrailers as t (t.id)}<option value={`trailer:${t.id}`}
              >{t.unitNumber} (rem.)</option
            >{/each}
        </Select>
      </label>
      <label class="space-y-1 text-xs font-semibold text-ink-muted">
        Nom du plan
        <Input bind:value={scheduleForm.name} placeholder="Vidange, inspection DOT…" />
      </label>
      <div class="grid gap-3 sm:grid-cols-3">
        <label class="space-y-1 text-xs font-semibold text-ink-muted">
          Tous les (jours)
          <Input bind:value={scheduleForm.intervalDays} type="number" min="1" placeholder="90" />
        </label>
        <label class="space-y-1 text-xs font-semibold text-ink-muted">
          ou (km)
          <Input bind:value={scheduleForm.intervalKm} type="number" min="1" placeholder="20000" />
        </label>
        <label class="space-y-1 text-xs font-semibold text-ink-muted">
          Préavis (j)
          <Input bind:value={scheduleForm.leadDays} type="number" min="0" />
        </label>
      </div>
    </form>
    {#snippet footer()}
      <Button
        variant="secondary"
        onclick={() => {
          showSchedule = false;
        }}>Annuler</Button
      >
      <Button
        variant="primary"
        loading={savingSchedule}
        disabled={!scheduleForm.asset || !scheduleForm.name.trim()}
        onclick={() => {
          const form = document.getElementById('schedule-create-form') as HTMLFormElement | null;
          form?.requestSubmit();
        }}>Planifier</Button
      >
    {/snippet}
  </Modal>

  <div class="mb-5">
    <div class="mb-2 flex flex-wrap items-center gap-2">
      <h2 class="text-sm font-semibold text-ink">Maintenance préventive</h2>
      {#if pmOverdue > 0}<Badge tone="danger">{pmOverdue} en retard</Badge>{/if}
      {#if pmDue > 0}<Badge tone="warn">{pmDue} dû</Badge>{/if}
      {#if pmDueSoon > 0}<Badge tone="info">{pmDueSoon} bientôt</Badge>{/if}
      <span class="ml-auto"
        ><ViewToggle bind:view={mxView} views={['table', 'cards', 'kanban']} /></span
      >
    </div>

    {#if schedules.length === 0}
      <Card>
        <EmptyState
          message="Aucun plan d'entretien. Crée un intervalle (km/jours) — l'échéance se calcule toute seule et alimente le Workbench."
        />
      </Card>
    {:else if mxView === 'table'}
      <Card padded={false}>
        <div class="divide-y divide-edge">
          {#each pmActionable as s (s.id)}
            <div
              class={`flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm ${s.isActive ? '' : 'opacity-50'}`}
            >
              <Badge tone={scheduleTone(s.due.status)}>{s.due.status}</Badge>
              <span class="font-medium text-ink">{assetLabel(s)}</span>
              <span class="text-ink-muted">{s.name}</span>
              <span class="text-xs text-ink-faint">chaque {intervalLabel(s)}</span>
              <span class="ml-auto text-xs text-ink-muted">
                prochaine: {nextDueLabel(s)}
                {#if s.due.daysUntilDue != null}
                  <span class="text-ink-faint">({s.due.daysUntilDue} j)</span>
                {/if}
              </span>
              <div class="flex gap-1">
                {#if s.due.isDue && s.isActive}
                  <button
                    class="rounded-md bg-accent px-2.5 py-1 text-xs font-semibold text-white hover:bg-accent-strong"
                    onclick={() => generateFromSchedule(s.id)}>Générer WO</button
                  >
                {/if}
                <button
                  class="rounded-md border border-edge px-2.5 py-1 text-xs font-semibold text-ink-muted hover:bg-surface-muted"
                  onclick={() => toggleSchedule(s)}>{s.isActive ? 'Pause' : 'Activer'}</button
                >
                <button
                  class="rounded-md px-2.5 py-1 text-xs font-semibold text-danger hover:bg-danger/10"
                  onclick={() => deleteSchedule(s.id)}
                  aria-label="Supprimer le plan">✕</button
                >
              </div>
            </div>
          {/each}
        </div>
      </Card>
    {:else if mxView === 'cards'}
      <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {#each pmActionable as s (s.id)}
          <Card>
            <div class="flex items-start justify-between gap-2">
              <span class="font-semibold text-ink">{assetLabel(s)}</span>
              <Badge tone={scheduleTone(s.due.status)}>{s.due.status}</Badge>
            </div>
            <p class="mt-0.5 text-sm text-ink-muted">{s.name}</p>
            <p class="mt-0.5 text-xs text-ink-faint">chaque {intervalLabel(s)}</p>
            <div class="mt-1 text-xs text-ink-muted">
              prochaine : {nextDueLabel(s)}
              {#if s.due.daysUntilDue != null}
                <span class="text-ink-faint">({s.due.daysUntilDue} j)</span>
              {/if}
            </div>
            <div class="mt-2 flex flex-wrap gap-1">
              {#if s.due.isDue && s.isActive}
                <button
                  class="rounded-md bg-accent px-2.5 py-1 text-xs font-semibold text-white hover:bg-accent-strong"
                  onclick={() => generateFromSchedule(s.id)}>Générer WO</button
                >
              {/if}
              <button
                class="rounded-md border border-edge px-2.5 py-1 text-xs font-semibold text-ink-muted hover:bg-surface-muted"
                onclick={() => toggleSchedule(s)}>{s.isActive ? 'Pause' : 'Activer'}</button
              >
              <button
                class="rounded-md px-2.5 py-1 text-xs font-semibold text-danger hover:bg-danger/10"
                onclick={() => deleteSchedule(s.id)}
                aria-label="Supprimer le plan">✕</button
              >
            </div>
          </Card>
        {/each}
      </div>
    {:else if mxView === 'kanban'}
      <div class="flex gap-3 overflow-x-auto pb-2">
        {#each MX_KANBAN_COLS as col (col.status)}
          {@const items = pmActionable.filter((s) => s.due.status === col.status)}
          <div
            class="flex w-64 shrink-0 flex-col rounded-card border border-edge-soft bg-surface-muted"
          >
            <div class="flex items-center justify-between px-3 py-2">
              <Badge tone={scheduleTone(col.status)}>{col.label}</Badge>
              <span class="font-mono text-xs text-ink-muted">{items.length}</span>
            </div>
            <div class="flex max-h-[65vh] flex-col gap-2 overflow-y-auto px-2 pb-2">
              {#if items.length === 0}
                <p class="px-1 py-3 text-center text-xs text-ink-faint">—</p>
              {:else}
                {#each items as s (s.id)}
                  <div
                    class={`rounded-inner border border-edge-soft bg-surface p-2.5 shadow-sm ${s.isActive ? '' : 'opacity-50'}`}
                  >
                    <div class="font-semibold text-sm text-ink">{assetLabel(s)}</div>
                    <div class="mt-0.5 truncate text-xs text-ink-muted">{s.name}</div>
                    <div class="mt-0.5 text-[11px] text-ink-faint">chaque {intervalLabel(s)}</div>
                    <div class="mt-0.5 text-[11px] text-ink-muted">
                      prochaine : {nextDueLabel(s)}
                    </div>
                    <div class="mt-1.5 flex flex-wrap gap-1">
                      {#if s.due.isDue && s.isActive}
                        <button
                          class="rounded-md bg-accent px-2 py-0.5 text-[11px] font-semibold text-white hover:bg-accent-strong"
                          onclick={() => generateFromSchedule(s.id)}>Générer WO</button
                        >
                      {/if}
                      <button
                        class="rounded-md border border-edge px-2 py-0.5 text-[11px] font-semibold text-ink-muted hover:bg-surface-muted"
                        onclick={() => toggleSchedule(s)}>{s.isActive ? 'Pause' : 'Activer'}</button
                      >
                      <button
                        class="rounded-md px-2 py-0.5 text-[11px] font-semibold text-danger hover:bg-danger/10"
                        onclick={() => deleteSchedule(s.id)}
                        aria-label="Supprimer le plan">✕</button
                      >
                    </div>
                  </div>
                {/each}
              {/if}
            </div>
          </div>
        {/each}
      </div>
    {/if}
  </div>

  <!-- C. Asset roster -->
  <h2 class="mb-2 text-sm font-semibold text-ink">Flotte interne</h2>
  <Tabs {tabs} bind:active={activeTab}>
    {#if activeTab === 'vehicles'}
      <Card padded={false}>
        {#if internalVehicles.length === 0}
          <EmptyState message="Aucun véhicule interne." />
        {:else}
          <div class="divide-y divide-edge">
            {#each internalVehicles as v (v.id)}
              <a
                href={`/fleet/vehicles/${v.id}`}
                class="flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-surface-muted"
              >
                <span class="font-medium text-ink">{v.unitNumber}</span>
                <Badge tone={assetTone(v.status)}>{v.status}</Badge>
              </a>
            {/each}
          </div>
        {/if}
      </Card>
    {:else if activeTab === 'trailers'}
      <Card padded={false}>
        {#if internalTrailers.length === 0}
          <EmptyState message="Aucune remorque interne." />
        {:else}
          <div class="divide-y divide-edge">
            {#each internalTrailers as t (t.id)}
              <a
                href={`/fleet/trailers/${t.id}`}
                class="flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-surface-muted"
              >
                <span class="font-medium text-ink">{t.unitNumber}</span>
                <Badge tone={assetTone(t.status)}>{t.status}</Badge>
              </a>
            {/each}
          </div>
        {/if}
      </Card>
    {:else}
      <Card padded={false}>
        {#if internalDrivers.length === 0}
          <EmptyState message="Aucun chauffeur interne." />
        {:else}
          <div class="divide-y divide-edge">
            {#each internalDrivers as d (d.id)}
              <a
                href={`/fleet/drivers/${d.id}`}
                class="flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-surface-muted"
              >
                <span class="font-medium text-ink">{d.firstName} {d.lastName}</span>
                {#if d.licenseNumber}<span class="text-ink-faint">{d.licenseNumber}</span>{/if}
                <Badge tone={driverTone(d.status)}>{d.status}</Badge>
              </a>
            {/each}
          </div>
        {/if}
      </Card>
    {/if}
  </Tabs>
{/if}
