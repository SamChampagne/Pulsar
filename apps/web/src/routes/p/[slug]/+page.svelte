<script lang="ts">
  import { page } from '$app/state';
  import { api, ApiError } from '$lib/api/client';
  import PublicShell from '$lib/components/PublicShell.svelte';

  interface Block {
    type: 'heading' | 'text' | 'image' | 'form';
    text?: string;
    url?: string;
    fields?: string[];
  }

  interface SitePage {
    title: string;
    blocks: Block[];
  }

  const slug = $derived(page.params.slug);

  let site = $state<SitePage | null>(null);
  let notFound = $state(false);
  let error = $state('');

  // Form state
  let fieldValues = $state<Record<string, string>>({});
  let hp = $state('');
  let submitting = $state(false);
  let submitted = $state(false);
  let submitError = $state('');

  $effect(() => {
    if (!slug) return;
    site = null;
    notFound = false;
    error = '';
    submitted = false;
    fieldValues = {};

    api<SitePage>(`/public/sites/${slug}`)
      .then((s) => {
        site = s;
        // Initialize field values for form blocks
        for (const block of s.blocks) {
          if (block.type === 'form' && block.fields) {
            for (const f of block.fields) {
              fieldValues[f] = '';
            }
          }
        }
      })
      .catch((e) => {
        if (e instanceof ApiError && e.statusCode === 404) {
          notFound = true;
        } else {
          error = e instanceof ApiError ? e.message : 'Erreur lors du chargement de la page.';
        }
      });
  });

  async function handleSubmit() {
    submitting = true;
    submitError = '';
    try {
      await api(`/public/sites/${slug}/submit`, {
        method: 'POST',
        body: { ...fieldValues, _hp: hp },
      });
      submitted = true;
    } catch (e) {
      submitError = e instanceof ApiError ? e.message : 'Une erreur est survenue. Veuillez réessayer.';
    } finally {
      submitting = false;
    }
  }

  function labelForField(field: string): string {
    const labels: Record<string, string> = {
      name: 'Nom',
      email: 'Courriel',
      company: 'Entreprise',
      phone: 'Téléphone',
      message: 'Message',
    };
    return labels[field] ?? field.charAt(0).toUpperCase() + field.slice(1);
  }

  function inputTypeForField(field: string): string {
    if (field === 'email') return 'email';
    if (field === 'phone') return 'tel';
    return 'text';
  }
</script>

<PublicShell maxWidth="max-w-xl">
  {#if notFound}
    <div class="py-8 text-center">
      <p class="text-2xl font-bold text-ink mb-2">404</p>
      <p class="text-ink-muted">Page introuvable.</p>
    </div>
  {:else if error}
    <p class="text-sm text-danger">{error}</p>
  {:else if site}
    {#each site.blocks as block, i (i)}
      {#if block.type === 'heading'}
        <h1 class="text-2xl font-bold text-ink mb-4">{block.text}</h1>
      {:else if block.type === 'text'}
        <p class="text-ink mb-4 leading-relaxed">{block.text}</p>
      {:else if block.type === 'image'}
        <div class="mb-4">
          <img src={block.url} alt="" class="max-w-full rounded-card" />
        </div>
      {:else if block.type === 'form' && block.fields}
        {#if submitted}
          <div class="rounded-card border border-ok-soft bg-ok-soft px-4 py-4 text-sm text-ok text-center">
            Merci, nous vous recontacterons.
          </div>
        {:else}
          <form onsubmit={(e) => { e.preventDefault(); void handleSubmit(); }} class="flex flex-col gap-4">
            <!-- Honeypot — hidden from real users -->
            <input
              type="text"
              name="_hp"
              bind:value={hp}
              tabindex="-1"
              autocomplete="off"
              style="position:absolute;left:-9999px;width:1px;height:1px;opacity:0;"
              aria-hidden="true"
            />

            {#each block.fields as field (field)}
              <div class="flex flex-col gap-1">
                <label for={`field-${field}`} class="text-sm font-medium text-ink">
                  {labelForField(field)}
                </label>
                <input
                  id={`field-${field}`}
                  type={inputTypeForField(field)}
                  bind:value={fieldValues[field]}
                  class="rounded-card border border-edge bg-canvas px-3 py-2 text-sm text-ink placeholder-ink-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                  placeholder={labelForField(field)}
                />
              </div>
            {/each}

            {#if submitError}
              <p class="text-sm text-danger">{submitError}</p>
            {/if}

            <button
              type="submit"
              disabled={submitting}
              class="mt-1 rounded-card bg-accent px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
            >
              {submitting ? 'Envoi…' : 'Envoyer'}
            </button>
          </form>
        {/if}
      {/if}
    {/each}

    <p class="mt-6 text-center text-xs text-ink-faint">Propulsé par Pulsar</p>
  {:else}
    <p class="text-sm text-ink-muted">Chargement…</p>
  {/if}
</PublicShell>
