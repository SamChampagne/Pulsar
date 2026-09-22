<script lang="ts">
  import { api, ApiError } from '$lib/api/client';
  import { auth } from '$lib/stores/auth';
  import { toast } from '$lib/stores/toast';
  import { confirmAction } from '$lib/stores/confirmation';
  import { isValidPhone } from '@pulsar/shared';
  import { enterNext } from '$lib/forms/enter-next';
  import { Button, Modal, Field, Input, Skeleton } from '$lib/components/ui';

  let {
    kind,
    id,
    onsaved,
  }: { kind: 'customers' | 'carriers'; id: string; onsaved: () => Promise<void> } = $props();
  const canManage = $derived($auth?.user.permissions.includes('transportation.master-data.manage'));
  const isCustomer = $derived(kind === 'customers');
  let open = $state(false);
  let loading = $state(false);
  let loaded = $state(false);
  let saving = $state(false);
  let error = $state('');
  let initiallyActive = true;
  let form = $state({
    code: '',
    name: '',
    contactName: '',
    email: '',
    phone: '',
    notes: '',
    scacCode: '',
    mcNumber: '',
    dotNumber: '',
    active: true,
  });

  async function edit() {
    open = true;
    loading = true;
    loaded = false;
    error = '';
    try {
      const row = await api<Record<string, unknown>>(`/transportation/${kind}/${id}`);
      for (const key of [
        'code',
        'name',
        'contactName',
        'email',
        'phone',
        'notes',
        'scacCode',
        'mcNumber',
        'dotNumber',
      ] as const)
        form[key] = String(row[key] ?? '');
      form.active = isCustomer ? row.isActive === true : row.status === 'ACTIVE';
      initiallyActive = form.active;
      loaded = true;
    } catch (e) {
      error = e instanceof ApiError ? e.message : 'Chargement impossible';
    } finally {
      loading = false;
    }
  }

  async function save(event: SubmitEvent) {
    event.preventDefault();
    if (saving || !loaded) return;
    if (!isValidPhone(form.phone.trim())) {
      error = 'Téléphone invalide : utilisez 7 à 15 chiffres et une extension facultative.';
      return;
    }
    if (
      initiallyActive &&
      !form.active &&
      !(await confirmAction(
        `Désactiver ${form.name} ? Son historique sera conservé. Cela n’annule pas les opérations en cours.`,
      ))
    )
      return;
    saving = true;
    error = '';
    const optional = (value: string) => value.trim() || null;
    try {
      await api(`/transportation/${kind}/${id}`, {
        method: 'PATCH',
        body: {
          name: form.name.trim(),
          contactName: optional(form.contactName),
          email: optional(form.email),
          phone: optional(form.phone),
          ...(isCustomer
            ? { notes: optional(form.notes), isActive: form.active }
            : {
                scacCode: optional(form.scacCode.toUpperCase()),
                mcNumber: optional(form.mcNumber),
                dotNumber: optional(form.dotNumber),
                status: form.active ? 'ACTIVE' : 'INACTIVE',
              }),
        },
      });
      open = false;
      toast.success('Fiche mise à jour');
      await onsaved();
    } catch (e) {
      error = e instanceof ApiError ? e.message : 'Enregistrement impossible';
    } finally {
      saving = false;
    }
  }
</script>

{#if canManage}<Button variant="secondary" onclick={edit}>Modifier</Button>{/if}
<Modal
  bind:open
  title={isCustomer ? 'Modifier le client' : 'Modifier le transporteur'}
  dismissible={!saving}
>
  {#if loading}<Skeleton rows={5} />{:else if !loaded}
    <p role="alert" class="mb-3 text-sm text-danger">{error}</p>
    <Button variant="secondary" onclick={edit}>Réessayer le chargement</Button>
  {:else}
    <form onsubmit={save} use:enterNext class="space-y-3">
      {#if error}<p role="alert" class="text-sm text-danger">{error}</p>{/if}
      <Field label="Code (fixe)"><Input value={form.code} disabled /></Field>
      <Field label="Nom"><Input bind:value={form.name} required maxlength={200} /></Field>
      <Field label="Contact"><Input bind:value={form.contactName} maxlength={150} /></Field>
      <Field label="Courriel"><Input bind:value={form.email} type="email" maxlength={254} /></Field>
      <Field label="Téléphone"
        ><Input
          bind:value={form.phone}
          type="tel"
          maxlength={40}
          placeholder="+1 514 555-0123 poste 42"
        /></Field
      >
      {#if !isCustomer}
        <div class="grid gap-3 sm:grid-cols-3">
          <Field label="SCAC"
            ><Input bind:value={form.scacCode} maxlength={4} pattern={'[a-zA-Z]{2,4}'} /></Field
          >
          <Field label="MC"><Input bind:value={form.mcNumber} maxlength={30} /></Field>
          <Field label="DOT"><Input bind:value={form.dotNumber} maxlength={30} /></Field>
        </div>
      {:else}
        <Field label="Notes"
          ><textarea
            bind:value={form.notes}
            maxlength={5000}
            rows="3"
            class="w-full rounded-md border border-edge bg-surface p-2 text-sm"
          ></textarea></Field
        >
      {/if}
      <label class="flex items-center gap-2 text-sm"
        ><input type="checkbox" bind:checked={form.active} />{isCustomer
          ? 'Client actif'
          : 'Transporteur actif'}</label
      >
      <p class="text-xs text-ink-muted">
        L’historique reste conservé. Entrée : champ suivant · Maj + Entrée : précédent.
      </p>
      <div class="flex justify-end gap-2 border-t border-edge pt-3">
        <Button
          variant="secondary"
          disabled={saving}
          onclick={() => {
            open = false;
          }}>Annuler</Button
        >
        <Button type="submit" loading={saving}>Enregistrer</Button>
      </div>
    </form>
  {/if}
</Modal>
