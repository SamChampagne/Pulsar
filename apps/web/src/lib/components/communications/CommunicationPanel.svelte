<script lang="ts">
  import { onMount } from 'svelte';
  import {
    CommunicationChannel,
    communicationHtml,
    normalizeCommunicationRecipient,
    renderCommunicationTemplate,
    PERMISSIONS,
    SMS_STATUS_LABELS,
    SMS_DELIVERY_LABELS,
    type SmsStatus,
    type SmsDeliveryStatus,
  } from '@pulsar/shared';
  import { api, ApiError } from '$lib/api/client';
  import { auth } from '$lib/stores/auth';
  import { confirmAction } from '$lib/stores/confirmation';
  import { formatDateTime } from '$lib/format';
  import { Button, Field, Input, Textarea, ErrorNotice, Skeleton, Badge } from '$lib/components/ui';
  import EmailPreview from '$lib/components/email/EmailPreview.svelte';
  import CommunicationTemplates from './CommunicationTemplates.svelte';
  type Message = {
    id: string;
    recipient: string;
    subject: string | null;
    text: string;
    live: boolean;
    emailStatus: string | null;
    createdAt: string;
    smsMessage: { status: SmsStatus; deliveryStatus: SmsDeliveryStatus } | null;
  };
  type Context = {
    title: string;
    client: string;
    reviewToken: string;
    canManageSource: boolean;
    recipients: { label: string; value: string; channel: CommunicationChannel }[];
    connection: { ready: boolean; live: boolean; version: string | null; from: string | null };
    history: { items: Message[]; total: number; page: number; pageSize: number };
  };
  type Preference = {
    version: number;
    allowed: boolean | null;
    stopped: boolean;
    updatedAt: string | null;
  };
  type Template = {
    id: string;
    name: string;
    subject: string | null;
    text: string;
    active: boolean;
    updatedAt: string;
    channel: CommunicationChannel;
  };
  type Intent = {
    access: string;
    entityId: string;
    channel: CommunicationChannel;
    recipient: string;
    operationKey: string;
    reviewToken: string;
    configVersion: string | null;
    preferenceVersion: number;
    text: string;
    subject?: string;
    confirmed: true;
  };
  let {
    access,
    entityId,
    busy = $bindable(false),
  }: { access: string; entityId: string; busy?: boolean } = $props();
  const channels = $derived(
    Object.values(CommunicationChannel).filter((c) =>
      $auth?.user.permissions.includes(c === 'SMS' ? PERMISSIONS.SMS.READ : PERMISSIONS.EMAIL.READ),
    ),
  );
  let channel = $state<CommunicationChannel>(CommunicationChannel.EMAIL);
  let context = $state<Context | null>(null),
    templates = $state<Template[]>([]),
    preference = $state<Preference | null>(null);
  let tab = $state<'compose' | 'history' | 'templates'>('compose'),
    loading = $state(true),
    error = $state(''),
    success = $state('');
  let recipient = $state(''),
    subject = $state(''),
    text = $state(''),
    evidence = $state(''),
    preferenceOpen = $state(false),
    observedDate = $state('');
  let pending = $state<Intent | null>(null),
    storageFault = $state(false),
    page = $state(1),
    templateId = $state('');
  let generation = 0,
    preferenceGeneration = 0;
  const canSend = $derived(
    !!$auth?.user.permissions.includes(
      channel === 'SMS' ? PERMISSIONS.SMS.SEND : PERMISSIONS.EMAIL.SEND,
    ),
  );
  const manage = $derived(
    !!$auth?.user.permissions.includes(PERMISSIONS.CORE.COMMUNICATIONS_MANAGE),
  );
  const validRecipient = $derived(normalizeCommunicationRecipient(channel, recipient));
  const storageKey = $derived(
    `pulsar:dossier-message:${$auth?.tenant.id}:${$auth?.user.id}:${access}:${entityId}`,
  );
  const query = () => ({ access, entityId, channel, page });
  const emailLabels: Record<string, string> = {
    SENDING: 'Envoi engagé — ne pas renvoyer',
    SIMULATED: 'Simulation',
    ACCEPTED: 'Accepté par le serveur courriel',
    UNKNOWN: 'Résultat incertain — vérifier la boîte d’envoi',
  };
  function messageLabel(row: Message) {
    return row.smsMessage
      ? SMS_STATUS_LABELS[row.smsMessage.status]
      : emailLabels[row.emailStatus ?? 'SENDING'];
  }
  async function load() {
    const g = ++generation;
    loading = true;
    error = '';
    try {
      const [c, t] = await Promise.all([
        api<Context>('/communications/context', { query: query() }),
        api<Template[]>('/communications/templates', { query: { channel } }),
      ]);
      if (g !== generation) return;
      context = c;
      templates = t;
    } catch (e) {
      if (g === generation) {
        context = null;
        error = (e as Error).message;
      }
    } finally {
      if (g === generation) loading = false;
    }
  }
  async function loadPreference(value: string) {
    const g = ++preferenceGeneration;
    preference = null;
    try {
      const result = await api<Preference>('/communications/preference', {
        query: { ...query(), recipient: value },
      });
      if (
        g === preferenceGeneration &&
        value === normalizeCommunicationRecipient(channel, recipient)
      )
        preference = result;
    } catch (e) {
      if (g === preferenceGeneration) error = (e as Error).message;
    }
  }
  $effect(() => {
    const value = validRecipient;
    channel;
    preference = null;
    preferenceGeneration++;
    if (value) {
      const timer = setTimeout(() => void loadPreference(value), 200);
      return () => clearTimeout(timer);
    }
  });
  onMount(() => {
    channel = channels.includes(CommunicationChannel.EMAIL)
      ? CommunicationChannel.EMAIL
      : CommunicationChannel.SMS;
    try {
      const saved = sessionStorage.getItem(storageKey);
      if (saved) {
        const intent = JSON.parse(saved) as Intent;
        if (
          intent.access !== access ||
          intent.entityId !== entityId ||
          !channels.includes(intent.channel) ||
          typeof intent.operationKey !== 'string' ||
          typeof intent.text !== 'string'
        )
          throw new Error('Demande enregistrée invalide.');
        pending = intent;
        channel = intent.channel;
        recipient = intent.recipient;
        subject = intent.subject ?? '';
        text = intent.text;
      }
    } catch {
      storageFault = true;
    }
    void load();
    return () => {
      generation++;
      preferenceGeneration++;
    };
  });
  async function changeChannel(next: CommunicationChannel) {
    if (pending || busy) return;
    channel = next;
    recipient = '';
    text = '';
    subject = '';
    templateId = '';
    page = 1;
    preferenceOpen = false;
    await load();
  }
  function applyTemplate(id: string) {
    const t = templates.find((t) => t.id === id && t.active);
    if (!t || !context) return;
    const values = {
      dossier: context.title,
      client: context.client,
      destinataire: context.recipients.find((r) => r.value === validRecipient)?.label ?? '',
    };
    const body = renderCommunicationTemplate(t.text, values),
      title = renderCommunicationTemplate(t.subject ?? '', values);
    text = body.value;
    subject = title.value;
    if (body.missing.length || title.missing.length)
      error = 'Complétez les variables restantes dans le message avant l’envoi.';
  }
  async function savePreference(allowed: boolean) {
    if (!preference || !validRecipient || busy || !evidence.trim() || !observedDate) return;
    if (
      !(await confirmAction(
        `${allowed ? 'Autoriser' : 'Bloquer'} les messages opérationnels ${channel} vers ${validRecipient} dans cette entreprise ? Cette décision ne vaut pas consentement marketing.`,
        {
          title: 'Enregistrer la décision du contact',
          confirmLabel: 'Enregistrer',
          dangerous: !allowed,
        },
      ))
    )
      return;
    busy = true;
    error = '';
    try {
      preference = await api<Preference>('/communications/preference', {
        method: 'PUT',
        body: {
          ...query(),
          recipient: validRecipient,
          expectedVersion: preference.version,
          allowed,
          evidence,
          observedAt: new Date(`${observedDate}T00:00:00Z`).toISOString(),
          confirmed: true,
        },
      });
      preferenceOpen = false;
      evidence = '';
      success = 'Décision enregistrée avec sa preuve dans le journal d’audit.';
    } catch (e) {
      error = (e as Error).message;
      await loadPreference(validRecipient);
    } finally {
      busy = false;
    }
  }
  async function send() {
    if (busy || storageFault || !context || !canSend) return;
    if (!pending) {
      if (!validRecipient || preference?.allowed !== true || preference.stopped || !text.trim())
        return;
      if (
        !(await confirmAction(
          `${context.connection.live ? 'Envoi réel' : 'Simulation'} · ${channel} vers ${validRecipient}. Confirmez le destinataire, le contenu de l’aperçu et son autorisation opérationnelle.`,
          {
            title: 'Confirmer le message',
            confirmLabel: context.connection.live ? 'Envoyer' : 'Simuler',
            dangerous: context.connection.live,
          },
        ))
      )
        return;
      const intent: Intent = {
        access,
        entityId,
        channel,
        recipient: validRecipient,
        operationKey: crypto.randomUUID(),
        reviewToken: context.reviewToken,
        configVersion: context.connection.version,
        preferenceVersion: preference.version,
        text,
        ...(channel === 'EMAIL' ? { subject } : {}),
        confirmed: true,
      };
      try {
        sessionStorage.setItem(storageKey, JSON.stringify(intent));
        pending = intent;
      } catch {
        error =
          'Impossible de conserver la clé de reprise dans ce navigateur. Aucun message envoyé.';
        return;
      }
    }
    busy = true;
    error = '';
    success = '';
    try {
      const result = await api<Message>('/communications/messages', {
        method: 'POST',
        body: pending,
      });
      const status = result.smsMessage?.status ?? result.emailStatus;
      success = messageLabel(result);
      if (status !== 'SENDING' && status !== 'UNKNOWN') {
        sessionStorage.removeItem(storageKey);
        pending = null;
        text = '';
        subject = '';
        templateId = '';
      }
      await load();
      tab = 'history';
    } catch (e) {
      // Validation rejection means no send. Network/5xx/permission uncertainty retains EXACT intent.
      if (e instanceof ApiError && e.statusCode === 400) {
        sessionStorage.removeItem(storageKey);
        pending = null;
      }
      error = (e as Error).message;
    } finally {
      busy = false;
    }
  }
  async function releaseDraft() {
    if (
      busy ||
      !(await confirmAction(
        'Confirmez avoir vérifié le journal et, en cas de résultat incertain, le fournisseur. Ceci ne rappelle ni n’annule un message engagé. Le texte sera effacé; aucun renvoi ne sera effectué.',
        {
          title: 'Terminer la vérification manuelle',
          confirmLabel: 'Fermer cette demande',
          dangerous: true,
        },
      ))
    )
      return;
    try {
      sessionStorage.removeItem(storageKey);
      pending = null;
      storageFault = false;
      text = '';
      subject = '';
      error = '';
      await load();
    } catch {
      error = 'Impossible de libérer la demande locale.';
    }
  }
</script>

<div class="space-y-5" data-tour="dossier-communications">
  <div class="flex flex-wrap items-start justify-between gap-3">
    <div class="min-w-0">
      <p class="text-xs font-medium uppercase tracking-wide text-ink-muted">Dossier en cours</p>
      <h2 class="mt-1 break-words text-lg font-semibold">{context?.title ?? 'Chargement…'}</h2>
    </div>
    <div class="flex gap-1 rounded-lg border border-edge p-1" aria-label="Canal de communication">
      {#each channels as c}<Button
          variant={channel === c ? 'secondary' : 'ghost'}
          disabled={busy || !!pending}
          onclick={() => changeChannel(c)}>{c === 'SMS' ? 'SMS' : 'Courriel'}</Button
        >{/each}
    </div>
  </div>
  <div
    class="flex flex-wrap gap-2 border-b border-edge pb-3"
    aria-label="Sections des communications"
  >
    <Button
      variant={tab === 'compose' ? 'secondary' : 'ghost'}
      onclick={() => {
        tab = 'compose';
      }}>Composer</Button
    >
    <Button
      variant={tab === 'history' ? 'secondary' : 'ghost'}
      onclick={() => {
        tab = 'history';
      }}>Historique {context?.history.total ?? 0}</Button
    >
    <Button
      variant={tab === 'templates' ? 'secondary' : 'ghost'}
      onclick={() => {
        tab = 'templates';
      }}>Modèles</Button
    >
  </div>
  <ErrorNotice message={error} />
  {#if storageFault}<ErrorNotice
      message="La demande locale n’a pas pu être lue. Vérifiez l’historique et le fournisseur avant de fermer cette demande manuellement."
    />{/if}
  {#if success}<p role="status" class="rounded-lg border border-edge bg-surface-muted p-3 text-sm">
      {success}
    </p>{/if}
  {#if pending || storageFault}<section
      class="space-y-2 rounded-lg border border-warning/30 bg-warning/5 p-4"
    >
      <h3 class="font-medium">Demande conservée</h3>
      <p class="text-sm text-ink-muted">
        Une demande a déjà été engagée ou son résultat reste incertain. Vérifier reprend exactement
        la même clé, sans renvoyer un message déjà enregistré.
      </p>
      {#if pending}<Button disabled={busy} onclick={send}>Vérifier l’envoi</Button>{/if}
      <Button variant="ghost" disabled={busy} onclick={releaseDraft}
        >Terminer après vérification manuelle</Button
      >
    </section>{/if}
  {#if loading}<Skeleton rows={6} />
  {:else if context}
    {#if tab === 'compose'}
      <div
        class="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-surface-muted p-3 text-sm"
      >
        <span
          >{context.connection.live
            ? 'Envoi réel'
            : 'Simulation — aucun destinataire contacté'}{#if context.connection.from}<span
              class="ml-2 text-ink-muted">{context.connection.from}</span
            >{/if}</span
        ><a class="underline" href={channel === 'SMS' ? '/connect/sms' : '/emails/config'}
          >Configurer la connexion</a
        >
      </div>
      {#if !context.connection.ready}<p class="text-sm text-danger">
          Complétez et activez la connexion dans Pulsar avant l’envoi.
        </p>{/if}
      <div class="grid items-start gap-5 md:grid-cols-2">
        <fieldset disabled={busy || !!pending || storageFault} class="min-w-0 space-y-4">
          {#if context.recipients.length}<label class="block text-sm font-medium"
              >Coordonnées du dossier<select
                class="mt-1 w-full rounded-md border border-edge bg-surface p-2"
                value=""
                onchange={(e) => {
                  recipient = e.currentTarget.value;
                  preferenceOpen = false;
                }}
                ><option value="">Choisir explicitement un contact…</option
                >{#each context.recipients as r}<option value={r.value}
                    >{r.label} · {r.value}</option
                  >{/each}</select
              ></label
            >{/if}
          <Field label={channel === 'SMS' ? 'Numéro destinataire (E.164)' : 'Adresse destinataire'}
            ><Input
              bind:value={recipient}
              type={channel === 'SMS' ? 'tel' : 'email'}
              maxlength={254}
              placeholder={channel === 'SMS' ? '+15145550123' : 'contact@entreprise.ca'}
            /></Field
          >
          <section class="space-y-3 rounded-lg border border-edge p-3">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <p class="text-sm">
                {preference?.stopped
                  ? 'STOP reçu — envoi bloqué'
                  : preference?.allowed === true
                    ? 'Messages opérationnels autorisés'
                    : preference?.allowed === false
                      ? 'Messages opérationnels refusés'
                      : 'Autorisation non renseignée'}
              </p>
              {#if manage && context.canManageSource && preference}<Button
                  variant="ghost"
                  onclick={() => {
                    preferenceOpen = !preferenceOpen;
                  }}>Enregistrer la décision</Button
                >{/if}
            </div>
            <p class="text-xs text-ink-muted">
              Décision commune à cette entreprise et à cette coordonnée. Ne permet ni campagne
              marketing, ni levée automatique d’un STOP.
            </p>
            {#if preferenceOpen}<Field label="Preuve ou référence de la décision"
                ><Textarea
                  bind:value={evidence}
                  maxlength={500}
                  placeholder="Ex. demande du contact au téléphone, référence du courriel…"
                /></Field
              ><Field label="Date de la décision"
                ><Input type="date" bind:value={observedDate} /></Field
              >
              <div class="flex flex-wrap gap-2">
                <Button
                  disabled={!evidence.trim() || !observedDate || preference?.stopped}
                  onclick={() => savePreference(true)}>Autoriser</Button
                ><Button
                  variant="secondary"
                  disabled={!evidence.trim() || !observedDate}
                  onclick={() => savePreference(false)}>Bloquer</Button
                >
              </div>{/if}
          </section>
          <label class="block text-sm font-medium"
            >Modèle (facultatif)<select
              class="mt-1 w-full rounded-md border border-edge bg-surface p-2"
              bind:value={templateId}
              onchange={(e) => applyTemplate(e.currentTarget.value)}
              ><option value="">Message libre</option
              >{#each templates.filter((t) => t.active) as t}<option value={t.id}>{t.name}</option
                >{/each}</select
            ></label
          >
          {#if channel === 'EMAIL'}<Field label="Objet"
              ><Input bind:value={subject} maxlength={200} /></Field
            >{/if}
          <Field label="Message"
            ><Textarea
              bind:value={text}
              maxlength={channel === 'SMS' ? 1600 : 10000}
              rows={6}
            /></Field
          >
          <p class="text-xs text-ink-muted">
            {text.length} caractères. Aucune pièce jointe ni facture depuis ce panneau.
          </p>
        </fieldset>
        <div class="min-w-0 space-y-4 md:sticky md:top-0">
          {#if channel === 'EMAIL'}<EmailPreview
              html={communicationHtml(text)}
              {subject}
              to={recipient}
              from={context.connection.from ?? ''}
            />{:else}<section
              aria-label="Aperçu du SMS"
              class="rounded-xl border border-edge bg-surface-muted p-4"
            >
              <p class="mb-3 text-xs text-ink-muted">
                À : {recipient || 'Choisissez le destinataire'}
              </p>
              <p
                class="ml-auto max-w-sm whitespace-pre-wrap break-words rounded-xl bg-surface p-4 text-sm shadow-sm"
              >
                {text || 'Votre message apparaîtra ici.'}
              </p>
            </section>{/if}
          <Button
            loading={busy}
            disabled={!!pending ||
              storageFault ||
              !canSend ||
              !context.connection.ready ||
              !validRecipient ||
              preference?.allowed !== true ||
              preference.stopped ||
              !text.trim() ||
              (channel === 'EMAIL' && !subject.trim()) ||
              /\{\{|\}\}/.test(text + subject)}
            onclick={send}
            >{context.connection.live ? 'Vérifier et envoyer' : 'Vérifier et simuler'}</Button
          >
        </div>
      </div>
    {:else if tab === 'history'}
      <div class="flex items-center justify-between gap-3">
        <p class="text-sm text-ink-muted">
          Envois de ce dossier uniquement. Accepté ne signifie pas livré.
        </p>
        <Button variant="ghost" disabled={busy} onclick={load}>Actualiser</Button>
      </div>
      {#each context.history.items as row}<article
          class="space-y-2 rounded-lg border border-edge p-4"
        >
          <div class="flex flex-wrap justify-between gap-2">
            <p class="break-all text-sm font-medium">{row.recipient}</p>
            <Badge>{messageLabel(row)}</Badge>
          </div>
          <p class="text-xs text-ink-muted">{formatDateTime(row.createdAt)}</p>
          {#if row.smsMessage && row.live}<p class="text-xs text-ink-muted">
              {SMS_DELIVERY_LABELS[row.smsMessage.deliveryStatus]}
            </p>{/if}{#if row.subject}<h3 class="text-sm font-semibold">{row.subject}</h3>{/if}
          <p class="whitespace-pre-wrap break-words text-sm">{row.text}</p>
        </article>{:else}<div
          class="rounded-lg border border-dashed border-edge p-8 text-center text-sm text-ink-muted"
        >
          Aucun envoi dans ce dossier. Le premier message apparaîtra ici avec son résultat.
        </div>{/each}
      <div class="flex items-center justify-between">
        <Button
          variant="ghost"
          disabled={page <= 1 || loading}
          onclick={() => {
            page--;
            void load();
          }}>Précédent</Button
        ><span class="text-xs text-ink-muted">Page {page}</span><Button
          variant="ghost"
          disabled={page * 20 >= context.history.total || loading}
          onclick={() => {
            page++;
            void load();
          }}>Suivant</Button
        >
      </div>
      <p class="text-xs text-ink-muted">
        Les réponses restent dans la boîte de réception du canal. Elles ne sont pas associées
        automatiquement par adresse ou numéro.
      </p>
    {:else}<CommunicationTemplates
        {channel}
        {templates}
        canManage={manage &&
          !!$auth?.user.permissions.includes(
            channel === 'SMS' ? PERMISSIONS.SMS.MANAGE : PERMISSIONS.EMAIL.MANAGE,
          )}
        bind:busy
        onchanged={load}
      />{/if}
  {:else}<Button variant="secondary" onclick={load}>Réessayer</Button>{/if}
</div>
