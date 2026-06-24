<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { LandingBlockType } from '@pulsar/shared';

  interface LandingBlock {
    type: LandingBlockType;
    text?: string;
    url?: string;
    fields?: string[];
  }

  let {
    blocks = [],
    formBlock,
  }: {
    blocks?: LandingBlock[];
    formBlock?: Snippet<[LandingBlock, number]>;
  } = $props();

  function labelForField(field: string): string {
    const labels: Record<string, string> = {
      name: 'Nom',
      email: 'Courriel',
      company: 'Société',
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

  const firstHeadingIndex = $derived(blocks.findIndex((b) => b.type === 'heading'));
</script>

{#each blocks as block, i (i)}
  {#if block.type === 'heading'}
    {#if i === firstHeadingIndex}
      <h1 class="text-2xl font-bold text-ink mb-4">{block.text}</h1>
    {:else}
      <h2 class="text-xl font-semibold text-ink mb-4">{block.text}</h2>
    {/if}
  {:else if block.type === 'text'}
    <p class="text-ink mb-4 leading-relaxed">{block.text}</p>
  {:else if block.type === 'image' && block.url}
    <div class="mb-4">
      <img src={block.url} alt="" class="max-w-full rounded-card" />
    </div>
  {:else if block.type === 'form'}
    {#if formBlock}
      {@render formBlock(block, i)}
    {:else}
      <!-- Non-interactive disabled preview -->
      <div class="flex flex-col gap-4">
        {#each block.fields ?? [] as f (f)}
          <div class="flex flex-col gap-1">
            <label class="text-sm font-medium text-ink">{labelForField(f)}</label>
            <input
              type={inputTypeForField(f)}
              disabled
              placeholder={labelForField(f)}
              class="rounded-card border border-edge bg-canvas px-3 py-2 text-sm text-ink placeholder-ink-muted opacity-60"
            />
          </div>
        {/each}
        <button
          type="button"
          disabled
          class="mt-1 rounded-card bg-accent px-4 py-2 text-sm font-semibold text-white opacity-50"
        >
          Envoyer
        </button>
      </div>
    {/if}
  {/if}
{/each}
