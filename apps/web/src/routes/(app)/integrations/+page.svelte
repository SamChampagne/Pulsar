<script lang="ts">
  import { api, ApiError } from '$lib/api/client';
  import { auth } from '$lib/stores/auth';
  import { Badge, Card, EmptyState, ErrorNotice, Input, PageHeader, Select, Skeleton, Textarea } from '$lib/components/ui';
  import {
    PERMISSIONS,
    buildIntegrationRoadmap,
    inferIntegrationKind,
    integrationAttentionRank,
    summarizeIntegrationReadiness,
    type IntegrationKind,
    type IntegrationConnectorStatus,
    type IntegrationOperationsInput,
    type IntegrationSeverity,
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
    fields: Array<'endpointUrl' | 'apiKey' | 'secret' | 'webhookSecret' | 'tenantReference'>;
  };

  const templates: ConnectorTemplate[] = [
    {
      kind: 'erp',
      label: 'ERP / commandes',
      examples: 'Odoo, NetSuite, Dynamics, SAP',
      description: 'Importe clients, commandes et références sans script backend.',
      capabilities: ['orders.import', 'customers.import'],
      fields: ['endpointUrl', 'apiKey', 'tenantReference'],
    },
    {
      kind: 'accounting',
      label: 'Comptabilité',
      examples: 'QuickBooks, Xero, Sage',
      description: 'Exporte factures client et récupère paiements/états.',
      capabilities: ['customer-invoices.export', 'payments.import'],
      fields: ['endpointUrl', 'apiKey', 'tenantReference'],
    },
    {
      kind: 'telematics',
      label: 'Télématique',
      examples: 'Samsara, Geotab, ELD/GPS',
      description: 'Branche positions, statuts véhicule et preuve terrain.',
      capabilities: ['positions.import'],
      fields: ['endpointUrl', 'apiKey'],
    },
    {
      kind: 'edi',
      label: 'EDI / X12',
      examples: '204, 990, 214, 210',
      description: 'Prépare les échanges transport avec partenaires et clients.',
      capabilities: ['tenders.exchange', 'statuses.import'],
      fields: ['endpointUrl', 'secret', 'tenantReference'],
    },
    {
      kind: 'warehouse',
      label: 'WMS / inventaire',
      examples: 'WMS, stocks, réception',
      description: 'Synchronise inventaire, mouvements et disponibilité.',
      capabilities: ['inventory.import'],
      fields: ['endpointUrl', 'apiKey'],
    },
    {
      kind: 'webhook',
      label: 'Webhook sortant',
      examples: 'HTTP callback, n8n, Zapier',
      description: 'Envoie les événements Pulsar vers un système externe.',
      capabilities: ['events.deliver'],
      fields: ['endpointUrl', 'webhookSecret'],
    },
    {
      kind: 'custom',
      label: 'Connecteur custom',
      examples: 'API client, outil interne',
      description: 'Point d’entrée libre pour une intégration spécifique au projet.',
      capabilities: [],
      fields: ['endpointUrl', 'apiKey', 'secret'],
    },
  ];

  const allCapabilities = Array.from(new Set(templates.flatMap((t) => t.capabilities)));

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
    notes: string;
  };

  let integrations = $state<IntegrationRecord[]>([]);
  let error = $state('');
  let notice = $state('');
  let loading = $state(true);
  let saving = $state(false);
  let formOpen = $state(false);
  let form = $state<IntegrationForm>(blankForm('erp'));

  const canManage = $derived($auth?.user.permissions.includes(PERMISSIONS.CORE.INTEGRATIONS_MANAGE) ?? false);
  const selectedTemplate = $derived(templates.find((template) => template.kind === form.kind) ?? templates[0]);
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
      (a, b) => integrationAttentionRank(b.health) - integrationAttentionRank(a.health) || a.name.localeCompare(b.name),
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
      notes: '',
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

  function severityTone(severity: IntegrationSeverity): 'ok' | 'warn' | 'danger' | 'info' | 'neutral' {
    if (severity === 'critical') return 'danger';
    if (severity === 'warning') return 'warn';
    if (severity === 'info') return 'info';
    return 'ok';
  }

  function statusTone(status: IntegrationConnectorStatus): 'ok' | 'warn' | 'danger' | 'info' | 'neutral' {
    if (status === 'ENABLED') return 'ok';
    if (status === 'ERROR') return 'danger';
    return 'neutral';
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
      notes: stringConfig(integration.config, 'notes'),
    };
    formOpen = true;
    notice = '';
    error = '';
  }

  function setKind(kind: IntegrationKind) {
    form.kind = kind;
    form.capabilities = [...requiredCapabilitiesFor(kind)];
    if (!form.name) form.name = templates.find((template) => template.kind === kind)?.label ?? '';
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

  function compactConfig() {
    const config: Record<string, unknown> = {
      kind: form.kind,
      owner: form.owner,
      capabilities: form.capabilities,
    };
    for (const key of ['endpointUrl', 'apiKey', 'secret', 'webhookSecret', 'tenantReference', 'notes'] as const) {
      const value = form[key].trim();
      if (value) config[key] = value;
    }
    return config;
  }

  async function load() {
    loading = true;
    error = '';
    try {
      integrations = await api<IntegrationRecord[]>('/integrations');
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
      await load();
    } catch (e) {
      error = e instanceof ApiError ? e.message : 'Could not save integration';
    } finally {
      saving = false;
    }
  }

  async function toggleStatus(integration: IntegrationRecord) {
    if (!canManage) return;
    const nextStatus: IntegrationConnectorStatus = integration.status === 'ENABLED' ? 'DISABLED' : 'ENABLED';
    saving = true;
    error = '';
    notice = '';
    try {
      await api(`/integrations/${integration.id}`, { method: 'PATCH', body: { status: nextStatus } });
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
  title="Connecteurs projet"
  subtitle="Ajoute ERP, webhooks, EDI, télématique et comptabilité directement depuis l’interface — sans toucher au backend."
/>

<ErrorNotice message={error} onretry={load} />
{#if notice}
  <div class="mb-4 rounded-card border border-ok/25 bg-ok-soft px-4 py-3 text-sm font-medium text-ok">{notice}</div>
{/if}

<section class="mb-5 overflow-hidden rounded-card border border-edge bg-ink text-white shadow-sm">
  <div class="grid gap-5 p-5 xl:grid-cols-[1fr_420px] xl:p-6">
    <div>
      <p class="text-xs font-semibold tracking-[0.24em] text-white/55 uppercase">Interface-first integrations</p>
      <h1 class="mt-2 max-w-3xl text-2xl font-bold tracking-tight sm:text-3xl">
        Le projet configure ses connexions lui-même, avec un assistant simple et des secrets masqués.
      </h1>
      <p class="mt-3 max-w-2xl text-sm leading-6 text-white/68">
        Choisis un type, colle l’URL/API key, sélectionne les capacités, puis active le connecteur quand il est prêt.
        Pulsar garde la gouvernance : statut, santé, capacités manquantes et prochaine action.
      </p>
      <div class="mt-5 flex flex-wrap gap-2">
        {#each templates.slice(0, 4) as template (template.kind)}
          <button
            type="button"
            class="rounded-full bg-white/10 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-white/18 disabled:opacity-50"
            disabled={!canManage}
            onclick={() => openCreate(template.kind)}
          >
            + {template.label}
          </button>
        {/each}
      </div>
      {#if !canManage}
        <p class="mt-3 text-xs text-white/55">Ton rôle peut lire les intégrations, mais pas les modifier.</p>
      {/if}
    </div>
    <div class="grid grid-cols-2 gap-2 text-sm">
      <div class="rounded-xl bg-white/8 p-3 ring-1 ring-white/10">
        <p class="text-xs text-white/55">Connecteurs</p>
        <p class="mt-1 text-2xl font-semibold">{loading ? '—' : summary.total}</p>
      </div>
      <div class="rounded-xl bg-white/8 p-3 ring-1 ring-white/10">
        <p class="text-xs text-white/55">Live</p>
        <p class="mt-1 text-2xl font-semibold">{loading ? '—' : summary.live}</p>
      </div>
      <div class="rounded-xl bg-white/8 p-3 ring-1 ring-white/10">
        <p class="text-xs text-white/55">Bloqués</p>
        <p class="mt-1 text-2xl font-semibold">{loading ? '—' : summary.blocked}</p>
      </div>
      <div class="rounded-xl bg-white/8 p-3 ring-1 ring-white/10">
        <p class="text-xs text-white/55">À configurer</p>
        <p class="mt-1 text-2xl font-semibold">{loading ? '—' : summary.notConfigured}</p>
      </div>
    </div>
  </div>
</section>

<div class="grid gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
  <div class="space-y-4">
    <Card>
      <div class="flex items-start justify-between gap-3">
        <div>
          <h2 class="text-sm font-bold text-ink">Ajouter une intégration</h2>
          <p class="mt-1 text-xs leading-5 text-ink-muted">Des presets compréhensibles côté projet, puis config chiffrée côté API.</p>
        </div>
        <Badge tone={canManage ? 'ok' : 'neutral'}>{canManage ? 'éditable' : 'lecture seule'}</Badge>
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
              <span class="shrink-0 rounded-full bg-surface-muted px-2 py-0.5 text-[10px] font-semibold text-ink-faint">{template.kind}</span>
            </div>
            <p class="mt-2 text-[11px] text-ink-faint">{template.examples}</p>
          </button>
        {/each}
      </div>
    </Card>

    <Card>
      <h2 class="text-sm font-bold text-ink">Ordre recommandé</h2>
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
    </Card>
  </div>

  <div class="space-y-4">
    {#if formOpen}
      <Card>
        <form onsubmit={save} class="space-y-4">
          <div class="flex flex-col gap-3 border-b border-edge-soft pb-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p class="text-xs font-semibold tracking-[0.2em] text-ink-faint uppercase">Configuration projet</p>
              <h2 class="mt-1 text-lg font-bold text-ink">{form.id ? 'Modifier le connecteur' : 'Nouveau connecteur'}</h2>
              <p class="mt-1 text-xs leading-5 text-ink-muted">{selectedTemplate.description}</p>
            </div>
            <button type="button" class="rounded-md border border-edge px-3 py-1.5 text-xs font-semibold text-ink-muted hover:bg-surface-muted" onclick={() => (formOpen = false)}>Fermer</button>
          </div>

          <div class="grid gap-3 md:grid-cols-2">
            <label class="space-y-1 text-xs font-semibold text-ink-muted">
              Type
              <select
                value={form.kind}
                disabled={!!form.id}
                onchange={(event) => setKind((event.currentTarget as HTMLSelectElement).value as IntegrationKind)}
                class="w-full rounded-md border border-edge bg-surface px-3 py-1.5 text-sm text-ink focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none disabled:bg-surface-muted"
              >
                {#each templates as template (template.kind)}
                  <option value={template.kind}>{template.label}</option>
                {/each}
              </select>
            </label>
            <label class="space-y-1 text-xs font-semibold text-ink-muted">
              Statut
              <Select bind:value={form.status}>
                <option value="DISABLED">Désactivé / brouillon</option>
                <option value="ENABLED">Activé</option>
                <option value="ERROR">En erreur</option>
              </Select>
            </label>
            <label class="space-y-1 text-xs font-semibold text-ink-muted">
              Nom affiché
              <Input value={form.name} required placeholder="Odoo production" oninput={(event) => updateName(event.currentTarget.value)} />
            </label>
            <label class="space-y-1 text-xs font-semibold text-ink-muted">
              Clé technique
              <Input bind:value={form.key} required disabled={!!form.id} placeholder="odoo-production" />
            </label>
            <label class="space-y-1 text-xs font-semibold text-ink-muted">
              Responsable
              <Input bind:value={form.owner} placeholder="Operations / Finance / IT" />
            </label>
            <label class="space-y-1 text-xs font-semibold text-ink-muted">
              Référence tenant/projet
              <Input bind:value={form.tenantReference} placeholder="acme-prod, company id, warehouse code" />
            </label>
          </div>

          <div class="grid gap-3 md:grid-cols-2">
            {#if selectedTemplate.fields.includes('endpointUrl')}
              <label class="space-y-1 text-xs font-semibold text-ink-muted">
                URL / endpoint
                <Input bind:value={form.endpointUrl} type="url" placeholder="https://api.client.com" />
              </label>
            {/if}
            {#if selectedTemplate.fields.includes('apiKey')}
              <label class="space-y-1 text-xs font-semibold text-ink-muted">
                API key
                <Input bind:value={form.apiKey} placeholder="Coller ou laisser *** pour garder l’existante" />
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
          </div>

          <div class="rounded-xl border border-edge bg-surface-muted p-3">
            <p class="text-xs font-bold text-ink">Capacités activées</p>
            <p class="mt-1 text-xs text-ink-muted">C’est ça qui dit à Pulsar ce que le connecteur peut réellement faire.</p>
            <div class="mt-3 grid gap-2 sm:grid-cols-2">
              {#each allCapabilities as capability (capability)}
                <label class="flex items-center gap-2 rounded-lg bg-surface px-2 py-2 text-xs text-ink-muted">
                  <input type="checkbox" checked={form.capabilities.includes(capability)} onchange={() => toggleCapability(capability)} />
                  <span>{capability}</span>
                </label>
              {/each}
            </div>
          </div>

          <label class="space-y-1 text-xs font-semibold text-ink-muted">
            Notes de branchement
            <Textarea bind:value={form.notes} rows={3} placeholder="Mapping prévu, sandbox, restrictions, personne contact…" />
          </label>

          <div class="flex flex-wrap items-center justify-between gap-3 border-t border-edge-soft pt-4">
            <p class="text-xs text-ink-faint">Les champs sensibles sont chiffrés côté API et reviennent masqués.</p>
            <button type="submit" disabled={saving || !canManage} class="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-accent-strong disabled:opacity-60">
              {saving ? 'Sauvegarde…' : form.id ? 'Mettre à jour' : 'Créer le connecteur'}
            </button>
          </div>
        </form>
      </Card>
    {/if}

    <Card padded={false}>
      <div class="flex flex-col gap-2 border-b border-edge-soft px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 class="text-sm font-bold text-ink">Connecteurs configurés</h2>
          <p class="text-xs text-ink-muted">État opérationnel + édition rapide sans retour backend.</p>
        </div>
        <Badge tone={summary.attention.length ? 'warn' : 'ok'}>{summary.attention.length ? `${summary.attention.length} à traiter` : 'stable'}</Badge>
      </div>
      {#if loading}
        <div class="p-4"><Skeleton rows={6} /></div>
      {:else if integrations.length === 0}
        <div class="p-4"><EmptyState title="Aucune intégration" message="Choisis un preset à gauche pour ajouter le premier connecteur du projet." /></div>
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
                    {#if integration?.config?.owner}<span class="text-xs text-ink-faint">owner {integration.config.owner}</span>{/if}
                  </div>
                  <p class="mt-1 text-xs leading-5 text-ink-muted">{row.health.reason}</p>
                  <p class="mt-1 text-xs text-ink-faint">{row.health.nextStep}</p>
                  {#if row.health.missingCapabilities.length}
                    <p class="mt-2 text-xs text-danger">Manquant : {row.health.missingCapabilities.join(', ')}</p>
                  {/if}
                </div>
                <div class="flex shrink-0 flex-wrap gap-2">
                  {#if integration}
                    <button type="button" class="rounded-md border border-edge px-3 py-1.5 text-xs font-semibold text-ink-muted hover:bg-surface-muted" onclick={() => editIntegration(integration)}>Modifier</button>
                    <button type="button" disabled={saving || !canManage} class="rounded-md border border-edge px-3 py-1.5 text-xs font-semibold text-ink-muted hover:bg-surface-muted disabled:opacity-50" onclick={() => toggleStatus(integration)}>
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
