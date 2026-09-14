<script lang="ts">
  import { page } from '$app/state';
  import { Button, ErrorNotice } from '$lib/components/ui';
  let done = $state(false),
    busy = $state(false),
    error = $state('');
  const token = $derived(page.url.searchParams.get('token') ?? '');
  async function unsubscribe() {
    busy = true;
    error = '';
    try {
      const response = await fetch('/api/v1/public/crm/unsubscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      if (!response.ok)
        throw new Error('Le lien est invalide ou le service est indisponible. Réessayez.');
      done = true;
    } catch (e) {
      error = (e as Error).message;
    } finally {
      busy = false;
    }
  }
</script>

<svelte:head
  ><title>Désabonnement · Pulsar</title><meta name="robots" content="noindex" /><meta
    name="referrer"
    content="no-referrer"
  /></svelte:head
>
<main class="mx-auto max-w-lg p-6 pt-20">
  <h1 class="text-2xl font-semibold text-ink">
    {done ? 'Désabonnement enregistré' : 'Arrêter les suivis par courriel'}
  </h1>
  <p class="my-4 text-sm leading-6 text-ink-muted">
    {done
      ? 'Les prochains suivis automatiques concernés sont arrêtés. Un message déjà en cours d’envoi pourrait encore vous parvenir.'
      : 'Confirmez pour retirer votre accord aux suivis automatiques associés à cette adresse.'}
  </p>
  {#if error}<ErrorNotice message={error} />{/if}{#if !done}<Button
      onclick={unsubscribe}
      loading={busy}
      disabled={!/^[A-Za-z0-9_-]{32}$/.test(token)}>Confirmer le désabonnement</Button
    >{/if}
</main>
