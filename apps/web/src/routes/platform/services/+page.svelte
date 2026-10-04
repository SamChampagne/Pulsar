<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { RUNTIME_PROVIDERS } from '@pulsar/shared';
  import { Server, Mail, Cpu, ArrowLeft, RefreshCw } from 'lucide-svelte';
  import { platformApi, getPlatformToken } from '$lib/api/platform';
  import { streamRuntimeConnect } from '$lib/api/agent-runtime-connect';
  import { Button, Field, Input, Select, Skeleton, ErrorNotice, Badge } from '$lib/components/ui';
  import PlatformSmtpForm, {
    type SmtpConfig,
  } from '$lib/components/platform/PlatformSmtpForm.svelte';
  type Tenant = { id: string; name: string; slug: string; status: string };
  type RuntimeConfig = {
    provider?: string;
    defaultModel?: string;
    baseUrl?: string;
    hasApiKey?: boolean;
    connectedAt?: string;
    lastTestAt?: string;
    lastTestOk?: boolean;
    updatedAt?: string;
  };
  type Detail = {
    tenant: Tenant;
    runtime: RuntimeConfig;
    health: {
      checkedAt: string;
      installed: boolean;
      runtimeMode?: string;
      runnerStatus?: string;
      runnerActiveProcesses?: number;
      runnerMaxConcurrent?: number;
      installedVersion: string | null;
      assessment: string;
    };
    email: {
      outbound: string;
      inbound: string;
      config:
        | (Partial<SmtpConfig> & { active: boolean; inboundActive: boolean; inboundLive: boolean })
        | null;
    };
    sms: { active: boolean; liveAuthorized: boolean; lastWebhookAt: string | null } | null;
  };
  type Overview = {
    email: SmtpConfig;
    emailChannel: string;
    tenants: Tenant[];
    audit: {
      id: string;
      tenantId: string | null;
      service: string;
      action: string;
      createdAt: string;
      actor: { email: string };
    }[];
    tenantLimit: number;
  };
  let data = $state<Overview | null>(null),
    detail = $state<Detail | null>(null),
    loading = $state(true),
    tenantLoading = $state(false),
    error = $state(''),
    tenantError = $state('');
  let selectedId = $state(''),
    tab = $state('global'),
    connectionLog = $state(''),
    connectionStatus = $state(''),
    result = $state(''),
    busy = $state(false),
    confirmed = $state(false);
  let form = $state({ provider: 'openrouter', defaultModel: '', baseUrl: '', apiKey: '' }),
    saved = $state('');
  let abort = $state<AbortController | undefined>();
  let requestVersion = 0;
  const provider = $derived(RUNTIME_PROVIDERS.find((p) => p.id === form.provider));
  const dirty = $derived(JSON.stringify(form) !== saved);
  const runtimeIdentity = (value: RuntimeConfig) =>
    JSON.stringify([value.provider ?? '', value.baseUrl ?? '', value.defaultModel ?? '']);
  const suspended = $derived(detail?.tenant.status !== 'ACTIVE');
  $effect(() => {
    JSON.stringify(form);
    confirmed = false;
    result = '';
  });
  const date = (v?: string | null) => (v ? new Date(v).toLocaleString('fr-CA') : 'Non vérifié');
  const smtp = (d: Detail): SmtpConfig => ({
    mode: d.email.config?.active ? 'SMTP' : 'ENVIRONMENT',
    host: d.email.config?.host ?? '',
    port: d.email.config?.port ?? 587,
    secure: d.email.config?.secure ?? false,
    username: d.email.config?.username ?? '',
    fromName: d.email.config?.fromName ?? '',
    fromEmail: d.email.config?.fromEmail ?? '',
    replyTo: d.email.config?.replyTo ?? '',
    hasPassword: d.email.config?.hasPassword ?? false,
    updatedAt: d.email.config?.updatedAt ?? null,
  });
  async function load() {
    loading = true;
    error = '';
    try {
      data = await platformApi<Overview>('/platform/services');
    } catch (e) {
      error = (e as Error).message;
    } finally {
      loading = false;
    }
  }
  async function selectTenant() {
    abort?.abort();
    const n = ++requestVersion,
      id = selectedId;
    detail = null;
    tenantError = '';
    connectionLog = '';
    connectionStatus = '';
    result = '';
    confirmed = false;
    if (!id) return;
    tenantLoading = true;
    try {
      const d = await platformApi<Detail>(`/platform/services/tenants/${encodeURIComponent(id)}`);
      if (n !== requestVersion) return;
      detail = d;
      form = {
        provider: d.runtime.provider ?? 'openrouter',
        defaultModel: d.runtime.defaultModel ?? '',
        baseUrl: d.runtime.baseUrl ?? '',
        apiKey: '',
      };
      saved = JSON.stringify(form);
    } catch (e) {
      if (n === requestVersion) tenantError = (e as Error).message;
    } finally {
      if (n === requestVersion) tenantLoading = false;
    }
  }
  async function refresh() {
    await load();
    if (selectedId) await selectTenant();
  }
  function changeProvider() {
    form.apiKey = '';
    form.defaultModel = '';
    form.baseUrl = form.provider === 'openai' ? 'https://api.openai.com/v1' : '';
    connectionLog = '';
  }
  async function runtimeAction(action: 'save' | 'verify' | 'connect') {
    if (busy || !detail || suspended || (action === 'save' ? !confirmed : dirty)) return;
    busy = true;
    tenantError = '';
    result = '';
    const id = detail.tenant.id;
    const expectedIdentity = runtimeIdentity(detail.runtime);
    const body = { expectedUpdatedAt: detail.runtime.updatedAt ?? null, confirmed: true };
    try {
      const path = `/platform/services/tenants/${encodeURIComponent(id)}/runtime`;
      if (action === 'save') {
        await platformApi(path, {
          method: 'PUT',
          body: { ...body, ...form, apiKey: form.apiKey || undefined },
        });
        await selectTenant();
        result = 'Connexion IA enregistrée pour cette entreprise.';
      } else if (action === 'verify') {
        const r = await platformApi<{ message: string }>(`${path}/verify`, {
          method: 'POST',
          body,
        });
        await selectTenant();
        result = r.message;
      } else {
        const attempt = new AbortController();
        abort = attempt;
        connectionLog = '';
        connectionStatus = 'Préparation du runner de cette entreprise…';
        let completed = false;
        for await (const event of streamRuntimeConnect({
          path: `${path}/connect`,
          token: getPlatformToken(),
          body,
          signal: attempt.signal,
        })) {
          if (abort !== attempt || selectedId !== id) return;
          if (event.type === 'status') connectionStatus = event.message;
          if (event.type === 'text') connectionLog = (connectionLog + event.text).slice(-20000);
          if (event.type === 'error') {
            tenantError = event.message;
            connectionStatus = 'Connexion non confirmée.';
            break;
          }
          if (event.type === 'end') completed = true;
        }
        if (!completed) return;
        // Refresh without erasing the device instructions/error produced by this attempt.
        const d = await platformApi<Detail>(
          `/platform/services/tenants/${encodeURIComponent(id)}`,
          {
            signal: AbortSignal.any([attempt.signal, AbortSignal.timeout(15_000)]),
          },
        );
        if (selectedId === id && abort === attempt && !attempt.signal.aborted) {
          detail = d;
          if (runtimeIdentity(d.runtime) !== expectedIdentity) {
            connectionStatus =
              'La configuration IA a changé. Actualisez avant de reconnecter le compte.';
            return;
          }
          connectionStatus = d.runtime.connectedAt
            ? 'Compte connecté. Inférence et missions métier non testées.'
            : 'Connexion non confirmée dans la configuration. Actualisez avant de réessayer.';
        }
      }
    } catch (e) {
      if (selectedId === id) {
        if ((e as Error).name !== 'AbortError') tenantError = (e as Error).message;
        else connectionStatus = 'Tentative arrêtée. Aucune relance automatique.';
      }
    } finally {
      busy = false;
      abort = undefined;
    }
  }
  onMount(() => {
    void load();
  });
  onDestroy(() => abort?.abort());
</script>

<svelte:head><title>Services et connexions | Pulsar</title></svelte:head>
<header class="mb-6 flex flex-wrap items-start justify-between gap-3">
  <div>
    <a
      href="/platform/operations"
      class="mb-2 inline-flex items-center gap-1 text-xs text-ink-muted hover:text-accent"
      ><ArrowLeft class="size-3" />Exploitation</a
    >
    <h1 class="text-2xl font-semibold tracking-tight">Services et connexions</h1>
    <p class="mt-1 max-w-2xl text-sm text-ink-muted">
      Mettre en place, vérifier et dépanner les connexions, sans quitter l’administration.
    </p>
  </div>
  <Button variant="secondary" onclick={refresh} disabled={busy || tenantLoading} {loading}
    ><RefreshCw class="size-4" />Actualiser</Button
  >
</header>
<ErrorNotice message={error} onretry={load} />
{#if loading && !data}<Skeleton rows={8} />{:else if data}
  <nav
    aria-label="Périmètre des services"
    class="mb-6 flex gap-1 overflow-x-auto border-b border-edge"
  >
    {#each [{ key: 'global', label: 'Courriel plateforme', icon: Mail }, { key: 'tenants', label: 'Connexions entreprises', icon: Cpu }, { key: 'infrastructure', label: 'Mise en place serveur', icon: Server }] as item}
      <button
        onclick={() => (tab = item.key)}
        aria-current={tab === item.key ? 'page' : undefined}
        class="flex shrink-0 items-center gap-2 border-b-2 px-3 py-3 text-sm transition-colors {tab ===
        item.key
          ? 'border-accent font-medium text-accent'
          : 'border-transparent text-ink-muted hover:text-ink'}"
        ><item.icon class="size-4" />{item.label}</button
      >
    {/each}
  </nav>
  {#if tab === 'global'}
    <div class="grid gap-8 lg:grid-cols-[minmax(0,2fr)_minmax(16rem,1fr)]">
      <section class="rounded-lg border border-edge bg-surface p-5">
        <div class="mb-5 flex flex-wrap items-center justify-between gap-2">
          <h2 class="text-base font-semibold">Transport courriel global</h2>
          <Badge
            >{data.emailChannel === 'smtp'
              ? 'SMTP réel configuré'
              : data.emailChannel === 'log'
                ? 'Simulation'
                : 'Configuration indisponible'}</Badge
          >
        </div>
        {#key data.email.updatedAt}<PlatformSmtpForm
            config={data.email}
            disabled={!!error || loading}
            onsaved={load}
          />{/key}
      </section>
      <aside class="space-y-5 text-sm leading-6">
        <section>
          <h2 class="font-semibold">Ce que ce réglage débloque</h2>
          <p class="mt-2 text-ink-muted">
            Les invitations et liens de réinitialisation peuvent partir par un vrai serveur SMTP.
            Les entreprises sans SMTP dédié utilisent également ce transport.
          </p>
        </section>
        <section class="border-t border-edge pt-5">
          <h2 class="font-semibold">Vérifier n’est pas envoyer</h2>
          <p class="mt-2 text-ink-muted">
            Le contrôle vérifie TLS et l’authentification. Il ne prouve ni la réception en boîte ni
            la configuration SPF/DKIM/DMARC de votre domaine.
          </p>
        </section>
        <section class="border-t border-edge pt-5">
          <h2 class="font-semibold">Une modification, une trace</h2>
          <p class="mt-2 text-ink-muted">
            Les secrets sont chiffrés et jamais affichés. Une configuration modifiée ailleurs doit
            être rechargée avant de sauvegarder.
          </p>
        </section>
      </aside>
    </div>
  {:else if tab === 'tenants'}
    <section class="mb-5 max-w-xl">
      <Field label="Entreprise à administrer"
        ><Select bind:value={selectedId} onchange={selectTenant} disabled={busy}
          ><option value="">Sélectionner une entreprise</option
          >{#each data.tenants as tenant}<option value={tenant.id}
              >{tenant.name} · {tenant.slug}{tenant.status !== 'ACTIVE'
                ? ' (suspendue)'
                : ''}</option
            >{/each}</Select
        ></Field
      >
      {#if data.tenants.length >= data.tenantLimit}<p class="mt-2 text-xs text-warn">
          Liste limitée aux {data.tenantLimit} premières entreprises.
        </p>{/if}
    </section>
    <ErrorNotice message={tenantError} />
    {#if tenantLoading}<Skeleton rows={6} />{:else if detail}
      <div class="mb-5 rounded-md bg-surface-muted px-4 py-3 text-sm">
        Administration de <strong>{detail.tenant.name}</strong> ·
        <span class="font-mono text-xs">{detail.tenant.slug}</span>. {suspended
          ? 'Entreprise suspendue : configuration en lecture seule.'
          : 'Chaque connexion reste isolée. Aucun compte utilisateur usurpé.'}
      </div>
      <div class="grid items-start gap-6 xl:grid-cols-2">
        <section
          class="min-w-0 rounded-lg border border-edge bg-surface p-5"
          aria-label="Connexion IA entreprise"
        >
          <h2 class="text-base font-semibold">IA et workers</h2>
          <div class="my-4 border-y border-edge py-3 text-sm">
            <p class="font-medium">
              {detail.health.runnerStatus === 'unassigned'
                ? 'Runner non rattaché'
                : detail.health.runnerStatus === 'unreachable'
                  ? 'Runner injoignable'
                  : detail.health.installed
                    ? 'Runtime joignable'
                    : 'Runtime absent'}
            </p>
            <p class="mt-1 text-xs text-ink-muted">
              {detail.health.installedVersion
                ? `Hermes ${detail.health.installedVersion} · `
                : ''}{detail.health.runnerActiveProcesses ?? '—'} / {detail.health
                .runnerMaxConcurrent ?? '—'} processus · contrôle {date(detail.health.checkedAt)}
            </p>
            {#if !detail.health.installed}<p class="mt-2 text-xs text-warn">
                Le fournisseur peut être préparé ici. Le runner doit ensuite être provisionné et
                rattaché côté serveur : consultez « Mise en place serveur ».
              </p>{/if}
            {#if detail.health.assessment === 'review-required'}<p class="mt-2 text-xs text-warn">
                Version runtime différente de la référence qualifiée : revue opérateur requise.
              </p>{/if}
          </div>
          <div class="space-y-4">
            <Field label="Fournisseur IA"
              ><Select
                bind:value={form.provider}
                onchange={changeProvider}
                disabled={busy || suspended}
                >{#each RUNTIME_PROVIDERS as p}<option value={p.id}
                    >{p.label} · {p.authMode === 'login' ? 'connexion OAuth' : 'clé API'}</option
                  >{/each}</Select
              ></Field
            >
            {#if provider?.authMode === 'apiKey'}<Field label="Clé API"
                ><Input
                  type="password"
                  bind:value={form.apiKey}
                  maxlength={512}
                  disabled={busy || suspended}
                  placeholder={detail.runtime.hasApiKey && form.provider === detail.runtime.provider
                    ? 'Clé enregistrée — laisser vide pour conserver'
                    : 'Clé du compte de cette entreprise'}
                /></Field
              >{:else}<p class="text-xs text-ink-muted">
                Connexion interactive au compte autorisé pour cette entreprise. Aucun partage
                automatique de votre abonnement avec les autres entreprises.
              </p>{/if}
            {#if provider?.needsBaseUrl}<Field label="URL du fournisseur"
                ><Input
                  type="url"
                  bind:value={form.baseUrl}
                  disabled={busy || suspended}
                  maxlength={512}
                /></Field
              >{/if}
            <Field label="Modèle par défaut"
              ><Input
                bind:value={form.defaultModel}
                disabled={busy || suspended}
                maxlength={512}
                placeholder="Identifiant exact du modèle du fournisseur"
              /></Field
            >
            <p class="text-xs text-ink-muted">
              Changer de fournisseur ou d’URL retire l’ancienne connexion. Les modèles spécifiques
              des workers restent prioritaires; leur autonomie et leurs permissions ne changent pas.
            </p>
            <label class="flex items-start gap-2 text-sm"
              ><input
                type="checkbox"
                class="mt-1"
                bind:checked={confirmed}
                disabled={busy || suspended}
              />Je suis autorisé à configurer l’IA pour {detail.tenant.name}.</label
            >
            <div class="flex flex-wrap gap-2">
              <Button
                onclick={() => runtimeAction('save')}
                disabled={busy || suspended || !confirmed}>Enregistrer l’IA</Button
              ><Button
                variant="secondary"
                onclick={() => runtimeAction('verify')}
                disabled={busy || suspended || dirty || !detail.health.installed}
                >Vérifier le runtime</Button
              >
              {#if provider?.authMode === 'login'}<Button
                  variant="secondary"
                  onclick={() => runtimeAction('connect')}
                  disabled={busy || suspended || dirty || !detail.health.installed}
                  >Connecter le compte</Button
                >{/if}
              {#if abort}<Button variant="ghost" onclick={() => abort?.abort()}
                  >Annuler la connexion</Button
                >{/if}
            </div>
            {#if busy}<p role="status" class="text-xs text-ink-muted">Opération en cours…</p>{/if}
            {#if connectionStatus}<p
                role="status"
                class="rounded-md border border-edge p-3 text-sm"
              >
                {connectionStatus}
              </p>{/if}
            {#if abort && form.provider === 'openai-codex'}
              <p class="text-xs text-ink-muted">
                Autorisez le compte OpenAI de cette entreprise à l’aide du code fourni ci-dessous.
                Ne partagez pas ces instructions. L’accès par code d’appareil doit être autorisé
                pour ce compte.
              </p>
              {#if /https:\/\/auth\.openai\.com\/codex\/device(?:\s|$)/.test(connectionLog)}
                <a
                  class="inline-block text-sm text-accent underline"
                  href="https://auth.openai.com/codex/device"
                  target="_blank"
                  rel="noopener noreferrer">Ouvrir l’autorisation OpenAI ↗</a
                >
              {/if}
            {/if}
            {#if connectionLog}<pre
                class="max-h-52 overflow-auto whitespace-pre-wrap break-words rounded-md bg-surface-muted p-3 text-xs">{connectionLog}</pre>{/if}
            {#if result}<p role="status" class="rounded-md border border-edge p-3 text-sm">
                {result}
              </p>{/if}
            <p class="text-xs text-ink-muted">
              Dernier contrôle ACP : {date(detail.runtime.lastTestAt)}. Aucun appel LLM dans ce
              contrôle; accès au modèle et facturation non validés.
            </p>
          </div>
        </section>
        <section class="min-w-0 rounded-lg border border-edge bg-surface p-5">
          <h2 class="mb-5 text-base font-semibold">Courriel de l’entreprise</h2>
          {#key `${detail.tenant.id}:${detail.email.config?.updatedAt}`}<PlatformSmtpForm
              config={smtp(detail)}
              tenantName={detail.tenant.name}
              endpoint={`/platform/services/tenants/${encodeURIComponent(detail.tenant.id)}/email`}
              disabled={suspended}
              onsaved={selectTenant}
            />{/key}
        </section>
      </div>
      <section class="mt-6 rounded-md bg-surface-muted p-4 text-sm leading-6">
        <h2 class="font-semibold">Autres connexions</h2>
        <p class="mt-2">
          Réception IMAP : {detail.email.inbound === 'imap'
            ? 'collecte réelle active'
            : 'simulation ou collecte inactive'}. SMS : {detail.sms?.active &&
          detail.sms.liveAuthorized
            ? 'envois réels autorisés'
            : 'désactivés ou non autorisés'}.
        </p>
        <p class="mt-1 text-ink-muted">
          Ces autorisations restent à confirmer par un utilisateur interne de l’entreprise dans ses
          réglages Courriel / SMS. Ce centre ne contourne ni les consentements de communication, ni
          les blocages STOP.
        </p>
      </section>
    {:else if !selectedId}<p
        class="rounded-lg border border-dashed border-edge px-5 py-10 text-sm text-ink-muted"
      >
        Choisissez une entreprise pour contrôler son runner et préparer ses connexions. Aucune
        connexion n’est modifiée par cette lecture.
      </p>{/if}
  {:else}
    <section class="max-w-3xl space-y-6 text-sm leading-6">
      <h2 class="text-lg font-semibold">Ce qui reste du ressort du serveur</h2>
      <p class="text-ink-muted">
        Un réglage d’interface ne peut pas installer un conteneur manquant. Ce centre configure les
        connexions existantes; il n’exécute aucune commande Docker et n’expose aucun secret de
        déploiement.
      </p>
      {#each [{ title: 'Runner IA par entreprise', text: 'Construire l’image qualifiée, créer un volume, un réseau et un secret distincts, puis rattacher l’ID de l’entreprise au routage privé. Autoriser les domaines HTTPS du fournisseur. Revenir vérifier sa disponibilité ici.', ref: 'deploy/agent-runner/README.md' }, { title: 'Fabrication / moteur APS', text: 'Déployer le moteur et appliquer ses migrations. Un processus joignable ne suffit pas : sa base doit être prête avant toute planification.', ref: 'deploy/ovh/README.md' }, { title: 'Documents et sauvegardes', text: 'Monter le stockage persistant ou configurer S3, vérifier les permissions et réaliser une restauration sur une copie isolée. Ne pas changer de stockage sans plan de migration des documents.', ref: 'deploy/ovh/README.md' }] as item}
        <article class="border-t border-edge pt-5">
          <h3 class="font-semibold">{item.title}</h3>
          <p class="mt-2 text-ink-muted">{item.text}</p>
          <p class="mt-2 break-all font-mono text-xs">Guide dans le dépôt : {item.ref}</p>
        </article>
      {/each}<Button variant="secondary" href="/platform/operations"
        >Ouvrir le diagnostic d’exploitation</Button
      >
    </section>
  {/if}
  <section class="mt-8 border-t border-edge pt-5">
    <h2 class="mb-3 text-sm font-semibold">Dernières interventions administratives</h2>
    <p class="mb-3 text-xs text-ink-muted">
      30 dernières interventions. Actualisez après une opération pour recharger ce journal; aucun
      contenu de message ni secret.
    </p>
    {#if !data.audit.length}<p class="text-sm text-ink-muted">
        Aucune intervention enregistrée dans ce centre.
      </p>{:else}<ul class="divide-y divide-edge">
        {#each data.audit as entry}<li
            class="flex flex-wrap justify-between gap-x-5 gap-y-1 py-2 text-xs"
          >
            <span
              >{entry.actor.email} · {entry.service} · {entry.action}{entry.tenantId
                ? ` · ${data.tenants.find((t) => t.id === entry.tenantId)?.name ?? entry.tenantId}`
                : ''}</span
            ><time class="font-mono text-ink-muted">{date(entry.createdAt)}</time>
          </li>{/each}
      </ul>{/if}
  </section>
{/if}
