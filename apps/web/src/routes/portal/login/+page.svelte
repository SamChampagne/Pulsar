<script lang="ts">
  import { goto } from '$app/navigation';
  import type { PortalLoginResponse } from '@pulsar/shared';
  import PublicShell from '$lib/components/PublicShell.svelte';
  import { Button, Field, Input } from '$lib/components/ui';
  import { portalApi, PortalApiError } from '$lib/portal/api';
  import { startPortalSession } from '$lib/portal/session';

  let email = $state('');
  let password = $state('');
  let tenant = $state('');
  // The company slug is normally implicit: it is only asked for when the same
  // address is a portal account in several tenants (the API says so with a 400
  // "tenant required"), or when the visitor opens the field themselves.
  let showTenant = $state(false);
  let error = $state('');
  let loading = $state(false);

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    error = '';
    loading = true;
    try {
      const session = await portalApi<PortalLoginResponse>('/portal/auth/login', {
        method: 'POST',
        body: {
          email: email.trim(),
          password,
          ...(tenant.trim() ? { tenant: tenant.trim() } : {}),
        },
      });
      startPortalSession(session);
      await goto('/portal/orders');
    } catch (e) {
      if (!(e instanceof PortalApiError)) {
        error = 'Service indisponible, réessayez dans un instant.';
      } else if (e.statusCode === 400 && /tenant required/i.test(e.message)) {
        showTenant = true;
        error = 'Ce courriel existe chez plusieurs entreprises — précisez laquelle.';
      } else if (e.statusCode === 401) {
        error = 'Courriel ou mot de passe invalide.';
      } else {
        error = e.message;
      }
    } finally {
      loading = false;
    }
  }
</script>

<PublicShell title="Portail client" subtitle="Connectez-vous pour suivre vos commandes.">
  <form onsubmit={submit} class="flex flex-col gap-4">
    <Field label="Courriel">
      <Input type="email" bind:value={email} required name="email" aria-label="Courriel" />
    </Field>
    <Field label="Mot de passe">
      <Input
        type="password"
        bind:value={password}
        required
        name="password"
        aria-label="Mot de passe"
      />
    </Field>

    {#if showTenant}
      <Field label="Entreprise (identifiant)">
        <Input
          bind:value={tenant}
          name="tenant"
          placeholder="acme"
          aria-label="Entreprise (identifiant)"
        />
      </Field>
    {:else}
      <button
        type="button"
        class="self-start text-xs text-ink-muted hover:text-ink"
        onclick={() => (showTenant = true)}
      >
        Préciser l’entreprise
      </button>
    {/if}

    {#if error}
      <p class="text-sm text-danger" role="alert">{error}</p>
    {/if}

    <Button type="submit" {loading} disabled={loading}>
      {loading ? 'Connexion…' : 'Se connecter'}
    </Button>

    <p class="text-center">
      <a href="/portal/forgot" class="text-xs text-ink-muted hover:text-ink"
        >Mot de passe oublié ?</a
      >
    </p>
  </form>
</PublicShell>
