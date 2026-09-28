<script lang="ts">
  import { catalogDetailFields, type CatalogDetails } from '@pulsar/shared';
  import { api, ApiError } from '$lib/api/client';
  import { auth } from '$lib/stores/auth';
  import { Button, Modal, Field, Input, Textarea, Skeleton } from '$lib/components/ui';
  import SupplierOffers from './SupplierOffers.svelte';
  import CatalogPackages from './CatalogPackages.svelte';
  let { endpoint, name }: { endpoint: string; name: string } = $props();
  const module = $derived(endpoint.split('/')[1]);
  const manage = $derived(
    ($auth?.user.permissions as string[] | undefined)?.includes(`${module}.manage`) ?? false,
  );
  let open = $state(false),
    tab = $state('details'),
    loading = $state(false),
    busy = $state(false),
    error = $state(''),
    uncertain = $state(false);
  let version = $state(0),
    unit = $state(''),
    kind = $state(''),
    data = $state<CatalogDetails>({});
  const fields = $derived(catalogDetailFields(kind));
  const sections = $derived([...new Set(fields.map((f) => f.section))]);
  async function load() {
    loading = true;
    error = '';
    uncertain = false;
    try {
      const r = await api<{
        item: { unit: string; kind: string };
        version: number;
        data: CatalogDetails;
      }>(`${endpoint}/details`);
      data = r.data;
      version = r.version;
      unit = r.item.unit;
      kind = r.item.kind;
    } catch (e) {
      error = e instanceof Error ? e.message : 'Lecture impossible.';
      uncertain = true;
    } finally {
      loading = false;
    }
  }
  async function save() {
    if (busy || uncertain) return;
    busy = true;
    error = '';
    try {
      const r = await api<{ version: number; data: CatalogDetails }>(`${endpoint}/details`, {
        method: 'PUT',
        body: { expectedVersion: version, data },
      });
      data = r.data;
      version = r.version;
    } catch (e) {
      error = e instanceof Error ? e.message : 'Enregistrement impossible.';
      uncertain = !(e instanceof ApiError) || e.statusCode >= 500 || e.statusCode === 409;
    } finally {
      busy = false;
    }
  }
</script>

<Button
  variant="ghost"
  aria-label={`Fiche article ${name}`}
  onclick={() => {
    open = true;
    tab = 'details';
    void load();
  }}>Fiche article</Button
>
<Modal bind:open title={`Fiche article — ${name}`} size="xl" dismissible={!busy}>
  <div class="space-y-5">
    <div class="flex flex-wrap gap-2" aria-label="Sections de la fiche article">
      <Button
        variant={tab === 'details' ? 'primary' : 'secondary'}
        disabled={busy}
        onclick={() => {
          tab = 'details';
        }}>Informations techniques</Button
      >
      {#if kind === 'GOODS'}<Button
          variant={tab === 'packages' ? 'primary' : 'secondary'}
          disabled={busy}
          onclick={() => {
            tab = 'packages';
          }}>Conditionnements</Button
        >{/if}
      {#if module !== 'services'}<Button
          variant={tab === 'offers' ? 'primary' : 'secondary'}
          disabled={busy}
          onclick={() => {
            tab = 'offers';
          }}>Références fournisseurs</Button
        >{/if}
    </div>
    {#if tab === 'details'}
      <p class="text-sm text-ink-muted">
        Une fiche interne pour préparer le travail. Les dimensions décrivent une unité <strong
          >{unit}</strong
        >. Ces informations ne modifient ni le stock, ni les capacités, ni les anciens documents.
      </p>
      {#if error}<p role="alert" class="rounded-md bg-danger-soft p-3 text-sm text-danger">
          {error}
        </p>{/if}
      {#if uncertain}<p class="text-sm text-warn">
          Rechargez la fiche avant une nouvelle modification. La relecture remplacera la saisie
          locale.
        </p>
        <Button variant="secondary" onclick={load}>Recharger la fiche article</Button>{/if}
      {#if loading}<Skeleton rows={5} />{:else}
        <form
          onsubmit={(e) => {
            e.preventDefault();
            void save();
          }}
          class="space-y-5"
        >
          <fieldset disabled={!manage || busy || uncertain} class="space-y-5">
            {#each sections as section}<section class="space-y-3 border-t border-edge pt-4">
                <h3 class="text-sm font-semibold">{section}</h3>
                <div class="grid gap-3 sm:grid-cols-2">
                  {#each fields.filter((f) => f.section === section) as f}<div
                      class={f.max > 500 ? 'sm:col-span-2' : ''}
                    >
                      <Field label={f.label}>
                        {#if f.max > 500}<Textarea
                            aria-label={f.label}
                            value={data[f.key] ?? ''}
                            oninput={(e) => {
                              data[f.key] = e.currentTarget.value;
                            }}
                            maxlength={f.max}
                          />
                        {:else}<Input
                            aria-label={f.label}
                            inputmode={'decimal' in f ? 'decimal' : 'text'}
                            value={data[f.key] ?? ''}
                            oninput={(e) => {
                              data[f.key] = e.currentTarget.value;
                            }}
                            maxlength={f.max}
                          />{/if}
                      </Field>
                    </div>{/each}
                </div>
              </section>{/each}
          </fieldset>
          <div class="flex flex-wrap items-center justify-between gap-3 border-t border-edge pt-4">
            <span class="text-xs text-ink-muted"
              >Version {version} · {manage ? 'Informations facultatives' : 'Lecture seule'}</span
            >{#if manage}<Button type="submit" loading={busy} disabled={uncertain}
                >Enregistrer la fiche article</Button
              >{/if}
          </div>
        </form>
      {/if}
    {:else if tab === 'packages'}<CatalogPackages
        {endpoint}
        {manage}
        bind:busy
      />{:else}<SupplierOffers {endpoint} {manage} bind:busy />{/if}
  </div>
</Modal>
