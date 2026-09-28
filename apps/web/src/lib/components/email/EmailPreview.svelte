<script lang="ts">
  import DOMPurify from 'dompurify';
  import { Monitor, Smartphone } from 'lucide-svelte';
  let {
    html,
    subject = '',
    from = '',
    to = '',
    replyTo = '',
  }: { html: string; subject?: string; from?: string; to?: string; replyTo?: string } = $props();
  let mobile = $state(false);
  // Opaque sandbox + CSP prevent scripts, remote tracking, forms and navigation.
  const document = $derived(
    `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src 'none'; form-action 'none'; base-uri 'none'"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:20px;font:14px/1.6 Arial,sans-serif;color:#1f2937;overflow-wrap:anywhere}img{max-width:100%;height:auto}a{pointer-events:none}table{max-width:100%}</style></head><body>${DOMPurify.sanitize(html || '<p>Votre message apparaîtra ici.</p>', { FORBID_TAGS: ['script', 'iframe', 'form', 'input', 'button', 'object', 'embed', 'link', 'meta', 'base'], FORBID_ATTR: ['srcset', 'href', 'xlink:href', 'action', 'formaction'] })}</body></html>`,
  );
</script>

<section
  class="min-w-0 overflow-hidden rounded-lg border border-edge bg-surface-muted"
  aria-label="Aperçu du courriel"
>
  <div class="flex items-center justify-between gap-2 border-b border-edge p-3">
    <h3 class="text-sm font-semibold">Aperçu</h3>
    <div class="flex gap-1" aria-label="Format de l’aperçu">
      <button
        type="button"
        aria-label="Aperçu bureau"
        aria-pressed={!mobile}
        onclick={() => (mobile = false)}
        class="rounded p-2 hover:bg-surface"
        class:bg-surface={!mobile}><Monitor size={16} /></button
      >
      <button
        type="button"
        aria-label="Aperçu mobile"
        aria-pressed={mobile}
        onclick={() => (mobile = true)}
        class="rounded p-2 hover:bg-surface"
        class:bg-surface={mobile}><Smartphone size={16} /></button
      >
    </div>
  </div>
  <div
    class="mx-auto transition-[max-width] duration-200 motion-reduce:transition-none"
    style:max-width={mobile ? '375px' : '100%'}
  >
    <div class="space-y-1 border-b border-edge bg-surface p-4 text-xs text-ink-muted break-words">
      <p class="mb-2 text-sm font-semibold text-ink">{subject || 'Objet du message'}</p>
      {#if from}<p>De : {from}</p>{/if}{#if to}<p>À : {to}</p>{/if}{#if replyTo}<p>
          Répondre à : {replyTo}
        </p>{/if}
    </div>
    <iframe
      title="Aperçu sécurisé du courriel"
      srcdoc={document}
      sandbox=""
      referrerpolicy="no-referrer"
      class="h-80 w-full border-0 bg-white"
    ></iframe>
  </div>
  <p class="border-t border-edge p-3 text-xs leading-5 text-ink-muted">
    Rendu indicatif. Images distantes et liens désactivés; variables non remplacées. Aucun envoi.
  </p>
</section>
