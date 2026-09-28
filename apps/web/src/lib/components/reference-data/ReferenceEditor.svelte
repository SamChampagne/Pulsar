<script lang="ts">
  import type { ReferenceAccess } from '@pulsar/shared';
  import { api, ApiError } from '$lib/api/client';
  import Modal from '../ui/Modal.svelte';
  import Button from '../ui/Button.svelte';
  import ErrorNotice from '../ui/ErrorNotice.svelte';
  import { referenceFields, referenceStatuses, type ReferenceRow } from './fields';
  import { labelFor } from '../ui/status';
  import AddressFields, { type Address } from './AddressFields.svelte';
  let {
    access,
    row = null,
    fixedKind,
    onclose,
    onsaved,
  }: {
    access: ReferenceAccess;
    row?: ReferenceRow | null;
    fixedKind?: string;
    onclose: () => void;
    onsaved: (row: ReferenceRow) => void;
  } = $props();
  let open = $state(true),
    busy = $state(false),
    error = $state(''),
    uncertain = $state(false);
  let values = $state<Record<string, string>>({});
  let billingAddress = $state<Address | null>(null),
    shippingAddress = $state<Address | null>(null);
  const hasAddresses = $derived(['customer', 'client', 'supplier'].includes(access.kind));
  let active = $state(true),
    status = $state('');
  $effect(() => {
    billingAddress = row?.billingAddress
      ? (JSON.parse(JSON.stringify(row.billingAddress)) as Address)
      : null;
    shippingAddress = row?.shippingAddress
      ? (JSON.parse(JSON.stringify(row.shippingAddress)) as Address)
      : null;
    values = Object.fromEntries(
      referenceFields[access.kind].map((f) => [
        f.key,
        String(
          row?.[f.key] ?? (f.key === 'kind' && fixedKind ? fixedKind : (f.options?.[0] ?? '')),
        ),
      ]),
    );
    active = (row?.active ?? row?.isActive ?? true) as boolean;
    status = String(row?.status ?? '');
  });
  $effect(() => {
    if (!open) onclose();
  });
  async function save(event: SubmitEvent) {
    event.preventDefault();
    event.stopPropagation(); // A picker can be nested inside an unsaved parent form.
    if (busy || uncertain) return;
    busy = true;
    error = '';
    const body: Record<string, unknown> = {};
    if (hasAddresses) {
      body.billingAddress = billingAddress;
      body.shippingAddress = shippingAddress;
    }
    for (const field of referenceFields[access.kind]) {
      if (row && field.immutable) continue;
      const value = values[field.key]?.trim() ?? '';
      if (value || field.required) body[field.key] = value;
      // Empty optional fields clear existing values; omission would silently retain them.
      else if (row) body[field.key] = field.key === 'description' ? '' : null;
    }
    if (row) {
      if (['client', 'supplier', 'item'].includes(access.kind)) {
        body.expectedUpdatedAt = row.updatedAt;
        body.active = active;
      }
      if (access.kind === 'customer') {
        body.isActive = active;
        body.expectedUpdatedAt = row.updatedAt;
      }
      if (access.kind === 'carrier' || access.kind === 'driver') body.status = status;
    }
    try {
      const result = await api<ReferenceRow>(
        `/${access.path}${row ? '/' + encodeURIComponent(row.id) : ''}`,
        { method: row ? 'PATCH' : 'POST', body },
      );
      onsaved(result);
      open = false;
    } catch (e) {
      error = (e as Error).message;
      uncertain = !(e instanceof ApiError) || e.statusCode >= 500;
    } finally {
      busy = false;
    }
  }
</script>

<Modal bind:open title={`${row ? 'Modifier' : 'Ajouter'} · ${access.label}`} dismissible={!busy}>
  <form onsubmit={save} class="space-y-4">
    <p class="text-sm text-ink-muted">
      Cette fiche appartient aux données partagées de votre entreprise. Elle reste accessible ici,
      sans activer un autre module.
    </p>
    {#if row}<p class="rounded-lg border border-edge bg-surface-muted p-3 text-sm">
        Les modifications de cette fiche seront visibles dans tous les modules qui l’utilisent. Les
        opérations et documents historiques ne sont pas réécrits.
      </p>{/if}
    <div class="grid gap-4 sm:grid-cols-2">
      {#each referenceFields[access.kind] as field (field.key)}
        <label class="grid gap-1 text-sm"
          ><span>{field.label}{field.required ? ' *' : ''}</span>
          {#if field.options}<select
              class="rounded-lg border border-edge bg-surface px-3 py-2"
              bind:value={values[field.key]}
              required={field.required}
              disabled={busy ||
                uncertain ||
                (!!row && field.immutable) ||
                (field.key === 'kind' && !!fixedKind)}
            >
              {#each field.options as value}<option {value}>{value}</option>{/each}
            </select>{:else}<input
              class="min-w-0 rounded-lg border border-edge bg-surface px-3 py-2"
              type={field.type ?? 'text'}
              bind:value={values[field.key]}
              maxlength={field.max}
              required={field.required}
              disabled={busy || uncertain || (!!row && field.immutable)}
            />{/if}
        </label>
      {/each}
    </div>
    {#if hasAddresses}
      <AddressFields
        label="Adresse de facturation"
        bind:value={billingAddress}
        disabled={busy || uncertain}
      />
      <button
        type="button"
        class="text-xs text-accent hover:underline"
        disabled={busy || uncertain || !billingAddress}
        onclick={() =>
          (shippingAddress = billingAddress ? JSON.parse(JSON.stringify(billingAddress)) : null)}
        >Copier la facturation vers la livraison</button
      >
      <AddressFields
        label="Adresse de livraison par défaut"
        bind:value={shippingAddress}
        disabled={busy || uncertain}
      />
      <datalist id="address-countries"
        ><option value="CA">Canada</option><option value="US">États-Unis</option><option value="FR"
          >France</option
        ></datalist
      >
      <p class="text-xs text-ink-muted">
        Adresses de référence indépendantes. Les sites d’expédition et documents existants ne sont
        pas modifiés; aucune taxe n’est déduite de ces adresses.
      </p>
    {/if}
    {#if row && ['customer', 'client', 'supplier', 'item'].includes(access.kind)}<label
        class="flex items-center gap-2 text-sm"
        ><input type="checkbox" bind:checked={active} disabled={busy || uncertain} /> Fiche active</label
      >{/if}
    {#if row && (access.kind === 'carrier' || access.kind === 'driver')}<label
        class="grid gap-1 text-sm"
        >Statut<select
          bind:value={status}
          disabled={busy || uncertain}
          class="rounded-lg border border-edge bg-surface px-3 py-2"
          >{#each referenceStatuses[access.kind] as value}<option {value}>{labelFor(value)}</option
            >{/each}</select
        ></label
      >{/if}
    {#if access.kind === 'vehicle' || access.kind === 'trailer'}<p class="text-xs text-ink-muted">
        La disponibilité opérationnelle est gérée par les workflows, pas par cette fiche d’identité.
      </p>{/if}
    <ErrorNotice message={error} />
    {#if uncertain}<p role="alert" class="text-sm text-warn">
        Réponse incertaine. Fermez et recherchez la fiche pour vérifier ce qui a été enregistré
        avant toute nouvelle tentative.
      </p>{/if}
    <div class="flex justify-end gap-2">
      <Button
        variant="secondary"
        disabled={busy}
        onclick={() => {
          open = false;
        }}>Fermer</Button
      ><Button type="submit" disabled={busy || uncertain}
        >{busy ? 'Enregistrement…' : 'Enregistrer'}</Button
      >
    </div>
  </form>
</Modal>
