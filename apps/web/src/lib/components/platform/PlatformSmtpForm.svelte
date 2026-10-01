<script lang="ts">
  import { untrack } from 'svelte';
  import { SMTP_PRESETS } from '@pulsar/shared';
  import { platformApi } from '$lib/api/platform';
  import { Button, Field, Input, Select, ErrorNotice } from '$lib/components/ui';
  export type SmtpConfig = {
    mode: string;
    host: string;
    port: number;
    secure: boolean;
    username: string;
    fromName: string;
    fromEmail: string;
    replyTo: string;
    hasPassword: boolean;
    updatedAt: string | null;
  };
  let {
    config,
    tenantName = '',
    endpoint = '/platform/services/email',
    disabled = false,
    onsaved,
  }: {
    config: SmtpConfig;
    tenantName?: string;
    endpoint?: string;
    disabled?: boolean;
    onsaved: () => Promise<void>;
  } = $props();
  let form = $state(
    untrack(() => ({
      mode: config.mode,
      host: config.host,
      port: config.port,
      secure: config.secure,
      username: config.username,
      fromName: config.fromName,
      fromEmail: config.fromEmail,
      replyTo: config.replyTo,
    })),
  );
  const initial = untrack(() => JSON.stringify(form));
  let password = $state(''),
    confirmed = $state(false),
    busy = $state(false),
    error = $state(''),
    result = $state('');
  const dirty = $derived(JSON.stringify(form) !== initial || !!password);
  const identityChanged = $derived(form.host !== config.host || form.username !== config.username);
  $effect(() => {
    JSON.stringify(form);
    password;
    confirmed = false;
    result = '';
  });
  async function save(event: SubmitEvent) {
    event.preventDefault();
    if (busy || disabled || !confirmed) return;
    busy = true;
    error = '';
    result = '';
    try {
      await platformApi(endpoint, {
        method: 'PUT',
        body: {
          ...form,
          fromEmail: form.fromEmail || undefined,
          replyTo: form.replyTo || null,
          ...(password ? { password } : {}),
          expectedUpdatedAt: config.updatedAt,
          confirmed: true,
        },
      });
      password = '';
      await onsaved();
    } catch (e) {
      error = (e as Error).message;
    } finally {
      busy = false;
    }
  }
  async function verify() {
    if (dirty || busy) return;
    busy = true;
    error = '';
    result = '';
    try {
      const r = await platformApi<{ message: string }>(`${endpoint}/verify`, {
        method: 'POST',
        body: { confirmed: true, expectedUpdatedAt: config.updatedAt },
      });
      result = r.message;
    } catch (e) {
      error = (e as Error).message;
    } finally {
      busy = false;
    }
  }
</script>

<form
  onsubmit={save}
  class="space-y-5"
  aria-label={tenantName ? `Courriel de ${tenantName}` : 'Courriel plateforme'}
>
  <ErrorNotice message={error} />
  <Field label="Transport sortant"
    ><Select bind:value={form.mode} disabled={disabled || busy}>
      <option value="ENVIRONMENT"
        >{tenantName ? 'Hériter de la plateforme' : 'Configuration du serveur (existante)'}</option
      >
      {#if !tenantName}<option value="SIMULATION"
          >Simulation — ne pas envoyer par le transport global</option
        >{/if}
      <option value="SMTP"
        >{tenantName ? 'SMTP propre à cette entreprise' : 'SMTP configuré dans Pulsar'}</option
      >
    </Select></Field
  >
  {#if form.mode === 'SMTP'}
    <Field label="Préremplir un fournisseur"
      ><Select
        disabled={disabled || busy}
        onchange={(e) => {
          const p = SMTP_PRESETS.find((p) => p.key === e.currentTarget.value);
          if (p && p.key !== 'custom') {
            form.host = p.host;
            form.port = p.port;
            form.secure = p.secure;
            password = '';
          }
        }}
      >
        <option value="">Choisir un préréglage</option>{#each SMTP_PRESETS as preset}<option
            value={preset.key}>{preset.name}</option
          >{/each}
      </Select></Field
    >
    <div class="grid gap-4 sm:grid-cols-[1fr_8rem]">
      <Field label="Hôte SMTP"
        ><Input
          bind:value={form.host}
          required
          maxlength={253}
          disabled={disabled || busy}
          placeholder="smtp.exemple.ca"
        /></Field
      >
      <Field label="Port"
        ><Input
          type="number"
          bind:value={form.port}
          min={1}
          max={65535}
          step={1}
          required
          disabled={disabled || busy}
        /></Field
      >
    </div>
    <label class="flex items-center gap-2 text-sm"
      ><input type="checkbox" bind:checked={form.secure} disabled={disabled || busy} />TLS implicite
      (généralement port 465)</label
    >
    <p class="text-xs text-ink-muted">
      Sinon STARTTLS. Le contrôle de connexion exige un canal chiffré. Aucun certificat invalide
      accepté.
    </p>
    <div class="grid gap-4 sm:grid-cols-2">
      <Field label="Identifiant SMTP"
        ><Input bind:value={form.username} maxlength={255} disabled={disabled || busy} /></Field
      >
      <Field label="Mot de passe ou mot de passe d’application"
        ><Input
          type="password"
          bind:value={password}
          maxlength={512}
          disabled={disabled || busy}
          placeholder={config.hasPassword && !identityChanged
            ? 'Secret enregistré — laisser vide pour conserver'
            : 'Nouveau secret'}
        /></Field
      >
      <Field label="Nom de l’expéditeur"
        ><Input bind:value={form.fromName} maxlength={255} disabled={disabled || busy} /></Field
      >
      <Field label="Adresse de l’expéditeur"
        ><Input
          type="email"
          bind:value={form.fromEmail}
          required
          maxlength={255}
          disabled={disabled || busy}
        /></Field
      >
    </div>
    <Field label="Adresse de réponse (facultative)"
      ><Input
        type="email"
        bind:value={form.replyTo}
        maxlength={255}
        disabled={disabled || busy}
      /></Field
    >
    {#if identityChanged && config.hasPassword}<p class="text-xs text-warn">
        L’hôte ou le compte change : l’ancien secret ne sera pas réutilisé.
      </p>{/if}
  {/if}
  <aside class="rounded-md bg-surface-muted p-3 text-xs leading-5 text-ink-muted">
    {#if tenantName}Portée : <strong class="text-ink">{tenantName}</strong> seulement. Hériter désactive
      son SMTP dédié et peut réactiver les envois par la plateforme. Aucune modification IMAP ou SMS.
    {:else}Portée : invitations, réinitialisations et envois qui héritent du transport plateforme.
      Les SMTP propres aux entreprises ne changent pas. La simulation globale n’est donc pas un
      arrêt de tous les courriels. Les prochaines tentatives en file pourront utiliser le transport
      choisi.{/if}
  </aside>
  <label class="flex items-start gap-2 text-sm"
    ><input class="mt-1" type="checkbox" bind:checked={confirmed} disabled={disabled || busy} />Je
    confirme la portée de ce changement et les éventuels envois réels.</label
  >
  <div class="flex flex-wrap gap-2">
    <Button type="submit" loading={busy} disabled={disabled || !confirmed}
      >Enregistrer le courriel</Button
    >
    <Button variant="secondary" onclick={verify} disabled={disabled || dirty || busy}
      >Vérifier SMTP sans envoyer</Button
    >
  </div>
  {#if dirty}<p class="text-xs text-ink-muted">Enregistrez avant de vérifier la connexion.</p>{/if}
  {#if result}<p role="status" class="rounded-md border border-edge p-3 text-sm">{result}</p>{/if}
</form>
