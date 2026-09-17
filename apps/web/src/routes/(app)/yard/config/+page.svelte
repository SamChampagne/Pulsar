<script lang="ts">
  import { PageHeader, Card, Button } from '$lib/components/ui';
  import ModuleSettings from '$lib/components/settings/ModuleSettings.svelte';
  import CustomFieldsEditor from '$lib/components/settings/CustomFieldsEditor.svelte';
  import { api, ApiError } from '$lib/api/client';
  import { toast } from '$lib/stores/toast';
  import { confirmAction } from '$lib/stores/confirmation';
  import { formatDateTime } from '$lib/format';

  interface IcalStatus {
    hasToken: boolean;
    rotatedAt?: string;
  }

  let hasToken = $state(false);
  let rotatedAt = $state<string | null>(null);
  let loadingStatus = $state(true);
  let icalUrl = $state('');
  let icalError = $state('');
  let generatingIcal = $state(false);

  async function loadStatus() {
    loadingStatus = true;
    try {
      const res = await api<IcalStatus>('/yard/ical-token');
      hasToken = res.hasToken;
      rotatedAt = res.rotatedAt ?? null;
    } catch {
      // Best-effort — the generator button still works without the reload-safe hint.
    } finally {
      loadingStatus = false;
    }
  }

  async function generateIcalToken() {
    if (hasToken) {
      const ok = await confirmAction(
        "Régénérer le lien iCal ? Les abonnements de calendrier utilisant l'ancien lien cesseront de fonctionner immédiatement.",
      );
      if (!ok) return;
    }
    icalError = '';
    generatingIcal = true;
    try {
      const res = await api<{ token: string; url: string }>('/yard/ical-token', { method: 'POST' });
      icalUrl = res.url;
      hasToken = true;
      rotatedAt = new Date().toISOString();
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

  $effect(() => {
    void loadStatus();
  });
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
    {#if hasToken && !icalUrl}
      <p class="mb-3 text-xs text-ink-muted">
        Un lien actif existe déjà{#if rotatedAt}
          (généré le {formatDateTime(rotatedAt)}){/if} — il n'est plus affichable pour des raisons de
        sécurité. Régénérez-le pour en obtenir un nouveau.
      </p>
    {/if}
    {#if icalUrl}
      <div class="mb-2 flex flex-wrap items-center gap-2">
        <code
          class="min-w-0 flex-1 break-all rounded bg-surface-muted px-2 py-1 font-mono text-xs text-ink"
        >
          {icalUrl}
        </code>
        <Button variant="secondary" onclick={copyIcalUrl}>Copier</Button>
      </div>
      <p class="mb-3 text-xs text-ink-muted">Conservez ce lien : il ne sera plus affiché.</p>
    {/if}
    <Button
      variant={hasToken ? 'secondary' : 'primary'}
      loading={generatingIcal}
      disabled={loadingStatus}
      onclick={generateIcalToken}
    >
      {hasToken ? 'Régénérer le lien iCal' : 'Générer le lien iCal'}
    </Button>
  </Card>
</div>

<div class="mt-6">
  <CustomFieldsEditor module="yard" />
</div>
