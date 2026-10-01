<script lang="ts">
  import { api, ApiError } from '$lib/api/client';
  import { formatDateTime } from '$lib/format';
  import { Card, Badge, Button } from '$lib/components/ui';
  interface Health {
    checkedAt: string;
    installed: boolean;
    runtimeMode?: 'local' | 'remote';
    runnerStatus?: 'unassigned' | 'unreachable' | 'ready';
    runnerBusy?: boolean;
    runnerActiveProcesses?: number;
    runnerMaxConcurrent?: number;
    declaredVersion: string | null;
    installedVersion: string | null;
    pythonVersion: string | null;
    acpVersion: string | null;
    mcpVersion: string | null;
    sourceCommit: string | null;
    sourceModified: boolean | null;
    assessment: 'not-installed' | 'unknown' | 'reference-match' | 'review-required';
    reference: {
      version: string;
      commit: string;
      upstreamVersion: string;
      upstreamCheckedAt: string;
      upstreamUrl: string;
    };
  }
  let health = $state<Health | null>(null);
  let loading = $state(false);
  let error = $state('');
  async function load() {
    loading = true;
    error = '';
    try {
      health = await api<Health>('/agent-runtime/health');
    } catch (e) {
      error = e instanceof ApiError ? e.message : 'Diagnostic indisponible';
    } finally {
      loading = false;
    }
  }
  $effect(() => {
    void load();
  });
</script>

<section aria-label="Diagnostic du moteur IA" class="mb-5">
  <Card>
    <div class="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 class="text-sm font-semibold text-ink">Moteur IA · Hermes</h2>
        <p class="mt-1 text-xs text-ink-muted">
          {health?.runtimeMode === 'remote'
            ? 'Runner dédié à votre entreprise'
            : 'Inventaire local'}, sans appel au modèle ni mise à jour automatique.
        </p>
      </div>
      <Button variant="secondary" size="sm" onclick={load} disabled={loading}>
        {loading ? 'Lecture…' : 'Actualiser le diagnostic'}
      </Button>
    </div>
    {#if error}<p role="alert" class="mb-3 text-sm text-danger">{error}</p>{/if}
    {#if health}
      {#if health.runtimeMode === 'remote'}
        <p class="mb-3 text-sm text-ink-muted" role="status">
          {health.runnerStatus === 'ready'
            ? 'Service IA joignable. Fournisseur, connexion et modèle se règlent ci-dessous.'
            : health.runnerStatus === 'unassigned'
              ? 'Aucun runner valide rattaché à cette entreprise. Intervention administrateur requise pour le premier déploiement.'
              : 'Le runner rattaché ne répond pas. Les autres modules de Pulsar restent disponibles.'}
        </p>
        {#if health.runnerMaxConcurrent}<p class="mb-3 text-sm text-ink-muted tabular-nums">
            {health.runnerActiveProcesses ?? 0} / {health.runnerMaxConcurrent} processus IA actifs. La
            capacité est partagée entre conversations et workers automatiques.
          </p>{/if}
        {#if health.runnerBusy}<p class="mb-3 text-sm text-ink-muted">
            Des sessions sont en cours. Attendez leur fin avant de changer de configuration ou
            reconnecter un fournisseur.
          </p>{/if}
      {/if}
      <div class="mb-4 flex flex-wrap items-center gap-2">
        <Badge tone={health.assessment === 'reference-match' ? 'neutral' : 'warn'}>
          {health.assessment === 'reference-match'
            ? 'Référence Pulsar reconnue'
            : health.assessment === 'not-installed'
              ? health.runtimeMode === 'remote'
                ? health.runnerStatus === 'unassigned'
                  ? 'Non rattaché'
                  : 'Injoignable'
                : 'Non installé'
              : health.assessment === 'review-required'
                ? 'Écart à qualifier'
                : 'Inventaire incomplet'}
        </Badge>
        <span class="text-xs text-ink-muted"
          >{formatDateTime(health.checkedAt)} · {health.runtimeMode === 'remote'
            ? 'lecture du runner'
            : 'cache 30 s'}</span
        >
      </div>
      <dl class="grid gap-4 border-y border-edge py-4 sm:grid-cols-3">
        <div>
          <dt class="text-xs text-ink-muted">Version installée</dt>
          <dd class="mt-1 font-mono text-lg text-ink">{health.installedVersion ?? 'Inconnue'}</dd>
          <dd class="text-xs text-ink-muted">Source : {health.declaredVersion ?? 'inconnue'}</dd>
        </div>
        <div>
          <dt class="text-xs text-ink-muted">Environnement</dt>
          <dd class="mt-1 text-sm text-ink">Python {health.pythonVersion ?? 'inconnu'}</dd>
          <dd class="text-xs text-ink-muted">
            ACP {health.acpVersion ?? '?'} · MCP {health.mcpVersion ?? '?'}
          </dd>
        </div>
        <div>
          <dt class="text-xs text-ink-muted">Révision du fork</dt>
          <dd class="mt-1 font-mono text-sm text-ink">
            {health.sourceCommit?.slice(0, 12) ?? 'Inconnue'}
          </dd>
          <dd class="text-xs text-ink-muted">
            {health.sourceModified == null
              ? 'État source inconnu'
              : health.sourceModified
                ? 'Sources modifiées localement'
                : 'Sources suivies inchangées'}
          </dd>
        </div>
      </dl>
      <div class="mt-4 rounded-control bg-surface-muted p-3 text-sm text-ink-muted">
        <p>
          <span class="font-medium text-ink"
            >Version officielle repérée : {health.reference.upstreamVersion}</span
          >
          · vérification documentaire du {health.reference.upstreamCheckedAt}, pas un contrôle en
          direct.
        </p>
        <p class="mt-1">
          Le fork de référence Pulsar est en {health.reference.version}. Une nouvelle version doit
          être qualifiée sur les outils, les reprises et les droits avant déploiement.
        </p>
        <a
          href={health.reference.upstreamUrl}
          target="_blank"
          rel="noreferrer"
          class="mt-2 inline-block text-accent underline underline-offset-2"
          >Voir la publication officielle</a
        >
      </div>
      <p class="mt-3 text-xs text-ink-muted">
        Ce diagnostic ne valide ni la clé fournisseur, ni le coût, ni la qualité des réponses.
        L’isolation des outils ne remplace pas une isolation serveur/conteneur.
      </p>
    {:else if loading}<p class="text-sm text-ink-muted">Lecture des versions locales…</p>{/if}
  </Card>
</section>
