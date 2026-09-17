<script lang="ts">
  import PublicShell from '$lib/components/PublicShell.svelte';
  import { Button, Field, Input } from '$lib/components/ui';
  import { portalApi, PortalApiError } from '$lib/portal/api';

  /**
   * Consumes a one-shot portal link (`INVITATION` or `PASSWORD_RESET`) — both
   * hit the same `POST /portal/auth/reset-password`, only the wording differs.
   * Not a route file (no `+` prefix): SvelteKit ignores it when mapping routes.
   */
  let {
    token,
    title,
    subtitle,
    successMessage,
    submitLabel,
  }: {
    token: string;
    title: string;
    subtitle: string;
    successMessage: string;
    submitLabel: string;
  } = $props();

  let password = $state('');
  let confirm = $state('');
  let error = $state('');
  let loading = $state(false);
  let done = $state(false);

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    error = '';
    if (password.length < 8) {
      error = 'Le mot de passe doit contenir au moins 8 caractères.';
      return;
    }
    if (password !== confirm) {
      error = 'Les deux mots de passe ne correspondent pas.';
      return;
    }
    loading = true;
    try {
      await portalApi('/portal/auth/reset-password', {
        method: 'POST',
        body: { token, password },
      });
      done = true;
    } catch (e) {
      if (!(e instanceof PortalApiError)) {
        error = 'Service indisponible, réessayez dans un instant.';
      } else if (e.statusCode === 401) {
        error = 'Lien invalide ou expiré.';
      } else if (e.statusCode === 400 && /disabled/i.test(e.message)) {
        error = 'Compte désactivé — contactez votre administrateur.';
      } else {
        error = e.message;
      }
    } finally {
      loading = false;
    }
  }
</script>

<PublicShell {title} subtitle={done ? '' : subtitle}>
  {#if done}
    <p class="text-sm text-ok">{successMessage}</p>
    <p class="mt-4 text-center">
      <a href="/portal/login" class="text-sm text-accent hover:underline">Se connecter</a>
    </p>
  {:else}
    <form onsubmit={submit} class="flex flex-col gap-4">
      <Field label="Mot de passe (8 caractères minimum)">
        <Input
          type="password"
          bind:value={password}
          required
          minlength={8}
          name="password"
          aria-label="Mot de passe"
        />
      </Field>
      <Field label="Confirmer le mot de passe">
        <Input
          type="password"
          bind:value={confirm}
          required
          name="confirm"
          aria-label="Confirmer le mot de passe"
        />
      </Field>
      {#if error}
        <p class="text-sm text-danger" role="alert">{error}</p>
      {/if}
      <Button type="submit" {loading} disabled={loading}>
        {loading ? 'Enregistrement…' : submitLabel}
      </Button>
      <p class="text-center">
        <a href="/portal/login" class="text-xs text-ink-muted hover:text-ink"
          >Retour à la connexion</a
        >
      </p>
    </form>
  {/if}
</PublicShell>
