<script lang="ts">
  export interface Address {
    line1: string;
    line2?: string;
    city: string;
    region?: string;
    postalCode?: string;
    countryCode: string;
  }
  let {
    value = $bindable(null),
    label,
    disabled = false,
  }: { value: Address | null; label: string; disabled?: boolean } = $props();
</script>

<fieldset class="rounded-lg border border-edge p-3" {disabled}>
  <legend class="px-1 text-sm font-medium">{label}</legend>
  <label class="mb-3 flex items-center gap-2 text-sm"
    ><input
      type="checkbox"
      checked={!!value}
      onchange={(e) => {
        value = e.currentTarget.checked ? { line1: '', city: '', countryCode: 'CA' } : null;
      }}
    />Renseigner cette adresse</label
  >
  {#if value}<div class="grid gap-3 sm:grid-cols-2">
      <label class="grid gap-1 text-xs sm:col-span-2"
        >Rue et numéro<input
          class="rounded-md border border-edge bg-surface px-3 py-2 text-sm"
          required
          maxlength="200"
          bind:value={value.line1}
          autocomplete="street-address"
        /></label
      >
      <label class="grid gap-1 text-xs sm:col-span-2"
        >Complément<input
          class="rounded-md border border-edge bg-surface px-3 py-2 text-sm"
          maxlength="200"
          bind:value={value.line2}
        /></label
      >
      <label class="grid gap-1 text-xs"
        >Ville<input
          class="rounded-md border border-edge bg-surface px-3 py-2 text-sm"
          required
          maxlength="100"
          bind:value={value.city}
        /></label
      >
      <label class="grid gap-1 text-xs"
        >Province / État / Région<input
          class="rounded-md border border-edge bg-surface px-3 py-2 text-sm"
          maxlength="100"
          bind:value={value.region}
        /></label
      >
      <label class="grid gap-1 text-xs"
        >Pays (code ISO)<input
          class="rounded-md border border-edge bg-surface px-3 py-2 text-sm uppercase"
          required
          maxlength="2"
          pattern={'[A-Z]{2}'}
          value={value.countryCode}
          oninput={(e) => {
            if (value) value.countryCode = e.currentTarget.value.toUpperCase();
          }}
          list="address-countries"
        /></label
      >
      <label class="grid gap-1 text-xs"
        >Code postal<input
          class="rounded-md border border-edge bg-surface px-3 py-2 text-sm"
          maxlength={value.countryCode === 'CA' ? 7 : value.countryCode === 'US' ? 10 : 20}
          required={['CA', 'US'].includes(value.countryCode)}
          bind:value={value.postalCode}
        /></label
      >
    </div>{/if}
</fieldset>
