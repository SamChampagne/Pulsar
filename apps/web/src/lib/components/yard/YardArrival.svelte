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
    ErrorNotice,
    Field,
    Input,
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
    trailerRef = $state(''),
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
  function close() {
    if (saving) return false;
    if (
      trailerRef ||
      driverName ||
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
    saving = true;
    error = '';
    try {
      const result = await api<{ id: string }>('/yard/visits', {
        method: 'POST',
        body: {
          locationId: workspace.site.id,
          trailerRef: trailerRef.trim(),
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
          ><Input
            bind:value={trailerRef}
            required
            maxlength={100}
            placeholder="Ex. RF-218"
          /></Field
        ><Field label="Chauffeur"><Input bind:value={driverName} maxlength={100} /></Field>
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
