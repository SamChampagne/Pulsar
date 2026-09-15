<script lang="ts">
  import { api, ApiError } from '$lib/api/client';
  import { toast } from '$lib/stores/toast';
  import type { Tone } from '$lib/components/ui';
  import {
    PageHeader,
    Button,
    Card,
    Badge,
    Skeleton,
    Input,
    Field,
    ErrorNotice,
  } from '$lib/components/ui';

  interface EmailConfig {
    host: string;
    port: number;
    secure: boolean;
    username: string;
    fromName: string;
    fromEmail: string;
    replyTo: string | null;
    hasPassword: boolean;
    // IMAP fields
    imapHost: string | null;
    imapPort: number | null;
    imapSecure: boolean;
    imapUsername: string | null;
    hasImapPassword: boolean;
    inboundActive: boolean;
    lastPollAt: string | null;
    lastPollOk: boolean | null;
  }

  // — Data —
  let config = $state<EmailConfig | null>(null);
  let loading = $state(true);
  let error = $state('');
  let saving = $state(false);

  // — SMTP form state —
  let host = $state('');
  let port = $state(587);
  let secure = $state(false);
  let username = $state('');
  let password = $state('');
  let fromName = $state('');
  let fromEmail = $state('');
  let replyTo = $state('');

  // — IMAP form state —
  let imapHost = $state('');
  let imapPort = $state(993);
  let imapSecure = $state(true);
  let imapUsername = $state('');
  let imapPassword = $state('');
  let inboundActive = $state(false);

  // — Test SMTP —
  let testTo = $state('');
  let testSending = $state(false);

  // — Test IMAP —
  let testInboundRunning = $state(false);
  let testInboundResult = $state<{ ok: boolean; error?: string } | null>(null);

  const isConfigured = $derived(!!host.trim());
  const isImapConfigured = $derived(!!imapHost.trim());

  const configBadgeTone: Tone = $derived(isConfigured ? 'ok' : 'neutral');

  async function load() {
    loading = true;
    error = '';
    try {
      const result = (await api<EmailConfig | null>('/email-config')) ?? ({} as EmailConfig);
      config = result;
      host = result.host ?? '';
      port = result.port ?? 587;
      secure = result.secure ?? false;
      username = result.username ?? '';
      fromName = result.fromName ?? '';
      fromEmail = result.fromEmail ?? '';
      replyTo = result.replyTo ?? '';
      password = '';
      // IMAP
      imapHost = result.imapHost ?? '';
      imapPort = result.imapPort ?? 993;
      imapSecure = result.imapSecure ?? true;
      imapUsername = result.imapUsername ?? '';
      imapPassword = '';
      inboundActive = result.inboundActive ?? false;
    } catch (e) {
      error = e instanceof ApiError ? e.message : 'Échec du chargement de la configuration';
    } finally {
      loading = false;
    }
  }

  async function save() {
    saving = true;
    try {
      const body: Record<string, unknown> = {
        host: host.trim(),
        port: Number(port),
        secure,
        username: username.trim(),
        fromName: fromName.trim(),
        fromEmail: fromEmail.trim(),
        replyTo: replyTo.trim() || null,
        // IMAP fields
        imapHost: imapHost.trim() || null,
        imapPort: imapHost.trim() ? Number(imapPort) : null,
        imapSecure,
        imapUsername: imapUsername.trim() || null,
        inboundActive,
      };
      if (password) {
        body.password = password;
      }
      if (imapPassword) {
        body.imapPassword = imapPassword;
      }
      await api('/email-config', { method: 'PUT', body });
      toast.success('Configuration sauvegardée');
      password = '';
      imapPassword = '';
      void load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Erreur lors de la sauvegarde');
    } finally {
      saving = false;
    }
  }

  async function sendTest() {
    if (!testTo.trim()) {
      toast.error('Saisissez une adresse de test');
      return;
    }
    testSending = true;
    try {
      const result = await api<{ ok: boolean; simulated: boolean }>('/email-config/test', {
        method: 'POST',
        body: { to: testTo.trim() },
      });
      if (!result.ok) toast.error('Le transport courriel a refusé le test');
      else
        toast.success(
          result.simulated
            ? 'Test simulé : aucun courriel envoyé'
            : 'Test accepté par le transport. Vérifiez sa réception.',
        );
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Erreur lors de l'envoi du test");
    } finally {
      testSending = false;
    }
  }

  async function testInbound() {
    testInboundRunning = true;
    testInboundResult = null;
    try {
      const result = await api<{ ok: boolean; error?: string }>('/email-config/test-inbound', {
        method: 'POST',
      });
      testInboundResult = result;
      if (result.ok) {
        toast.success('Connexion IMAP réussie');
        void load(); // refresh lastPollAt / lastPollOk
      } else {
        toast.error(result.error ?? 'Échec de la connexion IMAP');
      }
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : 'Erreur lors du test IMAP';
      testInboundResult = { ok: false, error: msg };
      toast.error(msg);
    } finally {
      testInboundRunning = false;
    }
  }

  function formatPollAt(iso: string | null): string {
    if (!iso) return 'Jamais';
    return new Date(iso).toLocaleString('fr-CA');
  }

  $effect(() => {
    void load();
  });
</script>

<a href="/connect" class="mb-3 inline-block text-sm text-accent hover:underline"
  >← Toutes les connexions</a
>
<PageHeader title="Connexion courriel" eyebrow="Connexions · SMTP / IMAP">
  {#snippet actions()}
    <Badge tone={configBadgeTone}>
      {isConfigured ? 'Configuré' : 'Non configuré'}
    </Badge>
  {/snippet}
</PageHeader>

<ErrorNotice message={error} onretry={load} />

{#if loading}
  <Card><Skeleton rows={8} /></Card>
{:else}
  <div class="flex flex-col gap-6">
    <div class="grid gap-6 lg:grid-cols-[1fr_22rem]">
      <!-- SMTP form -->
      <Card>
        <h2 class="mb-4 text-sm font-bold text-ink">Paramètres SMTP (envoi)</h2>
        <div class="flex flex-col gap-4">
          <div class="grid gap-4 sm:grid-cols-[1fr_8rem_6rem]">
            <Field label="Hôte">
              <Input bind:value={host} placeholder="smtp.example.com" />
            </Field>
            <Field label="Port">
              <Input type="number" bind:value={port} min={1} max={65535} />
            </Field>
            <Field label="TLS / SSL">
              <label class="flex h-9 cursor-pointer items-center gap-2 text-sm text-ink">
                <input type="checkbox" bind:checked={secure} class="accent-accent" />
                Sécurisé
              </label>
            </Field>
          </div>

          <div class="grid gap-4 sm:grid-cols-2">
            <Field label="Nom d'utilisateur">
              <Input bind:value={username} placeholder="user@example.com" />
            </Field>
            <div>
              <Field label="Mot de passe">
                <Input
                  type="password"
                  bind:value={password}
                  placeholder={config?.hasPassword ? '••••••' : 'Nouveau mot de passe'}
                />
              </Field>
              <p class="mt-1 text-xs text-ink-faint">
                {config?.hasPassword
                  ? 'Laissez vide pour conserver le mot de passe actuel'
                  : 'Nouveau mot de passe'}
              </p>
            </div>
          </div>

          <div class="grid gap-4 sm:grid-cols-2">
            <Field label="Nom de l'expéditeur">
              <Input bind:value={fromName} placeholder="Pulsar Logistics" />
            </Field>
            <Field label="Adresse de l'expéditeur">
              <Input type="email" bind:value={fromEmail} placeholder="no-reply@example.com" />
            </Field>
          </div>

          <Field label="Répondre à (optionnel)">
            <Input type="email" bind:value={replyTo} placeholder="support@example.com" />
          </Field>
        </div>
      </Card>

      <!-- Test SMTP panel -->
      <Card>
        <h2 class="mb-4 text-sm font-bold text-ink">Tester la configuration SMTP</h2>
        <p class="mb-4 text-sm text-ink-muted">
          Envoyez un courriel de test pour vérifier que la configuration SMTP est fonctionnelle.
        </p>
        <div class="flex flex-col gap-3">
          <Field label="Adresse de destination">
            <Input
              type="email"
              bind:value={testTo}
              placeholder="moi@example.com"
              disabled={testSending}
            />
          </Field>
          <Button onclick={sendTest} disabled={testSending || !isConfigured}>
            {testSending ? 'Envoi…' : 'Envoyer un test'}
          </Button>
          {#if !isConfigured}
            <p class="text-xs text-ink-muted">
              Configurez et sauvegardez les paramètres SMTP avant d'effectuer un test.
            </p>
          {/if}
        </div>
      </Card>
    </div>

    <!-- IMAP section -->
    <div class="grid gap-6 lg:grid-cols-[1fr_22rem]">
      <Card>
        <h2 class="mb-4 text-sm font-bold text-ink">Réception (IMAP)</h2>
        <div class="flex flex-col gap-4">
          <div class="grid gap-4 sm:grid-cols-[1fr_8rem_6rem]">
            <Field label="Hôte IMAP">
              <Input bind:value={imapHost} placeholder="imap.example.com" />
            </Field>
            <Field label="Port">
              <Input type="number" bind:value={imapPort} min={1} max={65535} />
            </Field>
            <Field label="TLS / SSL">
              <label class="flex h-9 cursor-pointer items-center gap-2 text-sm text-ink">
                <input type="checkbox" bind:checked={imapSecure} class="accent-accent" />
                Sécurisé
              </label>
            </Field>
          </div>

          <div class="grid gap-4 sm:grid-cols-2">
            <Field label="Nom d'utilisateur">
              <Input bind:value={imapUsername} placeholder="user@example.com" />
            </Field>
            <div>
              <Field label="Mot de passe IMAP">
                <Input
                  type="password"
                  bind:value={imapPassword}
                  placeholder={config?.hasImapPassword ? '••••••' : 'Nouveau mot de passe'}
                />
              </Field>
              <p class="mt-1 text-xs text-ink-faint">
                {config?.hasImapPassword
                  ? 'Laissez vide pour conserver le mot de passe actuel'
                  : 'Nouveau mot de passe'}
              </p>
            </div>
          </div>

          <Field label="Réception active">
            <label class="flex h-9 cursor-pointer items-center gap-2 text-sm text-ink">
              <input type="checkbox" bind:checked={inboundActive} class="accent-accent" />
              Activer la collecte des courriels entrants
            </label>
          </Field>
        </div>
      </Card>

      <!-- Test IMAP panel -->
      <Card>
        <h2 class="mb-4 text-sm font-bold text-ink">Tester la réception</h2>
        <p class="mb-4 text-sm text-ink-muted">
          Vérifie la connexion IMAP et déclenche un relevé immédiat.
        </p>
        <div class="flex flex-col gap-3">
          <Button onclick={testInbound} disabled={testInboundRunning || !isImapConfigured}>
            {testInboundRunning ? 'Test en cours…' : 'Tester la réception'}
          </Button>
          {#if !isImapConfigured}
            <p class="text-xs text-ink-muted">
              Configurez et sauvegardez les paramètres IMAP avant d'effectuer un test.
            </p>
          {/if}
          {#if testInboundResult !== null}
            <div
              class={`rounded-md border px-3 py-2 text-xs ${testInboundResult.ok ? 'border-ok bg-ok-soft/20 text-ok' : 'border-danger bg-danger-soft/20 text-danger'}`}
            >
              {testInboundResult.ok
                ? 'Connexion réussie ✓'
                : (testInboundResult.error ?? 'Échec de la connexion')}
            </div>
          {/if}
          <div class="border-t border-edge-soft pt-3 text-xs text-ink-muted">
            <div class="flex items-center justify-between">
              <span>Dernier relevé</span>
              <span class="font-mono">{formatPollAt(config?.lastPollAt ?? null)}</span>
            </div>
            {#if config?.lastPollAt}
              <div class="mt-1 flex items-center justify-between">
                <span>Statut</span>
                <Badge tone={config.lastPollOk ? 'ok' : 'danger'}>
                  {config.lastPollOk ? 'OK' : 'Erreur'}
                </Badge>
              </div>
            {/if}
          </div>
        </div>
      </Card>
    </div>

    <!-- Global save button -->
    <div class="flex justify-end">
      <Button onclick={save} disabled={saving}>
        {saving ? 'Sauvegarde…' : 'Sauvegarder'}
      </Button>
    </div>
  </div>
{/if}
