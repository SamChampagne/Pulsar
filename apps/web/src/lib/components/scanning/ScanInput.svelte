<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { normalizeScan } from '@pulsar/shared';
  import { ScanLine } from 'lucide-svelte';
  let {
    onscan,
    disabled = false,
    label = 'Code à scanner',
  }: {
    onscan: (code: string) => Promise<string | void>;
    disabled?: boolean;
    label?: string;
  } = $props();
  let input: HTMLInputElement;
  let value = $state(''),
    busy = $state(false),
    error = $state(''),
    message = $state('');
  let manualKeyboard = $state(false);
  let alive = true;
  onMount(() => {
    void tick().then(() => {
      if (alive && !disabled) input?.focus();
    });
    return () => {
      alive = false;
    };
  });
  async function submit() {
    if (disabled || busy) return;
    let code: string;
    try {
      code = normalizeScan(value);
    } catch (e) {
      error = (e as Error).message;
      return;
    }
    busy = true;
    error = '';
    message = '';
    try {
      const result = await onscan(code);
      if (alive) {
        message = result ?? 'Code reconnu';
        value = '';
      }
    } catch (e) {
      if (alive) {
        error = e instanceof Error ? e.message : 'Scan indisponible';
      }
    } finally {
      if (alive) {
        busy = false;
        queueMicrotask(() => {
          if (input?.isConnected && !disabled) {
            input.focus();
            input.select();
          }
        });
      }
    }
  }
  function keydown(event: KeyboardEvent) {
    if (event.isComposing || event.repeat || event.ctrlKey || event.altKey || event.metaKey) return;
    if (event.key === 'Enter' || (event.key === 'Tab' && value.trim() && !event.shiftKey)) {
      event.preventDefault();
      event.stopPropagation();
      void submit();
    }
  }
</script>

<section
  class="rounded-lg border border-edge bg-surface-muted/40 p-3"
  aria-label="Lecteur de codes-barres"
  data-tour="scanner"
>
  <p class="mb-2 flex items-center gap-2 text-sm font-medium"><ScanLine size={18} />{label}</p>
  <div class="flex gap-2">
    <input
      bind:this={input}
      bind:value
      aria-label={label}
      data-scan-input
      data-initial-focus
      disabled={disabled || busy}
      maxlength={132}
      autocomplete="off"
      autocapitalize="none"
      spellcheck={false}
      inputmode={manualKeyboard ? 'text' : 'none'}
      onkeydown={keydown}
      oninput={(event) => {
        value = event.currentTarget.value;
        if (/[\r\n\t]$/.test(value)) void submit();
      }}
      placeholder="Scanner puis Entrée ou Tab"
      class="min-h-12 min-w-0 flex-1 rounded-md border border-edge bg-surface px-3 font-mono text-base focus-visible:outline-2 focus-visible:outline-accent"
    />
    <button
      type="button"
      disabled={disabled || busy || !value.trim()}
      onclick={submit}
      class="min-h-12 rounded-md bg-accent px-4 text-sm font-medium text-white disabled:opacity-50"
      >{busy ? 'Lecture…' : 'Lire'}</button
    >
  </div>
  <label class="mt-2 flex items-center gap-2 text-xs text-ink-muted"
    ><input type="checkbox" bind:checked={manualKeyboard} />Afficher le clavier tactile pour saisir
    manuellement</label
  >
  <p class="mt-2 text-xs text-ink-muted">
    USB / Bluetooth en mode clavier · Zebra DataWedge : sortie clavier + suffixe Entrée. Gardez le
    focus dans ce champ et attendez la confirmation avant le prochain scan.
  </p>
  {#if error}<p class="mt-2 text-sm text-danger" role="alert">{error}</p>{/if}
  <p class="mt-2 text-sm text-ok" role="status" aria-live="polite">{message}</p>
</section>
