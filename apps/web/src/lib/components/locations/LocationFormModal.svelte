<script lang="ts">
  import { api, ApiError } from '$lib/api/client';
  import { toast } from '$lib/stores/toast';
  import { Field, Input, Select, ReferenceSelect, Button, Modal } from '$lib/components/ui';
  import { COUNTRIES, regionsFor } from '@pulsar/shared';
  import type { LocationRecord } from './types';

  const COUNTRY_OPTIONS = COUNTRIES.map((c) => ({ value: c.code, label: c.name }));

  /** `Intl.supportedValuesOf` is missing on some older engines; the field
   *  falls back to a plain text input (no datalist) rather than throwing. */
  const TIMEZONES: string[] = (() => {
    try {
      return typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [];
    } catch {
      return [];
    }
  })();

  const LOCATION_TYPES = [
    'PLANT',
    'WAREHOUSE',
    'DISTRIBUTION_CENTER',
    'CUSTOMER_SITE',
    'CARRIER_TERMINAL',
    'OTHER',
  ];

  function typeLabel(t: string): string {
    return t
      .replaceAll('_', ' ')
      .toLowerCase()
      .replace(/^./, (c) => c.toUpperCase());
  }

  let {
    open = $bindable(false),
    location = null as LocationRecord | null,
    lockedType = null as string | null,
    defaultType = 'WAREHOUSE',
    oncreated = (_loc: LocationRecord) => {},
    onupdated = (_loc: LocationRecord) => {},
  } = $props();

  let saving = $state(false);
  let error = $state('');
  let form = $state(blankForm());

  function blankForm() {
    return {
      code: '',
      name: '',
      type: lockedType ?? defaultType,
      addressLine1: '',
      addressLine2: '',
      city: '',
      state: '',
      postalCode: '',
      country: '',
      latitude: '',
      longitude: '',
      timezone: '',
      isActive: true,
    };
  }

  function formFromLocation(loc: LocationRecord) {
    return {
      code: loc.code,
      name: loc.name,
      type: loc.type,
      addressLine1: loc.addressLine1,
      addressLine2: loc.addressLine2 ?? '',
      city: loc.city,
      state: loc.state ?? '',
      postalCode: loc.postalCode ?? '',
      country: loc.country ?? '',
      latitude: loc.latitude != null ? String(loc.latitude) : '',
      longitude: loc.longitude != null ? String(loc.longitude) : '',
      timezone: loc.timezone ?? '',
      isActive: loc.isActive,
    };
  }

  // Reset the form whenever the modal is (re)opened, either for creation or edition.
  $effect(() => {
    if (open) {
      form = location ? formFromLocation(location) : blankForm();
      error = '';
    }
  });

  /** Province/state options for the currently selected country; empty when
   *  the country has no closed vocabulary (falls back to free text below). */
  const regions = $derived(regionsFor(form.country).map((r) => ({ value: r.code, label: r.name })));

  function onCountryChange() {
    form.state = '';
  }

  async function save(event: SubmitEvent) {
    event.preventDefault();
    error = '';
    saving = true;
    const body = {
      code: form.code,
      name: form.name,
      type: lockedType ?? form.type,
      addressLine1: form.addressLine1,
      addressLine2: form.addressLine2 || undefined,
      city: form.city,
      state: form.state || undefined,
      postalCode: form.postalCode || undefined,
      country: form.country || undefined,
      latitude: String(form.latitude ?? '').trim() !== '' ? Number(form.latitude) : undefined,
      longitude: String(form.longitude ?? '').trim() !== '' ? Number(form.longitude) : undefined,
      timezone: form.timezone || undefined,
      ...(location ? { isActive: form.isActive } : {}),
    };
    try {
      let result: LocationRecord;
      if (location) {
        result = await api<LocationRecord>(`/locations/${location.id}`, {
          method: 'PATCH',
          body,
        });
        toast.success('Lieu mis à jour');
        onupdated(result);
      } else {
        result = await api<LocationRecord>('/locations', { method: 'POST', body });
        toast.success('Lieu créé');
        oncreated(result);
      }
      open = false;
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : 'Échec de l’enregistrement';
      error = msg;
      toast.error(msg);
    } finally {
      saving = false;
    }
  }
</script>

<Modal bind:open title={location ? `Éditer ${location.code}` : 'Nouveau lieu'} size="md">
  {#snippet children()}
    <form onsubmit={save} class="space-y-3">
      {#if error}<p class="text-sm text-danger">{error}</p>{/if}
      <div class="grid grid-cols-2 gap-3">
        <Field label="Code"><Input bind:value={form.code} required placeholder="WH-MTL" /></Field>
        <Field label="Type">
          <Select bind:value={form.type} disabled={!!lockedType}>
            {#each LOCATION_TYPES as t (t)}<option value={t}>{typeLabel(t)}</option>{/each}
          </Select>
        </Field>
      </div>
      <Field label="Nom"><Input bind:value={form.name} required /></Field>
      <Field label="Adresse"
        ><Input bind:value={form.addressLine1} required placeholder="1234 rue Principale" /></Field
      >
      <Field label="Complément d’adresse"
        ><Input bind:value={form.addressLine2} placeholder="Suite, dock…" /></Field
      >
      <div class="grid grid-cols-2 gap-3">
        <Field label="Ville"><Input bind:value={form.city} required /></Field>
        <Field label="Province / État">
          {#if regions.length}
            <ReferenceSelect options={regions} bind:value={form.state} clearable />
          {:else}
            <Input bind:value={form.state} placeholder="QC" />
          {/if}
        </Field>
      </div>
      <div class="grid grid-cols-2 gap-3">
        <Field label="Code postal"
          ><Input bind:value={form.postalCode} placeholder="H1A 1A1" /></Field
        >
        <Field label="Pays">
          <ReferenceSelect
            options={COUNTRY_OPTIONS}
            bind:value={form.country}
            clearable
            onchange={onCountryChange}
          />
        </Field>
      </div>
      <div class="grid grid-cols-3 gap-3">
        <Field label="Latitude"
          ><Input
            bind:value={form.latitude}
            type="number"
            step="any"
            placeholder="45.5017"
          /></Field
        >
        <Field label="Longitude"
          ><Input
            bind:value={form.longitude}
            type="number"
            step="any"
            placeholder="-73.5673"
          /></Field
        >
        <Field label="Fuseau">
          <input
            bind:value={form.timezone}
            list={TIMEZONES.length ? 'loc-tz-list' : undefined}
            placeholder="America/Toronto"
            class="min-h-9 w-full rounded-md border border-edge bg-surface px-3 py-1.5 text-sm text-ink transition-colors placeholder:text-ink-faint focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
          />
          {#if TIMEZONES.length}
            <datalist id="loc-tz-list">
              {#each TIMEZONES as tz (tz)}<option value={tz}></option>{/each}
            </datalist>
          {/if}
        </Field>
      </div>
      <p class="text-xs text-ink-faint">
        Latitude/longitude sont optionnelles : laissées vides, le serveur tente un géocodage
        automatique de l’adresse.
      </p>
      {#if location}
        <label class="flex items-center gap-2 text-sm text-ink">
          <input type="checkbox" bind:checked={form.isActive} class="rounded border-edge" /> Lieu actif
        </label>
      {/if}
      <div class="flex justify-end gap-2 border-t border-edge pt-3">
        <Button
          variant="secondary"
          onclick={() => {
            open = false;
          }}>Annuler</Button
        >
        <Button variant="primary" type="submit" loading={saving}
          >{location ? 'Enregistrer' : 'Créer'}</Button
        >
      </div>
    </form>
  {/snippet}
</Modal>
