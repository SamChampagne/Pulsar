<script lang="ts">
  import { api } from '$lib/api/client';
  import type { Paginated } from '@pulsar/shared';
  import { auth } from '$lib/stores/auth';
  let {
    value = $bindable(''),
    country = '',
    onselect = undefined,
  }: {
    value?: string;
    country?: string;
    onselect?: (city: { city: string; state: string | null; country: string }) => void;
  } = $props();
  type City = { city: string; state: string | null; country: string };
  const uid = $props.id();
  let suggestions = $state<City[]>([]);
  let unavailable = $state(false);
  $effect(() => {
    const query = value.trim();
    const selectedCountry = country;
    if (!query || !$auth?.user.permissions.includes('core.locations.read')) {
      suggestions = [];
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const res = await api<Paginated<City>>('/locations', {
          query: { search: query, pageSize: 50 },
        });
        if (cancelled) return;
        suggestions = [
          ...new Map(
            res.items
              .filter(
                (c) =>
                  (!selectedCountry || c.country === selectedCountry) &&
                  c.city.toLocaleLowerCase().startsWith(query.toLocaleLowerCase()),
              )
              .map((c) => [c.city, c]),
          ).values(),
        ];
        unavailable = false;
      } catch {
        if (!cancelled) {
          suggestions = [];
          unavailable = true;
        }
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  });
</script>

<input
  bind:value
  aria-label="Ville"
  aria-describedby={`${uid}-hint`}
  required
  maxlength="120"
  list={uid}
  autocomplete="address-level2"
  onchange={() => {
    const city = suggestions.find((c) => c.city === value);
    if (city) onselect?.(city);
  }}
  class="min-h-9 w-full rounded-md border border-edge bg-surface px-3 py-1.5 text-sm text-ink focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
/>
<datalist id={uid}
  >{#each suggestions as city}<option value={city.city}>{city.state}, {city.country}</option
    >{/each}</datalist
>
<span id={`${uid}-hint`} class="mt-1 block text-xs text-ink-faint"
  >{unavailable
    ? 'Suggestions indisponibles. La saisie manuelle reste possible.'
    : 'Suggestions parmi les villes déjà utilisées dans votre entreprise.'}</span
>
