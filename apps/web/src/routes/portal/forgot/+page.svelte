<script lang="ts">
  import PublicShell from '$lib/components/PublicShell.svelte';
  import { Button, Field, Input } from '$lib/components/ui';
  import { portalApi } from '$lib/portal/api';

  let email = $state('');
  let tenant = $state('');
  let sent = $state(false);
  let loading = $state(false);

  // The answer never reveals whether the account exists (the API always replies
  // `{ ok: true }`), so a transport failure shows the same neutral notice.
  async function submit(event: SubmitEvent) {
    event.preventDefault();
    loading = true;
    try {
      await portalApi('/portal/auth/forgot-password', {
        method: 'POST',
        body: { email: email.trim(), ...(tenant.trim() ? { tenant: tenant.trim() } : {}) },
      });
    } catch {
      // Ignored on purpose: the notice below must not become an oracle.
    } finally {
      loading = false;
      sent = true;
    }
  }
</script>

<PublicShell
  title="Mot de passe oublié"
  subtitle="Nous vous enverrons un lien de réinitialisation."
>
  {#if sent}
    <p class="text-sm text-ink">Si un compte existe, un courriel a été envoyé.</p>
    <p class="mt-4 text-center">
      <a href="/portal/login" class="text-xs text-accent hover:underline">Retour à la connexion</a>
    </p>
  {:else}
    <form onsubmit={submit} class="flex flex-col gap-4">
      <Field label="Courriel">
        <Input type="email" bind:value={email} required name="email" aria-label="Courriel" />
      </Field>
      <Field label="Entreprise (identifiant, optionnel)">
        <Input
          bind:value={tenant}
          name="tenant"
          placeholder="acme"
          aria-label="Entreprise (identifiant, optionnel)"
        />
      </Field>
      <Button type="submit" {loading} disabled={loading}>
        {loading ? 'Envoi…' : 'Envoyer le lien'}
      </Button>
      <p class="text-center">
        <a href="/portal/login" class="text-xs text-ink-muted hover:text-ink"
          >Retour à la connexion</a
        >
      </p>
    </form>
  {/if}
</PublicShell>
