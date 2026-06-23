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
  }

  // — Data —
  let config = $state<EmailConfig | null>(null);
  let loading = $state(true);
  let error = $state('');
  let saving = $state(false);

  // — Form state —
  let host = $state('');
  let port = $state(587);
  let secure = $state(false);
  let username = $state('');
  let password = $state('');
  let fromName = $state('');
  let fromEmail = $state('');
  let replyTo = $state('');

  // — Test email —
  let testTo = $state('');
  let testSending = $state(false);

  const isConfigured = $derived(!!host.trim());

  const configBadgeTone: Tone = $derived(isConfigured ? 'ok' : 'neutral');

  async function load() {
    loading = true;
    error = '';
    try {
      const result = await api<EmailConfig>('/email-config');
      config = result;
      host = result.host ?? '';
      port = result.port ?? 587;
      secure = result.secure ?? false;
      username = result.username ?? '';
      fromName = result.fromName ?? '';
      fromEmail = result.fromEmail ?? '';
      replyTo = result.replyTo ?? '';
      password = '';
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
      };
      if (password) {
        body.password = password;
      }
      await api('/email-config', { method: 'PUT', body });
      toast.success('Configuration SMTP sauvegardée');
      password = '';
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
      await api('/email-config/test', { method: 'POST', body: { to: testTo.trim() } });
      toast.success('Courriel de test envoyé');
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Erreur lors de l'envoi du test");
    } finally {
      testSending = false;
    }
  }

  $effect(() => {
    void load();
  });
</script>

<PageHeader title="Configuration SMTP" eyebrow="Courriels">
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
  <div class="grid gap-6 lg:grid-cols-[1fr_22rem]">
    <!-- SMTP form -->
    <Card>
      <h2 class="mb-4 text-sm font-bold text-ink">Paramètres SMTP</h2>
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
              {config?.hasPassword ? 'Laissez vide pour conserver le mot de passe actuel' : 'Nouveau mot de passe'}
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

        <div class="flex justify-end">
          <Button onclick={save} disabled={saving}>
            {saving ? 'Sauvegarde…' : 'Sauvegarder'}
          </Button>
        </div>
      </div>
    </Card>

    <!-- Test email panel -->
    <Card>
      <h2 class="mb-4 text-sm font-bold text-ink">Tester la configuration</h2>
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
{/if}
