<script lang="ts">
  import { page } from '$app/state';
  import { PERMISSIONS } from '@pulsar/shared';
  import { api, ApiError } from '$lib/api/client';
  import { auth } from '$lib/stores/auth';
  import { toast } from '$lib/stores/toast';
  import { confirmAction } from '$lib/stores/confirmation';
  import { formatMoney, formatDate } from '$lib/format';
  import { freightStatus, freightReasons, type FreightInvoice } from '$lib/billing/freight-audit';
  import {
    RecordHeader,
    RecordNav,
    RecordSection,
    Button,
    Card,
    Table,
    Badge,
    Skeleton,
    Select,
    Textarea,
    Field,
    Drawer,
    ErrorNotice,
  } from '$lib/components/ui';

  const invoiceId = $derived(page.params.id as string);
  const canManage = $derived(
    $auth?.user.permissions.includes(PERMISSIONS.BILLING.FREIGHT_AUDIT_MANAGE),
  );
  const canReadLoads = $derived(
    $auth?.tenant.enabledModules.includes('transportation') &&
      $auth?.user.permissions.includes(PERMISSIONS.TRANSPORTATION.PLANNING_READ),
  );
  let invoice = $state<FreightInvoice | null>(null);
  let loading = $state(true);
  let error = $state('');
  let actionError = $state('');
  let busy = $state(false);
  let panelOpen = $state(false);
  let panelMode = $state<'dispute' | 'resolve'>('dispute');
  let reasonCode = $state('RATE_MISMATCH');
  let note = $state('');
  let resolution = $state('ACCEPT_CHARGED');
  let generation = 0;

  async function load() {
    const id = invoiceId,
      request = ++generation;
    loading = true;
    error = '';
    try {
      const result = await api<FreightInvoice>(
        `/freight-audit/incoming-invoices/${encodeURIComponent(id)}`,
      );
      if (request === generation && id === invoiceId) invoice = result;
    } catch (e) {
      if (request === generation)
        error = e instanceof ApiError ? e.message : 'Échec du chargement du dossier';
    } finally {
      if (request === generation) loading = false;
    }
  }
  $effect(() => {
    void invoiceId;
    invoice = null;
    panelOpen = false;
    actionError = '';
    void load();
  });

  function openPanel(mode: 'dispute' | 'resolve') {
    panelMode = mode;
    reasonCode = invoice?.disputeReasonCode || 'RATE_MISMATCH';
    note = '';
    resolution = 'ACCEPT_CHARGED';
    actionError = '';
    panelOpen = true;
  }
  function closePanel() {
    if (busy) return false;
    if (
      !note &&
      resolution === 'ACCEPT_CHARGED' &&
      reasonCode === (invoice?.disputeReasonCode || 'RATE_MISMATCH')
    )
      return true;
    void confirmAction('Les modifications de ce formulaire seront perdues.', {
      title: 'Fermer sans enregistrer ?',
      confirmLabel: 'Abandonner',
    }).then((accepted) => {
      if (accepted) panelOpen = false;
    });
    return false;
  }
  async function act(verb: 'audit' | 'pay' | 'dispute' | 'resolve') {
    if (busy || !canManage || !invoice) return;
    const id = invoice.id;
    busy = true;
    actionError = '';
    try {
      if (
        verb === 'pay' &&
        !(await confirmAction(
          'Cette action met uniquement à jour le suivi d’audit. Elle ne crée aucun paiement, aucune écriture comptable et aucun transfert bancaire.',
          {
            title: 'Marquer cette facture réglée ?',
            confirmLabel: 'Marquer réglée',
            dangerous: false,
          },
        ))
      )
        return;
      if (
        verb === 'resolve' &&
        !(await confirmAction(
          resolution === 'KEEP_EXPECTED'
            ? 'Conserver le montant attendu et enregistrer l’écart positif comme économie suivie ? Aucun avoir ni paiement ne sera créé.'
            : 'Accepter le montant facturé et clore le litige sans économie récupérée ?',
          {
            title: 'Confirmer la résolution',
            confirmLabel: 'Résoudre le litige',
            dangerous: false,
          },
        ))
      )
        return;
      if (id !== invoiceId) return;
      const body =
        verb === 'dispute' || verb === 'resolve'
          ? {
              reasonCode,
              note: note.trim() || undefined,
              ...(verb === 'resolve' ? { resolution } : {}),
            }
          : {};
      const result = await api<FreightInvoice>(
        `/freight-audit/incoming-invoices/${encodeURIComponent(id)}/${verb}`,
        { method: 'POST', body },
      );
      if (id !== invoiceId) return;
      invoice = result;
      panelOpen = false;
      toast.success(verb === 'audit' ? 'Rapprochement terminé' : 'Suivi du dossier mis à jour');
    } catch (e) {
      if (id === invoiceId)
        actionError = e instanceof ApiError ? e.message : 'Action non enregistrée. Réessayez.';
    } finally {
      busy = false;
    }
  }
  const sections = [
    { id: 'synthese', label: 'Synthèse' },
    { id: 'rapprochement', label: 'Rapprochement' },
    { id: 'suivi', label: 'Suivi et règlement' },
  ];
</script>

<svelte:head
  ><title>{invoice?.carrierInvoiceNumber ?? 'Audit transporteur'} · Pulsar</title></svelte:head
>
<RecordHeader
  title={invoice?.carrierInvoiceNumber ?? 'Dossier d’audit'}
  kind="Audit transporteur"
  backHref="/billing/freight-audit"
  backLabel="Audit transporteur"
>
  {#snippet meta()}
    {#if invoice}<span>{invoice.carrier.name}</span><Badge
        tone={freightStatus[invoice.status]?.tone ?? 'neutral'}
        >{freightStatus[invoice.status]?.label ?? invoice.status}</Badge
      >{/if}
  {/snippet}
  {#snippet actions()}
    {#if invoice && canManage && !loading && !error}
      {#if ['RECEIVED', 'FLAGGED'].includes(invoice.status)}
        <Button loading={busy} disabled={busy} onclick={() => act('audit')}
          >Rapprocher les lignes</Button
        >
      {/if}
      {#if invoice.status === 'FLAGGED'}<Button
          variant="secondary"
          disabled={busy}
          onclick={() => openPanel('dispute')}>Ouvrir un litige</Button
        >{/if}
      {#if invoice.status === 'DISPUTED'}<Button
          disabled={busy}
          onclick={() => openPanel('resolve')}>Résoudre le litige</Button
        >{/if}
      {#if ['MATCHED', 'RESOLVED'].includes(invoice.status)}<Button
          variant="secondary"
          disabled={busy}
          onclick={() => act('pay')}>Marquer réglée</Button
        >{/if}
    {/if}
  {/snippet}
</RecordHeader>
{#if loading}
  <Card><Skeleton rows={6} /></Card>
{:else if error}
  <ErrorNotice message={error} onretry={load} />
{:else if invoice}
  {@const inv = invoice}
  <RecordNav {sections} />
  {#if !panelOpen}<ErrorNotice message={actionError} />{/if}
  <div class="space-y-8">
    <RecordSection id="synthese" label="Synthèse">
      <Card>
        <h2 class="mb-4 text-base font-semibold">Comparaison des montants</h2>
        <dl class="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {#each [{ label: 'Facturé', amount: invoice.chargedTotal }, { label: 'Attendu · coûts figés', amount: invoice.matchedTotal }, { label: 'Écart net', amount: invoice.varianceTotal }, { label: 'Économie suivie', amount: invoice.recoveredAmount }] as metric}
            <div>
              <dt class="text-xs text-ink-muted">{metric.label}</dt>
              <dd class="mt-1 font-semibold tabular-nums">
                {metric.amount === null
                  ? 'Non calculé'
                  : formatMoney(metric.amount, invoice.currency)}
              </dd>
            </div>
          {/each}
        </dl>
        <p class="mt-5 text-sm text-ink-muted">
          Le rapprochement compare chaque référence au coût figé du chargement. Il ne recalcule pas
          les tarifs.
        </p>
      </Card>
    </RecordSection>
    <RecordSection id="rapprochement" label="Rapprochement">
      <div>
        <h2 class="text-base font-semibold">Lignes et chargements</h2>
        <p class="mt-1 text-sm text-ink-muted">
          {inv.lines.filter((l) => l.matchedLoadId).length} / {inv.lines.length} lignes rapprochées ·
          Écart brut : {inv.varianceGross === null
            ? 'non calculé'
            : formatMoney(inv.varianceGross, inv.currency)}
        </p>
      </div>
      <Table>
        {#snippet head()}<th>Chargement / référence</th><th>Description</th><th class="text-right"
            >Facturé</th
          ><th class="text-right">Attendu</th><th class="text-right">Écart</th>{/snippet}
        {#snippet body()}
          {#each inv.lines as line (line.id)}
            <tr>
              <td
                >{#if line.matchedLoadId && canReadLoads}<a
                    class="font-medium text-accent hover:underline"
                    href={`/loads/${encodeURIComponent(line.matchedLoadId)}`}>{line.lineRef}</a
                  >{:else}<span class="font-medium">{line.lineRef}</span>{/if}
                <div class="mt-1 text-xs text-ink-muted">
                  {line.matchedLoadId
                    ? 'Coût figé trouvé'
                    : inv.status === 'RECEIVED'
                      ? 'À rapprocher'
                      : 'Non rapproché · vérifier la référence et le coût'}
                </div></td
              >
              <td>{line.description || '—'}</td>
              <td class="text-right tabular-nums"
                >{formatMoney(line.chargedAmount, inv.currency)}</td
              >
              <td class="text-right tabular-nums"
                >{line.expectedAmount === null
                  ? '—'
                  : formatMoney(line.expectedAmount, inv.currency)}</td
              >
              <td class="text-right tabular-nums"
                >{line.variance === null ? '—' : formatMoney(line.variance, inv.currency)}</td
              >
            </tr>
          {:else}<tr><td colspan={5}>Aucune ligne dans ce dossier.</td></tr>{/each}
        {/snippet}
      </Table>
    </RecordSection>
    <RecordSection id="suivi" label="Suivi et règlement">
      <Card>
        <h2 class="text-base font-semibold">Suivi du dossier</h2>
        <dl class="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <dt class="text-xs text-ink-muted">Reçue le</dt>
            <dd>{invoice.receivedAt ? formatDate(invoice.receivedAt) : '—'}</dd>
          </div>
          <div>
            <dt class="text-xs text-ink-muted">Résolution</dt>
            <dd>
              {invoice.resolution === 'KEEP_EXPECTED'
                ? 'Montant attendu conservé'
                : invoice.resolution === 'ACCEPT_CHARGED'
                  ? 'Montant facturé accepté'
                  : 'Aucune résolution'}
            </dd>
          </div>
          {#if invoice.disputeReasonCode}<div>
              <dt class="text-xs text-ink-muted">Motif</dt>
              <dd>{freightReasons[invoice.disputeReasonCode] ?? invoice.disputeReasonCode}</dd>
            </div>{/if}
          {#if invoice.disputeNote}<div>
              <dt class="text-xs text-ink-muted">Note</dt>
              <dd class="whitespace-pre-wrap break-words">{invoice.disputeNote}</dd>
            </div>{/if}
          {#if invoice.resolvedAt}<div>
              <dt class="text-xs text-ink-muted">Résolue le</dt>
              <dd>{formatDate(invoice.resolvedAt)}</dd>
            </div>{/if}
          {#if invoice.paidAt}<div>
              <dt class="text-xs text-ink-muted">Marquée réglée le</dt>
              <dd>{formatDate(invoice.paidAt)}</dd>
            </div>{/if}
        </dl>
        <div class="mt-5 border-t border-edge pt-4 text-sm text-ink-muted">
          Ce dossier est un suivi d’audit, distinct des factures et paiements comptables. Le statut
          « réglée » ne crée ni paiement ni écriture au grand livre. Aucun lien comptable
          automatique n’est encore établi.
        </div>
      </Card>
    </RecordSection>
  </div>
{/if}

<Drawer
  bind:open={panelOpen}
  title={panelMode === 'dispute' ? 'Ouvrir un litige' : 'Résoudre le litige'}
  width="md"
  dismissible={!busy}
  onbeforeclose={closePanel}
>
  <form
    id="freight-decision"
    class="space-y-4"
    onsubmit={(event) => {
      event.preventDefault();
      void act(panelMode);
    }}
  >
    <p class="text-sm text-ink-muted">{invoice?.carrierInvoiceNumber} · {invoice?.carrier.name}</p>
    <ErrorNotice message={actionError} />
    <fieldset disabled={busy} class="min-w-0 space-y-4">
      {#if panelMode === 'resolve'}
        <Field label="Décision"
          ><Select bind:value={resolution}
            ><option value="ACCEPT_CHARGED">Accepter le montant facturé</option><option
              value="KEEP_EXPECTED">Conserver le montant attendu</option
            ></Select
          ></Field
        >
      {/if}
      <Field label="Motif"
        ><Select bind:value={reasonCode}
          >{#each Object.entries(freightReasons) as [code, label]}<option value={code}
              >{label}</option
            >{/each}</Select
        ></Field
      >
      <Field label="Note"
        ><Textarea
          bind:value={note}
          placeholder="Contexte et justification de la décision"
        /></Field
      >
    </fieldset>
  </form>
  {#snippet footer()}
    <Button
      variant="secondary"
      disabled={busy}
      onclick={() => {
        if (closePanel()) panelOpen = false;
      }}>Fermer</Button
    >
    <Button disabled={busy} loading={busy} onclick={() => act(panelMode)}
      >{panelMode === 'dispute' ? 'Enregistrer le litige' : 'Confirmer la résolution'}</Button
    >
  {/snippet}
</Drawer>
