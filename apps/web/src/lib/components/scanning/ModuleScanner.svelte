<script lang="ts">
  import { ScanLine } from 'lucide-svelte';
  import { auth } from '$lib/stores/auth';
  import { api } from '$lib/api/client';
  import Modal from '$lib/components/ui/Modal.svelte';
  import ScanInput from './ScanInput.svelte';
  import { SCAN_CONTEXTS } from '$lib/scanning/context';
  import type { ScanKind, ScanResult } from '@pulsar/shared';
  let { domain }: { domain: string } = $props();
  let open = $state(false),
    kind = $state<ScanKind>('item'),
    result = $state<ScanResult | null>(null);
  const context = $derived(SCAN_CONTEXTS[domain]);
  const allowed = $derived(
    context &&
      $auth?.tenant.enabledModules.includes(context.module) &&
      $auth.user.permissions.includes(context.permission),
  );
  $effect(() => {
    domain;
    open = false;
    result = null;
  });
  async function scan(code: string) {
    const requested = kind,
      scope = domain;
    result = null;
    const found = await api<ScanResult>('/scan/' + scope, {
      method: 'POST',
      body: { kind: requested, code },
    });
    if (requested !== kind || scope !== domain || !open) return;
    result = found;
    return found.code + ' · ' + found.name;
  }
</script>

{#if allowed}
  <button
    type="button"
    aria-label="Scanner un code"
    title="Scanner un code"
    data-tour="module-scanner"
    class="shell-icon"
    onclick={() => {
      kind = context.kinds[0].kind;
      result = null;
      open = true;
    }}><ScanLine size={18} /></button
  >
  <Modal bind:open title="Scanner dans ce module" size="md">
    <label class="mb-3 block text-sm"
      >Type de code
      <select
        bind:value={kind}
        onchange={() => (result = null)}
        class="mt-1 min-h-11 w-full rounded-md border border-edge bg-surface px-3"
      >
        {#each context.kinds as choice}<option value={choice.kind}>{choice.label}</option>{/each}
      </select>
    </label>
    {#key kind}<ScanInput onscan={scan} />{/key}
    <p class="mt-3 text-xs text-ink-muted">
      Le scan consulte un dossier. Il ne valide ni réception, ni livraison, ni mouvement de stock.
    </p>
    {#if result}<div class="mt-4 rounded-md border border-edge p-3">
        <p class="font-mono font-semibold">{result.code}</p>
        <p class="text-sm">{result.name} {result.status ?? ''} {result.unit ?? ''}</p>
        {#if result.href}<a
            href={result.href}
            onclick={() => (open = false)}
            class="mt-3 inline-flex min-h-10 items-center text-sm text-accent underline"
            >Ouvrir l’écran associé</a
          >{/if}
      </div>{/if}
    <details class="mt-4 text-sm">
      <summary class="cursor-pointer">Configurer mon lecteur USB, Bluetooth ou Zebra</summary>
      <ol class="mt-2 list-decimal space-y-2 pl-5 text-ink-muted">
        <li>
          USB/Bluetooth : associer le lecteur au système en mode HID/clavier; utiliser la même
          langue de clavier que l’appareil.
        </li>
        <li>
          Zebra Android : dans DataWedge, associer un profil au navigateur utilisé, activer Barcode
          input et Keystroke output, ajouter le suffixe Enter.
        </li>
        <li>
          Si Entrée ne valide pas : configurer DataWedge pour émettre Entrée comme événement de
          touche. Tester un code connu avant toute opération.
        </li>
        <li>
          Les codes doivent correspondre exactement aux références Pulsar. Les codes GS1 composites,
          RFID et le mode hors-ligne ne sont pas pris en charge ici.
        </li>
      </ol>
      <a
        class="mt-2 inline-block text-accent underline"
        href="https://techdocs.zebra.com/datawedge/latest/guide/output/keystroke/"
        target="_blank"
        rel="noreferrer">Documentation Zebra DataWedge</a
      >
    </details>
  </Modal>
{/if}
