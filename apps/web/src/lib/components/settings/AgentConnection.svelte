<script lang="ts">
  import { api, ApiError } from '$lib/api/client';
  import { toast } from '$lib/stores/toast';
  import { formatDateTime } from '$lib/format';
  import { streamRuntimeConnect } from '$lib/api/agent-runtime-connect';
  import {
    PageHeader,
    Button,
    Field,
    Input,
    Select,
    Card,
    Badge,
    Skeleton,
  } from '$lib/components/ui';

  interface RuntimeProvider {
    id: string;
    label: string;
    authMode: 'apiKey' | 'login';
    providerKey: string;
    keyEnvVar?: string;
    loginCommand?: string;
    needsBaseUrl?: boolean;
  }

  interface RuntimeConfig {
    provider?: string;
    authMode?: 'apiKey' | 'login';
    defaultModel?: string;
    baseUrl?: string;
    hasApiKey?: boolean;
    connectedAt?: string;
    lastTestAt?: string;
    lastTestOk?: boolean;
    configured?: boolean;
    installed: boolean;
  }

  interface TestResult {
    ok: boolean;
    models?: string[];
    error?: string;
  }

  let providers = $state<RuntimeProvider[]>([]);
  let config = $state<RuntimeConfig | null>(null);
  let error = $state('');
  let loading = $state(true);

  // Form state
  let selectedProviderId = $state('');
  let apiKey = $state('');
  let baseUrl = $state('');
  let defaultModel = $state('');

  // Connect log (login providers)
  let connecting = $state(false);
  let connectLog = $state('');

  // Test result
  let testing = $state(false);
  let testResult = $state<TestResult | null>(null);

  // Saving
  let saving = $state(false);

  const selectedProvider = $derived(providers.find((p) => p.id === selectedProviderId) ?? null);

  async function load() {
    try {
      const [provList, cfg] = await Promise.all([
        api<RuntimeProvider[]>('/agent-runtime/providers'),
        api<RuntimeConfig>('/agent-runtime'),
      ]);
      providers = provList;
      config = cfg;
      // Pre-fill form from saved config
      if (cfg.provider) {
        selectedProviderId = cfg.provider;
      } else if (provList.length > 0) {
        selectedProviderId = provList[0].id;
      }
      defaultModel = cfg.defaultModel ?? '';
      baseUrl = cfg.baseUrl ?? '';
    } catch (e) {
      error = e instanceof ApiError ? e.message : 'Failed to load runtime config';
    } finally {
      loading = false;
    }
  }

  async function connectLogin() {
    connectLog = '';
    connecting = true;
    testResult = null;
    try {
      for await (const evt of streamRuntimeConnect()) {
        if (evt.type === 'text') {
          connectLog += evt.text + '\n';
        } else if (evt.type === 'error') {
          connectLog += `Error: ${evt.message}\n`;
          break;
        } else if (evt.type === 'end') {
          break;
        }
      }
      // Refresh config to pick up connectedAt
      config = await api<RuntimeConfig>('/agent-runtime');
    } catch (e) {
      connectLog += `\nError: ${e instanceof Error ? e.message : String(e)}`;
    } finally {
      connecting = false;
    }
  }

  async function testConnection() {
    testing = true;
    testResult = null;
    error = '';
    try {
      testResult = await api<TestResult>('/agent-runtime/test', { method: 'POST' });
    } catch (e) {
      error = e instanceof ApiError ? e.message : 'Test failed';
    } finally {
      testing = false;
    }
  }

  async function save() {
    if (!selectedProviderId) return;
    saving = true;
    error = '';
    try {
      const body: Record<string, unknown> = {
        provider: selectedProviderId,
      };
      if (apiKey.trim()) body.apiKey = apiKey.trim();
      if (defaultModel.trim()) body.defaultModel = defaultModel.trim();
      if (baseUrl.trim()) body.baseUrl = baseUrl.trim();

      config = await api<RuntimeConfig>('/agent-runtime', { method: 'PUT', body });
      apiKey = ''; // clear the raw key field after save
      toast.success('Runtime config saved');
    } catch (e) {
      error = e instanceof ApiError ? e.message : 'Save failed';
    } finally {
      saving = false;
    }
  }

  async function copySetupCommand() {
    await navigator.clipboard.writeText('pnpm agents:setup');
    toast.success('Copied');
  }

  $effect(() => {
    void load();
  });
</script>

<PageHeader title="Runtime agents" />

<p class="mb-4 text-sm text-ink-muted">
  Configure the LLM provider that powers Hermes — the AI runtime used by ⌘K agents and the dispatch
  assistant. Pick a provider, authenticate, set a default model, and test the connection.
</p>

{#if loading}
  <Card padded={false}><Skeleton rows={4} /></Card>
{:else}
  {#if config !== null && !config.installed}
    <div
      class="mb-4 flex items-start gap-3 rounded-card border border-warning bg-warning-soft px-4 py-3"
    >
      <span class="mt-0.5 text-warning">⚠</span>
      <div class="flex-1 text-sm text-ink">
        <span class="font-semibold">Hermes runtime not installed.</span>
        Run
        <button
          type="button"
          class="mx-1 cursor-pointer rounded bg-surface-muted px-1.5 py-0.5 font-mono text-xs hover:bg-surface-hover"
          onclick={copySetupCommand}
          title="Click to copy">pnpm agents:setup</button
        > to install it.
      </div>
    </div>
  {:else if config !== null && config.configured}
    <div
      class="mb-4 flex flex-wrap items-center gap-3 rounded-card border border-edge bg-surface px-4 py-3 text-sm"
    >
      <Badge tone="ok">Configuré</Badge>
      {#if config.provider}
        <span class="text-ink"
          >Fournisseur : <span class="font-semibold">{config.provider}</span></span
        >
      {/if}
      {#if config.connectedAt}
        <span class="text-ink-muted">Connecté : {formatDateTime(config.connectedAt)}</span>
      {/if}
      {#if config.lastTestAt}
        <span class="text-ink-muted">
          Dernier test : {formatDateTime(config.lastTestAt)}
          {#if config.lastTestOk !== undefined}
            — {config.lastTestOk ? '✅ OK' : '❌ Échec'}
          {/if}
        </span>
      {/if}
    </div>
  {/if}

  {#if error}
    <p class="mb-3 text-sm text-danger">{error}</p>
  {/if}

  <div class="space-y-5">
    <!-- Provider selection -->
    <Card>
      <h2 class="mb-4 text-sm font-semibold text-ink">Fournisseur</h2>
      <Field label="Provider">
        <Select bind:value={selectedProviderId}>
          {#each providers as p (p.id)}
            <option value={p.id}>{p.label}</option>
          {/each}
        </Select>
      </Field>
    </Card>

    <!-- Auth block: conditional on authMode -->
    {#if selectedProvider}
      <Card>
        <h2 class="mb-4 text-sm font-semibold text-ink">Authentification</h2>

        {#if selectedProvider.authMode === 'apiKey'}
          <div class="space-y-3">
            <Field label="Clé API">
              <Input
                type="password"
                bind:value={apiKey}
                placeholder={config?.hasApiKey && config.provider === selectedProviderId
                  ? '••••••••  (configurée — laisser vide pour ne pas changer)'
                  : 'Coller la clé API…'}
              />
            </Field>
            {#if selectedProvider.keyEnvVar}
              <p class="text-xs text-ink-muted">
                Variable d'environnement : <code class="rounded bg-surface-muted px-1 text-xs"
                  >{selectedProvider.keyEnvVar}</code
                >
              </p>
            {/if}
            {#if selectedProvider.needsBaseUrl}
              <Field label="Base URL">
                <Input bind:value={baseUrl} placeholder="https://api.example.com/v1" />
              </Field>
            {/if}
          </div>
        {:else}
          <!-- Login / OAuth / device-code flow -->
          <div class="space-y-3">
            {#if config?.connectedAt && config.provider === selectedProviderId}
              <div class="flex items-center gap-2 text-sm">
                <Badge tone="ok">Connecté</Badge>
                <span class="text-ink-muted">{formatDateTime(config.connectedAt)}</span>
              </div>
            {/if}
            <Button variant="primary" onclick={connectLogin} disabled={connecting}>
              {connecting ? 'Connexion en cours…' : `Connecter ${selectedProvider.label}`}
            </Button>
            {#if connectLog}
              <div
                class="mt-2 max-h-48 overflow-y-auto rounded-card border border-edge bg-surface-muted p-3 font-mono text-xs text-ink whitespace-pre-wrap"
              >
                {connectLog}
              </div>
            {/if}
            {#if selectedProvider.loginCommand}
              <p class="text-xs text-ink-muted">
                Commande : <code class="rounded bg-surface-muted px-1"
                  >{selectedProvider.loginCommand}</code
                >
              </p>
            {/if}
          </div>
        {/if}
      </Card>
    {/if}

    <!-- Default model -->
    <Card>
      <h2 class="mb-4 text-sm font-semibold text-ink">Modèle par défaut</h2>
      <Field label="Modèle (optionnel)">
        <Input bind:value={defaultModel} placeholder="ex. anthropic:claude-sonnet-4-6" />
      </Field>
      <p class="mt-1.5 text-xs text-ink-muted">
        Laissez vide pour utiliser le modèle par défaut du fournisseur. Les agents peuvent
        surcharger ce réglage.
      </p>
    </Card>

    <!-- Test + Save actions -->
    <div class="flex flex-wrap items-start gap-3">
      <Button
        variant="secondary"
        onclick={testConnection}
        disabled={testing || !config?.configured}
      >
        {testing ? 'Test en cours…' : 'Tester la connexion'}
      </Button>
      <Button variant="primary" onclick={save} disabled={saving || !selectedProviderId}>
        {saving ? 'Enregistrement…' : 'Enregistrer'}
      </Button>
    </div>

    <!-- Test result -->
    {#if testResult}
      <div
        class={`rounded-card border px-4 py-3 text-sm ${testResult.ok ? 'border-ok bg-ok-soft text-ok' : 'border-danger bg-danger-soft text-danger'}`}
      >
        {#if testResult.ok}
          <span class="font-semibold">✅ Connexion OK</span>
          {#if testResult.models && testResult.models.length > 0}
            <div class="mt-2 text-xs text-ink-muted">
              Modèles disponibles :
              <ul class="mt-1 list-inside list-disc space-y-0.5">
                {#each testResult.models as m (m)}
                  <li><code class="rounded bg-surface-muted px-1">{m}</code></li>
                {/each}
              </ul>
            </div>
          {/if}
        {:else}
          <span class="font-semibold">❌ Échec</span>
          {#if testResult.error}
            <p class="mt-1 text-xs">{testResult.error}</p>
          {/if}
        {/if}
      </div>
    {/if}
  </div>
{/if}
