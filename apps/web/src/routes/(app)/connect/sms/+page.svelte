<script lang="ts">
  import { onMount } from 'svelte';
  import { Smartphone, Settings2 } from 'lucide-svelte';
  import {
    E164_PATTERN,
    SMS_STATUS_LABELS,
    SmsStatus,
    SmsDeliveryStatus,
    SMS_DELIVERY_LABELS,
  } from '@pulsar/shared';
  import { confirmAction } from '$lib/stores/confirmation';
  import SmsIncoming from '$lib/components/settings/SmsIncoming.svelte';
  import { api, ApiError } from '$lib/api/client';
  import { auth } from '$lib/stores/auth';
  import { formatDateTime } from '$lib/format';
  import {
    PageHeader,
    Button,
    Card,
    Badge,
    Skeleton,
    Input,
    Textarea,
    Field,
    ErrorNotice,
    EmptyState,
  } from '$lib/components/ui';
  type Config = {
    fromNumber: string;
    messagingProfileId: string;
    live: boolean;
    liveAuthorized: boolean;
    webhookPublicKey: string | null;
    webhookOrigin: string | null;
    lastWebhookAt: string | null;
    active: boolean;
    dailyLimit: number;
    hasApiKey: boolean;
    updatedAt: string;
  };
  type Message = {
    id: string;
    fromNumber: string;
    toNumber: string;
    text: string;
    status: SmsStatus;
    deliveryStatus: SmsDeliveryStatus;
    deliveryAt: string | null;
    live: boolean;
    providerMessageId: string | null;
    errorCode: string | null;
    createdAt: string;
  };
  type Intent = {
    operationKey: string;
    expectedUpdatedAt: string;
    toNumber: string;
    text: string;
    confirmed: true;
  };
  let connection = $state<{
      config: Config | null;
      liveEnabled: boolean;
      webhookPath: string | null;
    } | null>(null),
    items = $state<Message[]>([]),
    total = $state(0),
    page = $state(1);
  let loading = $state(true),
    error = $state(''),
    busy = $state(false),
    settingsOpen = $state(false),
    saved = $state(''),
    result = $state('');
  let form = $state({
      fromNumber: '',
      messagingProfileId: '',
      live: false,
      active: true,
      dailyLimit: 100,
      webhookPublicKey: '',
      webhookOrigin: '',
    }),
    apiKey = $state('');
  let toNumber = $state(''),
    text = $state(''),
    confirmed = $state(false),
    pending = $state<Intent | null>(null),
    storageError = $state(false),
    reviewed = $state(false);
  const canManage = $derived($auth?.user.permissions.includes('core.sms.manage') ?? false);
  const canSend = $derived($auth?.user.permissions.includes('core.sms.send') ?? false);
  const storageKey = $derived(`pulsar:sms:${$auth?.tenant.id}:${$auth?.user.id}`);
  const dirty = $derived(saved !== JSON.stringify(form) || !!apiKey);
  async function history() {
    const r = await api<{ items: Message[]; total: number }>('/sms/messages', { query: { page } });
    items = r.items;
    total = r.total;
  }
  async function load() {
    loading = true;
    error = '';
    try {
      connection = await api('/sms/connection');
      await history();
      const c = connection!.config;
      form = {
        fromNumber: c?.fromNumber ?? '',
        messagingProfileId: c?.messagingProfileId ?? '',
        live: c?.live ?? false,
        active: c?.active ?? true,
        dailyLimit: c?.dailyLimit ?? 100,
        webhookPublicKey: c?.webhookPublicKey ?? '',
        webhookOrigin: c?.webhookOrigin ?? '',
      };
      saved = JSON.stringify(form);
      apiKey = '';
      settingsOpen = !c;
    } catch (e) {
      error = (e as Error).message;
      connection = null;
    } finally {
      loading = false;
    }
  }
  onMount(() => {
    try {
      const value = sessionStorage.getItem(storageKey);
      pending = value ? JSON.parse(value) : null;
    } catch {
      storageError = true;
    }
    void load();
  });
  async function save() {
    if (
      form.live &&
      form.active &&
      !(await confirmAction(
        'Autoriser les SMS réels pour cette entreprise ? Les utilisateurs habilités pourront envoyer des messages payants avec ce numéro. Vérifiez le profil Telnyx et les retours STOP avant tout envoi.',
        { title: 'Activer Telnyx dans Pulsar', confirmLabel: 'Autoriser le mode réel' },
      ))
    )
      return;
    busy = true;
    error = '';
    try {
      await api('/sms/config', {
        method: 'PUT',
        body: {
          ...form,
          expectedUpdatedAt: connection?.config?.updatedAt ?? null,
          ...(apiKey ? { apiKey } : {}),
          webhookPublicKey: form.webhookPublicKey || undefined,
          ...(form.live && form.active ? { confirmLive: true } : {}),
        },
      });
      await load();
    } catch (e) {
      error = (e as Error).message;
    } finally {
      busy = false;
    }
  }
  async function send() {
    if (
      busy ||
      !canSend ||
      storageError ||
      (!pending && (!confirmed || !connection?.config || dirty))
    )
      return;
    busy = true;
    error = '';
    result = '';
    try {
      if (!pending) {
        const intent: Intent = {
          operationKey: crypto.randomUUID(),
          expectedUpdatedAt: connection!.config!.updatedAt,
          toNumber,
          text,
          confirmed: true,
        };
        sessionStorage.setItem(storageKey, JSON.stringify(intent));
        pending = intent;
      }
      const message = await api<Message>('/sms/messages', { method: 'POST', body: pending });
      result = SMS_STATUS_LABELS[message.status];
      if (message.status !== SmsStatus.UNKNOWN && message.status !== SmsStatus.SENDING) {
        sessionStorage.removeItem(storageKey);
        pending = null;
        text = '';
        confirmed = false;
      }
      page = 1;
      await history();
    } catch (e) {
      error = (e as Error).message;
      if (e instanceof ApiError && e.statusCode < 500) {
        sessionStorage.removeItem(storageKey);
        pending = null;
      }
    } finally {
      busy = false;
    }
  }
  function closePending() {
    if (!reviewed || busy) return;
    sessionStorage.removeItem(storageKey);
    pending = null;
    reviewed = false;
    confirmed = false;
    text = '';
    result = '';
  }
  async function turnPage(next: number) {
    page = next;
    error = '';
    try {
      await history();
    } catch (e) {
      items = [];
      error = (e as Error).message;
    }
  }
</script>

<PageHeader title="SMS · Telnyx" eyebrow="Communications">
  {#snippet actions()}{#if canManage}<Button
        variant="secondary"
        onclick={() => {
          settingsOpen = !settingsOpen;
        }}><Settings2 size={16} />Configurer</Button
      >{/if}{/snippet}
</PageHeader>
<ErrorNotice message={error} onretry={load} />
{#if loading}<Skeleton rows={6} />{:else if connection}
  <div class="space-y-5" data-tour="sms-workspace">
    <div
      class="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-edge bg-surface p-4"
    >
      <div>
        <h2 class="font-semibold">Une connexion pour votre entreprise</h2>
        <p class="mt-1 text-sm text-ink-muted">
          SMS transactionnels, un destinataire à la fois. Aucune campagne ni automatisation CRM
          activée par cette connexion.
        </p>
      </div>
      <Badge tone={connection.config?.live ? 'warn' : 'neutral'}
        >{!connection.config?.active
          ? 'Connexion inactive'
          : connection.config.live
            ? 'Mode réel'
            : 'Simulation'}</Badge
      >
    </div>
    {#if connection.config?.live && !connection.liveEnabled}<p class="text-sm text-warn">
        Activation à confirmer dans Pulsar. Cette ancienne configuration reste bloquée jusqu’à votre
        autorisation.
      </p>{/if}
    {#if settingsOpen && canManage}
      <Card
        ><form
          class="space-y-4"
          onsubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <h2 class="font-semibold">Connexion Telnyx</h2>
          <p class="text-sm text-ink-muted">
            Le numéro doit appartenir à votre compte et être rattaché au Messaging Profile.
            Saisissez la clé ici, jamais dans une conversation ou une note.
          </p>
          <div class="grid gap-4 md:grid-cols-2">
            <Field label="Numéro d’envoi (E.164)"
              ><Input
                bind:value={form.fromNumber}
                type="tel"
                placeholder="+15145550123"
                maxlength={16}
                required
                pattern={E164_PATTERN.source}
              /></Field
            ><Field label="Messaging Profile ID"
              ><Input bind:value={form.messagingProfileId} maxlength={36} required /></Field
            ><Field label="Clé API Telnyx"
              ><Input
                type="password"
                bind:value={apiKey}
                maxlength={512}
                placeholder={connection.config?.hasApiKey
                  ? 'Clé enregistrée — vide pour conserver'
                  : 'Nouvelle clé'}
              /></Field
            ><Field label="Plafond quotidien par mode (jour UTC)"
              ><Input
                type="number"
                bind:value={form.dailyLimit}
                min={1}
                max={500}
                required
              /></Field
            >
          </div>
          <div class="space-y-3 border-t border-edge pt-4">
            <h3 class="font-semibold">Retours de livraison et réponses</h3>
            <p class="text-sm text-ink-muted">
              Tous les réglages sont enregistrés ici, sans variable serveur. La clé publique Telnyx
              vérifie les signatures; ce n’est pas votre clé API.
            </p>
            <Field label="Clé publique Telnyx (Ed25519)"
              ><Input
                bind:value={form.webhookPublicKey}
                maxlength={44}
                placeholder="Clé publique Base64 — Keys & Credentials dans Telnyx"
              /></Field
            >
            <Field label="Adresse HTTPS publique de Pulsar"
              ><Input
                bind:value={form.webhookOrigin}
                maxlength={255}
                placeholder="https://pulsar.intebec.ca"
              /></Field
            >
            {#if connection.webhookPath && connection.config?.webhookOrigin}
              <div class="rounded-lg bg-surface-muted p-3 text-sm">
                <p class="font-medium">URL enregistrée à copier dans le Messaging Profile Telnyx</p>
                <p class="mt-2 select-all break-all font-mono text-xs">
                  {connection.config.webhookOrigin}{connection.webhookPath}
                </p>
                <p class="mt-2 text-xs text-ink-muted">
                  Champ Webhook URL des messages entrants. Les accusés sortants utilisent
                  automatiquement cette URL. Une adresse locale n’est pas accessible par Telnyx.
                </p>
              </div>
            {/if}
            <p class="text-xs text-ink-muted">
              Dernier retour signé : {connection.config?.lastWebhookAt
                ? formatDateTime(connection.config.lastWebhookAt)
                : 'Aucun reçu — connexion entrante non vérifiée'}. STOP bloque les nouveaux envois;
              aucun message de réponse automatique.
            </p>
          </div>
          <div class="flex flex-wrap gap-5 text-sm">
            <label class="flex gap-2"
              ><input type="checkbox" bind:checked={form.active} />Connexion active</label
            ><label class="flex gap-2"
              ><input type="checkbox" bind:checked={form.live} />Mode réel — peut engendrer des
              frais</label
            >
          </div>
          <div class="flex flex-wrap items-center justify-between gap-2">
            <span class="text-xs text-ink-muted"
              >{dirty ? 'Modifications non enregistrées' : 'Configuration enregistrée'} · clé chiffrée,
              jamais renvoyée par l’API.</span
            ><Button type="submit" loading={busy} disabled={!dirty}>Enregistrer la connexion</Button
            >
          </div>
        </form></Card
      >
    {/if}
    {#if pending}
      <Card
        ><h2 class="font-semibold">Envoi à vérifier</h2>
        <p class="mt-2 text-sm">Vers {pending.toNumber} : {pending.text}</p>
        <p class="my-3 text-sm text-ink-muted">
          Reprenez exactement la même demande. Pulsar ne contacte pas une deuxième fois Telnyx si
          l’envoi est déjà engagé. Pour un résultat incertain, vérifiez le portail Telnyx avant
          toute autre tentative.
        </p>
        <Button disabled={busy || !canSend} onclick={send}>Reprendre la même demande</Button><label
          class="my-3 flex items-start gap-2 text-sm"
          ><input type="checkbox" bind:checked={reviewed} />J’ai vérifié le résultat dans Telnyx et
          je ferme cette reprise sans renvoyer le SMS.</label
        ><Button variant="secondary" disabled={!reviewed || busy} onclick={closePending}
          >Clore la reprise locale</Button
        ></Card
      >
    {:else if canSend}
      <div class="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <Card
          ><form
            class="space-y-4"
            onsubmit={(e) => {
              e.preventDefault();
              void send();
            }}
          >
            <h2 class="font-semibold">Préparer un SMS</h2>
            <Field label="Destinataire (E.164)"
              ><Input
                type="tel"
                bind:value={toNumber}
                maxlength={16}
                placeholder="+15145550123"
                required
                pattern={E164_PATTERN.source}
              /></Field
            ><Field label="Message"><Textarea bind:value={text} rows={6} /></Field>
            <p class="text-xs text-ink-muted">
              {text.length} / 1 600 caractères · Selon les accents et la longueur, Telnyx peut facturer
              plusieurs segments. Ceci n’est pas une estimation de prix.
            </p>
            <label class="flex items-start gap-2 text-sm"
              ><input type="checkbox" bind:checked={confirmed} class="mt-1" />Je confirme le numéro,
              le contenu et l’autorisation de contacter ce destinataire pour ce message
              transactionnel.</label
            >{#if storageError}<p class="text-danger">
                Reprise locale indisponible : envoi bloqué.
              </p>{/if}<Button
              type="submit"
              loading={busy}
              disabled={!connection.config?.active ||
                dirty ||
                !confirmed ||
                !E164_PATTERN.test(toNumber) ||
                !text.trim() ||
                text.length > 1600 ||
                storageError ||
                (!!connection.config?.live && !connection.liveEnabled)}
              >{connection.config?.live ? 'Confirmer et envoyer le SMS' : 'Simuler le SMS'}</Button
            >
          </form></Card
        >
        <aside class="mx-auto w-full max-w-sm rounded-3xl border border-edge bg-surface p-5">
          <div class="mb-6 flex items-center gap-2 border-b border-edge pb-4 text-sm">
            <Smartphone size={18} /><span>{toNumber || 'Aperçu du destinataire'}</span>
          </div>
          <p class="mb-2 text-xs text-ink-muted">
            De {connection.config?.fromNumber || 'votre numéro Telnyx'}
          </p>
          <div
            class="min-h-28 rounded-2xl rounded-bl-sm bg-accent/10 p-4 text-sm leading-6 break-words whitespace-pre-wrap"
          >
            {text || 'Votre message apparaîtra ici.'}
          </div>
          <p class="mt-4 text-xs text-ink-muted">Aperçu uniquement · aucun SMS envoyé</p>
        </aside>
      </div>
    {/if}
    {#if result}<p role="status" class="rounded-lg border border-edge p-3 text-sm">{result}</p>{/if}
    <section class="space-y-3">
      <div class="flex items-center justify-between">
        <h2 class="font-semibold">
          Journal des SMS <span class="ml-2 text-sm font-normal text-ink-muted">{total}</span>
        </h2>
        <Button variant="ghost" disabled={busy} onclick={() => turnPage(page)}
          >Actualiser le journal</Button
        >
      </div>
      <p class="text-xs text-ink-muted">
        « Accepté » décrit l’envoi à Telnyx. La livraison est confirmée séparément par un retour
        signé; ce n’est jamais une preuve de lecture.
      </p>
      {#each items as item (item.id)}<Card
          ><div class="flex flex-wrap items-center justify-between gap-2">
            <p class="font-medium">{item.toNumber}</p>
            <Badge
              tone={item.status === SmsStatus.REJECTED
                ? 'danger'
                : item.status === SmsStatus.UNKNOWN || item.status === SmsStatus.SENDING
                  ? 'warn'
                  : 'neutral'}>{SMS_STATUS_LABELS[item.status]}</Badge
            >
          </div>
          {#if item.live}<p
              class="mt-2 text-sm"
              class:text-danger={item.deliveryStatus === SmsDeliveryStatus.FAILED}
            >
              {SMS_DELIVERY_LABELS[item.deliveryStatus]}{item.deliveryAt
                ? ` · ${formatDateTime(item.deliveryAt)}`
                : ''}
            </p>{/if}
          <p class="my-3 text-sm break-words whitespace-pre-wrap">{item.text}</p>
          <p class="text-xs text-ink-muted">
            {formatDateTime(item.createdAt)} · {item.live ? 'Réel' : 'Simulation'} · De {item.fromNumber}
          </p>
          {#if item.providerMessageId}<p class="mt-1 text-xs break-all text-ink-muted">
              ID Telnyx : {item.providerMessageId}
            </p>{/if}{#if item.errorCode}<p class="mt-1 text-xs text-danger">
              {item.errorCode}
            </p>{/if}</Card
        >{:else}<EmptyState
          title="Aucun SMS"
          message="Configurez Telnyx puis commencez par une simulation."
        />{/each}
      <div class="flex items-center justify-end gap-3">
        <Button variant="secondary" disabled={page <= 1 || busy} onclick={() => turnPage(page - 1)}
          >Précédent</Button
        ><span class="text-sm">Page {page}</span><Button
          variant="secondary"
          disabled={page * 20 >= total || busy}
          onclick={() => turnPage(page + 1)}>Suivant</Button
        >
      </div>
    </section>
    <SmsIncoming />
  </div>
{/if}
