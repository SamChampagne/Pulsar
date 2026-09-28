<script lang="ts">
  import { onMount } from 'svelte';
  import { SMTP_PRESETS } from '@pulsar/shared';
  import { Mail, Inbox, ShieldCheck } from 'lucide-svelte';
  import { api } from '$lib/api/client';
  import { toast } from '$lib/stores/toast';
  import { confirmAction } from '$lib/stores/confirmation';
  import { formatDateTime } from '$lib/format';
  import EmailPreview from '$lib/components/email/EmailPreview.svelte';
  import {
    PageHeader,
    Button,
    Card,
    Badge,
    Skeleton,
    Input,
    Field,
    Select,
    ErrorNotice,
  } from '$lib/components/ui';
  type Config = {
    host: string | null;
    port: number | null;
    secure: boolean;
    username: string | null;
    fromName: string | null;
    fromEmail: string | null;
    replyTo: string | null;
    active: boolean;
    hasPassword: boolean;
    updatedAt: string;
    imapHost: string | null;
    imapPort: number | null;
    imapSecure: boolean;
    imapUsername: string | null;
    inboundActive: boolean;
    inboundLive: boolean;
    hasImapPassword: boolean;
    lastTestAt: string | null;
    lastTestOk: boolean | null;
    lastPollAt: string | null;
  };
  type Connection = {
    outbound: 'smtp-tenant' | 'smtp-platform' | 'log';
    inbound: 'imap' | 'log';
    config: Config | null;
  };
  let connection = $state<Connection | null>(null),
    loading = $state(true),
    error = $state(''),
    saving = $state(false),
    testing = $state(false);
  let tab = $state('send'),
    presetKey = $state('custom'),
    saved = $state('');
  let form = $state({
    host: '',
    port: 587,
    secure: false,
    username: '',
    fromName: '',
    fromEmail: '',
    replyTo: '',
    active: true,
    imapHost: '',
    imapPort: 993,
    imapSecure: true,
    imapUsername: '',
    inboundActive: false,
    inboundLive: false,
  });
  let password = $state(''),
    imapPassword = $state(''),
    testTo = $state(''),
    confirmed = $state(false),
    testResult = $state('');
  const dirty = $derived(JSON.stringify(form) !== saved || !!password || !!imapPassword);
  const smtpChanged = $derived(
    !!connection?.config &&
      (form.host !== (connection.config.host ?? '') ||
        form.username !== (connection.config.username ?? '')),
  );
  const imapChanged = $derived(
    !!connection?.config &&
      (form.imapHost !== (connection.config.imapHost ?? '') ||
        form.imapUsername !== (connection.config.imapUsername ?? '')),
  );
  const preset = $derived(SMTP_PRESETS.find((p) => p.key === presetKey)!);
  async function load() {
    loading = true;
    error = '';
    try {
      connection = await api<Connection>('/email-config/connection');
      const c = connection.config;
      form = {
        host: c?.host ?? '',
        port: c?.port ?? 587,
        secure: c?.secure ?? false,
        username: c?.username ?? '',
        fromName: c?.fromName ?? '',
        fromEmail: c?.fromEmail ?? '',
        replyTo: c?.replyTo ?? '',
        active: c?.active ?? true,
        imapHost: c?.imapHost ?? '',
        imapPort: c?.imapPort ?? 993,
        imapSecure: c?.imapSecure ?? true,
        imapUsername: c?.imapUsername ?? '',
        inboundActive: c?.inboundActive ?? false,
        inboundLive: c?.inboundLive ?? false,
      };
      saved = JSON.stringify(form);
      password = '';
      imapPassword = '';
      presetKey = SMTP_PRESETS.find((p) => p.host === form.host)?.key ?? 'custom';
    } catch (e) {
      error = (e as Error).message;
      connection = null;
    } finally {
      loading = false;
    }
  }
  function choose(key: string) {
    const p = SMTP_PRESETS.find((p) => p.key === key)!;
    presetKey = key;
    if (key !== 'custom') {
      form.host = p.host;
      form.port = p.port;
      form.secure = p.secure;
      password = '';
    }
    confirmed = false;
    testResult = '';
  }
  async function save() {
    if (
      form.inboundLive &&
      !(await confirmAction(
        'Pulsar pourra relever cette boîte IMAP toutes les cinq minutes lorsque la collecte est active. Confirmez que vous êtes autorisé à importer ces courriels dans cette entreprise.',
        { title: 'Autoriser la réception réelle', confirmLabel: 'Autoriser IMAP' },
      ))
    )
      return;
    saving = true;
    error = '';
    testResult = '';
    confirmed = false;
    try {
      await api('/email-config', {
        method: 'PUT',
        body: {
          ...form,
          host: form.host || null,
          fromName: form.fromName || null,
          fromEmail: form.fromEmail || null,
          username: form.username || null,
          replyTo: form.replyTo || null,
          imapHost: form.imapHost || null,
          imapUsername: form.imapUsername || null,
          expectedUpdatedAt: connection?.config?.updatedAt ?? null,
          ...(password ? { password } : {}),
          ...(imapPassword ? { imapPassword } : {}),
          ...(form.inboundLive ? { confirmInboundLive: true } : {}),
        },
      });
      await load();
      toast.success('Connexion courriel enregistrée');
    } catch (e) {
      error = (e as Error).message;
    } finally {
      saving = false;
    }
  }
  async function test(inbound = false) {
    if (dirty || testing || (!inbound && !confirmed)) return;
    testing = true;
    error = '';
    testResult = '';
    try {
      const result = await api<{ ok: boolean; simulated?: boolean }>(
        inbound ? '/email-config/test-inbound' : '/email-config/test',
        { method: 'POST', body: inbound ? {} : { to: testTo } },
      );
      testResult = result.ok
        ? inbound
          ? result.simulated
            ? 'Simulation IMAP réussie — aucune boîte distante contactée.'
            : 'Connexion IMAP vérifiée. Aucun message importé par ce test.'
          : result.simulated
            ? 'Simulation réussie — aucun courriel expédié.'
            : 'Courriel accepté par le serveur SMTP. Vérifiez la boîte de destination et les indésirables.'
        : 'Échec du test. Vérifiez les paramètres et les accès auprès du fournisseur.';
      connection = await api<Connection>('/email-config/connection');
    } catch (e) {
      error = (e as Error).message;
    } finally {
      testing = false;
      confirmed = false;
    }
  }
  onMount(load);
</script>

<PageHeader title="Connexion courriel" eyebrow="Communications"
  >{#snippet actions()}<Button href="/emails" variant="secondary">Ouvrir les courriels</Button
    >{/snippet}</PageHeader
>
<ErrorNotice message={error} onretry={load} />
{#if loading}<Skeleton rows={6} />{:else if connection}
  <div class="space-y-5" data-tour="email-connection">
    <div class="grid gap-3 sm:grid-cols-2">
      <Card
        ><div class="flex items-center gap-3">
          <Mail size={20} />
          <div>
            <p class="text-xs text-ink-muted">Envoi enregistré</p>
            <p class="font-medium">
              {connection.outbound === 'smtp-tenant'
                ? 'SMTP de cette entreprise'
                : connection.outbound === 'smtp-platform'
                  ? 'SMTP de la plateforme'
                  : 'Simulation — aucun envoi externe'}
            </p>
          </div>
        </div></Card
      >
      <Card
        ><div class="flex items-center gap-3">
          <Inbox size={20} />
          <div>
            <p class="text-xs text-ink-muted">Réception effective</p>
            <p class="font-medium">
              {connection.inbound === 'imap' ? 'Collecte IMAP' : 'Pas de collecte IMAP réelle'}
            </p>
          </div>
        </div></Card
      >
    </div>
    <div class="flex flex-wrap gap-2" aria-label="Configuration courriel">
      {#each [{ key: 'send', label: '1 · Envoi et identité' }, { key: 'receive', label: '2 · Réception' }, { key: 'test', label: '3 · Vérification' }] as item}<Button
          variant={tab === item.key ? 'primary' : 'secondary'}
          onclick={() => {
            tab = item.key;
          }}>{item.label}</Button
        >{/each}
    </div>
    <div class="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(20rem,0.85fr)]">
      <Card
        ><form
          onsubmit={(e) => {
            e.preventDefault();
            void save();
          }}
          class="space-y-5"
        >
          {#if tab === 'send'}
            <div>
              <h2 class="font-semibold">Votre fournisseur d’envoi</h2>
              <p class="mt-1 text-sm text-ink-muted">
                Une connexion commune aux modules. Préréglages SMTP, sans OAuth ni connexion API
                native.
              </p>
            </div>
            <div class="grid grid-cols-2 gap-2">
              {#each SMTP_PRESETS as p}<button
                  type="button"
                  aria-pressed={presetKey === p.key}
                  onclick={() => choose(p.key)}
                  class="rounded-lg border p-3 text-left text-sm transition-colors hover:bg-surface-muted"
                  class:border-accent={presetKey === p.key}
                  class:border-edge={presetKey !== p.key}>{p.name}</button
                >{/each}
            </div>
            <p class="text-xs leading-5 text-ink-muted">{preset.hint}</p>
            <label class="flex items-start gap-2 text-sm"
              ><input type="checkbox" bind:checked={form.active} class="mt-1" />Utiliser le SMTP de
              cette entreprise. Sinon, le transport de la plateforme s’applique : ce n’est pas un
              arrêt global des courriels.</label
            >
            <div class="grid gap-3 sm:grid-cols-[1fr_7rem]">
              <Field label="Hôte SMTP"
                ><Input
                  bind:value={form.host}
                  maxlength={255}
                  placeholder="smtp.exemple.ca"
                /></Field
              ><Field label="Port SMTP"
                ><Input type="number" bind:value={form.port} min={1} max={65535} /></Field
              >
            </div>
            <Field label="Sécurité SMTP"
              ><Select
                value={form.secure ? 'tls' : 'starttls'}
                onchange={(e) => (form.secure = e.currentTarget.value === 'tls')}
                ><option value="starttls">STARTTLS si offert (habituellement 587)</option><option
                  value="tls">TLS dès la connexion (habituellement 465)</option
                ></Select
              ></Field
            >
            <div class="grid gap-3 sm:grid-cols-2">
              <Field label="Identifiant SMTP"
                ><Input bind:value={form.username} maxlength={255} /></Field
              ><Field label="Mot de passe ou clé SMTP"
                ><Input
                  type="password"
                  bind:value={password}
                  maxlength={512}
                  placeholder={connection.config?.hasPassword && !smtpChanged
                    ? 'Secret enregistré — vide pour conserver'
                    : 'Nouveau secret'}
                /></Field
              >
            </div>
            {#if smtpChanged && connection.config?.hasPassword}<p class="text-sm text-warn">
                Serveur ou identifiant changé : saisissez le secret du nouveau compte. L’ancien
                secret sera retiré.
              </p>{/if}
            <div class="border-t border-edge pt-4">
              <h3 class="mb-3 font-semibold">Identité de l’expéditeur</h3>
              <div class="grid gap-3 sm:grid-cols-2">
                <Field label="Nom de l’expéditeur"
                  ><Input bind:value={form.fromName} maxlength={255} /></Field
                ><Field label="Adresse de l’expéditeur"
                  ><Input type="email" bind:value={form.fromEmail} maxlength={255} /></Field
                >
              </div>
            </div>
            <Field label="Répondre à"
              ><Input
                type="email"
                bind:value={form.replyTo}
                maxlength={255}
                placeholder="support@entreprise.ca"
              /></Field
            >
          {:else if tab === 'receive'}
            <div>
              <h2 class="font-semibold">Réception des réponses</h2>
              <p class="mt-1 text-sm text-ink-muted">
                IMAP lit une boîte aux lettres. Un fournisseur d’envoi comme Brevo ne fournit pas
                nécessairement cette boîte.
              </p>
            </div>
            <label class="flex gap-2 text-sm"
              ><input type="checkbox" bind:checked={form.inboundActive} />Activer la collecte IMAP
              pour cette entreprise</label
            >
            <label class="flex gap-2 text-sm"
              ><input type="checkbox" bind:checked={form.inboundLive} />Mode IMAP réel — lire la
              boîte distante</label
            >
            <p class="text-xs text-ink-muted">
              Sans ce mode, les tests restent simulés. Activez-le ici avec confirmation : aucune
              modification du serveur n’est nécessaire. La collecte active fonctionne toutes les
              cinq minutes.
            </p>
            <div class="grid gap-3 sm:grid-cols-[1fr_7rem]">
              <Field label="Hôte IMAP"><Input bind:value={form.imapHost} maxlength={255} /></Field
              ><Field label="Port IMAP"
                ><Input type="number" bind:value={form.imapPort} min={1} max={65535} /></Field
              >
            </div>
            <label class="flex gap-2 text-sm"
              ><input type="checkbox" bind:checked={form.imapSecure} />TLS dès la connexion
              (habituellement 993)</label
            >
            <Field label="Identifiant IMAP"
              ><Input bind:value={form.imapUsername} maxlength={255} /></Field
            ><Field label="Mot de passe IMAP"
              ><Input
                type="password"
                bind:value={imapPassword}
                maxlength={512}
                placeholder={connection.config?.hasImapPassword && !imapChanged
                  ? 'Secret enregistré — vide pour conserver'
                  : 'Nouveau secret'}
              /></Field
            >
            {#if imapChanged && connection.config?.hasImapPassword}<p class="text-sm text-warn">
                Le secret IMAP précédent sera retiré après ce changement de compte.
              </p>{/if}
            <p class="text-xs text-ink-muted">
              Dernier relevé : {connection.config?.lastPollAt
                ? formatDateTime(connection.config.lastPollAt)
                : 'Aucun'}
            </p>
          {:else}
            <div>
              <h2 class="font-semibold">Vérifier la connexion enregistrée</h2>
              <p class="mt-1 text-sm text-ink-muted">
                Enregistrez avant le test. Une acceptation SMTP ne prouve pas la livraison finale.
              </p>
            </div>
            <Field label="Adresse de test"><Input type="email" bind:value={testTo} /></Field>
            <label class="flex items-start gap-2 text-sm"
              ><input type="checkbox" bind:checked={confirmed} class="mt-1" />Je confirme l’envoi
              vers cette adresse. Un SMTP configuré peut envoyer un vrai courriel, même si le mode
              plateforme est log.</label
            >
            <Button disabled={dirty || !confirmed || !testTo || testing} onclick={() => test()}
              >Envoyer un test</Button
            >
            <div class="border-t border-edge pt-4">
              <Button
                variant="secondary"
                disabled={dirty ||
                  testing ||
                  !connection.config?.inboundActive ||
                  !connection.config?.imapHost}
                onclick={() => test(true)}>Tester la connexion IMAP</Button
              >
            </div>
            <p class="text-xs text-ink-muted">
              Dernier test SMTP : {connection.config?.lastTestAt
                ? `${formatDateTime(connection.config.lastTestAt)} · ${connection.config.lastTestOk ? 'Accepté / simulé selon le mode' : 'Échec'}`
                : 'Aucun'}
            </p>
            {#if testResult}<p role="status" class="rounded-md bg-surface-muted p-3 text-sm">
                {testResult}
              </p>{/if}
          {/if}
          <div class="flex flex-wrap items-center justify-between gap-3 border-t border-edge pt-4">
            <Badge tone={dirty ? 'warn' : 'neutral'}
              >{dirty ? 'Modifications non enregistrées' : 'Configuration enregistrée'}</Badge
            ><Button type="submit" disabled={saving || testing || !dirty} loading={saving}
              >Enregistrer</Button
            >
          </div>
        </form></Card
      >
      <div class="space-y-4">
        <EmailPreview
          subject="Une mise à jour de votre dossier"
          from={[form.fromName, form.fromEmail].filter(Boolean).join(' · ') ||
            'Expéditeur de la plateforme'}
          to="Votre destinataire"
          replyTo={form.replyTo}
          html="<h2>Bonjour,</h2><p>Votre équipe vous informe d’une mise à jour de votre dossier.</p><p>Merci de votre confiance.</p>"
        />
        <p class="flex gap-2 text-xs leading-5 text-ink-muted">
          <ShieldCheck size={18} class="shrink-0" />Secrets chiffrés et jamais relus. Faites valider
          SPF, DKIM et DMARC auprès de votre fournisseur; cet aperçu ne vérifie pas la
          délivrabilité.
        </p>
      </div>
    </div>
  </div>
{/if}
