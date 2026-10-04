<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { api, ApiError } from '$lib/api/client';
  import { toast } from '$lib/stores/toast';
  import { formatDateTime } from '$lib/format';
  import { streamRuntimeConnect, type RuntimeConnectPhase } from '$lib/api/agent-runtime-connect';
  import RuntimeHealth from './RuntimeHealth.svelte';
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
    runtimeMode?: 'local' | 'remote';
  }

  interface TestResult {
    ok: boolean;
    models?: { value: string; label: string }[];
    scope?: 'RUNTIME_ONLY';
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
  let connectPhase = $state<RuntimeConnectPhase | 'IDLE' | 'SUCCESS' | 'ERROR' | 'CANCELLED'>(
    'IDLE',
  );
  let connectMessage = $state('');
  let connectSeconds = $state(0);
  let connectAbort: AbortController | undefined;
  const lifetime = new AbortController();
  let clock: ReturnType<typeof setInterval> | undefined;
  const requestSignal = (ms = 15_000) =>
    AbortSignal.any([lifetime.signal, AbortSignal.timeout(ms)]);

  // Test result
  let testing = $state(false);
  let testResult = $state<TestResult | null>(null);

  // Saving
  let saving = $state(false);
  const busy = $derived(connecting || saving || testing);
  const runtimeIdentity = (value: RuntimeConfig) =>
    JSON.stringify([
      value.provider ?? '',
      value.authMode ?? '',
      value.baseUrl ?? '',
      value.defaultModel ?? '',
    ]);
  const codexDeviceLink = $derived(
    selectedProviderId === 'openai-codex' &&
      /https:\/\/auth\.openai\.com\/codex\/device(?:\s|$)/.test(connectLog),
  );

  const selectedProvider = $derived(providers.find((p) => p.id === selectedProviderId) ?? null);
  const dirty = $derived(
    selectedProviderId !== config?.provider ||
      !!apiKey.trim() ||
      defaultModel.trim() !== (config?.defaultModel ?? '') ||
      baseUrl.trim() !== (config?.baseUrl ?? ''),
  );

  function providerChanged(event: Event & { currentTarget: HTMLSelectElement }) {
    selectedProviderId = event.currentTarget.value;
    apiKey = '';
    testResult = null;
    connectLog = '';
    connectPhase = 'IDLE';
    connectMessage = '';
    defaultModel = '';
    baseUrl = selectedProviderId === 'openai' ? 'https://api.openai.com/v1' : '';
  }

  async function load() {
    loading = true;
    error = '';
    try {
      const [provList, cfg] = await Promise.all([
        api<RuntimeProvider[]>('/agent-runtime/providers', { signal: requestSignal() }),
        api<RuntimeConfig>('/agent-runtime', { signal: requestSignal() }),
      ]);
      if (lifetime.signal.aborted) return;
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
      error = e instanceof ApiError ? e.message : 'Impossible de charger la configuration IA';
    } finally {
      loading = false;
    }
  }

  async function connectLogin() {
    if (busy || dirty || !config?.installed) return;
    const expectedIdentity = runtimeIdentity(config);
    const attempt = new AbortController();
    connectAbort = attempt;
    connectLog = '';
    connecting = true;
    testResult = null;
    connectPhase = 'STARTING';
    connectMessage = 'Demande transmise au runner de cette entreprise…';
    connectSeconds = 0;
    clock = setInterval(() => {
      connectSeconds += 1;
    }, 1000);
    try {
      let completed = false;
      for await (const evt of streamRuntimeConnect({ signal: attempt.signal })) {
        if (connectAbort !== attempt || lifetime.signal.aborted) return;
        if (evt.type === 'text') {
          connectLog = (connectLog + evt.text).slice(-20_000);
        } else if (evt.type === 'status') {
          connectPhase = evt.phase;
          connectMessage = evt.message;
        } else if (evt.type === 'error') {
          connectPhase = 'ERROR';
          connectMessage = evt.message;
          break;
        } else if (evt.type === 'end') {
          completed = true;
          break;
        }
      }
      if (!completed) return;
      connectPhase = 'VERIFYING';
      connectMessage = 'Lecture de la confirmation enregistrée…';
      const fresh = await api<RuntimeConfig>('/agent-runtime', {
        signal: AbortSignal.any([attempt.signal, requestSignal()]),
      });
      if (connectAbort !== attempt || lifetime.signal.aborted) return;
      config = fresh;
      if (runtimeIdentity(fresh) !== expectedIdentity) {
        connectPhase = 'ERROR';
        connectMessage =
          'La configuration IA a changé pendant la confirmation. Actualisez la page avant de reconnecter le compte.';
        return;
      }
      connectPhase = fresh.connectedAt ? 'SUCCESS' : 'ERROR';
      connectMessage = fresh.connectedAt
        ? 'Compte connecté. Vérifiez ensuite le runtime, puis essayez une conversation sans action métier.'
        : 'Le processus est terminé sans connexion enregistrée. Actualisez le diagnostic avant de réessayer.';
    } catch (e) {
      if (connectAbort !== attempt || lifetime.signal.aborted) return;
      connectPhase = attempt.signal.aborted ? 'CANCELLED' : 'ERROR';
      connectMessage = attempt.signal.aborted
        ? 'Tentative arrêtée. Aucun redémarrage automatique; vérifiez le statut avant de réessayer.'
        : e instanceof ApiError
          ? e.message
          : 'Impossible de confirmer la connexion. Vérifiez le diagnostic du runner.';
    } finally {
      if (connectAbort === attempt) {
        clearInterval(clock);
        connectAbort = undefined;
        connecting = false;
      }
    }
  }

  function cancelLogin() {
    connectAbort?.abort();
  }

  async function testConnection() {
    testing = true;
    testResult = null;
    error = '';
    try {
      testResult = await api<TestResult>('/agent-runtime/test', {
        method: 'POST',
        signal: requestSignal(90_000),
      });
      config = await api<RuntimeConfig>('/agent-runtime', { signal: requestSignal() });
    } catch (e) {
      error =
        e instanceof ApiError
          ? e.message
          : 'Le contrôle du runtime n’a pas répondu. Consultez le diagnostic avant de réessayer.';
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

      const saved = await api<RuntimeConfig>('/agent-runtime', {
        method: 'PUT',
        body,
        signal: requestSignal(),
      });
      config = {
        ...saved,
        installed: config?.installed ?? false,
        runtimeMode: config?.runtimeMode,
      };
      apiKey = ''; // clear the raw key field after save
      testResult = null;
      toast.success('Configuration IA enregistrée');
    } catch (e) {
      error =
        e instanceof ApiError
          ? e.message
          : 'Enregistrement non confirmé. Actualisez la configuration avant de réessayer.';
    } finally {
      saving = false;
    }
  }

  async function copySetupCommand() {
    await navigator.clipboard.writeText('pnpm agents:setup');
    toast.success('Commande copiée');
  }

  onMount(() => {
    void load();
  });
  onDestroy(() => {
    lifetime.abort();
    connectAbort?.abort();
    clearInterval(clock);
  });
</script>

<PageHeader title="Connexion IA" />

<p class="mb-4 text-sm text-ink-muted">
  Hermes exécute les conversations et missions des agents. Le fournisseur fournit le modèle; Pulsar
  conserve les permissions, les approbations et les plafonds métier.
</p>

<RuntimeHealth />

{#if loading}
  <Card padded={false}><Skeleton rows={4} /></Card>
{:else}
  {#if config !== null && !config.installed}
    <div
      class="mb-4 flex items-start gap-3 rounded-card border border-warning bg-warning-soft px-4 py-3"
    >
      <span class="mt-0.5 text-warning">⚠</span>
      <div class="flex-1 text-sm text-ink">
        {#if config.runtimeMode === 'remote'}
          <span class="font-semibold">Service IA indisponible pour cette entreprise.</span>
          Consultez le diagnostic ci-dessus : l’administrateur doit rattacher ou redémarrer le runner
          dédié. Aucune commande d’installation à lancer dans l’API. Vous pouvez déjà enregistrer vos
          paramètres ci-dessous.
        {:else}
          <span class="font-semibold">Moteur Hermes local non installé.</span>
          L’administrateur serveur doit exécuter
          <button
            type="button"
            class="mx-1 cursor-pointer rounded bg-surface-muted px-1.5 py-0.5 font-mono text-xs hover:bg-surface-hover"
            onclick={copySetupCommand}
            title="Copier la commande">pnpm agents:setup</button
          >. Les clés et modèles se configurent ensuite ici par entreprise.
        {/if}
      </div>
    </div>
  {:else if config !== null && config.configured}
    <div
      class="mb-4 flex flex-wrap items-center gap-3 rounded-card border border-edge bg-surface px-4 py-3 text-sm"
    >
      <Badge tone="neutral">Paramètres enregistrés</Badge>
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
          {#if config.lastTestOk != null}
            — {config.lastTestOk ? 'session runtime ouverte' : 'échec du runtime'}
          {/if}
        </span>
      {/if}
    </div>
  {/if}

  {#if error}
    <p role="alert" class="mb-3 text-sm text-danger">{error}</p>
    {#if !config}<Button variant="secondary" onclick={load}>Réessayer le chargement</Button>{/if}
  {/if}

  <div class="space-y-5">
    <!-- Provider selection -->
    <Card>
      <h2 class="mb-4 text-sm font-semibold text-ink">Fournisseur</h2>
      <Field label="Fournisseur du modèle">
        <Select bind:value={selectedProviderId} onchange={providerChanged} disabled={busy}>
          {#each providers as p (p.id)}
            <option value={p.id}>{p.label}</option>
          {/each}
        </Select>
      </Field>
      <p class="mt-2 text-xs text-ink-muted">
        Changer de fournisseur ou d’URL retire l’ancienne clé et invalide le contrôle précédent.
        Enregistrez avant de connecter ou vérifier.
      </p>
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
                disabled={busy}
                bind:value={apiKey}
                placeholder={config?.hasApiKey && config.provider === selectedProviderId
                  ? '••••••••  (configurée — laisser vide pour ne pas changer)'
                  : 'Coller la clé API…'}
              />
            </Field>
            {#if selectedProvider.keyEnvVar}
              <p class="text-xs text-ink-muted">
                Clé chiffrée pour cette entreprise; injectée uniquement dans <code
                  class="rounded bg-surface-muted px-1 text-xs">{selectedProvider.keyEnvVar}</code
                >
              </p>
            {/if}
            {#if selectedProvider.needsBaseUrl}
              <Field label="Base URL">
                <Input
                  bind:value={baseUrl}
                  placeholder="https://api.example.com/v1"
                  disabled={busy}
                />
              </Field>
              {#if config?.runtimeMode === 'remote'}
                <p class="text-xs text-ink-muted">
                  HTTPS, port 443 uniquement. Le domaine doit être autorisé dans le réseau du runner
                  par l’administrateur.
                </p>
              {/if}
            {/if}
          </div>
        {:else}
          <!-- Login / OAuth / device-code flow -->
          <div class="space-y-3">
            {#if config?.connectedAt && config.provider === selectedProviderId}
              <div class="flex items-center gap-2 text-sm">
                <Badge tone="neutral">Dernière connexion enregistrée</Badge>
                <span class="text-ink-muted">{formatDateTime(config.connectedAt)}</span>
              </div>
            {/if}
            {#if selectedProviderId === 'openai-codex'}
              <div class="rounded-md border border-edge bg-surface-muted p-3 text-sm text-ink">
                <p class="font-medium">Connecter votre compte ChatGPT / Codex</p>
                <p class="mt-1 text-ink-muted">
                  Le VPS prépare un code temporaire. Ouvrez le lien affiché ci-dessous sur votre
                  ordinateur, connectez-vous à OpenAI et saisissez ce code. Gardez cette page
                  ouverte jusqu’à confirmation.
                </p>
                <p class="mt-2 text-xs text-ink-muted">
                  L’accès dépend des autorisations de votre compte ou espace OpenAI, notamment
                  l’authentification par code d’appareil. Aucun téléchargement de Codex dans l’API
                  n’est nécessaire. Ne partagez ni ce code ni le journal.
                </p>
              </div>
            {/if}
            <div class="flex flex-wrap gap-2">
              <Button
                variant="primary"
                onclick={connectLogin}
                disabled={busy || dirty || !config?.installed}
              >
                {connecting ? 'Connexion en cours…' : `Connecter ${selectedProvider.label}`}
              </Button>
              {#if connecting}<Button variant="secondary" onclick={cancelLogin}
                  >Annuler la tentative</Button
                >{/if}
            </div>
            {#if connectPhase !== 'IDLE'}
              <section
                class="rounded-md border border-edge p-3"
                aria-label="Progression de la connexion"
              >
                <ol class="mb-3 grid gap-2 text-xs sm:grid-cols-3">
                  {#each [{ phase: 'STARTING', label: '1. Préparer le runner' }, { phase: 'WAITING_AUTHORIZATION', label: '2. Autoriser le compte' }, { phase: 'VERIFYING', label: '3. Confirmer' }] as step}
                    <li
                      class:font-semibold={connectPhase === step.phase}
                      class:text-accent={connectPhase === step.phase}
                    >
                      {step.label}
                    </li>
                  {/each}
                </ol>
                <p
                  role={connectPhase === 'ERROR' ? 'alert' : 'status'}
                  class="text-sm"
                  class:text-danger={connectPhase === 'ERROR'}
                >
                  {connectMessage}
                </p>
                {#if connecting}<p class="mt-2 text-xs text-ink-muted">
                    Temps écoulé : {Math.floor(connectSeconds / 60)} min {connectSeconds % 60} s · attente
                    limitée, sans relance automatique.
                  </p>{/if}
                {#if codexDeviceLink && connecting}<a
                    class="mt-3 inline-block text-sm font-medium text-accent underline"
                    href="https://auth.openai.com/codex/device"
                    target="_blank"
                    rel="noopener noreferrer">Ouvrir l’autorisation OpenAI ↗</a
                  >{/if}
              </section>
            {/if}
            {#if connectLog}
              <details open={connecting} class="rounded-md border border-edge p-3">
                <summary class="cursor-pointer text-xs font-medium text-ink-muted"
                  >Instructions du fournisseur — confidentielles</summary
                >
                <pre
                  class="mt-2 max-h-48 overflow-y-auto rounded-card border border-edge bg-surface-muted p-3 font-mono text-xs text-ink whitespace-pre-wrap"
                  style="overflow-wrap: anywhere">
                {connectLog}</pre>
              </details>
            {/if}
            {#if selectedProvider.loginCommand}
              <p class="text-xs text-ink-muted">
                Exécuté par le runner, pas dans votre terminal : <code
                  class="rounded bg-surface-muted px-1">{selectedProvider.loginCommand}</code
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
        <Input
          bind:value={defaultModel}
          placeholder="Identifiant exact fourni par votre fournisseur"
          disabled={busy}
        />
      </Field>
      <p class="mt-1.5 text-xs text-ink-muted">
        Les agents peuvent remplacer ce choix dans leur profil. Sans modèle ici ni dans le profil,
        une mission ne peut pas démarrer. Le nom doit correspondre au fournisseur sélectionné.
      </p>
    </Card>

    <!-- Test + Save actions -->
    <div class="flex flex-wrap items-start gap-3">
      <Button
        variant="secondary"
        onclick={testConnection}
        disabled={testing || !config?.configured || dirty || saving || connecting}
      >
        {testing ? 'Contrôle en cours…' : 'Vérifier le runtime'}
      </Button>
      <Button
        variant="primary"
        onclick={save}
        disabled={saving || !selectedProviderId || testing || connecting}
      >
        {saving ? 'Enregistrement…' : 'Enregistrer'}
      </Button>
    </div>
    {#if dirty}<p class="text-xs text-ink-muted">
        Des modifications ne sont pas enregistrées.
      </p>{/if}
    <p class="text-xs text-ink-muted">
      Le contrôle ouvre une session ACP et lit ses modèles proposés. Il n’envoie aucun prompt et ne
      prouve pas que la clé, la facturation fournisseur ou une mission métier fonctionnent. Les
      missions réelles restent à qualifier séparément.
    </p>

    <!-- Test result -->
    {#if testResult}
      <div
        class={`rounded-card border px-4 py-3 text-sm ${testResult.ok ? 'border-ok bg-ok-soft text-ok' : 'border-danger bg-danger-soft text-danger'}`}
      >
        {#if testResult.ok}
          <span class="font-semibold">Session runtime ouverte — inférence non testée</span>
          {#if testResult.models && testResult.models.length > 0}
            <div class="mt-2 text-xs text-ink-muted">
              Modèles disponibles :
              <ul class="mt-1 list-inside list-disc space-y-0.5">
                {#each testResult.models as m (m.value)}
                  <li><code class="rounded bg-surface-muted px-1">{m.label}</code></li>
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
  <div class="mt-5">
    <Card>
      <h2 class="text-sm font-semibold text-ink">À quoi sert cette connexion dans Pulsar ?</h2>
      <ol class="mt-3 list-inside list-decimal space-y-2 text-sm text-ink-muted">
        <li>
          Vérifier le runtime : contrôle technique sans prompt, distinct de la connexion du compte.
        </li>
        <li>
          Configurer un agent : rôle, modèle, modules autorisés et plafonds. Commencer en mode
          proposition.
        </li>
        <li>
          Dans l’espace IA, demander une synthèse d’un dossier accessible à cet agent, puis vérifier
          ses sources et propositions.
        </li>
      </ol>
      <p class="mt-3 text-xs text-ink-muted">
        Les workers peuvent traiter les tâches opérationnelles auxquelles ils sont affectés. La
        revue MRP analyse les besoins; le calcul reste déterministe. Une connexion seule n’active
        aucun worker, n’envoie aucun message client et ne donne aucun droit supplémentaire.
      </p>
      <div class="mt-3 flex flex-wrap gap-3 text-sm">
        <a class="text-accent underline" href="/documentation?view=fields&topic=ai-connection"
          >Tous les champs de connexion et leur diagnostic</a
        >
        <a class="text-accent underline" href="/documentation?view=fields&topic=ai-workers"
          >Rôles, outils et garde-fous des workers</a
        >
      </div>
    </Card>
  </div>
{/if}
