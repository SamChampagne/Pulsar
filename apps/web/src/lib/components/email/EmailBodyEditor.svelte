<script lang="ts">
  import DOMPurify from 'dompurify';
  import { confirmAction } from '$lib/stores/confirmation';
  import { Button, Field, Textarea } from '$lib/components/ui';
  let { html = $bindable('') }: { html?: string } = $props();
  let mode = $state<'text' | 'html'>('text'),
    text = $state('');
  function asHtml(value: string) {
    return value
      ? `<div style="white-space:pre-wrap">${value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')}</div>`
      : '';
  }
  // A loaded template/AI draft wins; never replace it with an older plain-text buffer.
  $effect(() => {
    if (mode === 'text' && html !== asHtml(text)) mode = 'html';
  });
  async function simple() {
    if (mode === 'text') return;
    if (
      html.trim() &&
      !(await confirmAction(
        'Passer en texte simple retire la mise en forme et les images de ce brouillon. Continuer ?',
        { title: 'Convertir le brouillon', confirmLabel: 'Convertir', dangerous: false },
      ))
    )
      return;
    const escaped = DOMPurify.sanitize(
      html.replace(/<br\s*\/?\s*>|<\/p>|<\/div>|<\/h[1-6]>/gi, '\n'),
      { ALLOWED_TAGS: [], ALLOWED_ATTR: [] },
    );
    const decoder = document.createElement('textarea');
    decoder.innerHTML = escaped;
    text = decoder.value.trim();
    html = asHtml(text);
    mode = 'text';
  }
</script>

<div class="space-y-2">
  <div class="flex gap-2">
    <Button variant={mode === 'text' ? 'primary' : 'secondary'} onclick={simple}
      >Texte simple</Button
    ><Button
      variant={mode === 'html' ? 'primary' : 'secondary'}
      onclick={() => {
        mode = 'html';
      }}>HTML avancé</Button
    >
  </div>
  {#if mode === 'text'}<Field label="Message du courriel"
      ><Textarea
        bind:value={text}
        rows={9}
        maxlength={100000}
        placeholder="Bonjour, votre intervention est confirmée…"
        oninput={(e) => {
          html = asHtml(e.currentTarget.value);
        }}
      /></Field
    >
  {:else}<Field label="Corps HTML"
      ><Textarea
        bind:value={html}
        rows={9}
        maxlength={100000}
        placeholder="<p>Bonjour,</p>"
      /></Field
    >{/if}
  <p class="text-xs leading-5 text-ink-muted">
    Le mode simple préserve vos sauts de ligne. Vérifiez l’aperçu avant l’envoi.
  </p>
</div>
