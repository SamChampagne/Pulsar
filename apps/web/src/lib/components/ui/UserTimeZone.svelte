<script lang="ts">
  import { isTimeZone, browserTimeZone } from '@pulsar/shared';
  import { auth } from '$lib/stores/auth';
  import { userTimeZone } from '$lib/stores/time-zone.svelte';
  import { getPreferences, putPreferences } from '$lib/api/preferences';
  import { Modal, Button, ErrorNotice } from '$lib/components/ui';
  let open = $state(false),
    zone = $state(''),
    saving = $state(false),
    error = $state('');
  const zones = [
    ...new Set([
      'UTC',
      browserTimeZone(),
      ...(typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : []),
    ]),
  ];
  $effect(() => {
    const identity = $auth?.user.id;
    let stale = false;
    userTimeZone.load(null);
    if (identity)
      void getPreferences()
        .then((p) => {
          if (!stale) userTimeZone.load(p.timeZone);
        })
        .catch(() => {
          if (!stale) error = 'Préférence non chargée : fuseau de cet appareil affiché.';
        });
    return () => {
      stale = true;
    };
  });
  async function save() {
    if (zone && !isTimeZone(zone)) {
      error = 'Choisissez un fuseau valide dans la liste.';
      return;
    }
    saving = true;
    error = '';
    const identity = $auth?.user.id;
    try {
      await putPreferences({ timeZone: zone || null });
      if (identity === $auth?.user.id) {
        userTimeZone.load(zone || null);
        open = false;
      }
    } catch (e) {
      error = (e as Error).message;
    } finally {
      saving = false;
    }
  }
</script>

<button
  type="button"
  class="min-w-0 truncate rounded-md px-2 py-1 text-xs text-ink-muted hover:bg-surface-muted"
  aria-label={`Fuseau utilisateur : ${userTimeZone.value}`}
  title={error || 'Changer mon fuseau horaire'}
  onclick={() => {
    zone = userTimeZone.preference ?? '';
    open = true;
  }}
>
  {userTimeZone.value}
  {#if !userTimeZone.preference}<span class="text-ink-faint">· appareil</span>{/if}
</button>
<Modal bind:open title="Mon fuseau horaire" size="sm">
  <p class="mb-4 text-sm text-ink-muted">
    Votre préférence suit votre compte. Les dates sans heure ne changent pas. Les plannings de site
    conservent leur fuseau métier indiqué à l’écran.
  </p>
  <p class="mb-4 text-xs text-ink-muted">
    Les anciens champs de saisie date/heure utilisent encore le fuseau de l’appareil ({browserTimeZone()}).
    Changer l’affichage ne change pas leur interprétation.
  </p>
  <label class="flex flex-col gap-2 text-sm"
    >Fuseau d’affichage
    <input
      class="rounded-lg border border-edge bg-surface px-3 py-2"
      list="user-time-zones"
      bind:value={zone}
      placeholder={`Automatique : ${browserTimeZone()}`}
      maxlength="100"
    />
  </label>
  <datalist id="user-time-zones"
    >{#each zones as z}<option value={z}></option>{/each}</datalist
  >
  <p class="mt-2 text-xs text-ink-muted">
    Effacez le champ pour suivre l’appareil. Aucun horaire enregistré ne sera déplacé.
  </p>
  <ErrorNotice message={error} />
  {#snippet footer()}<Button
      variant="secondary"
      disabled={saving}
      onclick={() => {
        open = false;
      }}>Fermer</Button
    ><Button loading={saving} onclick={save}>Enregistrer</Button>{/snippet}
</Modal>
