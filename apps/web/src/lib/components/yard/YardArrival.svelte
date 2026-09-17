<script lang="ts">
  import { untrack } from 'svelte';
  import { api, ApiError } from '$lib/api/client';
  import {
    yardDirectionLabel,
    type YardWorkspace,
    type YardWorkspaceAppointment,
  } from '@pulsar/shared';
  import {
    Button,
    Drawer,
    EntityPicker,
    ErrorNotice,
    Field,
    Select,
    Textarea,
    Skeleton,
  } from '$lib/components/ui';
  import { confirmAction } from '$lib/stores/confirmation';
  import CustomFieldInputs from '$lib/components/CustomFieldInputs.svelte';
  let {
    workspace,
    appointment = null,
    onclose,
    onsaved,
  }: {
    workspace: YardWorkspace;
    appointment?: YardWorkspaceAppointment | null;
    onclose: () => void;
    onsaved: (id: string) => void | Promise<void>;
  } = $props();
  let open = $state(true),
    // Remorque : holds either a fleet trailer id (catalog pick) or a raw
    // reference (free text) — `trailerIsFreeText` says which, so `save()`
    // sends `trailerId` or `trailerRef` accordingly (rule: id when picked,
    // text when free — never both).
    trailerPick = $state(''),
    trailerIsFreeText = $state(false),
    // Chauffeur : the API only stores free text (`driverName` — a visit has no
    // driver FK). A catalog pick still resolves to the driver's display name
    // below, so `driverName` stays the single value the API ever sees.
    driverPick = $state(''),
    driverIsFreeText = $state(false),
    driverName = $state(''),
    direction = $state(untrack(() => appointment?.direction ?? 'INBOUND')),
    notes = $state(''),
    spotId = $state(''),
    saving = $state(false),
    uncertain = $state(false),
    error = $state(''),
    loading = $state(true),
    definitionsFailed = $state(false);
  type Def = {
    key: string;
    label: string;
    type: 'TEXT' | 'NUMBER' | 'DATE' | 'BOOLEAN' | 'SELECT';
    options?: { value: string; label: string }[];
    required: boolean;
  };
  let definitions = $state<Def[]>([]),
    customData = $state<Record<string, unknown>>({});
  const freeSpots = $derived(
    workspace.spots.filter((s) => s.isActive && !workspace.visits.some((v) => v.spotId === s.id)),
  );
  $effect(() => {
    let disposed = false;
    api<Def[]>('/yard/custom-fields', { query: { entityType: 'YARD_VISIT' } })
      .then((d) => {
        if (!disposed) definitions = d;
      })
      .catch((e) => {
        if (!disposed) {
          error = e.message;
          definitionsFailed = true;
        }
      })
      .finally(() => {
        if (!disposed) loading = false;
      });
    return () => {
      disposed = true;
    };
  });
  // Resolves a catalog driver pick to its display name; a free-text pick is
  // already the name itself.
  $effect(() => {
    const id = driverPick;
    const isFree = driverIsFreeText;
    if (!id) {
      driverName = '';
      return;
    }
    if (isFree) {
      driverName = id;
      return;
    }
    let cancelled = false;
    api<{ firstName: string; lastName: string }>(
      `/transportation/drivers/${encodeURIComponent(id)}`,
    )
      .then((d) => {
        if (!cancelled) driverName = [d.firstName, d.lastName].filter(Boolean).join(' ');
      })
      .catch(() => {
        if (!cancelled) driverName = '';
      });
    return () => {
      cancelled = true;
    };
  });
  function close() {
    if (saving) return false;
    if (
      trailerPick ||
      driverPick ||
      notes ||
      spotId ||
      Object.values(customData).some((v) => v !== '' && v !== false)
    ) {
      void confirmAction('Abandonner les informations de cette arrivée ?', {
        title: 'Fermer la saisie',
        confirmLabel: 'Abandonner',
      }).then((ok) => {
        if (ok) {
          open = false;
          onclose();
        }
      });
      return false;
    }
    return true;
  }
  async function save(e: SubmitEvent) {
    e.preventDefault();
    if (saving || loading || definitionsFailed || uncertain) return;
    if (!trailerPick) {
      error = 'La remorque ou une référence de véhicule est requise.';
      return;
    }
    if (trailerIsFreeText && trailerPick.trim().length > 100) {
      error = 'La référence de véhicule ne peut dépasser 100 caractères.';
      return;
    }
    saving = true;
    error = '';
    try {
      const result = await api<{ id: string }>('/yard/visits', {
        method: 'POST',
        body: {
          locationId: workspace.site.id,
          trailerId: trailerIsFreeText ? undefined : trailerPick,
          trailerRef: trailerIsFreeText ? trailerPick.trim() : undefined,
          driverName: driverName.trim() || undefined,
          direction,
          spotId: spotId || undefined,
          notes: notes.trim() || undefined,
          appointmentId: appointment?.id,
          carrierId: appointment?.carrierId ?? undefined,
          customData: Object.fromEntries(Object.entries(customData).filter(([, v]) => v !== '')),
        },
      });
      await onsaved(result.id);
      open = false;
      onclose();
    } catch (e) {
      // A transport/5xx failure can occur after commit. Never replay an unconfirmed arrival.
      uncertain = !(e instanceof ApiError) || e.statusCode >= 500;
      error =
        !uncertain && e instanceof ApiError
          ? e.message
          : 'Réponse non confirmée : cette arrivée a peut-être été enregistrée. Fermez ce panneau et actualisez les visites avant de créer une autre arrivée. Votre saisie reste visible ici.';
    } finally {
      saving = false;
    }
  }
</script>

<Drawer
  bind:open
  title="Enregistrer une arrivée"
  width="lg"
  dismissible={!saving}
  onbeforeclose={close}
  {onclose}
>
  <p class="mb-5 text-sm text-ink-muted">
    {workspace.site.name}{appointment
      ? ` · rendez-vous ${appointment.appointmentNumber}`
      : ' · arrivée sans rendez-vous'}
  </p>
  {#if loading}<Skeleton rows={3} />{:else}
    <form id="yard-arrival" class="space-y-4" onsubmit={save}>
      <fieldset disabled={saving} class="space-y-4">
        <Field label="Remorque ou référence du véhicule"
          ><EntityPicker
            endpoint="/transportation/trailers"
            label="Remorque ou référence du véhicule"
            labelKey="unitNumber"
            detailKey="plate"
            allowFreeText
            bind:value={
              () => trailerPick,
              (v) => {
                trailerPick = v;
                trailerIsFreeText = false;
              }
            }
            onfreetext={() => {
              trailerIsFreeText = true;
            }}
          /></Field
        ><Field label="Chauffeur"
          ><EntityPicker
            endpoint="/transportation/drivers"
            label="Chauffeur"
            labelKey="lastName"
            detailKey="firstName"
            allowFreeText
            bind:value={
              () => driverPick,
              (v) => {
                driverPick = v;
                driverIsFreeText = false;
              }
            }
            onfreetext={() => {
              driverIsFreeText = true;
            }}
          /></Field
        >
        <Field label="Opération"
          ><Select bind:value={direction} disabled={!!appointment}
            >{#each ['INBOUND', 'OUTBOUND', 'OTHER'] as d (d)}<option value={d}
                >{yardDirectionLabel(d)}</option
              >{/each}</Select
          ></Field
        >
        {#if appointment}<p class="text-xs text-ink-muted">Sens repris du rendez-vous lié.</p>{/if}
        <Field label="Emplacement à l’arrivée"
          ><Select bind:value={spotId}
            ><option value="">File d’attente · affecter plus tard</option
            >{#each freeSpots as s (s.id)}<option value={s.id}>{s.code}</option>{/each}</Select
          ></Field
        >
        <Field label="Notes"><Textarea bind:value={notes} rows={3} /></Field>
        <CustomFieldInputs {definitions} bind:data={customData} />
      </fieldset>
    </form>
  {/if}
  <div class="mt-4"><ErrorNotice message={error} /></div>
  {#snippet footer()}<button
      type="submit"
      form="yard-arrival"
      disabled={saving || loading || definitionsFailed || uncertain}
      class="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >{saving ? 'Enregistrement…' : 'Enregistrer l’arrivée'}</button
    >{/snippet}
</Drawer>
