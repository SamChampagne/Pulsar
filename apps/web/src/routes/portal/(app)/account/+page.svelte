<script lang="ts">
  import { PortalUserRole } from '@pulsar/shared';
  import { Button, Card, PageHeader } from '$lib/components/ui';
  import { portalApi } from '$lib/portal/api';
  import { portalSession } from '$lib/portal/session';

  let sending = $state(false);
  let sent = $state(false);

  // Reuses the exact public forgot-password call (`routes/portal/forgot`'s
  // `/portal/auth/forgot-password`), just with the signed-in email already
  // known — no tenant slug travels in the session, but `tenant` is optional
  // server-side. Like the public page, the API never reveals whether the
  // account exists, so a transport failure still shows the same neutral
  // confirmation rather than becoming an oracle.
  async function resetPassword() {
    const email = $portalSession?.user.email;
    if (!email) return;
    sending = true;
    try {
      await portalApi('/portal/auth/forgot-password', { method: 'POST', body: { email } });
    } catch {
      // Ignored on purpose — see the comment above.
    } finally {
      sending = false;
      sent = true;
    }
  }
</script>

<svelte:head><title>Mon compte — Portail client</title></svelte:head>

<PageHeader title="Mon compte" subtitle="Vos informations et vos accès au portail." />

{#if $portalSession}
  <Card>
    <dl class="grid gap-4 sm:grid-cols-2">
      <div>
        <dt class="text-xs text-ink-muted">Nom</dt>
        <dd class="text-sm text-ink">
          {$portalSession.user.firstName}
          {$portalSession.user.lastName}
        </dd>
      </div>
      <div>
        <dt class="text-xs text-ink-muted">Courriel</dt>
        <dd class="text-sm break-all text-ink">{$portalSession.user.email}</dd>
      </div>
      <div>
        <dt class="text-xs text-ink-muted">Rôle</dt>
        <dd class="text-sm text-ink">
          {$portalSession.user.role === PortalUserRole.ADMIN ? 'Administrateur' : 'Membre'}
        </dd>
      </div>
      <div>
        <dt class="text-xs text-ink-muted">Entreprise</dt>
        <dd class="text-sm text-ink">{$portalSession.customer.name}</dd>
      </div>
      <div>
        <dt class="text-xs text-ink-muted">Transporteur</dt>
        <dd class="text-sm text-ink">{$portalSession.shipper.name}</dd>
      </div>
    </dl>
  </Card>

  <div class="mt-4">
    <Card>
      <h2 class="mb-2 text-sm font-semibold text-ink">Mot de passe</h2>
      {#if sent}
        <p class="text-sm text-ok">
          Si un compte existe, un courriel de réinitialisation a été envoyé à {$portalSession.user
            .email}.
        </p>
      {:else}
        <p class="mb-3 text-sm text-ink-muted">
          Un lien de réinitialisation vous sera envoyé par courriel.
        </p>
        <Button variant="secondary" loading={sending} disabled={sending} onclick={resetPassword}>
          Réinitialiser mon mot de passe
        </Button>
      {/if}
    </Card>
  </div>
{:else}
  <p class="text-sm text-ink-muted">Chargement…</p>
{/if}
