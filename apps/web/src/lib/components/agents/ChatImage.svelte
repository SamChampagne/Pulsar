<script lang="ts">
  import { onMount } from 'svelte';
  import { getAccessToken } from '$lib/stores/auth';
  let {
    image,
    conversationId,
  }: { image: { id?: string; fileName: string; preview?: string }; conversationId: string | null } =
    $props();
  let url = $state('');
  let failed = $state(false);
  let expanded = $state(false);
  let host: HTMLDivElement;
  onMount(() => {
    const controller = new AbortController();
    let objectUrl = '';
    let started = false;
    const load = async () => {
      if (started || image.preview || !image.id || !conversationId) return;
      started = true;
      try {
        const token = getAccessToken();
        const res = await fetch(
          `/api/v1/agent-conversations/${conversationId}/images/${image.id}`,
          {
            headers: { Authorization: `Bearer ${token}` },
            signal: controller.signal,
            cache: 'no-store',
          },
        );
        if (!res.ok) throw new Error('Image inaccessible');
        const blob = await res.blob();
        if (controller.signal.aborted) return;
        objectUrl = URL.createObjectURL(blob);
        url = objectUrl;
      } catch {
        if (!controller.signal.aborted) failed = true;
      }
    };
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        observer.disconnect();
        void load();
      }
    });
    observer.observe(host);
    return () => {
      observer.disconnect();
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  });
</script>

<div bind:this={host} class="max-w-full">
  {#if image.preview || url}
    <button
      type="button"
      class="max-w-full rounded-lg focus-visible:outline-2 focus-visible:outline-accent"
      aria-label={`Agrandir ou réduire ${image.fileName}`}
      aria-expanded={expanded}
      onclick={() => (expanded = !expanded)}
    >
      <img
        src={image.preview || url}
        alt={image.fileName}
        class={expanded
          ? 'max-h-96 max-w-full rounded-lg object-contain'
          : 'h-24 max-w-40 rounded-lg border border-edge object-contain'}
        loading="lazy"
      />
    </button>
  {:else}<p class="rounded-lg border border-edge p-3 text-xs text-ink-muted">
      {failed ? 'Image indisponible' : 'Image jointe'} · {image.fileName}
    </p>{/if}
</div>
