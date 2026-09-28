<script lang="ts">
  import { formatDateTime as fmtUserInstant } from '$lib/format';
  import { api } from '$lib/api/client';
  import { auth, getAccessToken } from '$lib/stores/auth';
  import { Button, Field, Input, Textarea, ErrorNotice, Badge } from '$lib/components/ui';
  type Identities = {
    issuerName: string;
    issuerAddress: string;
    issuerTaxIds: string;
    recipientName: string;
    recipientAddress: string;
  };
  type Delivery = {
    id: string;
    toAddresses: string[];
    status: string;
    deliveryChannel: string;
    deliveryUncertain: boolean;
    sentAt: string | null;
    createdAt: string;
  };
  type Context = {
    snapshot: {
      identities: Identities;
      documentDate: string;
      recipientProvenance?: {
        kind: 'MANUAL' | 'INVOICE';
        coordinatesHash?: string;
        frozenAt?: string;
        addressVersion?: number;
        reason?: string;
      };
    } | null;
    publishedAt: string | null;
    ready: boolean;
    hash: string | null;
    defaults: Identities;
    suggestedEmail: string;
    invoiceCoordinates: {
      recipientName: string;
      recipientAddress: string;
      frozenAt: string;
      addressVersion: number;
      coordinatesHash: string;
    } | null;
    capturedContactEmail: string;
    channel: 'log' | 'smtp';
    deliveries: Delivery[];
    legacySendBlocked?: boolean;
    automaticSettingsIgnored?: boolean;
  };
  let {
    invoiceId,
    noteId,
    number,
    kind = 'credit',
    busy = $bindable(false),
  }: {
    invoiceId: string;
    noteId?: string;
    number: string;
    busy?: boolean;
    kind?: 'credit' | 'invoice';
  } = $props();
  const isInvoice = $derived(kind === 'invoice');
  const path = $derived(
    `/billing/customer-invoices/${invoiceId}${isInvoice ? '' : `/credits/${noteId}`}/document`,
  );
  const canPublish = $derived(
    $auth?.user.permissions.includes(
      isInvoice ? 'billing.customer-invoices.manage' : 'billing.credit-notes.approve',
    ),
  );
  const canSend = $derived(
    $auth?.user.permissions.includes(
      isInvoice ? 'billing.customer-invoices.send' : 'billing.credit-notes.send',
    ),
  );
  let data = $state<Context | null>(null),
    error = $state(''),
    loading = $state(false),
    confirmed = $state(false),
    sendConfirmed = $state(false),
    to = $state('');
  let fields = $state<Identities>({
    issuerName: '',
    issuerAddress: '',
    issuerTaxIds: '',
    recipientName: '',
    recipientAddress: '',
  });
  let recipientSource = $state<'MANUAL' | 'INVOICE'>('MANUAL'),
    coordinatesHash = $state(''),
    recipientReason = $state('');
  const currentDelivery = $derived(
    data?.deliveries.find((d) => d.deliveryChannel === data?.channel),
  );
  async function load() {
    loading = true;
    error = '';
    try {
      data = await api<Context>(path);
      fields = { ...data.defaults };
      recipientSource = data.snapshot?.recipientProvenance?.kind ?? 'MANUAL';
      coordinatesHash = data.snapshot?.recipientProvenance?.coordinatesHash ?? '';
      recipientReason = data.snapshot?.recipientProvenance?.reason ?? '';
      confirmed = false;
      if (!to) to = data.suggestedEmail;
      sendConfirmed = false;
    } catch (e) {
      error = (e as Error).message;
    } finally {
      loading = false;
    }
  }
  function chooseInvoiceCoordinates() {
    if (!data?.invoiceCoordinates || busy) return;
    recipientSource = 'INVOICE';
    coordinatesHash = data.invoiceCoordinates.coordinatesHash;
    fields.recipientName = data.invoiceCoordinates.recipientName;
    fields.recipientAddress = data.invoiceCoordinates.recipientAddress;
    recipientReason = '';
    confirmed = false;
  }
  async function publish() {
    if (busy || !confirmed) return;
    busy = true;
    error = '';
    try {
      data = await api<Context>(path, {
        method: 'POST',
        body: {
          issuerName: fields.issuerName,
          issuerAddress: fields.issuerAddress,
          issuerTaxIds: fields.issuerTaxIds,
          recipientSource,
          ...(recipientSource === 'INVOICE'
            ? { expectedCoordinatesHash: coordinatesHash }
            : {
                recipientName: fields.recipientName,
                recipientAddress: fields.recipientAddress,
                ...(recipientReason.trim() ? { recipientReason: recipientReason.trim() } : {}),
              }),
          confirmed: true,
        },
      });
      confirmed = false;
    } catch (e) {
      error = `${(e as Error).message} Actualisez pour vérifier si les coordonnées ont déjà été figées. Reprendre la même publication ne crée pas un second document.`;
    } finally {
      busy = false;
    }
  }
  async function download() {
    busy = true;
    error = '';
    try {
      const response = await fetch(`/api/v1${path}/pdf`, {
        headers: { Authorization: `Bearer ${getAccessToken()}` },
      });
      if (!response.ok)
        throw new Error(
          'Téléchargement impossible. Actualisez la session ou vérifiez le document.',
        );
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = url;
      link.download = `${isInvoice ? 'facture' : 'avoir'}-${number}.pdf`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (e) {
      error = (e as Error).message;
    } finally {
      busy = false;
    }
  }
  async function send() {
    if (busy || !data?.hash || !sendConfirmed || currentDelivery || data.legacySendBlocked) return;
    busy = true;
    error = '';
    try {
      data = await api<Context>(`${path}/send`, {
        method: 'POST',
        body: {
          to: to.trim(),
          expectedHash: data.hash,
          expectedChannel: data.channel,
          confirmed: true,
        },
      });
      sendConfirmed = false;
    } catch (e) {
      error = `${(e as Error).message} Actualisez l’historique avant toute reprise. Un envoi existant ne sera pas répété.`;
    } finally {
      busy = false;
    }
  }
  const statusLabel = (d: Delivery) =>
    !d.deliveryChannel
      ? 'Historique ancien · mode et document non qualifiés, vérification opérateur requise'
      : d.status === 'SENT'
        ? d.deliveryChannel === 'log'
          ? 'Simulation locale terminée · aucun courriel envoyé'
          : 'Accepté par le serveur courriel · réception non confirmée'
        : d.deliveryUncertain || d.status === 'SENDING'
          ? 'Remise en cours ou résultat incertain · ne pas renvoyer'
          : d.status === 'FAILED'
            ? 'Échec avant remise · intervention requise'
            : 'En attente de remise';
</script>

<details
  class="rounded-md border border-edge p-3"
  ontoggle={(e) => {
    if (e.currentTarget.open && !data && !loading) void load();
  }}
>
  <summary class="cursor-pointer text-sm font-medium"
    >{isInvoice ? 'Document et envoi de la facture' : 'Document et envoi client'}</summary
  >
  <div class="mt-4 space-y-4">
    {#if isInvoice}<p class="text-sm text-ink-muted">
        Publier n’envoie rien. La remise est suivie ci-dessous, séparément du statut comptable de la
        facture et des paiements.
      </p>{/if}
    <ErrorNotice message={error} />
    <Button variant="ghost" disabled={busy || loading} onclick={load}
      >Actualiser le document et l’envoi</Button
    >
    {#if loading}<p class="text-sm text-ink-muted" role="status">
        Chargement du document…
      </p>{:else if data}
      {#if data.snapshot}
        <Badge tone={data.ready ? 'ok' : 'neutral'}
          >{data.ready ? 'PDF figé' : 'Coordonnées figées · PDF à reprendre'}</Badge
        >
        <dl class="grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt class="text-xs text-ink-muted">Émetteur</dt>
            <dd class="whitespace-pre-wrap break-words">
              {data.snapshot.identities.issuerName}<br />{data.snapshot.identities.issuerAddress}<br
              />{data.snapshot.identities.issuerTaxIds}
            </dd>
          </div>
          <div>
            <dt class="text-xs text-ink-muted">Client</dt>
            <dd class="whitespace-pre-wrap break-words">
              {data.snapshot.identities.recipientName}<br />{data.snapshot.identities
                .recipientAddress}
            </dd>
          </div>
        </dl>
        <p class="text-xs text-ink-muted">
          Document daté du {data.snapshot.documentDate.slice(0, 10)} (UTC). Les changements de coordonnées
          dans le catalogue ne modifient plus ce PDF.
        </p>
        <p class="text-sm text-ink-muted" aria-label="Provenance du destinataire">
          {#if data.snapshot.recipientProvenance?.kind === 'INVOICE'}
            Source : coordonnées de facturation figées sur la facture d’origine, adresse v{data
              .snapshot.recipientProvenance.addressVersion},
            {fmtUserInstant(data.snapshot.recipientProvenance.frozenAt!)}.
          {:else if data.snapshot.recipientProvenance?.kind === 'MANUAL'}
            Source : saisie manuelle confirmée à la publication.
            {data.snapshot.recipientProvenance.reason ?? ''}
          {:else}Source non enregistrée pour cette publication historique.{/if}
        </p>
      {/if}
      {#if !data.ready && canPublish}
        <form
          class="space-y-3"
          onsubmit={(e) => {
            e.preventDefault();
            void publish();
          }}
        >
          <p class="rounded-md bg-surface-muted p-3 text-sm">
            Vérifiez les identités légales et les inscriptions fiscales avant de figer le document.
            Vous pouvez reprendre la copie de la facture ou confirmer une saisie manuelle. La fiche
            client actuelle n’est pas une preuve historique. Cette opération ne rembourse pas le
            client et n’envoie rien.
          </p>
          <fieldset
            disabled={busy || !!data.snapshot}
            class="min-w-0 space-y-3"
            oninput={() => {
              confirmed = false;
            }}
          >
            <Field label="Nom légal de l’émetteur"
              ><Input required maxlength={180} bind:value={fields.issuerName} /></Field
            >
            <Field label="Adresse de l’émetteur"
              ><Textarea required maxlength={600} bind:value={fields.issuerAddress} /></Field
            >
            <Field label="Inscriptions fiscales (libellés et numéros)"
              ><Textarea maxlength={600} bind:value={fields.issuerTaxIds} /></Field
            >
            <p class="text-xs text-ink-muted">
              Obligatoire si le document comporte des taxes. Indiquez chaque inscription applicable,
              par exemple TPS et TVQ. Préremplissage configurable dans les réglages Facturation.
            </p>
            {#if !data.snapshot}
              <section
                class="min-w-0 space-y-2 rounded-md bg-surface-muted p-3 text-sm"
                aria-label="Source du destinataire"
              >
                <h3 class="font-medium">Coordonnées du client sur le PDF</h3>
                {#if data.invoiceCoordinates}
                  <p class="whitespace-pre-wrap break-words">
                    {data.invoiceCoordinates.recipientName}<br />{data.invoiceCoordinates
                      .recipientAddress}
                  </p>
                  <p class="text-xs text-ink-muted">
                    Adresse v{data.invoiceCoordinates.addressVersion}, copie figée le {fmtUserInstant(
                      data.invoiceCoordinates.frozenAt,
                    )}. Les changements ultérieurs du carnet ne remplacent pas cette copie.
                  </p>
                  <div class="flex flex-wrap gap-2">
                    <Button
                      variant={recipientSource === 'INVOICE' ? 'primary' : 'secondary'}
                      onclick={chooseInvoiceCoordinates}>Reprendre la copie de la facture</Button
                    >
                    {#if recipientSource === 'INVOICE'}<Button
                        variant="ghost"
                        onclick={() => {
                          recipientSource = 'MANUAL';
                          confirmed = false;
                        }}>Utiliser une saisie manuelle</Button
                      >{/if}
                  </div>
                  {#if recipientSource === 'INVOICE'}<p>
                      Copie sélectionnée : le serveur utilisera exactement cette identité et cette
                      adresse.
                    </p>
                  {:else}<p class="text-xs text-ink-muted">
                      Saisie manuelle : justifiez ce choix avant publication.
                    </p>{/if}
                {:else}<p>
                    Aucune adresse de facturation figée utilisable sur cette facture. Confirmez les
                    coordonnées manuellement; elles seront datées à la publication, sans
                    reconstruire le passé.
                  </p>{/if}
              </section>
            {/if}
            <Field label="Nom légal du client"
              ><Input
                required
                maxlength={recipientSource === 'INVOICE' ? undefined : 180}
                readonly={recipientSource === 'INVOICE'}
                bind:value={fields.recipientName}
              /></Field
            >
            <Field label="Adresse du client"
              ><Textarea
                maxlength={recipientSource === 'INVOICE' ? undefined : 600}
                readonly={recipientSource === 'INVOICE'}
                bind:value={fields.recipientAddress}
              /></Field
            >
            {#if recipientSource === 'MANUAL' && (data.invoiceCoordinates || recipientReason)}
              <Field label="Motif de la saisie manuelle"
                ><Textarea
                  required
                  minlength={3}
                  maxlength={500}
                  bind:value={recipientReason}
                /></Field
              >
            {/if}
          </fieldset>
          <label class="flex items-start gap-2 text-sm"
            ><input type="checkbox" bind:checked={confirmed} disabled={busy} class="mt-1" />Je
            confirme les coordonnées et les mentions fiscales; elles seront définitives.</label
          >
          <Button type="submit" disabled={busy || !confirmed} loading={busy}
            >{data.snapshot ? 'Reprendre la génération du PDF' : 'Figer et générer le PDF'}</Button
          >
        </form>
      {:else if !data.ready}<p class="text-sm text-ink-muted">
          Une personne autorisée à gérer ce document doit préparer le PDF.
        </p>{/if}
      {#if data.ready}
        <Button variant="secondary" disabled={busy} onclick={download}
          >{isInvoice ? 'Télécharger le PDF de facture' : 'Télécharger le PDF d’avoir'}</Button
        >
        {#if data.legacySendBlocked}<p
            class="rounded-md bg-surface-muted p-3 text-sm"
            role="status"
          >
            Envoi historique détecté. Vérifiez le journal et le fournisseur avant toute
            intervention; le renvoi est bloqué pour éviter un doublon.
          </p>{/if}
        {#if data.automaticSettingsIgnored}<p class="text-xs text-ink-muted">
            Les anciennes options d’envoi automatique sont sans effet sur les factures clients. Une
            confirmation explicite reste requise.
          </p>{/if}
        {#if canSend && !currentDelivery && !data.legacySendBlocked}
          <form
            class="space-y-3 border-t border-edge pt-3"
            onsubmit={(e) => {
              e.preventDefault();
              void send();
            }}
          >
            <p class="text-sm text-ink-muted">
              {data.channel === 'log'
                ? 'Mode simulation : le PDF et la demande seront vérifiés, mais aucun courriel ne partira. Un envoi réel restera possible après configuration SMTP et nouvelle confirmation.'
                : 'Mode SMTP : le PDF figé sera joint au courriel. Vérifiez-le avant de confirmer. Un seul envoi réel est autorisé dans ce premier circuit.'}
            </p>
            {#if data.capturedContactEmail}
              <div class="min-w-0 space-y-2 rounded-md bg-surface-muted p-3 text-sm">
                <p class="break-words">
                  Contact de la copie facture : {data.capturedContactEmail}. Vérifiez qu’il est
                  toujours le bon destinataire; le PDF ne contient pas ce courriel.
                </p>
                <Button
                  variant="secondary"
                  disabled={busy}
                  onclick={() => {
                    to = data!.capturedContactEmail;
                    sendConfirmed = false;
                  }}>Reprendre le courriel du contact figé</Button
                >
              </div>
            {/if}
            <Field label="Courriel du destinataire"
              ><Input
                type="email"
                required
                maxlength={254}
                bind:value={to}
                oninput={() => {
                  sendConfirmed = false;
                }}
                disabled={busy}
              /></Field
            >
            <label class="flex items-start gap-2 text-sm"
              ><input
                type="checkbox"
                bind:checked={sendConfirmed}
                disabled={busy}
                class="mt-1"
              />{data.channel === 'log'
                ? 'Je confirme la simulation, sans envoi externe.'
                : `J’ai vérifié le PDF et je confirme l’envoi à ${to || 'ce destinataire'}.`}</label
            >
            <Button type="submit" disabled={busy || !sendConfirmed}
              >{data.channel === 'log'
                ? isInvoice
                  ? 'Simuler l’envoi de la facture'
                  : 'Simuler l’envoi de l’avoir'
                : isInvoice
                  ? 'Envoyer le PDF de facture'
                  : 'Envoyer le PDF d’avoir'}</Button
            >
          </form>
        {/if}
      {/if}
      {#each data.deliveries as delivery (delivery.id)}
        <div class="space-y-1 rounded-md bg-surface-muted p-3 text-sm" role="status">
          <p class="font-medium">{statusLabel(delivery)}</p>
          <p class="break-all text-ink-muted">
            {delivery.toAddresses.join(', ')} · {fmtUserInstant(delivery.createdAt)}
          </p>
          {#if delivery.status === 'FAILED' || delivery.status === 'SENDING'}<p class="text-xs">
              Aucune relance automatique. Vérifiez le journal courriel et le fournisseur avant toute
              intervention; ne recréez pas le document.
            </p>{/if}
        </div>
      {/each}
    {/if}
  </div>
</details>
