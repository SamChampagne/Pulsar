<script lang="ts">
  import { api } from '$lib/api/client';
  import { auth } from '$lib/stores/auth';
  import { CONNECTION_CATALOG, PERMISSIONS } from '@pulsar/shared';
  import { PageHeader, Button, Badge, Input, Skeleton, type Tone } from '$lib/components/ui';
  let loading = $state(true),
    search = $state(''),
    errors = $state<string[]>([]);
  let email = $state<{
    outbound: string;
    inbound: string;
    config: {
      host: string | null;
      fromEmail: string | null;
      lastTestOk: boolean | null;
      lastTestAt: string | null;
      lastPollOk: boolean | null;
    } | null;
  } | null>(null);
  let sms = $state<{
    liveEnabled: boolean;
    config: { active: boolean; live: boolean; hasApiKey: boolean } | null;
  } | null>(null);
  let runtime = $state<{
    configured: boolean;
    provider?: string;
    lastTestOk?: boolean;
    lastTestAt?: string;
  } | null>(null);
  let integrations = $state<
    { id: string; key: string; name: string; status: string; config?: Record<string, unknown> }[]
  >([]);
  const can = (permission: string) => !!$auth?.user.permissions.some((p) => p === permission);
  const filtered = $derived(
    CONNECTION_CATALOG.filter(
      (c) =>
        (!c.permission || can(c.permission)) &&
        (c.name + ' ' + c.category + ' ' + c.usage).toLowerCase().includes(search.toLowerCase()),
    ),
  );
  function connectionState(key: string): { text: string; tone: Tone } {
    if (key === 'telnyx') {
      if (!sms) return { text: 'État indisponible', tone: 'neutral' };
      if (!sms.config) return { text: 'À configurer', tone: 'neutral' };
      if (!sms.config.active) return { text: 'Connexion inactive', tone: 'neutral' };
      if (!sms.config.live) return { text: 'Simulation — aucun envoi', tone: 'info' };
      if (!sms.liveEnabled || !sms.config.hasApiKey)
        return { text: 'Envoi réel bloqué', tone: 'warn' };
      return { text: 'Réel autorisé · livraison à vérifier', tone: 'warn' };
    }
    if (key === 'email') {
      if (!email) return { text: 'État indisponible', tone: 'neutral' };
      if (email.outbound === 'log') return { text: 'Simulation — aucun envoi', tone: 'info' };
      if (email.config?.lastTestOk === false)
        return { text: 'Dernier test en échec', tone: 'danger' };
      if (email.config?.lastTestOk) return { text: 'Test accepté par le transport', tone: 'ok' };
      return { text: 'Configuré · à tester', tone: 'warn' };
    }
    if (key === 'agents') {
      if (!runtime) return { text: 'État indisponible', tone: 'neutral' };
      if (!runtime.configured) return { text: 'À configurer', tone: 'neutral' };
      return {
        text: runtime.lastTestOk
          ? 'Dernier test réussi'
          : runtime.lastTestOk === false
            ? 'Dernier test en échec'
            : 'Configuré · à tester',
        tone: runtime.lastTestOk ? 'ok' : 'warn',
      };
    }
    return { text: 'Disponible', tone: 'neutral' };
  }
  async function load() {
    loading = true;
    errors = [];
    const jobs: Promise<unknown>[] = [];
    if (can(PERMISSIONS.SMS.READ))
      jobs.push(
        api<typeof sms>('/sms/connection')
          .then((r) => (sms = r))
          .catch((e) => {
            sms = null;
            errors.push('SMS : ' + e.message);
          }),
      );
    if (can(PERMISSIONS.EMAIL.MANAGE))
      jobs.push(
        api<typeof email>('/email-config/connection')
          .then((r) => (email = r))
          .catch((e) => {
            email = null;
            errors.push('Courriel : ' + e.message);
          }),
      );
    if (can(PERMISSIONS.CORE.AGENTS_MANAGE))
      jobs.push(
        api<typeof runtime>('/agent-runtime')
          .then((r) => (runtime = r))
          .catch((e) => {
            runtime = null;
            errors.push('IA : ' + e.message);
          }),
      );
    if (can(PERMISSIONS.CORE.INTEGRATIONS_READ))
      jobs.push(
        api<typeof integrations>('/integrations')
          .then((r) => (integrations = r))
          .catch((e) => {
            integrations = [];
            errors.push('Intégrations : ' + e.message);
          }),
      );
    await Promise.all(jobs);
    loading = false;
  }
  $effect(() => {
    void load();
  });
</script>

<svelte:head><title>Connexions · Pulsar</title></svelte:head>
<PageHeader
  title="Connexions"
  eyebrow="Plateforme"
  subtitle="Configurez les comptes externes ici. Les modules utilisent leurs capacités sans dupliquer les identifiants."
>
  {#snippet actions()}<Button variant="secondary" disabled={loading} onclick={load}
      >Actualiser les états</Button
    >{#if can(PERMISSIONS.CRM.READ)}<Button href="/crm/pipeline">Ouvrir le pipeline CRM</Button
      >{/if}{/snippet}
</PageHeader>
<div class="mb-6 grid gap-5 border-b border-edge pb-5 lg:grid-cols-[minmax(0,1fr)_21rem]">
  <p class="max-w-3xl text-sm leading-6 text-ink-muted">
    Les connexions disponibles ouvrent leurs vrais réglages. « Configuré » ne signifie pas « testé
    », et un transport qui accepte un message ne prouve pas sa réception. Les futurs connecteurs
    sont identifiés séparément.
  </p>
  <Input
    aria-label="Rechercher une connexion"
    placeholder="Courriel, IA, CRM, imports…"
    bind:value={search}
  />
</div>
{#each errors as message}<p role="alert" class="mb-2 text-sm text-danger">{message}</p>{/each}
{#if loading}<Skeleton rows={5} />{:else}
  <div class="space-y-7">
    {#each [...new Set(filtered.map((c) => c.category))] as category}
      <section aria-label={category}>
        <h2 class="mb-3 text-sm font-semibold text-ink-muted">{category}</h2>
        <div class="divide-y divide-edge rounded-lg border border-edge bg-surface">
          {#each filtered.filter((c) => c.category === category) as connector}
            {@const ready = connector.availability === 'AVAILABLE'}
            {@const status = ready
              ? connectionState(connector.key)
              : { text: 'À développer', tone: 'neutral' as Tone }}
            <article class="grid gap-4 p-4 md:grid-cols-[minmax(0,1fr)_minmax(12rem,19rem)]">
              <div class="min-w-0">
                <div class="flex flex-wrap items-center gap-2">
                  <h3 class="font-semibold text-ink">{connector.name}</h3>
                  <Badge tone={status.tone}>{status.text}</Badge>
                </div>
                <p class="mt-2 max-w-2xl text-sm text-ink-muted">{connector.description}</p>
                <p class="mt-2 text-xs text-ink-faint">{connector.capabilities.join(' · ')}</p>
                {#if connector.key === 'email' && email}<p class="mt-2 text-xs text-ink-muted">
                    Sortie : {email.outbound === 'smtp-tenant'
                      ? 'SMTP de cette entreprise'
                      : email.outbound === 'smtp-platform'
                        ? 'SMTP de la plateforme'
                        : 'Journal local (simulation)'} · Réception : {email.inbound === 'imap'
                      ? 'IMAP actif'
                      : 'simulation, aucune boîte réelle relevée'}
                  </p>{/if}
                {#if connector.key === 'agents' && runtime?.provider}<p
                    class="mt-2 text-xs text-ink-muted"
                  >
                    Fournisseur enregistré : {runtime.provider}
                  </p>{/if}
              </div>
              <div class="flex flex-col items-start justify-between gap-3 md:items-end">
                <p class="text-xs text-ink-muted md:text-right">
                  Utilisation<br /><span class="mt-1 inline-block text-ink">{connector.usage}</span>
                </p>
                {#if ready && connector.href}<Button href={connector.href} variant="secondary"
                    >{connector.key === 'telnyx' ? 'Ouvrir' : 'Configurer'}
                    {connector.key === 'email'
                      ? 'le courriel'
                      : connector.key === 'agents'
                        ? 'l’IA'
                        : 'la connexion'}</Button
                  >{:else}<span class="text-xs text-ink-faint"
                    >Aucun identifiant demandé avant disponibilité</span
                  >{/if}
              </div>
            </article>
          {/each}
        </div>
      </section>
    {/each}
    {#if !filtered.length}<p class="text-sm text-ink-muted">
        Aucune connexion ne correspond à votre recherche ou à vos permissions.
      </p>{/if}
    {#if can(PERMISSIONS.CORE.INTEGRATIONS_READ)}
      <section
        class="rounded-lg border border-edge bg-surface p-5"
        aria-label="Configurations d’intégrations"
      >
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 class="font-semibold">Webhooks et configurations avancées</h2>
            <p class="mt-1 text-sm text-ink-muted">
              Les fiches ERP, comptabilité et API personnalisées ne disposent pas toutes d’un
              adaptateur exécutable.
            </p>
          </div>
          <Button href="/integrations" variant="secondary">Ouvrir le studio avancé</Button>
        </div>
        <div class="mt-4 divide-y divide-edge">
          {#each integrations.filter((i) => i.name
              .toLowerCase()
              .includes(search.toLowerCase())) as integration}
            {@const executable =
              integration.key.startsWith('webhook') && typeof integration.config?.url === 'string'}
            <div class="flex flex-wrap items-center justify-between gap-3 py-3">
              <div>
                <p class="text-sm font-medium">{integration.name}</p>
                <p class="mt-1 text-xs text-ink-muted">
                  {executable
                    ? 'Webhook sortant · consulter les livraisons dans le studio'
                    : 'Configuration préparatoire · aucun échange externe prouvé'}
                </p>
              </div>
              <Badge tone={executable && integration.status === 'ENABLED' ? 'info' : 'neutral'}
                >{executable
                  ? integration.status === 'ENABLED'
                    ? 'Activé · réception à vérifier'
                    : 'Désactivé'
                  : 'Préparatoire'}</Badge
              >
            </div>
          {:else}<p class="text-sm text-ink-muted">
              Aucune configuration avancée enregistrée.
            </p>{/each}
        </div>
      </section>
    {/if}
    <p class="max-w-4xl text-xs leading-5 text-ink-faint">
      Les réglages SMTP et IA existants sont réutilisés : aucun secret n’est copié dans un deuxième
      registre. Une configuration SMTP et un fournisseur IA par entreprise pour le moment. Le
      stockage, le routage et les courriels de sécurité restent des réglages de déploiement.
    </p>
  </div>
{/if}
