<script lang="ts">
  import { PageHeader, Card, Button } from '$lib/components/ui';
  import ModuleSettings from '$lib/components/settings/ModuleSettings.svelte';
  import CustomFieldsEditor from '$lib/components/settings/CustomFieldsEditor.svelte';
  import { api, ApiError } from '$lib/api/client';
  import { toast } from '$lib/stores/toast';
  import { confirmAction } from '$lib/stores/confirmation';

  let icalUrl = $state('');
  let icalError = $state('');
  let generatingIcal = $state(false);

  async function generateIcalToken() {
    if (icalUrl) {
      const ok = await confirmAction(
        "Régénérer le lien iCal ? L'ancien lien cessera de fonctionner immédiatement.",
      );
      if (!ok) return;
    }
    icalError = '';
    generatingIcal = true;
    try {
      const res = await api<{ token: string; url: string }>('/yard/ical-token', { method: 'POST' });
      icalUrl = res.url;
      toast.success('Lien iCal généré');
    } catch (e) {
      icalError = e instanceof ApiError ? e.message : 'Échec de la génération du lien iCal';
      toast.error(icalError);
    } finally {
      generatingIcal = false;
    }
  }

  async function copyIcalUrl() {
    await navigator.clipboard.writeText(icalUrl);
    toast.success('Lien copié');
  }
</script>

<PageHeader
  title="Configuration"
  eyebrow="Cour et quais"
  subtitle="Réglages du module et personnalisation des données."
/>
<ModuleSettings module="yard" />

<div class="mt-6">
  <Card>
    <h2 class="mb-1 text-sm font-semibold text-ink">Flux iCal — rendez-vous de quai</h2>
    <p class="mb-3 text-sm text-ink-muted">
      Abonnez un calendrier externe (Outlook, Google Calendar…) aux rendez-vous de quai des 90
      prochains jours. Régénérer le lien invalide immédiatement l'ancien.
    </p>
    {#if icalError}<p class="mb-2 text-sm text-danger">{icalError}</p>{/if}
    {#if icalUrl}
      <div class="mb-3 flex flex-wrap items-center gap-2">
        <code
          class="min-w-0 flex-1 break-all rounded bg-surface-muted px-2 py-1 font-mono text-xs text-ink"
        >
          {icalUrl}
        </code>
        <Button variant="secondary" onclick={copyIcalUrl}>Copier</Button>
      </div>
    {/if}
    <Button
      variant={icalUrl ? 'secondary' : 'primary'}
      loading={generatingIcal}
      onclick={generateIcalToken}
    >
      {icalUrl ? 'Régénérer le lien' : 'Générer le lien iCal'}
    </Button>
  </Card>
</div>

<div class="mt-6">
  <CustomFieldsEditor module="yard" />
</div>
