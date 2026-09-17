<script lang="ts">
  import { api, ApiError } from '$lib/api/client';
  import { auth } from '$lib/stores/auth';
  import { confirmAction } from '$lib/stores/confirmation';
  import { formatDateTime } from '$lib/format';
  import {
    INBOUND_HOOK_TARGETS,
    PERMISSIONS,
    getInboundHookTarget,
    normalizeMappingRules,
    type InboundHookTarget,
    type MappingRule,
    type Paginated,
  } from '@pulsar/shared';
  import {
    Badge,
    Card,
    EmptyState,
    ErrorNotice,
    Field,
    Input,
    Modal,
    PageHeader,
    ReferenceSelect,
    Select,
    Skeleton,
    Table,
    type Tone,
  } from '$lib/components/ui';

  // ── Types ──────────────────────────────────────────────────────────────────

  interface IntegrationRecord {
    id: string;
    key: string;
    name: string;
    status: 'DISABLED' | 'ENABLED' | 'ERROR';
    config?: Record<string, unknown>;
    hasInboundToken?: boolean;
    createdAt: string;
  }

  interface TokenIssueResult {
    token: string;
    url: string;
    target: string | null;
    targetValid: boolean;
    signed: boolean;
    status: string;
  }

  interface InboundMessage {
    id: string;
    source: string;
    status: string;
    kind: string;
    summary: string | null;
    createdAt: string;
  }

  // ── State: receivers list ───────────────────────────────────────────────────

  let integrations = $state<IntegrationRecord[]>([]);
  let loading = $state(true);
  let error = $state('');

  // ── State: create form ───────────────────────────────────────────────────────

  let createOpen = $state(false);
  let createName = $state('');
  let createKey = $state('');
  let keyTouched = $state(false);
  let createTarget = $state('');
  let createMappings = $state<MappingRule[]>([]);
  let createSecret = $state('');
  let creating = $state(false);
  let createError = $state('');
  let createdIntegration = $state<IntegrationRecord | null>(null);

  // ── State: token modal ───────────────────────────────────────────────────────

  let tokenOpen = $state(false);
  let tokenResult = $state<TokenIssueResult | null>(null);
  let issuing = $state(false);
  let issueError = $state('');
  let tokenCopied = $state(false);
  let urlCopied = $state(false);

  // ── State: inbox (WEBHOOK source only) ──────────────────────────────────────

  let inbox = $state<InboundMessage[]>([]);
  let inboxTotal = $state(0);
  let inboxLoading = $state(true);
  let inboxError = $state('');

  // ── Permissions ──────────────────────────────────────────────────────────────

  const canManage = $derived(
    $auth?.user.permissions.includes(PERMISSIONS.CORE.INTEGRATIONS_MANAGE) ?? false,
  );

  function holdsTargetPermission(target: InboundHookTarget): boolean {
    const permissions: readonly string[] = $auth?.user.permissions ?? [];
    return permissions.includes(target.permission);
  }

  const targetOptions = $derived(
    INBOUND_HOOK_TARGETS.map((t) => ({ value: t.key, label: t.label })),
  );
  const selectedTarget = $derived<InboundHookTarget | undefined>(
    getInboundHookTarget(createTarget),
  );

  // Receivers = integrations that carry a configured `target` (the marker of an
  // inbound receiver — an outbound webhook never sets it).
  const receivers = $derived(
    integrations.filter((i) => typeof i.config?.target === 'string' && i.config.target),
  );

  function receiverTarget(integration: IntegrationRecord): InboundHookTarget | undefined {
    const key = integration.config?.target;
    return typeof key === 'string' ? getInboundHookTarget(key) : undefined;
  }

  function statusTone(status: IntegrationRecord['status']): Tone {
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

  function updateCreateName(value: string) {
    createName = value;
    if (!keyTouched) createKey = slugify(value ? `inbound-${value}` : '');
  }

  // ── Load ──────────────────────────────────────────────────────────────────

  async function load() {
    loading = true;
    error = '';
    try {
      integrations = await api<IntegrationRecord[]>('/integrations');
    } catch (e) {
      error = e instanceof ApiError ? e.message : 'Échec du chargement des intégrations';
    } finally {
      loading = false;
    }
  }

  async function loadInbox() {
    inboxLoading = true;
    inboxError = '';
    try {
      const res = await api<Paginated<InboundMessage>>('/connect/inbox', {
        query: { source: 'WEBHOOK', page: 1, pageSize: 10 },
      });
      inbox = res.items;
      inboxTotal = res.total;
    } catch (e) {
      inboxError = e instanceof ApiError ? e.message : "Échec du chargement de l'inbox";
    } finally {
      inboxLoading = false;
    }
  }

  // ── Create form helpers ──────────────────────────────────────────────────────

  function openCreate() {
    createName = '';
    createKey = '';
    keyTouched = false;
    createTarget = '';
    createMappings = [];
    createSecret = '';
    createError = '';
    createdIntegration = null;
    createOpen = true;
  }

  function addMappingRow() {
    createMappings = [
      ...createMappings,
      { source: '', target: '', transform: 'none', required: false },
    ];
  }

  function updateMappingRow(index: number, field: keyof MappingRule, value: string | boolean) {
    createMappings = createMappings.map((row, i) =>
      i === index ? { ...row, [field]: value } : row,
    );
  }

  function removeMappingRow(index: number) {
    createMappings = createMappings.filter((_, i) => i !== index);
  }

  async function submitCreate(event: SubmitEvent) {
    event.preventDefault();
    if (!canManage || !createTarget) return;
    creating = true;
    createError = '';
    try {
      const config: Record<string, unknown> = { target: createTarget };
      const mappings = normalizeMappingRules(createMappings).filter(
        (row) => row.source || row.target,
      );
      if (mappings.length) config.mappings = mappings;
      if (createSecret.trim()) config.inboundSecret = createSecret.trim();
      const created = await api<IntegrationRecord>('/integrations', {
        method: 'POST',
        body: {
          key: createKey.trim(),
          name: createName.trim(),
          status: 'ENABLED',
          config,
        },
      });
      createdIntegration = created;
      await load();
    } catch (e) {
      createError = e instanceof ApiError ? e.message : 'Échec de la création du récepteur';
    } finally {
      creating = false;
    }
  }

  // ── Token issuance / rotation ────────────────────────────────────────────────

  async function issueToken(integration: IntegrationRecord) {
    if (!canManage) return;
    const alreadyIssued = integration.hasInboundToken;
    if (
      alreadyIssued &&
      !(await confirmAction(
        `Ré-émettre le jeton de « ${integration.name} » invalide immédiatement l'ancien. Le partenaire devra être mis à jour.`,
        { title: 'Rotationner le jeton', confirmLabel: 'Rotationner', dangerous: true },
      ))
    ) {
      return;
    }
    issuing = true;
    issueError = '';
    tokenResult = null;
    try {
      tokenResult = await api<TokenIssueResult>(`/integrations/${integration.id}/inbound-token`, {
        method: 'POST',
        body: {},
      });
      tokenCopied = false;
      urlCopied = false;
      tokenOpen = true;
      createOpen = false;
      await load();
    } catch (e) {
      issueError = e instanceof ApiError ? e.message : 'Échec de la génération du jeton';
      tokenOpen = true;
    } finally {
      issuing = false;
    }
  }

  async function copyToClipboard(value: string, which: 'token' | 'url') {
    try {
      await navigator.clipboard.writeText(value);
      if (which === 'token') tokenCopied = true;
      else urlCopied = true;
    } catch {
      // clipboard API unavailable — the value is still selectable in the modal
    }
  }

  // ── Reactivity ────────────────────────────────────────────────────────────

  $effect(() => {
    void load();
    void loadInbox();
  });
</script>

<svelte:head><title>Récepteurs entrants · Pulsar</title></svelte:head>

<PageHeader
  title="Récepteurs entrants"
  eyebrow="Connexions"
  subtitle="Un partenaire pousse du JSON vers Pulsar ; le jeton, la cible et le mapping définissent exactement ce qu'il peut écrire."
>
  {#snippet actions()}
    {#if canManage}
      <button
        type="button"
        class="rounded-md bg-accent px-3 py-1.5 text-sm font-semibold text-white hover:bg-accent-strong"
        onclick={openCreate}
      >
        Nouveau récepteur
      </button>
    {/if}
  {/snippet}
</PageHeader>

<ErrorNotice message={error} onretry={load} />

{#if loading}
  <Card padded={false}><Skeleton rows={4} /></Card>
{:else if receivers.length === 0}
  <EmptyState
    title="Aucun récepteur"
    message="Créez un récepteur pour laisser un partenaire pousser des données vers une cible métier précise."
  />
{:else}
  <Card padded={false}>
    <div class="divide-y divide-edge-soft">
      {#each receivers as integration (integration.id)}
        {@const target = receiverTarget(integration)}
        <article class="flex flex-wrap items-start justify-between gap-3 px-4 py-4">
          <div class="min-w-0">
            <div class="flex flex-wrap items-center gap-2">
              <p class="text-sm font-semibold text-ink">{integration.name}</p>
              <Badge tone={statusTone(integration.status)}>{integration.status}</Badge>
              {#if integration.hasInboundToken}
                <Badge tone="info">Jeton émis</Badge>
              {:else}
                <Badge tone="warn">Pas de jeton</Badge>
              {/if}
            </div>
            <p class="mt-1 text-xs text-ink-muted">
              Cible : {target?.label ?? integration.config?.target ?? '—'}
              {#if !target}<span class="text-danger"> (cible inconnue)</span>{/if}
            </p>
            <p class="mt-1 text-xs text-ink-faint">
              {Array.isArray(integration.config?.mappings) && integration.config.mappings.length
                ? `${integration.config.mappings.length} champ(s) mappé(s)`
                : 'Mapping identité (corps transmis tel quel)'}
              {integration.config?.inboundSecret ? '· HMAC activé' : '· sans signature'}
            </p>
          </div>
          {#if canManage}
            <button
              type="button"
              disabled={issuing}
              class="shrink-0 rounded-md border border-edge px-3 py-1.5 text-xs font-semibold text-ink-muted hover:bg-surface-muted disabled:opacity-50"
              onclick={() => void issueToken(integration)}
            >
              {integration.hasInboundToken ? 'Rotationner le jeton' : 'Générer le jeton'}
            </button>
          {/if}
        </article>
      {/each}
    </div>
  </Card>
{/if}

<!-- Partner-facing help -->
<Card>
  <h2 class="text-sm font-bold text-ink">Comment un partenaire se connecte</h2>
  <div class="mt-3 space-y-2 text-xs leading-5 text-ink-muted">
    <p>
      <span class="font-semibold text-ink">Requête.</span>
      <code class="rounded bg-surface-muted px-1 py-0.5 font-mono"
        >POST /api/v1/public/hooks/&lt;jeton&gt;</code
      >
      — le jeton dans l'URL est la seule crédentiale, aucune clé API ni JWT.
    </p>
    <p>
      <span class="font-semibold text-ink">Signature (optionnelle).</span> Si un secret est
      configuré, le partenaire doit envoyer
      <code class="rounded bg-surface-muted px-1 py-0.5 font-mono"
        >X-Signature: sha256=&lt;hex&gt;</code
      >
      (HMAC-SHA256 du corps brut). Absente ou invalide → 401.
    </p>
    <p>
      <span class="font-semibold text-ink">Idempotence.</span> En-tête
      <code class="rounded bg-surface-muted px-1 py-0.5 font-mono">X-Idempotency-Key</code>
      recommandé (sinon un hachage du corps sert de clé) : un rejeu renvoie 200 avec le statut d'origine,
      sans ré-exécuter l'écriture.
    </p>
    <p>
      <span class="font-semibold text-ink">Réponses.</span> 202 = livraison traitée (<code
        class="rounded bg-surface-muted px-1 py-0.5 font-mono">status: 'IMPORTED' | 'FAILED'</code
      >) ; 200 = rejeu idempotent ; 400/401/403/404 pour les erreurs d'accès.
    </p>
    <p>
      <span class="font-semibold text-ink">Taille.</span> 100 Ko par défaut (body-parser JSON) ; 256 Ko
      en défense en profondeur côté service.
    </p>
  </div>
</Card>

<!-- Inbox (WEBHOOK source only) -->
<Card padded={false}>
  <div
    class="flex flex-wrap items-center justify-between gap-3 border-b border-edge-soft px-4 py-3"
  >
    <div>
      <h2 class="text-sm font-bold text-ink">Livraisons reçues</h2>
      <p class="text-xs text-ink-muted">
        Boîte de réception filtrée aux webhooks (<code class="font-mono">source=WEBHOOK</code>).
      </p>
    </div>
    <a href="/connect/inbox" class="text-xs font-semibold text-accent hover:underline"
      >Voir toute l'inbox →</a
    >
  </div>
  <ErrorNotice message={inboxError} onretry={loadInbox} />
  {#if inboxLoading}
    <div class="p-4"><Skeleton rows={3} /></div>
  {:else if inbox.length === 0}
    <div class="p-4">
      <EmptyState title="Aucune livraison" message="Aucun message webhook reçu pour l'instant." />
    </div>
  {:else}
    <Table>
      {#snippet head()}
        <th>Statut</th>
        <th>Type</th>
        <th>Résumé</th>
        <th>Reçu le</th>
      {/snippet}
      {#snippet body()}
        {#each inbox as msg (msg.id)}
          <tr>
            <td
              ><Badge
                tone={msg.status === 'IMPORTED'
                  ? 'ok'
                  : msg.status === 'FAILED'
                    ? 'danger'
                    : 'neutral'}>{msg.status}</Badge
              ></td
            >
            <td class="text-xs text-ink-muted">{msg.kind || '—'}</td>
            <td class="max-w-xs truncate text-sm text-ink">{msg.summary || '—'}</td>
            <td class="text-xs text-ink-muted">{formatDateTime(msg.createdAt)}</td>
          </tr>
        {/each}
      {/snippet}
    </Table>
    {#if inboxTotal > inbox.length}
      <p class="px-4 py-2 text-xs text-ink-faint">
        {inbox.length} sur {inboxTotal} — voir l'inbox complète pour la suite.
      </p>
    {/if}
  {/if}
</Card>

<!-- Create receiver modal -->
<Modal bind:open={createOpen} title="Nouveau récepteur entrant" size="lg">
  {#if createdIntegration}
    <div class="space-y-4">
      <div class="rounded-card border border-ok/25 bg-ok-soft px-4 py-3 text-sm">
        <p class="font-semibold text-ok">Récepteur créé.</p>
        <p class="mt-1 text-xs text-ink-muted">
          {createdIntegration.name} — générez maintenant le jeton à donner au partenaire.
        </p>
      </div>
      <div class="flex justify-end gap-2">
        <button
          type="button"
          class="rounded-md border border-edge px-3 py-1.5 text-xs font-semibold text-ink-muted hover:bg-surface-muted"
          onclick={() => (createOpen = false)}>Fermer</button
        >
        <button
          type="button"
          disabled={issuing}
          class="rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-white hover:bg-accent-strong disabled:opacity-50"
          onclick={() => createdIntegration && void issueToken(createdIntegration)}
        >
          {issuing ? 'Génération…' : 'Générer le jeton'}
        </button>
      </div>
    </div>
  {:else}
    <form class="space-y-4" onsubmit={submitCreate}>
      <ErrorNotice message={createError} />
      <Field label="Nom">
        <Input
          value={createName}
          required
          placeholder="Ex. Réception commandes — Acme ERP"
          oninput={(e) => updateCreateName(e.currentTarget.value)}
        />
      </Field>
      <Field label="Clé technique">
        <Input
          bind:value={createKey}
          required
          placeholder="inbound-acme-erp"
          oninput={() => (keyTouched = true)}
        />
      </Field>
      <Field label="Cible métier">
        <ReferenceSelect
          options={targetOptions}
          bind:value={createTarget}
          placeholder="Sélectionner une cible…"
          required
        />
      </Field>
      {#if selectedTarget}
        <div class="rounded-xl border border-edge bg-surface-muted p-3 text-xs">
          <p class="text-ink">
            Permission requise : <code class="font-mono">{selectedTarget.permission}</code>
            {#if !holdsTargetPermission(selectedTarget)}
              <span class="ml-1 text-danger">— vous ne la détenez pas (403 à la création)</span>
            {/if}
          </p>
          {#if selectedTarget.naturalKey}
            <p class="mt-1 text-ink-muted">
              Clé naturelle : <code class="font-mono">{selectedTarget.naturalKey}</code> — deux livraisons
              avec la même valeur mettent à jour la même ligne.
            </p>
          {:else}
            <p class="mt-1 text-ink-muted">Cible de création uniquement (pas de mise à jour).</p>
          {/if}
        </div>
      {/if}

      <div>
        <div class="flex items-center justify-between">
          <p class="text-xs font-semibold text-ink-muted">
            Mapping (facultatif — vide = corps transmis tel quel)
          </p>
          <button
            type="button"
            class="rounded-md border border-edge px-2 py-1 text-[11px] font-semibold text-ink-muted hover:bg-surface-muted"
            onclick={addMappingRow}>+ champ</button
          >
        </div>
        {#if createMappings.length}
          <div class="mt-2 overflow-hidden rounded-xl border border-edge">
            <div
              class="grid grid-cols-[1fr_1fr_130px_70px_32px] gap-0 bg-surface-muted px-3 py-2 text-[11px] font-bold uppercase tracking-wide text-ink-faint"
            >
              <span>Source</span><span>Cible</span><span>Transform</span><span>Req.</span><span
              ></span>
            </div>
            {#each createMappings as row, index (index)}
              <div
                class="grid grid-cols-[1fr_1fr_130px_70px_32px] gap-2 border-t border-edge-soft p-2"
              >
                <Input
                  value={row.source}
                  placeholder="order.reference"
                  oninput={(e) => updateMappingRow(index, 'source', e.currentTarget.value)}
                />
                <Input
                  value={row.target}
                  placeholder="externalRef"
                  oninput={(e) => updateMappingRow(index, 'target', e.currentTarget.value)}
                />
                <Input
                  value={row.transform ?? 'none'}
                  placeholder="trim / default:x"
                  oninput={(e) => updateMappingRow(index, 'transform', e.currentTarget.value)}
                />
                <label class="flex items-center justify-center gap-1 text-xs text-ink-muted">
                  <input
                    type="checkbox"
                    checked={!!row.required}
                    onchange={(e) => updateMappingRow(index, 'required', e.currentTarget.checked)}
                  />
                </label>
                <button
                  type="button"
                  class="rounded-md text-xs text-danger hover:bg-danger-soft"
                  onclick={() => removeMappingRow(index)}>×</button
                >
              </div>
            {/each}
          </div>
          <p class="mt-1 text-[11px] text-ink-faint">
            Transformations : trim, uppercase, number, date.iso, default:&lt;valeur&gt;,
            concat:&lt;séparateur&gt;. Chemins pointés (ex. <code class="font-mono">a.b.c</code>).
          </p>
        {/if}
      </div>

      <Field label="Secret HMAC (facultatif)">
        <Input
          bind:value={createSecret}
          placeholder="Laisser vide pour désactiver la vérification de signature"
        />
      </Field>

      <div class="flex justify-end gap-2 border-t border-edge-soft pt-3">
        <button
          type="button"
          class="rounded-md border border-edge px-3 py-1.5 text-xs font-semibold text-ink-muted hover:bg-surface-muted"
          onclick={() => (createOpen = false)}>Annuler</button
        >
        <button
          type="submit"
          disabled={creating || !canManage || !createTarget}
          class="rounded-md bg-accent px-4 py-1.5 text-sm font-semibold text-white hover:bg-accent-strong disabled:opacity-50"
        >
          {creating ? 'Création…' : 'Créer le récepteur'}
        </button>
      </div>
    </form>
  {/if}
</Modal>

<!-- Token modal — shown once, never persisted client-side -->
<Modal bind:open={tokenOpen} title="Jeton du récepteur" size="md" dismissible={!issuing}>
  {#if issueError}
    <ErrorNotice message={issueError} />
  {:else if tokenResult}
    <div class="space-y-4">
      <div class="rounded-card border border-warn/30 bg-warn-soft px-3 py-2 text-xs text-warn">
        Ce jeton n'est affiché qu'une seule fois. Copiez-le maintenant — Pulsar ne le retiendra pas.
      </div>
      <Field label="Jeton">
        <div class="flex gap-2">
          <Input value={tokenResult.token} disabled />
          <button
            type="button"
            class="shrink-0 rounded-md border border-edge px-3 py-1.5 text-xs font-semibold text-ink-muted hover:bg-surface-muted"
            onclick={() => void copyToClipboard(tokenResult!.token, 'token')}
          >
            {tokenCopied ? 'Copié' : 'Copier'}
          </button>
        </div>
      </Field>
      <Field label="URL complète à donner au partenaire">
        <div class="flex gap-2">
          <Input value={tokenResult.url} disabled />
          <button
            type="button"
            class="shrink-0 rounded-md border border-edge px-3 py-1.5 text-xs font-semibold text-ink-muted hover:bg-surface-muted"
            onclick={() => void copyToClipboard(tokenResult!.url, 'url')}
          >
            {urlCopied ? 'Copié' : 'Copier'}
          </button>
        </div>
      </Field>
      <p class="text-xs text-ink-muted">
        Cible : {tokenResult.target ?? '—'}
        {#if !tokenResult.targetValid}<span class="text-danger"> (cible invalide)</span>{/if}
        · Signature HMAC : {tokenResult.signed ? 'activée' : 'désactivée'} · Statut :
        {tokenResult.status}
      </p>
      <div class="flex justify-end">
        <button
          type="button"
          class="rounded-md bg-accent px-4 py-1.5 text-sm font-semibold text-white hover:bg-accent-strong"
          onclick={() => (tokenOpen = false)}
        >
          J'ai copié le jeton
        </button>
      </div>
    </div>
  {/if}
</Modal>
