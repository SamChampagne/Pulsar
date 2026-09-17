<script lang="ts">
  import { api, ApiError } from '$lib/api/client';
  import { auth } from '$lib/stores/auth';
  import {
    Badge,
    Drawer,
    Card,
    EmptyState,
    ErrorNotice,
    Input,
    PageHeader,
    Select,
    Skeleton,
    Textarea,
  } from '$lib/components/ui';
  import {
    PERMISSIONS,
    WEBHOOK_FORMATS,
    buildIntegrationRoadmap,
    inferIntegrationKind,
    integrationAttentionRank,
    summarizeIntegrationReadiness,
    type DomainEventCatalogEntry,
    type IntegrationKind,
    type IntegrationConnectorStatus,
    type IntegrationOperationsInput,
    type IntegrationSeverity,
    type WebhookFormat,
  } from '@pulsar/shared';

  type IntegrationRecord = IntegrationOperationsInput & {
    id: string;
    config?: Record<string, unknown>;
  };

  type ConnectorTemplate = {
    kind: IntegrationKind;
    label: string;
    examples: string;
    description: string;
    capabilities: string[];
    objects: string[];
    fields: Array<'endpointUrl' | 'apiKey' | 'secret' | 'webhookSecret' | 'tenantReference'>;
  };

  type IntegrationMapping = {
    source: string;
    target: string;
    transform: string;
    required: boolean;
  };

  type StudioCheck = {
    key: string;
    label: string;
    status: 'ok' | 'warning' | 'blocked';
    detail: string;
  };

  type ConnectionTestReport = {
    status: 'ok' | 'warning' | 'blocked';
    summary: string;
    checkedAt: string;
    checks: StudioCheck[];
  };

  type DryRunReport = {
    status: 'ok' | 'warning' | 'blocked';
    summary: string;
    checkedAt: string;
    rows: Array<IntegrationMapping & { status: 'mapped' | 'missing' | 'skipped'; value?: unknown }>;
    output: Record<string, unknown>;
    errors: string[];
  };

  type StudioStep = 'catalog' | 'connection' | 'mapping' | 'activate';

  const templates: ConnectorTemplate[] = [
    {
      kind: 'erp',
      label: 'ERP / commandes',
      examples: 'Odoo, NetSuite, Dynamics, SAP',
      description: 'Importe clients, commandes et références sans script backend.',
      capabilities: ['orders.import', 'customers.import'],
      objects: ['Clients', 'Commandes', 'Produits', 'Adresses'],
      fields: ['endpointUrl', 'apiKey', 'tenantReference'],
    },
    {
      kind: 'accounting',
      label: 'Comptabilité',
      examples: 'QuickBooks, Xero, Sage',
      description: 'Exporte factures client et récupère paiements/états.',
      capabilities: ['customer-invoices.export', 'payments.import'],
      objects: ['Factures', 'Paiements', 'Clients', 'Taxes'],
      fields: ['endpointUrl', 'apiKey', 'tenantReference'],
    },
    {
      kind: 'telematics',
      label: 'Télématique',
      examples: 'Samsara, Geotab, ELD/GPS',
      description: 'Branche positions, statuts véhicule et preuve terrain.',
      capabilities: ['positions.import'],
      objects: ['Véhicules', 'Positions', 'HOS', 'Événements'],
      fields: ['endpointUrl', 'apiKey'],
    },
    {
      kind: 'edi',
      label: 'EDI / X12',
      examples: '204, 990, 214, 210',
      description: 'Prépare les échanges transport avec partenaires et clients.',
      capabilities: ['tenders.exchange', 'statuses.import'],
      objects: ['Tenders', 'Shipments', 'Statuses', 'Factures EDI'],
      fields: ['endpointUrl', 'secret', 'tenantReference'],
    },
    {
      kind: 'warehouse',
      label: 'WMS / inventaire',
      examples: 'WMS, stocks, réception',
      description: 'Synchronise inventaire, mouvements et disponibilité.',
      capabilities: ['inventory.import'],
      objects: ['Items', 'Inventaire', 'Bins', 'Réceptions'],
      fields: ['endpointUrl', 'apiKey'],
    },
    {
      kind: 'webhook',
      label: 'Webhook sortant',
      examples: 'HTTP callback, n8n, Zapier',
      description: 'Envoie les événements Pulsar vers un système externe.',
      capabilities: ['events.deliver'],
      objects: ['Événements', 'Loads', 'Invoices', 'Exceptions'],
      fields: ['endpointUrl', 'webhookSecret'],
    },
    {
      kind: 'custom',
      label: 'Connecteur custom',
      examples: 'API client, outil interne',
      description: 'Point d’entrée libre pour une intégration spécifique au projet.',
      capabilities: [],
      objects: ['Objet custom', 'Payload JSON', 'Fichiers', 'Actions'],
      fields: ['endpointUrl', 'apiKey', 'secret'],
    },
  ];

  const allCapabilities = Array.from(new Set(templates.flatMap((t) => t.capabilities)));
  const allObjects = Array.from(new Set(templates.flatMap((t) => t.objects)));
  const studioSteps: Array<{ id: StudioStep; label: string; help: string }> = [
    { id: 'catalog', label: 'Catalogue', help: 'choisir le connecteur' },
    { id: 'connection', label: 'Connexion', help: 'credentials et portée' },
    { id: 'mapping', label: 'Mapping', help: 'champs + transformations' },
    { id: 'activate', label: 'Activation', help: 'test et mise en live' },
  ];

  function defaultMappings(kind: IntegrationKind): IntegrationMapping[] {
    if (kind === 'erp') {
      return [
        {
          source: 'customer.name',
          target: 'Customer.displayName',
          transform: 'trim',
          required: true,
        },
        {
          source: 'order.reference',
          target: 'TransportOrder.externalRef',
          transform: 'uppercase',
          required: true,
        },
        {
          source: 'order.delivery_date',
          target: 'TransportOrder.requestedDeliveryAt',
          transform: 'date.iso',
          required: false,
        },
      ];
    }
    if (kind === 'accounting') {
      return [
        {
          source: 'invoice.number',
          target: 'Invoice.externalRef',
          transform: 'none',
          required: true,
        },
        {
          source: 'invoice.total',
          target: 'Invoice.amount',
          transform: 'currency.decimal',
          required: true,
        },
        {
          source: 'payment.status',
          target: 'Invoice.paymentStatus',
          transform: 'enum.map',
          required: false,
        },
      ];
    }
    if (kind === 'telematics') {
      return [
        {
          source: 'vehicle.id',
          target: 'FleetAsset.externalRef',
          transform: 'none',
          required: true,
        },
        { source: 'gps.latitude', target: 'Position.lat', transform: 'number', required: true },
        { source: 'gps.longitude', target: 'Position.lng', transform: 'number', required: true },
      ];
    }
    if (kind === 'edi') {
      return [
        { source: 'N9.BM', target: 'Shipment.bolNumber', transform: 'x12.segment', required: true },
        { source: 'AT7.status', target: 'Shipment.status', transform: 'enum.map', required: true },
        {
          source: 'L11.reference',
          target: 'Load.externalRef',
          transform: 'x12.segment',
          required: false,
        },
      ];
    }
    if (kind === 'warehouse') {
      return [
        { source: 'sku', target: 'Item.sku', transform: 'uppercase', required: true },
        {
          source: 'qty_available',
          target: 'Inventory.availableQty',
          transform: 'number',
          required: true,
        },
        { source: 'bin', target: 'WarehouseBin.code', transform: 'trim', required: false },
      ];
    }
    if (kind === 'webhook') {
      return [
        { source: 'event.type', target: 'PulsarEvent.type', transform: 'enum.map', required: true },
        {
          source: 'event.data.id',
          target: 'PulsarEvent.externalId',
          transform: 'none',
          required: true,
        },
        {
          source: 'event.timestamp',
          target: 'PulsarEvent.occurredAt',
          transform: 'date.iso',
          required: false,
        },
      ];
    }
    return [
      {
        source: 'payload.id',
        target: 'ExternalObject.externalId',
        transform: 'none',
        required: true,
      },
      {
        source: 'payload.type',
        target: 'ExternalObject.kind',
        transform: 'enum.map',
        required: false,
      },
    ];
  }

  function defaultSample(kind: IntegrationKind): string {
    if (kind === 'telematics')
      return '{\n  "vehicle": { "id": "TRUCK-42" },\n  "gps": { "latitude": 45.5017, "longitude": -73.5673 }\n}';
    if (kind === 'webhook')
      return '{\n  "event": { "type": "load.delivered", "data": { "id": "LD-1004" }, "timestamp": "2026-06-17T12:00:00Z" }\n}';
    return '{\n  "customer": { "name": "Acme Manufacturing" },\n  "order": { "reference": "SO-1009", "delivery_date": "2026-06-18" }\n}';
  }

  type IntegrationForm = {
    id: string;
    key: string;
    name: string;
    kind: IntegrationKind;
    status: IntegrationConnectorStatus;
    endpointUrl: string;
    apiKey: string;
    secret: string;
    webhookSecret: string;
    tenantReference: string;
    owner: string;
    capabilities: string[];
    objects: string[];
    direction: 'inbound' | 'outbound' | 'bidirectional';
    schedule: 'manual' | 'webhook' | '15min' | 'hourly' | 'daily';
    mappings: IntegrationMapping[];
    samplePayload: string;
    notes: string;
    format: WebhookFormat;
    events: string[];
  };

  let integrations = $state<IntegrationRecord[]>([]);
  let error = $state('');
  let notice = $state('');
  let loading = $state(true);
  let saving = $state(false);
  let testing = $state(false);
  let formOpen = $state(false);
  let form = $state<IntegrationForm>(blankForm('erp'));
  let connectionReport = $state<ConnectionTestReport | null>(null);
  let dryRunReport = $state<DryRunReport | null>(null);
  let eventCatalog = $state<DomainEventCatalogEntry[]>([]);

  const canManage = $derived(
    $auth?.user.permissions.includes(PERMISSIONS.CORE.INTEGRATIONS_MANAGE) ?? false,
  );
  const selectedTemplate = $derived(
    templates.find((template) => template.kind === form.kind) ?? templates[0],
  );
  const studioPreview = $derived([
    { label: 'Type', value: selectedTemplate.label },
    { label: 'Objets', value: form.objects.length ? form.objects.join(', ') : 'à choisir' },
    {
      label: 'Mapping',
      value: `${form.mappings.filter((mapping) => mapping.source && mapping.target).length}/${form.mappings.length} champs prêts`,
    },
    { label: 'Mode', value: `${form.direction} · ${form.schedule}` },
  ]);
  const operations = $derived(
    integrations.map((integration): IntegrationOperationsInput => {
      const kind = kindFromConfig(integration);
      return {
        ...integration,
        kind,
        owner: stringConfig(integration.config, 'owner'),
        requiredCapabilities: requiredCapabilitiesFor(kind),
        capabilities: capabilitiesFromConfig(integration.config),
      };
    }),
  );
  const summary = $derived(summarizeIntegrationReadiness(operations));
  const roadmap = $derived(buildIntegrationRoadmap(operations));
  const rows = $derived(
    [...summary.rows].sort(
      (a, b) =>
        integrationAttentionRank(b.health) - integrationAttentionRank(a.health) ||
        a.name.localeCompare(b.name),
    ),
  );

  function blankForm(kind: IntegrationKind): IntegrationForm {
    const template = templates.find((item) => item.kind === kind) ?? templates[0];
    return {
      id: '',
      key: slugify(template.label),
      name: template.label,
      kind,
      status: 'DISABLED',
      endpointUrl: '',
      apiKey: '',
      secret: '',
      webhookSecret: '',
      tenantReference: '',
      owner: 'Operations',
      capabilities: [...template.capabilities],
      objects: [...template.objects.slice(0, 2)],
      direction: kind === 'webhook' || kind === 'accounting' ? 'outbound' : 'inbound',
      schedule: kind === 'webhook' ? 'webhook' : 'manual',
      mappings: defaultMappings(kind),
      samplePayload: defaultSample(kind),
      notes: '',
      format: 'json',
      events: [],
    };
  }

  function requiredCapabilitiesFor(kind: IntegrationKind): string[] {
    return templates.find((template) => template.kind === kind)?.capabilities ?? [];
  }

  function stringConfig(config: Record<string, unknown> | undefined, key: string): string {
    const value = config?.[key];
    return typeof value === 'string' ? value : '';
  }

  function kindFromConfig(integration: IntegrationRecord): IntegrationKind {
    const configured = stringConfig(integration.config, 'kind') as IntegrationKind;
    return templates.some((template) => template.kind === configured)
      ? configured
      : (integration.kind ?? inferIntegrationKind(integration.key, integration.name));
  }

  function capabilitiesFromConfig(config: Record<string, unknown> | undefined): string[] {
    const raw = config?.capabilities;
    return Array.isArray(raw) ? raw.filter((item): item is string => typeof item === 'string') : [];
  }

  function stringArrayConfig(config: Record<string, unknown> | undefined, key: string): string[] {
    const raw = config?.[key];
    return Array.isArray(raw) ? raw.filter((item): item is string => typeof item === 'string') : [];
  }

  function formatFromConfig(config: Record<string, unknown> | undefined): WebhookFormat {
    const raw = config?.format;
    return (WEBHOOK_FORMATS as readonly string[]).includes(raw as string)
      ? (raw as WebhookFormat)
      : 'json';
  }

  function mappingsFromConfig(
    config: Record<string, unknown> | undefined,
    kind: IntegrationKind,
  ): IntegrationMapping[] {
    const raw = config?.mappings;
    if (!Array.isArray(raw)) return defaultMappings(kind);
    const rows = raw
      .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
      .map((item) => ({
        source: typeof item.source === 'string' ? item.source : '',
        target: typeof item.target === 'string' ? item.target : '',
        transform: typeof item.transform === 'string' ? item.transform : 'none',
        required: Boolean(item.required),
      }))
      .filter((item) => item.source || item.target);
    return rows.length ? rows : defaultMappings(kind);
  }

  function severityTone(
    severity: IntegrationSeverity,
  ): 'ok' | 'warn' | 'danger' | 'info' | 'neutral' {
    if (severity === 'critical') return 'danger';
    if (severity === 'warning') return 'warn';
    if (severity === 'info') return 'info';
    return 'ok';
  }

  function statusTone(
    status: IntegrationConnectorStatus,
  ): 'ok' | 'warn' | 'danger' | 'info' | 'neutral' {
    if (status === 'ENABLED') return 'ok';
    if (status === 'ERROR') return 'danger';
    return 'neutral';
  }

  function studioTone(
    status: 'ok' | 'warning' | 'blocked',
  ): 'ok' | 'warn' | 'danger' | 'info' | 'neutral' {
    if (status === 'ok') return 'ok';
    if (status === 'warning') return 'warn';
    return 'danger';
  }

  function slugify(value: string): string {
    return value
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48);
  }

  function openCreate(kind: IntegrationKind) {
    form = blankForm(kind);
    formOpen = true;
    notice = '';
    error = '';
    connectionReport = null;
    dryRunReport = null;
  }

  function editIntegration(integration: IntegrationRecord) {
    const kind = kindFromConfig(integration);
    form = {
      id: integration.id,
      key: integration.key,
      name: integration.name,
      kind,
      status: integration.status,
      endpointUrl: stringConfig(integration.config, 'endpointUrl'),
      apiKey: stringConfig(integration.config, 'apiKey'),
      secret: stringConfig(integration.config, 'secret'),
      webhookSecret: stringConfig(integration.config, 'webhookSecret'),
      tenantReference: stringConfig(integration.config, 'tenantReference'),
      owner: stringConfig(integration.config, 'owner') || 'Operations',
      capabilities: capabilitiesFromConfig(integration.config),
      objects: stringArrayConfig(integration.config, 'objects').length
        ? stringArrayConfig(integration.config, 'objects')
        : [...(templates.find((template) => template.kind === kind)?.objects.slice(0, 2) ?? [])],
      direction:
        (stringConfig(integration.config, 'direction') as IntegrationForm['direction']) ||
        'inbound',
      schedule:
        (stringConfig(integration.config, 'schedule') as IntegrationForm['schedule']) || 'manual',
      mappings: mappingsFromConfig(integration.config, kind),
      samplePayload: stringConfig(integration.config, 'samplePayload') || defaultSample(kind),
      notes: stringConfig(integration.config, 'notes'),
      format: formatFromConfig(integration.config),
      events: stringArrayConfig(integration.config, 'events'),
    };
    formOpen = true;
    notice = '';
    error = '';
    connectionReport = null;
    dryRunReport = null;
  }

  function setKind(kind: IntegrationKind) {
    const template = templates.find((item) => item.kind === kind) ?? templates[0];
    form.kind = kind;
    form.capabilities = [...requiredCapabilitiesFor(kind)];
    form.objects = [...template.objects.slice(0, 2)];
    form.direction = kind === 'webhook' || kind === 'accounting' ? 'outbound' : 'inbound';
    form.schedule = kind === 'webhook' ? 'webhook' : 'manual';
    form.mappings = defaultMappings(kind);
    form.samplePayload = defaultSample(kind);
    if (!form.name) form.name = template.label;
    if (!form.id) form.key = slugify(form.name || kind);
  }

  function updateName(value: string) {
    form.name = value;
    if (!form.id) form.key = slugify(value);
  }

  function toggleCapability(capability: string) {
    form.capabilities = form.capabilities.includes(capability)
      ? form.capabilities.filter((item) => item !== capability)
      : [...form.capabilities, capability];
  }

  function toggleObject(object: string) {
    form.objects = form.objects.includes(object)
      ? form.objects.filter((item) => item !== object)
      : [...form.objects, object];
  }

  function updateMapping(index: number, field: keyof IntegrationMapping, value: string | boolean) {
    form.mappings = form.mappings.map((mapping, mappingIndex) =>
      mappingIndex === index ? { ...mapping, [field]: value } : mapping,
    );
  }

  function addMapping() {
    form.mappings = [
      ...form.mappings,
      { source: '', target: '', transform: 'none', required: false },
    ];
  }

  function removeMapping(index: number) {
    form.mappings = form.mappings.filter((_, mappingIndex) => mappingIndex !== index);
  }

  function toggleEvent(type: string) {
    form.events = form.events.includes(type)
      ? form.events.filter((item) => item !== type)
      : [...form.events, type];
  }

  function compactConfig() {
    const config: Record<string, unknown> = {
      kind: form.kind,
      owner: form.owner,
      capabilities: form.capabilities,
      objects: form.objects,
      direction: form.direction,
      schedule: form.schedule,
      mappings: form.mappings.filter((mapping) => mapping.source || mapping.target),
    };
    if (form.kind === 'webhook') {
      config.format = form.format;
      config.events = form.events;
    }
    for (const key of [
      'endpointUrl',
      'apiKey',
      'secret',
      'webhookSecret',
      'tenantReference',
      'samplePayload',
      'notes',
    ] as const) {
      const value = form[key].trim();
      if (value) config[key] = value;
    }
    return config;
  }

  async function load() {
    loading = true;
    error = '';
    try {
      [integrations, eventCatalog] = await Promise.all([
        api<IntegrationRecord[]>('/integrations'),
        api<DomainEventCatalogEntry[]>('/integrations/events'),
      ]);
    } catch (e) {
      error = e instanceof ApiError ? e.message : 'Failed to load integrations';
    } finally {
      loading = false;
    }
  }

  async function save(event: SubmitEvent) {
    event.preventDefault();
    if (!canManage) return;
    saving = true;
    error = '';
    notice = '';
    const payload = {
      key: form.key.trim(),
      name: form.name.trim(),
      status: form.status,
      config: compactConfig(),
    };
    try {
      if (form.id) {
        await api(`/integrations/${form.id}`, { method: 'PATCH', body: payload });
        notice = `${payload.name} mis à jour depuis l’interface.`;
      } else {
        await api('/integrations', { method: 'POST', body: payload });
        notice = `${payload.name} ajouté depuis l’interface.`;
      }
      formOpen = false;
      form = blankForm('erp');
      connectionReport = null;
      dryRunReport = null;
      await load();
    } catch (e) {
      error = e instanceof ApiError ? e.message : 'Could not save integration';
    } finally {
      saving = false;
    }
  }

  async function testConnection() {
    if (!canManage || !form.id) return;
    testing = true;
    error = '';
    notice = '';
    try {
      connectionReport = await api<ConnectionTestReport>(`/integrations/${form.id}/test`, {
        method: 'POST',
        body: {},
      });
      notice = connectionReport.summary;
    } catch (e) {
      error = e instanceof ApiError ? e.message : 'Could not test integration';
    } finally {
      testing = false;
    }
  }

  async function runDryRun() {
    if (!canManage || !form.id) return;
    testing = true;
    error = '';
    notice = '';
    try {
      dryRunReport = await api<DryRunReport>(`/integrations/${form.id}/dry-run`, {
        method: 'POST',
        body: {
          samplePayload: form.samplePayload,
          mappings: form.mappings.filter((mapping) => mapping.source || mapping.target),
        },
      });
      notice = dryRunReport.summary;
    } catch (e) {
      error = e instanceof ApiError ? e.message : 'Could not run mapping dry run';
    } finally {
      testing = false;
    }
  }

  async function toggleStatus(integration: IntegrationRecord) {
    if (!canManage) return;
    const nextStatus: IntegrationConnectorStatus =
      integration.status === 'ENABLED' ? 'DISABLED' : 'ENABLED';
    saving = true;
    error = '';
    notice = '';
    try {
      await api(`/integrations/${integration.id}`, {
        method: 'PATCH',
        body: { status: nextStatus },
      });
      notice = `${integration.name} est maintenant ${nextStatus}.`;
      await load();
    } catch (e) {
      error = e instanceof ApiError ? e.message : 'Could not update integration';
    } finally {
      saving = false;
    }
  }

  $effect(() => {
    void load();
  });
</script>

<PageHeader
  title="Intégrations"
  subtitle="Connexions, état de service et correspondance des données."
/>

<ErrorNotice message={error} onretry={load} />
{#if notice}
  <div
    class="mb-4 rounded-card border border-ok/25 bg-ok-soft px-4 py-3 text-sm font-medium text-ok"
  >
    {notice}
  </div>
{/if}

<dl
  class="mb-5 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-edge bg-edge sm:grid-cols-4"
>
  {#each [{ label: 'Connecteurs', value: summary.total }, { label: 'Actifs', value: summary.live }, { label: 'Bloqués', value: summary.blocked }, { label: 'À configurer', value: summary.notConfigured }] as metric (metric.label)}
    <div class="bg-surface p-4">
      <dt class="text-xs text-ink-muted">{metric.label}</dt>
      <dd class="mt-1 text-2xl font-semibold tabular-nums">{loading ? '—' : metric.value}</dd>
    </div>
  {/each}
</dl>

<div class="grid gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
  <div class="space-y-4">
    <Card>
      <div class="flex items-start justify-between gap-3">
        <div>
          <h2 class="text-sm font-bold text-ink">Ajouter une intégration</h2>
          <p class="mt-1 text-xs leading-5 text-ink-muted">
            Des presets compréhensibles côté projet, puis config chiffrée côté API.
          </p>
        </div>
        <Badge tone={canManage ? 'ok' : 'neutral'}>{canManage ? 'éditable' : 'lecture seule'}</Badge
        >
      </div>
      <div class="mt-4 grid gap-2">
        {#each templates as template (template.kind)}
          <button
            type="button"
            disabled={!canManage}
            onclick={() => openCreate(template.kind)}
            class="rounded-xl border border-edge bg-surface px-3 py-3 text-left transition hover:border-accent/40 hover:bg-accent-soft disabled:cursor-not-allowed disabled:opacity-55"
          >
            <div class="flex items-start justify-between gap-2">
              <div>
                <p class="text-sm font-semibold text-ink">{template.label}</p>
                <p class="mt-1 text-xs text-ink-muted">{template.description}</p>
              </div>
              <span
                class="shrink-0 rounded-full bg-surface-muted px-2 py-0.5 text-[10px] font-semibold text-ink-faint"
                >{template.kind}</span
              >
            </div>
            <p class="mt-2 text-[11px] text-ink-faint">{template.examples}</p>
          </button>
        {/each}
      </div>
    </Card>

    <details class="rounded-lg border border-edge bg-surface p-4">
      <summary class="cursor-pointer text-sm font-medium text-ink">Guide de mise en place</summary>
      <div class="mt-3 space-y-3">
        {#each roadmap as phase (phase.phase)}
          <div class="rounded-xl border border-edge p-3">
            <div class="flex items-center justify-between gap-2">
              <p class="text-sm font-semibold text-ink">{phase.title}</p>
              <Badge tone="info">{phase.phase}</Badge>
            </div>
            <p class="mt-1 text-xs leading-5 text-ink-muted">{phase.outcome}</p>
          </div>
        {/each}
      </div>
    </details>
  </div>

  <div class="space-y-4">
    <Card padded={false}>
      <div
        class="flex flex-col gap-2 border-b border-edge-soft px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
      >
        <div>
          <h2 class="text-sm font-bold text-ink">Connecteurs configurés</h2>
          <p class="text-xs text-ink-muted">
            État opérationnel + édition rapide sans retour backend.
          </p>
        </div>
        <Badge tone={summary.attention.length ? 'warn' : 'ok'}
          >{summary.attention.length ? `${summary.attention.length} à traiter` : 'stable'}</Badge
        >
      </div>
      {#if loading}
        <div class="p-4"><Skeleton rows={6} /></div>
      {:else if integrations.length === 0}
        <div class="p-4">
          <EmptyState
            title="Aucune intégration"
            message="Choisis un preset à gauche pour ajouter le premier connecteur du projet."
          />
        </div>
      {:else}
        <div class="divide-y divide-edge-soft">
          {#each rows as row (row.key)}
            {@const integration = integrations.find((item) => item.key === row.key)}
            <article class="px-4 py-4">
              <div class="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div class="min-w-0">
                  <div class="flex flex-wrap items-center gap-2">
                    <p class="truncate text-sm font-semibold text-ink">{row.name}</p>
                    <Badge tone={statusTone(row.status)}>{row.status}</Badge>
                    <Badge tone="neutral">{row.kind}</Badge>
                    {#if integration?.config?.owner}<span class="text-xs text-ink-faint"
                        >owner {integration.config.owner}</span
                      >{/if}
                  </div>
                  <p class="mt-1 text-xs leading-5 text-ink-muted">{row.health.reason}</p>
                  <p class="mt-1 text-xs text-ink-faint">{row.health.nextStep}</p>
                  {#if row.health.missingCapabilities.length}
                    <p class="mt-2 text-xs text-danger">
                      Manquant : {row.health.missingCapabilities.join(', ')}
                    </p>
                  {/if}
                </div>
                <div class="flex shrink-0 flex-wrap gap-2">
                  {#if integration}
                    <button
                      type="button"
                      class="rounded-md border border-edge px-3 py-1.5 text-xs font-semibold text-ink-muted hover:bg-surface-muted"
                      onclick={() => editIntegration(integration)}>Modifier</button
                    >
                    <button
                      type="button"
                      disabled={saving || !canManage}
                      class="rounded-md border border-edge px-3 py-1.5 text-xs font-semibold text-ink-muted hover:bg-surface-muted disabled:opacity-50"
                      onclick={() => toggleStatus(integration)}
                    >
                      {integration.status === 'ENABLED' ? 'Désactiver' : 'Activer'}
                    </button>
                  {/if}
                </div>
              </div>
            </article>
          {/each}
        </div>
      {/if}
    </Card>
  </div>
</div>

<Drawer
  bind:open={formOpen}
  title={form.id ? 'Modifier le connecteur' : 'Nouveau connecteur'}
  width="xl"
  dismissible={!saving && !testing}
>
  <Card padded={false}>
    <form onsubmit={save}>
      <ErrorNotice message={error} />
      {#if notice}<p class="mb-3 text-sm text-ok" role="status">{notice}</p>{/if}
      <div class="border-b border-edge-soft px-4 py-4">
        <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p class="text-xs font-semibold tracking-[0.2em] text-ink-faint uppercase">
              Connect Studio
            </p>
            <h2 class="mt-1 text-lg font-bold text-ink">
              {form.id ? 'Modifier le connecteur' : 'Nouveau connecteur guidé'}
            </h2>
            <p class="mt-1 text-xs leading-5 text-ink-muted">
              Catalogue + connexion + mapping de champs, sans flow n8n libre pour l’instant.
            </p>
          </div>
        </div>
        <div class="mt-4 grid gap-2 md:grid-cols-4">
          {#each studioSteps as step, index (step.id)}
            <div class="rounded-xl border border-edge bg-surface px-3 py-2">
              <div class="flex items-center gap-2">
                <span
                  class="grid size-6 place-items-center rounded-full bg-ink text-[11px] font-bold text-white"
                  >{index + 1}</span
                >
                <p class="text-xs font-bold text-ink">{step.label}</p>
              </div>
              <p class="mt-1 text-[11px] text-ink-faint">{step.help}</p>
            </div>
          {/each}
        </div>
      </div>

      <div class="grid gap-0">
        <div class="space-y-5 p-4">
          <section class="rounded-2xl border border-edge bg-surface-muted p-4">
            <div class="flex items-start justify-between gap-3">
              <div>
                <p class="text-xs font-semibold tracking-[0.18em] text-ink-faint uppercase">
                  1 · Catalogue
                </p>
                <h3 class="mt-1 text-sm font-bold text-ink">Choisir le type d’intégration</h3>
              </div>
              <Badge tone="info">{selectedTemplate.kind}</Badge>
            </div>
            <div class="mt-3 grid gap-2 md:grid-cols-2">
              {#each templates as template (template.kind)}
                <button
                  type="button"
                  disabled={!!form.id}
                  onclick={() => setKind(template.kind)}
                  class={`rounded-xl border px-3 py-3 text-left transition disabled:cursor-not-allowed ${form.kind === template.kind ? 'border-accent bg-accent-soft shadow-sm' : 'border-edge bg-surface hover:border-accent/40'}`}
                >
                  <div class="flex items-start justify-between gap-2">
                    <div>
                      <p class="text-sm font-semibold text-ink">{template.label}</p>
                      <p class="mt-1 text-xs leading-5 text-ink-muted">{template.description}</p>
                    </div>
                    <span
                      class="rounded-full bg-surface-muted px-2 py-0.5 text-[10px] font-semibold text-ink-faint"
                      >{template.kind}</span
                    >
                  </div>
                  <p class="mt-2 text-[11px] text-ink-faint">{template.examples}</p>
                </button>
              {/each}
            </div>
          </section>

          <section class="rounded-2xl border border-edge p-4">
            <p class="text-xs font-semibold tracking-[0.18em] text-ink-faint uppercase">
              2 · Connexion
            </p>
            <div class="mt-3 grid gap-3 md:grid-cols-2">
              <label class="space-y-1 text-xs font-semibold text-ink-muted">
                Nom affiché
                <Input
                  value={form.name}
                  required
                  placeholder="Odoo production"
                  oninput={(event) => updateName(event.currentTarget.value)}
                />
              </label>
              <label class="space-y-1 text-xs font-semibold text-ink-muted">
                Clé technique
                <Input
                  bind:value={form.key}
                  required
                  disabled={!!form.id}
                  placeholder="odoo-production"
                />
              </label>
              <label class="space-y-1 text-xs font-semibold text-ink-muted">
                Responsable
                <Input bind:value={form.owner} placeholder="Operations / Finance / IT" />
              </label>
              <label class="space-y-1 text-xs font-semibold text-ink-muted">
                Référence projet
                <Input
                  bind:value={form.tenantReference}
                  placeholder="acme-prod, company id, warehouse code"
                />
              </label>
              {#if selectedTemplate.fields.includes('endpointUrl')}
                <label class="space-y-1 text-xs font-semibold text-ink-muted">
                  URL / endpoint
                  <Input
                    bind:value={form.endpointUrl}
                    type="url"
                    placeholder="https://api.client.com"
                  />
                </label>
              {/if}
              {#if selectedTemplate.fields.includes('apiKey')}
                <label class="space-y-1 text-xs font-semibold text-ink-muted">
                  API key
                  <Input
                    bind:value={form.apiKey}
                    placeholder="Coller ou laisser *** pour garder l’existante"
                  />
                </label>
              {/if}
              {#if selectedTemplate.fields.includes('secret')}
                <label class="space-y-1 text-xs font-semibold text-ink-muted">
                  Secret
                  <Input bind:value={form.secret} placeholder="Secret EDI / client secret" />
                </label>
              {/if}
              {#if selectedTemplate.fields.includes('webhookSecret')}
                <label class="space-y-1 text-xs font-semibold text-ink-muted">
                  Webhook secret
                  <Input bind:value={form.webhookSecret} placeholder="Signature secret" />
                </label>
              {/if}
              <label class="space-y-1 text-xs font-semibold text-ink-muted">
                Direction
                <Select bind:value={form.direction}>
                  <option value="inbound">Entrant vers Pulsar</option>
                  <option value="outbound">Sortant de Pulsar</option>
                  <option value="bidirectional">Bidirectionnel</option>
                </Select>
              </label>
              <label class="space-y-1 text-xs font-semibold text-ink-muted">
                Fréquence
                <Select bind:value={form.schedule}>
                  <option value="manual">Test manuel</option>
                  <option value="webhook">Temps réel / webhook</option>
                  <option value="15min">Chaque 15 min</option>
                  <option value="hourly">Horaire</option>
                  <option value="daily">Quotidien</option>
                </Select>
              </label>
            </div>
            {#if form.kind === 'webhook'}
              <div class="mt-4 rounded-xl bg-surface-muted p-3">
                <label class="space-y-1 text-xs font-semibold text-ink-muted">
                  Format du corps
                  <Select bind:value={form.format}>
                    {#each WEBHOOK_FORMATS as fmt (fmt)}
                      <option value={fmt}
                        >{fmt === 'json'
                          ? 'JSON — enveloppe Pulsar'
                          : fmt === 'slack'
                            ? 'Slack — webhook entrant'
                            : fmt === 'teams'
                              ? 'Teams — MessageCard'
                              : 'EDI X12 — texte brut'}</option
                      >
                    {/each}
                  </Select>
                </label>
                <p class="mt-2 text-[11px] leading-4 text-ink-faint">
                  Le format ne change pas d’adaptateur : c’est la même livraison, mise en forme pour
                  l’endpoint cible.
                </p>
              </div>
              <div class="mt-3 rounded-xl bg-surface-muted p-3">
                <p class="text-xs font-bold text-ink">Événements diffusés</p>
                <p class="mt-1 text-[11px] leading-4 text-ink-faint">
                  Aucune case cochée = tous les événements du catalogue sont diffusés.
                </p>
                {#if eventCatalog.length === 0}
                  <p class="mt-2 text-xs text-ink-muted">Catalogue d’événements indisponible.</p>
                {:else}
                  <div class="mt-2 grid max-h-56 gap-1 overflow-y-auto pr-1">
                    {#each eventCatalog as entry (entry.type)}
                      <label
                        class="flex items-start gap-2 rounded-lg bg-surface px-2 py-2 text-xs text-ink-muted"
                      >
                        <input
                          type="checkbox"
                          class="mt-0.5"
                          checked={form.events.includes(entry.type)}
                          onchange={() => toggleEvent(entry.type)}
                        />
                        <span>
                          <span class="block font-mono text-[11px] font-semibold text-ink"
                            >{entry.type}</span
                          >
                          <span class="block text-[11px] text-ink-faint">{entry.description}</span>
                        </span>
                      </label>
                    {/each}
                  </div>
                {/if}
              </div>
            {/if}
          </section>

          <section class="rounded-2xl border border-edge p-4">
            <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p class="text-xs font-semibold tracking-[0.18em] text-ink-faint uppercase">
                  3 · Données + mapping
                </p>
                <h3 class="mt-1 text-sm font-bold text-ink">
                  Objets synchronisés et champs mappés
                </h3>
              </div>
              <button
                type="button"
                class="rounded-md border border-edge px-3 py-1.5 text-xs font-semibold text-ink-muted hover:bg-surface-muted"
                onclick={addMapping}>+ champ</button
              >
            </div>

            <div class="mt-3 rounded-xl bg-surface-muted p-3">
              <p class="text-xs font-bold text-ink">Objets métier</p>
              <div class="mt-3 flex flex-wrap gap-2">
                {#each allObjects as object (object)}
                  <label
                    class={`cursor-pointer rounded-full border px-3 py-1.5 text-xs font-semibold ${form.objects.includes(object) ? 'border-accent bg-accent-soft text-accent' : 'border-edge bg-surface text-ink-muted'}`}
                  >
                    <input
                      class="sr-only"
                      type="checkbox"
                      checked={form.objects.includes(object)}
                      onchange={() => toggleObject(object)}
                    />
                    {object}
                  </label>
                {/each}
              </div>
            </div>

            <div class="mt-3 overflow-hidden rounded-xl border border-edge">
              <div
                class="grid grid-cols-[1fr_1fr_150px_90px_44px] gap-0 bg-surface-muted px-3 py-2 text-[11px] font-bold uppercase tracking-wide text-ink-faint"
              >
                <span>Source</span><span>Pulsar</span><span>Transform</span><span>Req.</span><span
                ></span>
              </div>
              {#each form.mappings as mapping, index (index)}
                <div
                  class="grid grid-cols-[1fr_1fr_150px_90px_44px] gap-2 border-t border-edge-soft p-2"
                >
                  <Input
                    value={mapping.source}
                    placeholder="customer.name"
                    oninput={(event) => updateMapping(index, 'source', event.currentTarget.value)}
                  />
                  <Input
                    value={mapping.target}
                    placeholder="Customer.displayName"
                    oninput={(event) => updateMapping(index, 'target', event.currentTarget.value)}
                  />
                  <Input
                    value={mapping.transform}
                    placeholder="trim / enum.map"
                    oninput={(event) =>
                      updateMapping(index, 'transform', event.currentTarget.value)}
                  />
                  <label class="flex items-center justify-center gap-1 text-xs text-ink-muted">
                    <input
                      type="checkbox"
                      checked={mapping.required}
                      onchange={(event) =>
                        updateMapping(index, 'required', event.currentTarget.checked)}
                    />
                    oui
                  </label>
                  <button
                    type="button"
                    class="rounded-md text-xs text-danger hover:bg-danger-soft"
                    onclick={() => removeMapping(index)}>×</button
                  >
                </div>
              {/each}
            </div>
          </section>

          <section class="rounded-2xl border border-edge p-4">
            <p class="text-xs font-semibold tracking-[0.18em] text-ink-faint uppercase">
              4 · Test + activation
            </p>
            <div class="mt-3 grid gap-3 lg:grid-cols-2">
              <label class="space-y-1 text-xs font-semibold text-ink-muted">
                Payload sample / dry run
                <Textarea bind:value={form.samplePayload} rows={8} />
              </label>
              <div class="space-y-3">
                <label class="space-y-1 text-xs font-semibold text-ink-muted">
                  Statut
                  <Select bind:value={form.status}>
                    <option value="DISABLED">Désactivé / brouillon</option>
                    <option value="ENABLED">Activé</option>
                    <option value="ERROR">En erreur</option>
                  </Select>
                </label>
                <div class="rounded-xl border border-edge bg-surface-muted p-3">
                  <p class="text-xs font-bold text-ink">Capacités</p>
                  <div class="mt-2 grid gap-2">
                    {#each allCapabilities as capability (capability)}
                      <label
                        class="flex items-center gap-2 rounded-lg bg-surface px-2 py-2 text-xs text-ink-muted"
                      >
                        <input
                          type="checkbox"
                          checked={form.capabilities.includes(capability)}
                          onchange={() => toggleCapability(capability)}
                        />
                        <span>{capability}</span>
                      </label>
                    {/each}
                  </div>
                </div>
                <label class="space-y-1 text-xs font-semibold text-ink-muted">
                  Notes de branchement
                  <Textarea
                    bind:value={form.notes}
                    rows={3}
                    placeholder="Mapping prévu, sandbox, restrictions, personne contact…"
                  />
                </label>
              </div>
            </div>
          </section>
        </div>

        <aside class="border-t border-edge-soft bg-surface-muted p-4">
          <div class="grid gap-3 lg:grid-cols-[1fr_1fr_220px]">
            <div class="rounded-2xl border border-edge bg-surface p-4">
              <p class="text-xs font-semibold tracking-[0.18em] text-ink-faint uppercase">Résumé</p>
              <h3 class="mt-1 text-base font-bold text-ink">{form.name}</h3>
              <p class="mt-1 text-xs leading-5 text-ink-muted">{selectedTemplate.description}</p>
              <div class="mt-3 space-y-2">
                {#each studioPreview as item (item.label)}
                  <div class="flex items-start justify-between gap-3 text-xs">
                    <span class="text-ink-faint">{item.label}</span>
                    <span class="max-w-[180px] text-right font-semibold text-ink">{item.value}</span
                    >
                  </div>
                {/each}
              </div>
            </div>
            <div class="rounded-2xl border border-edge bg-surface p-4">
              <div class="flex items-start justify-between gap-2">
                <div>
                  <p class="text-xs font-bold text-ink">Test + dry run</p>
                  <p class="mt-1 text-xs leading-5 text-ink-muted">
                    Sauve le connecteur, puis valide endpoint et mapping.
                  </p>
                </div>
                {#if connectionReport}<Badge tone={studioTone(connectionReport.status)}
                    >{connectionReport.status}</Badge
                  >{/if}
              </div>
              {#if connectionReport}
                <div class="mt-3 space-y-2">
                  {#each connectionReport.checks as check (check.key)}
                    <div class="rounded-lg border border-edge-soft px-2 py-2">
                      <div class="flex items-center justify-between gap-2">
                        <span class="text-xs font-semibold text-ink">{check.label}</span>
                        <Badge tone={studioTone(check.status)}>{check.status}</Badge>
                      </div>
                      <p class="mt-1 text-[11px] leading-4 text-ink-muted">{check.detail}</p>
                    </div>
                  {/each}
                </div>
              {:else}
                <ol class="mt-2 space-y-2 text-xs leading-5 text-ink-muted">
                  <li>1. Tester credentials et endpoint.</li>
                  <li>2. Lire un payload sample.</li>
                  <li>3. Valider champs requis.</li>
                  <li>4. Activer quand le dry run passe.</li>
                </ol>
              {/if}
            </div>
            <div class="flex flex-col gap-2">
              <button
                type="button"
                class="rounded-md border border-edge bg-surface px-4 py-2 text-sm font-semibold text-ink-muted hover:bg-white disabled:opacity-50"
                disabled={testing || saving || !canManage || !form.id}
                onclick={testConnection}
              >
                {testing ? 'Test…' : 'Tester connexion'}
              </button>
              <button
                type="button"
                class="rounded-md border border-edge bg-surface px-4 py-2 text-sm font-semibold text-ink-muted hover:bg-white disabled:opacity-50"
                disabled={testing || saving || !canManage || !form.id}
                onclick={runDryRun}
              >
                Dry run mapping
              </button>
              <button
                type="submit"
                disabled={saving || !canManage}
                class="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-accent-strong disabled:opacity-60"
              >
                {saving
                  ? 'Sauvegarde…'
                  : form.id
                    ? 'Mettre à jour le studio'
                    : 'Créer le connecteur'}
              </button>
              {#if !form.id}<p class="text-[11px] leading-4 text-ink-faint">
                  Crée d’abord le connecteur pour activer les tests API.
                </p>{/if}
            </div>
            <div class="rounded-2xl border border-edge bg-surface p-4 lg:col-span-3">
              <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p class="text-xs font-bold text-ink">Résultat dry run</p>
                  <p class="mt-1 text-xs text-ink-muted">
                    Preview de l’objet Pulsar généré à partir du payload sample.
                  </p>
                </div>
                {#if dryRunReport}<Badge tone={studioTone(dryRunReport.status)}
                    >{dryRunReport.status}</Badge
                  >{/if}
              </div>
              {#if dryRunReport}
                <div class="mt-3 grid gap-3 lg:grid-cols-2">
                  <div class="overflow-hidden rounded-xl border border-edge-soft">
                    {#each dryRunReport.rows as row, index (index)}
                      <div
                        class="grid grid-cols-[1fr_1fr_82px] gap-2 border-t border-edge-soft px-3 py-2 text-xs first:border-t-0"
                      >
                        <span class="truncate text-ink-muted">{row.source}</span>
                        <span class="truncate font-semibold text-ink">{row.target}</span>
                        <Badge
                          tone={row.status === 'mapped'
                            ? 'ok'
                            : row.status === 'missing'
                              ? 'warn'
                              : 'neutral'}>{row.status}</Badge
                        >
                      </div>
                    {/each}
                  </div>
                  <pre
                    class="max-h-56 overflow-auto rounded-xl bg-ink p-3 text-[11px] leading-5 text-white/85">{JSON.stringify(
                      dryRunReport.output,
                      null,
                      2,
                    )}</pre>
                </div>
                {#if dryRunReport.errors.length}
                  <div
                    class="mt-3 rounded-xl border border-danger/20 bg-danger-soft px-3 py-2 text-xs text-danger"
                  >
                    {dryRunReport.errors.join(' · ')}
                  </div>
                {/if}
              {:else}
                <div
                  class="mt-3 rounded-xl border border-dashed border-edge px-3 py-4 text-xs text-ink-faint"
                >
                  Aucun dry run exécuté pour cette édition.
                </div>
              {/if}
            </div>
            <p class="text-[11px] leading-5 text-ink-faint lg:col-span-3">
              Les secrets restent côté API chiffrée/masquée. Le studio sauvegarde le catalogue, le
              mapping et le plan d’activation.
            </p>
          </div>
        </aside>
      </div>
    </form>
  </Card>
</Drawer>
