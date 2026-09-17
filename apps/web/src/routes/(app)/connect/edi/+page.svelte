<script lang="ts">
  import { api, ApiError } from '$lib/api/client';
  import { auth } from '$lib/stores/auth';
  import { getAccessToken } from '$lib/stores/auth';
  import { confirmAction } from '$lib/stores/confirmation';
  import { formatDateTime } from '$lib/format';
  import {
    PERMISSIONS,
    parseX12,
    read204,
    x12TransactionsOfType,
    type CanonicalLoadTender,
    type CanonicalTenderStop,
    type Paginated,
    type X12ParseError,
  } from '@pulsar/shared';
  import {
    Badge,
    Card,
    EmptyState,
    EntityPicker,
    ErrorNotice,
    Field,
    Input,
    Modal,
    PageHeader,
    ReferenceSelect,
    Skeleton,
    Table,
    Textarea,
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

  interface EdiInboundResult {
    inboxId: string;
    status: 'IMPORTED' | 'FAILED';
    summary: string;
    transactionSetId?: '204' | '210';
    ack?: string;
    error?: string;
    entityType?: string;
    entityId?: string;
    replayed?: true;
  }

  interface Edi214SendResult {
    deliveryId: string;
    shipmentNumber: string;
    eventCount: number;
  }

  // A short, self-contained 204 (1 pickup + 1 delivery) — used both as the
  // default preview/test text and never sent anywhere by the preview block.
  const SAMPLE_204 = `ISA*00*          *00*          *ZZ*ACMESHIPPER    *ZZ*PULSARTMS      *260917*0905*U*00401*000000102*0*P*>~
GS*SM*ACMESHIPPER*PULSARTMS*20260917*0905*102*X*004010~
ST*204*0001~
B2**CRXY**SHP-2026-0043**PP~
B2A*00~
S5*1*CL*9000*L~
G62*10*20260923*1*0900*LT~
N1*SH*ACME MANUFACTURING*93*ACME-MTL~
N4*MONTREAL*QC*H3C1K3*CA~
S5*2*CU*9000*L~
G62*54*20260924*1*1400*LT~
N1*CN*LOBLAW DC TORONTO*93*LOB-TOR~
N4*TORONTO*ON*M1V4T3*CA~
SE*12*0001~
GE*1*102~
IEA*1*000000102~`;

  const PURPOSE_LABELS: Record<CanonicalLoadTender['purpose'], string> = {
    ORIGINAL: 'Original',
    CANCELLATION: 'Annulation',
    CHANGE: 'Modification',
    REPLACE: 'Remplacement',
    UNKNOWN: 'Inconnu',
  };

  const STOP_TYPE_LABELS: Record<CanonicalTenderStop['type'], string> = {
    PICKUP: 'Ramasse',
    DELIVERY: 'Livraison',
    OTHER: 'Autre',
  };

  // ── State: partner list ─────────────────────────────────────────────────────

  let integrations = $state<IntegrationRecord[]>([]);
  let loading = $state(true);
  let error = $state('');

  const partners = $derived(integrations.filter((i) => i.key.startsWith('edi-')));

  // ── Permissions ──────────────────────────────────────────────────────────────

  const canManagePartners = $derived(
    $auth?.user.permissions.includes(PERMISSIONS.CORE.INTEGRATIONS_MANAGE) ?? false,
  );
  const canSendEdi = $derived(
    $auth?.user.permissions.includes(PERMISSIONS.CORE.CONNECT_MANAGE) ?? false,
  );
  const canReadTracking = $derived(
    $auth?.user.permissions.includes(PERMISSIONS.TRANSPORTATION.TRACKING_READ) ?? false,
  );
  const canWriteTracking = $derived(
    $auth?.user.permissions.includes(PERMISSIONS.TRANSPORTATION.TRACKING_WRITE) ?? false,
  );

  // ── State: create/edit partner modal ─────────────────────────────────────────

  let formOpen = $state(false);
  let editingId = $state<string | null>(null);
  let editingConfig = $state<IntegrationRecord['config'] | undefined>(undefined);
  let formName = $state('');
  let formKey = $state('');
  let keyTouched = $state(false);
  let formIsaSender = $state('');
  let formIsaReceiver = $state('');
  let formGsSender = $state('');
  let formGsReceiver = $state('');
  let formCustomerId = $state('');
  let formCarrierId = $state('');
  let formUrl = $state('');
  let saving = $state(false);
  let saveError = $state('');

  // ── State: token modal (same pattern as /connect/inbound-hooks) ─────────────

  let tokenOpen = $state(false);
  let tokenResult = $state<TokenIssueResult | null>(null);
  let issuingFor = $state<string | null>(null);
  let issueError = $state('');
  let tokenCopied = $state(false);
  let urlCopied = $state(false);

  // ── State: manual "envoyer un 204" modal ─────────────────────────────────────

  let sendOpen = $state(false);
  let sendPartner = $state<IntegrationRecord | null>(null);
  let sendContent = $state('');
  let sending = $state(false);
  let sendError = $state('');
  let sendResult = $state<EdiInboundResult | null>(null);

  // ── State: client-side preview (pure, never writes) ─────────────────────────

  let previewContent = $state(SAMPLE_204);
  let previewRan = $state(false);
  let previewResult = $state<CanonicalLoadTender | null>(null);
  let previewErrors = $state<X12ParseError[]>([]);

  // ── State: inbox (EDI source only) ──────────────────────────────────────────

  let inbox = $state<InboundMessage[]>([]);
  let inboxTotal = $state(0);
  let inboxLoading = $state(true);
  let inboxError = $state('');

  // ── State: per-shipment 214 helper ──────────────────────────────────────────

  let helperPartnerKey = $state('');
  let helperShipmentId = $state('');
  let helper214Text = $state('');
  let helper214Loading = $state(false);
  let helper214Error = $state('');
  let helper214Copied = $state(false);
  let sendingHelper214 = $state(false);
  let helper214SendError = $state('');
  let helper214SendResult = $state<Edi214SendResult | null>(null);

  const partnerOptions = $derived(partners.map((p) => ({ value: p.key, label: p.name })));
  const helperPartner = $derived(partners.find((p) => p.key === helperPartnerKey));
  const helperPartnerHasUrl = $derived(
    typeof helperPartner?.config?.url === 'string' && helperPartner.config.url.trim().length > 0,
  );

  // ── Helpers ──────────────────────────────────────────────────────────────────

  function slugify(value: string): string {
    return value
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48);
  }

  function updateFormName(value: string) {
    formName = value;
    if (!keyTouched) formKey = value ? `edi-${slugify(value)}` : '';
  }

  function statusTone(status: IntegrationRecord['status']): Tone {
    if (status === 'ENABLED') return 'ok';
    if (status === 'ERROR') return 'danger';
    return 'neutral';
  }

  function configString(partner: IntegrationRecord, key: string): string {
    const v = partner.config?.[key];
    return typeof v === 'string' && v.trim() ? v : '—';
  }

  // ── Load ──────────────────────────────────────────────────────────────────

  async function load() {
    loading = true;
    error = '';
    try {
      integrations = await api<IntegrationRecord[]>('/integrations');
    } catch (e) {
      error = e instanceof ApiError ? e.message : 'Échec du chargement des partenaires EDI';
    } finally {
      loading = false;
    }
  }

  async function loadInbox() {
    inboxLoading = true;
    inboxError = '';
    try {
      const res = await api<Paginated<InboundMessage>>('/connect/inbox', {
        query: { source: 'EDI', page: 1, pageSize: 10 },
      });
      inbox = res.items;
      inboxTotal = res.total;
    } catch (e) {
      inboxError = e instanceof ApiError ? e.message : "Échec du chargement de l'inbox";
    } finally {
      inboxLoading = false;
    }
  }

  // ── Create / edit partner ────────────────────────────────────────────────────

  function openCreate() {
    editingId = null;
    editingConfig = undefined;
    formName = '';
    formKey = '';
    keyTouched = false;
    formIsaSender = '';
    formIsaReceiver = '';
    formGsSender = '';
    formGsReceiver = '';
    formCustomerId = '';
    formCarrierId = '';
    formUrl = '';
    saveError = '';
    formOpen = true;
  }

  function openEdit(partner: IntegrationRecord) {
    editingId = partner.id;
    editingConfig = partner.config;
    formName = partner.name;
    formKey = partner.key;
    keyTouched = true;
    formIsaSender =
      typeof partner.config?.isaSenderId === 'string' ? partner.config.isaSenderId : '';
    formIsaReceiver =
      typeof partner.config?.isaReceiverId === 'string' ? partner.config.isaReceiverId : '';
    formGsSender = typeof partner.config?.gsSenderId === 'string' ? partner.config.gsSenderId : '';
    formGsReceiver =
      typeof partner.config?.gsReceiverId === 'string' ? partner.config.gsReceiverId : '';
    formCustomerId =
      typeof partner.config?.customerId === 'string' ? partner.config.customerId : '';
    formCarrierId = typeof partner.config?.carrierId === 'string' ? partner.config.carrierId : '';
    formUrl = typeof partner.config?.url === 'string' ? partner.config.url : '';
    saveError = '';
    formOpen = true;
  }

  // `undefined` (never set) so a blank field never reaches the request body —
  // the server derives GS02/03 from ISA06/08 with `??`, which only falls back
  // for a genuinely absent key, never for `''` (see integrations.service.ts).
  function trimmedOrUndefined(value: string): string | undefined {
    const v = value.trim();
    return v ? v : undefined;
  }

  // `PATCH /integrations/:id` now MERGES `config` into the stored config
  // (rather than replacing it): a key present with a non-null value is
  // set/overwritten, a key present with `null` is deleted, and a key simply
  // absent from the body is left untouched. So on CREATE a blank field must
  // still be OMITTED (there's nothing to merge into yet — omitting lets the
  // server default apply), while on EDIT a field that WAS set and is now
  // cleared must be sent as `null` (to actually delete it) — omitting it
  // there would leave the old value in place. A field that was already
  // blank and stays blank is omitted either way (nothing changed).
  function buildConfig(original?: IntegrationRecord['config']): Record<string, unknown> {
    const config: Record<string, unknown> = { format: 'x12' };
    setOptionalField(config, 'isaSenderId', formIsaSender, original);
    setOptionalField(config, 'isaReceiverId', formIsaReceiver, original);
    setOptionalField(config, 'gsSenderId', formGsSender, original);
    setOptionalField(config, 'gsReceiverId', formGsReceiver, original);
    if (formCustomerId) config.customerId = formCustomerId;
    if (formCarrierId) config.carrierId = formCarrierId;
    setOptionalField(config, 'url', formUrl, original);
    return config;
  }

  // Sets `config[key]` to the trimmed value when non-blank; when blank AND the
  // original config held a non-blank value for that key, sets it to `null` so
  // the merge on the server deletes it; otherwise (blank and was already
  // blank/unset — includes CREATE, where `original` is undefined) omits the
  // key entirely.
  function setOptionalField(
    config: Record<string, unknown>,
    key: string,
    value: string,
    original?: Record<string, unknown>,
  ) {
    const trimmed = trimmedOrUndefined(value);
    if (trimmed) {
      config[key] = trimmed;
      return;
    }
    const originalValue = original?.[key];
    if (typeof originalValue === 'string' && originalValue.trim()) {
      config[key] = null;
    }
  }

  async function submitForm(event: SubmitEvent) {
    event.preventDefault();
    if (!canManagePartners) return;
    saving = true;
    saveError = '';
    try {
      const config = buildConfig(editingId ? editingConfig : undefined);
      if (editingId) {
        await api<IntegrationRecord>(`/integrations/${editingId}`, {
          method: 'PATCH',
          body: { name: formName.trim(), config },
        });
      } else {
        await api<IntegrationRecord>('/integrations', {
          method: 'POST',
          body: { key: formKey.trim(), name: formName.trim(), status: 'ENABLED', config },
        });
      }
      formOpen = false;
      await load();
    } catch (e) {
      saveError = e instanceof ApiError ? e.message : "Échec de l'enregistrement du partenaire";
    } finally {
      saving = false;
    }
  }

  // ── Token issuance / rotation (reuses the /connect/inbound-hooks pattern) ────

  async function issueToken(partner: IntegrationRecord) {
    if (!canManagePartners) return;
    const alreadyIssued = partner.hasInboundToken;
    if (
      alreadyIssued &&
      !(await confirmAction(
        `Ré-émettre le jeton de « ${partner.name} » invalide immédiatement l'ancien. Le partenaire devra être mis à jour.`,
        { title: 'Rotationner le jeton', confirmLabel: 'Rotationner', dangerous: true },
      ))
    ) {
      return;
    }
    issuingFor = partner.id;
    issueError = '';
    tokenResult = null;
    try {
      tokenResult = await api<TokenIssueResult>(`/integrations/${partner.id}/inbound-token`, {
        method: 'POST',
        body: {},
      });
      tokenCopied = false;
      urlCopied = false;
      tokenOpen = true;
      await load();
    } catch (e) {
      issueError = e instanceof ApiError ? e.message : 'Échec de la génération du jeton';
      tokenOpen = true;
    } finally {
      issuingFor = null;
    }
  }

  async function copyToClipboard(value: string, setter: (v: boolean) => void) {
    try {
      await navigator.clipboard.writeText(value);
      setter(true);
    } catch {
      // clipboard API unavailable — the value is still selectable
    }
  }

  // ── Manual "envoyer un 204" ──────────────────────────────────────────────────

  function openSend(partner: IntegrationRecord) {
    sendPartner = partner;
    sendContent = SAMPLE_204;
    sendError = '';
    sendResult = null;
    sendOpen = true;
  }

  async function submitSend(event: SubmitEvent) {
    event.preventDefault();
    if (!sendPartner || !canSendEdi) return;
    sending = true;
    sendError = '';
    sendResult = null;
    try {
      sendResult = await api<EdiInboundResult>('/connect/edi/inbound', {
        method: 'POST',
        body: { integrationKey: sendPartner.key, content: sendContent },
      });
      await loadInbox();
    } catch (e) {
      sendError = e instanceof ApiError ? e.message : "Échec de l'envoi du 204";
    } finally {
      sending = false;
    }
  }

  // ── Client-side preview (pure — @pulsar/shared only, never writes) ──────────

  function runPreview() {
    previewRan = true;
    previewResult = null;
    previewErrors = [];
    const parsed = parseX12(previewContent);
    if (!parsed.ok || !parsed.document) {
      previewErrors = parsed.errors;
      return;
    }
    const [tx] = x12TransactionsOfType(parsed.document, '204');
    if (!tx) {
      previewErrors = parsed.errors.length
        ? parsed.errors
        : [
            {
              code: 'NO_TRANSACTION',
              message: 'Aucune transaction 204 trouvée dans cet interchange.',
            },
          ];
      return;
    }
    previewErrors = parsed.errors;
    previewResult = read204(tx);
  }

  // ── Per-shipment 214 helper ──────────────────────────────────────────────────

  async function readErrorBody(res: Response): Promise<string> {
    const raw = await res.text().catch(() => '');
    try {
      const parsed = JSON.parse(raw) as { message?: string | string[] };
      if (Array.isArray(parsed.message)) return parsed.message.join(', ');
      if (typeof parsed.message === 'string') return parsed.message;
    } catch {
      // not JSON — fall through to the raw text
    }
    return raw || `Échec (${res.status})`;
  }

  async function view214() {
    if (!helperPartner || !helperShipmentId) return;
    helper214Loading = true;
    helper214Error = '';
    helper214Text = '';
    helper214Copied = false;
    try {
      const url = new URL(
        `/api/v1/transportation/shipments/${helperShipmentId}/edi/214`,
        window.location.origin,
      );
      url.searchParams.set('integrationKey', helperPartner.key);
      const token = getAccessToken();
      const res = await fetch(url, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error(await readErrorBody(res));
      helper214Text = await res.text();
    } catch (e) {
      helper214Error = e instanceof Error ? e.message : 'Échec du chargement du 214';
    } finally {
      helper214Loading = false;
    }
  }

  async function copyHelper214() {
    try {
      await navigator.clipboard.writeText(helper214Text);
      helper214Copied = true;
    } catch {
      // clipboard API unavailable
    }
  }

  async function send214() {
    if (!helperPartner || !helperShipmentId || !helperPartnerHasUrl) return;
    if (
      !(await confirmAction(
        `Mettre en file le 214 courant de cette expédition pour « ${helperPartner.name} » ?`,
        { title: 'Envoyer le 214', confirmLabel: 'Envoyer' },
      ))
    ) {
      return;
    }
    sendingHelper214 = true;
    helper214SendError = '';
    helper214SendResult = null;
    try {
      helper214SendResult = await api<Edi214SendResult>(
        `/transportation/shipments/${helperShipmentId}/edi/214/send`,
        { method: 'POST', query: { integrationKey: helperPartner.key }, body: {} },
      );
    } catch (e) {
      helper214SendError = e instanceof ApiError ? e.message : "Échec de l'envoi du 214";
    } finally {
      sendingHelper214 = false;
    }
  }

  // ── Reactivity ────────────────────────────────────────────────────────────

  $effect(() => {
    void load();
    void loadInbox();
  });
</script>

<svelte:head><title>EDI X12 · Pulsar</title></svelte:head>

<PageHeader
  title="EDI X12"
  eyebrow="Connexions"
  subtitle="Partenaires EDI : tender 204 entrant, réponse 990, statuts 214 sortants, facture 210 entrante."
>
  {#snippet actions()}
    {#if canManagePartners}
      <button
        type="button"
        class="rounded-md bg-accent px-3 py-1.5 text-sm font-semibold text-white hover:bg-accent-strong"
        onclick={openCreate}
      >
        Nouveau partenaire EDI
      </button>
    {/if}
  {/snippet}
</PageHeader>

<ErrorNotice message={error} onretry={load} />

{#if loading}
  <Card padded={false}><Skeleton rows={4} /></Card>
{:else if partners.length === 0}
  <EmptyState
    title="Aucun partenaire EDI"
    message="Créez un partenaire pour lui associer des identifiants ISA/GS, un client et/ou un transporteur."
  />
{:else}
  <Card padded={false}>
    <div class="divide-y divide-edge-soft">
      {#each partners as partner (partner.id)}
        <article class="flex flex-wrap items-start justify-between gap-3 px-4 py-4">
          <div class="min-w-0">
            <div class="flex flex-wrap items-center gap-2">
              <p class="text-sm font-semibold text-ink">{partner.name}</p>
              <code
                class="rounded bg-surface-muted px-1.5 py-0.5 text-[11px] font-mono text-ink-muted"
                >{partner.key}</code
              >
              <Badge tone={statusTone(partner.status)}>{partner.status}</Badge>
              {#if partner.hasInboundToken}
                <Badge tone="info">Jeton émis</Badge>
              {:else}
                <Badge tone="warn">Pas de jeton</Badge>
              {/if}
            </div>
            <p class="mt-1 text-xs text-ink-muted">
              ISA {configString(partner, 'isaSenderId')} → {configString(partner, 'isaReceiverId')}
              · GS {configString(partner, 'gsSenderId')} → {configString(partner, 'gsReceiverId')}
            </p>
            <p class="mt-1 text-xs text-ink-faint">
              Client (204) : {configString(partner, 'customerId')} · Transporteur (210) :
              {configString(partner, 'carrierId')} · 214 sortant :
              {typeof partner.config?.url === 'string' && partner.config.url
                ? partner.config.url
                : 'non configuré'}
            </p>
          </div>
          <div class="flex shrink-0 flex-wrap gap-2">
            {#if canManagePartners}
              <button
                type="button"
                class="rounded-md border border-edge px-3 py-1.5 text-xs font-semibold text-ink-muted hover:bg-surface-muted"
                onclick={() => openEdit(partner)}>Modifier</button
              >
              <button
                type="button"
                disabled={issuingFor === partner.id}
                class="rounded-md border border-edge px-3 py-1.5 text-xs font-semibold text-ink-muted hover:bg-surface-muted disabled:opacity-50"
                onclick={() => void issueToken(partner)}
              >
                {partner.hasInboundToken ? 'Rotationner le jeton' : 'Générer le jeton'}
              </button>
            {/if}
            {#if canSendEdi}
              <button
                type="button"
                class="rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-white hover:bg-accent-strong"
                onclick={() => openSend(partner)}>Envoyer un 204</button
              >
            {/if}
          </div>
        </article>
      {/each}
    </div>
  </Card>
{/if}

<!-- Client-side preview — pure, never writes anything -->
<Card>
  <h2 class="text-sm font-bold text-ink">Tester avec un 204 (aperçu, aucune écriture)</h2>
  <p class="mt-1 text-xs text-ink-muted">
    Le texte collé est décodé entièrement dans le navigateur (<code class="font-mono"
      >@pulsar/shared/edi</code
    >) — rien n'est envoyé au serveur.
  </p>
  <div class="mt-3">
    <Field label="Interchange X12 (204)">
      <Textarea bind:value={previewContent} rows={8} />
    </Field>
  </div>
  <div class="mt-2 flex justify-end">
    <button
      type="button"
      class="rounded-md border border-edge px-3 py-1.5 text-xs font-semibold text-ink-muted hover:bg-surface-muted"
      onclick={runPreview}>Décoder</button
    >
  </div>

  {#if previewRan}
    {#if previewResult}
      {@const tender = previewResult}
      <div class="mt-4 space-y-3 border-t border-edge-soft pt-4">
        {#if previewErrors.length}
          <div class="rounded-card border border-warn/30 bg-warn-soft px-3 py-2 text-xs text-warn">
            <p class="font-semibold">Document lisible mais avec des anomalies :</p>
            <ul class="mt-1 list-disc pl-4">
              {#each previewErrors as err (err.code + (err.segment ?? '') + (err.index ?? ''))}
                <li>{err.message}</li>
              {/each}
            </ul>
          </div>
        {/if}
        <div class="grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-3">
          <p>
            <span class="font-semibold text-ink">Shipment ID :</span>
            {tender.shipmentId || '—'}
          </p>
          <p><span class="font-semibold text-ink">SCAC :</span> {tender.scac ?? '—'}</p>
          <p>
            <span class="font-semibold text-ink">But :</span>
            {PURPOSE_LABELS[tender.purpose]}
          </p>
          <p>
            <span class="font-semibold text-ink">Poids total :</span>
            {tender.totalWeight ?? '—'}
            {tender.weightUnit ?? ''}
          </p>
          <p>
            <span class="font-semibold text-ink">Références :</span>
            {tender.references.length
              ? tender.references.map((r) => `${r.qualifier}:${r.value}`).join(', ')
              : '—'}
          </p>
          <p>
            <span class="font-semibold text-ink">Équipement :</span>
            {tender.equipment.length
              ? tender.equipment
                  .map((e) => [e.initial, e.number, e.descriptionCode].filter(Boolean).join(' '))
                  .join(', ')
              : '—'}
          </p>
        </div>

        {#if tender.stops.length === 0}
          <EmptyState title="Aucun arrêt" message="Ce 204 ne contient aucune boucle S5 lisible." />
        {:else}
          <Table>
            {#snippet head()}
              <th>Type</th>
              <th>Nom</th>
              <th>Ville</th>
              <th>Prov.</th>
              <th>Fenêtre</th>
              <th>Poids</th>
            {/snippet}
            {#snippet body()}
              {#each tender.stops as stop (stop.sequence)}
                <tr>
                  <td
                    ><Badge tone={stop.type === 'DELIVERY' ? 'info' : 'ok'}
                      >{STOP_TYPE_LABELS[stop.type]}</Badge
                    ></td
                  >
                  <td class="text-sm text-ink">{stop.name ?? '—'}</td>
                  <td class="text-xs text-ink-muted">{stop.city ?? '—'}</td>
                  <td class="text-xs text-ink-muted">{stop.state ?? '—'}</td>
                  <td class="text-xs text-ink-muted">
                    {stop.earliestAt ? formatDateTime(stop.earliestAt) : '—'}
                    {#if stop.latestAt}→ {formatDateTime(stop.latestAt)}{/if}
                  </td>
                  <td class="text-xs text-ink-muted"
                    >{stop.weight ?? '—'} {stop.weightUnit ?? ''}</td
                  >
                </tr>
              {/each}
            {/snippet}
          </Table>
        {/if}
      </div>
    {:else}
      <div
        class="mt-4 rounded-card border border-danger/25 bg-danger-soft px-3 py-2 text-xs text-danger"
      >
        <p class="font-semibold">Impossible de décoder ce document :</p>
        <ul class="mt-1 list-disc pl-4">
          {#each previewErrors as err (err.code + (err.segment ?? '') + (err.index ?? ''))}
            <li>{err.code} — {err.message}</li>
          {/each}
        </ul>
      </div>
    {/if}
  {/if}
</Card>

<!-- Per-shipment 214 helper -->
<Card>
  <h2 class="text-sm font-bold text-ink">Statut 214 d'une expédition</h2>
  <p class="mt-1 text-xs text-ink-muted">
    Génère l'interchange 214 courant d'une expédition pour un partenaire, et permet de le mettre en
    file vers son endpoint (<code class="font-mono">config.url</code>).
  </p>
  <div class="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
    <Field label="Partenaire EDI">
      <ReferenceSelect
        options={partnerOptions}
        bind:value={helperPartnerKey}
        placeholder="Choisir un partenaire…"
      />
    </Field>
    <Field label="Expédition">
      <EntityPicker
        endpoint="/transportation/shipments"
        label="Expédition"
        labelKey="shipmentNumber"
        bind:value={helperShipmentId}
      />
    </Field>
  </div>
  <div class="mt-3 flex flex-wrap gap-2">
    <button
      type="button"
      disabled={!helperPartner || !helperShipmentId || !canReadTracking || helper214Loading}
      class="rounded-md border border-edge px-3 py-1.5 text-xs font-semibold text-ink-muted hover:bg-surface-muted disabled:opacity-50"
      onclick={() => void view214()}
    >
      {helper214Loading ? 'Chargement…' : 'Voir le 214'}
    </button>
    <button
      type="button"
      disabled={!helperPartner ||
        !helperShipmentId ||
        !helperPartnerHasUrl ||
        !canWriteTracking ||
        sendingHelper214}
      class="rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-white hover:bg-accent-strong disabled:opacity-50"
      onclick={() => void send214()}
    >
      {sendingHelper214 ? 'Envoi…' : 'Envoyer le 214'}
    </button>
    {#if helperPartner && !helperPartnerHasUrl}
      <p class="self-center text-xs text-ink-faint">
        « {helperPartner.name} » n'a pas d'URL sortante configurée — envoi désactivé.
      </p>
    {/if}
  </div>
  <ErrorNotice message={helper214Error} />
  {#if helper214Text}
    <div class="mt-3">
      <div class="flex items-center justify-between">
        <p class="text-xs font-semibold text-ink-muted">Interchange 214</p>
        <button
          type="button"
          class="rounded-md border border-edge px-2 py-1 text-[11px] font-semibold text-ink-muted hover:bg-surface-muted"
          onclick={() => void copyHelper214()}
        >
          {helper214Copied ? 'Copié' : 'Copier'}
        </button>
      </div>
      <pre
        class="mt-1 max-h-64 overflow-auto rounded-xl border border-edge bg-surface-muted p-3 text-[11px] whitespace-pre-wrap text-ink">{helper214Text}</pre>
    </div>
  {/if}
  <ErrorNotice message={helper214SendError} />
  {#if helper214SendResult}
    <div class="mt-3 rounded-card border border-ok/25 bg-ok-soft px-3 py-2 text-xs text-ok">
      Livraison mise en file (<code class="font-mono">{helper214SendResult.deliveryId}</code>) —
      {helper214SendResult.eventCount} événement(s) pour {helper214SendResult.shipmentNumber}.
    </div>
  {/if}
</Card>

<!-- Inbox (EDI source only) -->
<Card padded={false}>
  <div
    class="flex flex-wrap items-center justify-between gap-3 border-b border-edge-soft px-4 py-3"
  >
    <div>
      <h2 class="text-sm font-bold text-ink">Livraisons EDI reçues</h2>
      <p class="text-xs text-ink-muted">
        Boîte de réception filtrée aux interchanges EDI (<code class="font-mono">source=EDI</code>).
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
      <EmptyState title="Aucune livraison" message="Aucun interchange EDI reçu pour l'instant." />
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

<!-- Partner-facing help -->
<Card>
  <h2 class="text-sm font-bold text-ink">Comment un partenaire EDI se connecte</h2>
  <div class="mt-3 space-y-2 text-xs leading-5 text-ink-muted">
    <p>
      <span class="font-semibold text-ink">Intégration.</span> Un partenaire = une intégration de
      clé
      <code class="rounded bg-surface-muted px-1 py-0.5 font-mono">edi-&lt;partenaire&gt;</code>.
      <code class="font-mono">isaSenderId</code>/<code class="font-mono">isaReceiverId</code>
      (ISA06/08, ≤ 15 caractères) identifient les deux bouts ;
      <code class="font-mono">gsSenderId</code>/<code class="font-mono">gsReceiverId</code>
      (GS02/03) reprennent les ids ISA par défaut.
      <code class="font-mono">customerId</code> est obligatoire pour créer une commande depuis un
      204 ; <code class="font-mono">carrierId</code> pour importer une facture depuis un 210.
    </p>
    <p>
      <span class="font-semibold text-ink">Entrée.</span>
      <code class="rounded bg-surface-muted px-1 py-0.5 font-mono"
        >POST /api/v1/connect/edi/inbound</code
      >
      (JWT + <code class="font-mono">core.connect.manage</code>) accepte
      <code class="font-mono">text/plain</code> avec l'en-tête
      <code class="font-mono">X-Integration-Key</code>, ou du JSON
      <code class="font-mono">{'{ integrationKey, content }'}</code>. Le même contenu peut aussi
      être poussé sur la porte publique du jeton entrant (
      <code class="font-mono">POST /public/hooks/&lt;jeton&gt;</code>, quand un jeton est émis pour
      ce partenaire) — même idempotence, même journal.
    </p>
    <p>
      <span class="font-semibold text-ink">Réponse.</span> 202 avec
      <code class="font-mono">{'{ inboxId, status: "IMPORTED" | "FAILED", ack? }'}</code> — le 990
      généré (accepté ou refusé, avec son motif) est toujours dans
      <code class="font-mono">ack</code>
      pour un 204. Un renvoi du même interchange répond
      <code class="font-mono">replayed: true</code> sans rien réécrire.
    </p>
    <p>
      <span class="font-semibold text-ink">210 → facture.</span> Une facture transporteur brouillon
      est créée pour <code class="font-mono">carrierId</code>, une ligne par boucle LX ; aucune
      variance n'est calculée ici (elle se fait ensuite contre le coût figé du load). Pas de 990
      pour un 210.
    </p>
    <p>
      <span class="font-semibold text-ink">214 sortant.</span>
      <code class="font-mono">GET .../shipments/:id/edi/214?integrationKey=…</code> renvoie
      l'interchange en texte brut ; <code class="font-mono">.../214/send</code> le met dans l'outbox
      webhook existante (nécessite <code class="font-mono">config.url</code>).
    </p>
    <p>
      <span class="font-semibold text-ink">Limites v1.</span> Un seul GS/ST par interchange émis, aucun
      fuseau horaire (dates rendues telles quelles), pas de 997/AS2/VAN, numéros de contrôle sortants
      dérivés de l'horloge.
    </p>
  </div>
</Card>

<!-- Create / edit partner modal -->
<Modal
  bind:open={formOpen}
  title={editingId ? 'Modifier le partenaire EDI' : 'Nouveau partenaire EDI'}
  size="lg"
>
  <form class="space-y-4" onsubmit={submitForm}>
    <ErrorNotice message={saveError} />
    <Field label="Nom">
      <Input
        value={formName}
        required
        placeholder="Ex. Acme Shipper — EDI"
        oninput={(e) => updateFormName(e.currentTarget.value)}
      />
    </Field>
    <Field label="Clé technique">
      <Input
        bind:value={formKey}
        required
        disabled={!!editingId}
        placeholder="edi-acme-shipper"
        oninput={() => (keyTouched = true)}
      />
    </Field>
    <div class="grid grid-cols-2 gap-3">
      <Field label="ISA06 — notre id (isaSenderId)">
        <Input bind:value={formIsaSender} maxlength={15} placeholder="PULSARTMS" />
      </Field>
      <Field label="ISA08 — id du partenaire (isaReceiverId)">
        <Input bind:value={formIsaReceiver} maxlength={15} placeholder="ACMESHIPPER" />
      </Field>
      <Field label="GS02 (gsSenderId, défaut = ISA06)">
        <Input bind:value={formGsSender} maxlength={15} placeholder="PULSARTMS" />
      </Field>
      <Field label="GS03 (gsReceiverId, défaut = ISA08)">
        <Input bind:value={formGsReceiver} maxlength={15} placeholder="ACMESHIPPER" />
      </Field>
    </div>
    <Field label="Client (obligatoire pour un 204)">
      <EntityPicker
        endpoint="/transportation/customers"
        label="Client"
        labelKey="name"
        detailKey="code"
        bind:value={formCustomerId}
      />
    </Field>
    <Field label="Transporteur (obligatoire pour un 210)">
      <EntityPicker
        endpoint="/transportation/carriers"
        label="Transporteur"
        labelKey="name"
        detailKey="code"
        bind:value={formCarrierId}
      />
    </Field>
    <Field label="URL de destination des 214 sortants (facultatif)">
      <Input bind:value={formUrl} placeholder="https://partenaire.example.com/edi/214" />
    </Field>
    <div class="flex justify-end gap-2 border-t border-edge-soft pt-3">
      <button
        type="button"
        class="rounded-md border border-edge px-3 py-1.5 text-xs font-semibold text-ink-muted hover:bg-surface-muted"
        onclick={() => (formOpen = false)}>Annuler</button
      >
      <button
        type="submit"
        disabled={saving || !canManagePartners}
        class="rounded-md bg-accent px-4 py-1.5 text-sm font-semibold text-white hover:bg-accent-strong disabled:opacity-50"
      >
        {saving ? 'Enregistrement…' : editingId ? 'Enregistrer' : 'Créer le partenaire'}
      </button>
    </div>
  </form>
</Modal>

<!-- Token modal — shown once, never persisted client-side -->
<Modal bind:open={tokenOpen} title="Jeton du récepteur EDI" size="md" dismissible={!issuingFor}>
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
            onclick={() => void copyToClipboard(tokenResult!.token, (v) => (tokenCopied = v))}
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
            onclick={() => void copyToClipboard(tokenResult!.url, (v) => (urlCopied = v))}
          >
            {urlCopied ? 'Copié' : 'Copier'}
          </button>
        </div>
      </Field>
      <p class="text-xs text-ink-muted">
        Signature HMAC : {tokenResult.signed ? 'activée' : 'désactivée'} · Statut :
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

<!-- Manual "envoyer un 204" modal -->
<Modal bind:open={sendOpen} title="Envoyer un 204" size="lg">
  {#if sendPartner}
    <form class="space-y-4" onsubmit={submitSend}>
      <p class="text-xs text-ink-muted">
        Envoyé comme si « {sendPartner.name} » (<code class="font-mono">{sendPartner.key}</code>)
        l'avait poussé — passe par le même service que la porte publique.
      </p>
      <ErrorNotice message={sendError} />
      <Field label="Interchange X12 (204)">
        <Textarea bind:value={sendContent} rows={10} />
      </Field>
      <div class="flex justify-end gap-2">
        <button
          type="button"
          class="rounded-md border border-edge px-3 py-1.5 text-xs font-semibold text-ink-muted hover:bg-surface-muted"
          onclick={() => (sendOpen = false)}>Fermer</button
        >
        <button
          type="submit"
          disabled={sending || !canSendEdi}
          class="rounded-md bg-accent px-4 py-1.5 text-sm font-semibold text-white hover:bg-accent-strong disabled:opacity-50"
        >
          {sending ? 'Envoi…' : 'Envoyer'}
        </button>
      </div>
    </form>

    {#if sendResult}
      <div class="mt-4 space-y-2 border-t border-edge-soft pt-4">
        <div class="flex items-center gap-2">
          <Badge tone={sendResult.status === 'IMPORTED' ? 'ok' : 'danger'}
            >{sendResult.status === 'IMPORTED' ? 'Importé' : 'Échec'}</Badge
          >
          {#if sendResult.replayed}<Badge tone="neutral">Rejeu (déjà traité)</Badge>{/if}
          <p class="text-xs text-ink-muted">{sendResult.summary}</p>
        </div>
        {#if sendResult.entityType && sendResult.entityId}
          <p class="text-xs text-ink-muted">
            {sendResult.entityType} créé : <code class="font-mono">{sendResult.entityId}</code>
          </p>
        {/if}
        {#if sendResult.ack}
          <div>
            <p class="text-xs font-semibold text-ink-muted">Réponse 990</p>
            <pre
              class="mt-1 max-h-48 overflow-auto rounded-xl border border-edge bg-surface-muted p-3 text-[11px] whitespace-pre-wrap text-ink">{sendResult.ack}</pre>
          </div>
        {/if}
      </div>
    {/if}
  {/if}
</Modal>
