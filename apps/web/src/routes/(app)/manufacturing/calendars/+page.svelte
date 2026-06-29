<script lang="ts">
  import type { Paginated } from '@pulsar/shared';
  import { api, ApiError } from '$lib/api/client';
  import {
    Badge,
    Button,
    Card,
    EmptyState,
    Field,
    FilterBar,
    Input,
    Modal,
    PageHeader,
    Select,
    Skeleton,
    Table,
  } from '$lib/components/ui';
  import { toast } from '$lib/stores/toast';

  interface Shift {
    id: string;
    weekday: number;
    startTime: string;
    endTime: string;
  }

  interface Calendar {
    id: string;
    code: string;
    name: string;
    isActive: boolean;
    shifts?: Shift[];
  }

  const WEEKDAYS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];

  let calendars = $state<Calendar[]>([]);
  let total = $state(0);
  let loading = $state(true);
  let error = $state('');
  let search = $state('');

  // Create / edit panel
  let formOpen = $state(false);
  let editId = $state<string | null>(null);
  let formCode = $state('');
  let formName = $state('');
  let formActive = $state(true);
  let saving = $state(false);

  // Shift editor (edit mode only)
  let shifts = $state<Shift[]>([]);
  let newWeekday = $state('0');
  let newStart = $state('08:00');
  let newEnd = $state('16:00');
  let shiftBusy = $state(false);

  async function load() {
    loading = true;
    error = '';
    try {
      const res = await api<Paginated<Calendar>>('/manufacturing/calendars', {
        query: { pageSize: 100, search: search.trim() || undefined },
      });
      calendars = res.items;
      total = res.total;
    } catch (e) {
      error = e instanceof ApiError ? e.message : 'Échec du chargement des calendriers';
      toast.error(error);
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    void load();
  });

  function openCreate() {
    editId = null;
    formCode = '';
    formName = '';
    formActive = true;
    shifts = [];
    formOpen = true;
  }

  async function openEdit(cal: Calendar) {
    editId = cal.id;
    formCode = cal.code;
    formName = cal.name;
    formActive = cal.isActive;
    shifts = cal.shifts ?? [];
    newWeekday = '0';
    newStart = '08:00';
    newEnd = '16:00';
    formOpen = true;
    await refreshShifts();
  }

  async function refreshShifts() {
    if (!editId) return;
    try {
      const cal = await api<Calendar>(`/manufacturing/calendars/${editId}`);
      shifts = cal.shifts ?? [];
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Échec du chargement des quarts');
    }
  }

  async function submit() {
    if (!formCode.trim() || !formName.trim()) {
      toast.error('Code et nom sont requis');
      return;
    }
    saving = true;
    try {
      const body = {
        code: formCode.trim(),
        name: formName.trim(),
        isActive: formActive,
      };
      if (editId) {
        await api(`/manufacturing/calendars/${editId}`, { method: 'PATCH', body });
        toast.success('Calendrier mis à jour');
      } else {
        await api('/manufacturing/calendars', { method: 'POST', body });
        toast.success('Calendrier créé');
      }
      formOpen = false;
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Échec de l'enregistrement");
    } finally {
      saving = false;
    }
  }

  async function addShift() {
    if (!editId) return;
    shiftBusy = true;
    try {
      await api(`/manufacturing/calendars/${editId}/shifts`, {
        method: 'POST',
        body: {
          weekday: Number(newWeekday),
          startTime: newStart,
          endTime: newEnd,
        },
      });
      toast.success('Quart ajouté');
      await refreshShifts();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Échec de l'ajout du quart");
    } finally {
      shiftBusy = false;
    }
  }

  async function removeShift(shiftId: string) {
    if (!editId) return;
    shiftBusy = true;
    try {
      await api(`/manufacturing/calendars/${editId}/shifts/${shiftId}`, { method: 'DELETE' });
      toast.success('Quart supprimé');
      await refreshShifts();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Échec de la suppression du quart');
    } finally {
      shiftBusy = false;
    }
  }
</script>

<PageHeader title="Calendriers" count={total}>
  {#snippet actions()}
    <Button onclick={openCreate}>Nouveau calendrier</Button>
  {/snippet}
</PageHeader>

<FilterBar>
  <a href="/manufacturing" class="text-sm text-accent hover:underline">← Fabrication</a>
  <div class="w-72">
    <input
      placeholder="Rechercher par code ou nom…"
      bind:value={search}
      onkeydown={(e) => {
        if (e.key === 'Enter') void load();
      }}
      class="w-full rounded-md border border-edge bg-surface px-3 py-1.5 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
    />
  </div>
</FilterBar>

{#if loading}
  <Card padded={false}><Skeleton rows={6} /></Card>
{:else if error}
  <Card><p class="text-sm text-danger">{error}</p></Card>
{:else if calendars.length === 0}
  <Card>
    <EmptyState message="Aucun calendrier pour le moment.">
      {#snippet children()}
        <Button onclick={openCreate}>Nouveau calendrier</Button>
      {/snippet}
    </EmptyState>
  </Card>
{:else}
  <Table>
    {#snippet head()}
      <th>Code</th><th>Nom</th><th class="text-right">Nb quarts</th><th>Statut</th>
    {/snippet}
    {#snippet body()}
      {#each calendars as cal (cal.id)}
        <tr class="cursor-pointer" onclick={() => openEdit(cal)}>
          <td class="font-mono font-semibold text-ink">{cal.code}</td>
          <td>{cal.name}</td>
          <td class="text-right text-ink-muted">{(cal.shifts ?? []).length}</td>
          <td
            ><Badge tone={cal.isActive ? 'ok' : 'neutral'}
              >{cal.isActive ? 'Actif' : 'Inactif'}</Badge
            ></td
          >
        </tr>
      {/each}
    {/snippet}
  </Table>
{/if}

<Modal
  bind:open={formOpen}
  title={editId ? 'Modifier le calendrier' : 'Nouveau calendrier'}
  size="md"
>
  {#snippet children()}
    <div class="space-y-3">
      <Field label="Code">
        <Input bind:value={formCode} placeholder="CAL-001" />
      </Field>
      <Field label="Nom">
        <Input bind:value={formName} placeholder="Désignation" />
      </Field>
      <Field label="Actif">
        <label class="flex items-center gap-2 text-sm text-ink">
          <input type="checkbox" bind:checked={formActive} />
          Calendrier actif
        </label>
      </Field>

      {#if editId}
        <div class="space-y-2 border-t border-edge pt-3">
          <h3 class="text-sm font-semibold text-ink">Quarts de travail</h3>
          {#if shifts.length === 0}
            <p class="text-xs text-ink-faint">Aucun quart défini.</p>
          {:else}
            <div class="space-y-1">
              {#each shifts as s (s.id)}
                <div
                  class="flex items-center justify-between rounded-md border border-edge bg-surface px-3 py-1.5 text-sm"
                >
                  <span class="text-ink">
                    <span class="font-semibold">{WEEKDAYS[s.weekday] ?? s.weekday}</span>
                    <span class="text-ink-muted"> · {s.startTime}–{s.endTime}</span>
                  </span>
                  <button
                    type="button"
                    class="text-xs text-danger hover:underline disabled:opacity-50"
                    disabled={shiftBusy}
                    onclick={() => removeShift(s.id)}
                  >
                    Supprimer
                  </button>
                </div>
              {/each}
            </div>
          {/if}

          <div class="flex items-end gap-2 pt-1">
            <div class="w-28">
              <Field label="Jour">
                <Select bind:value={newWeekday}>
                  {#each WEEKDAYS as label, i}
                    <option value={String(i)}>{label}</option>
                  {/each}
                </Select>
              </Field>
            </div>
            <div class="w-28">
              <Field label="Début">
                <Input bind:value={newStart} type="time" />
              </Field>
            </div>
            <div class="w-28">
              <Field label="Fin">
                <Input bind:value={newEnd} type="time" />
              </Field>
            </div>
            <Button variant="secondary" loading={shiftBusy} onclick={addShift}>Ajouter</Button>
          </div>
        </div>
      {:else}
        <p class="text-xs text-ink-faint">
          Enregistrez le calendrier pour gérer ses quarts de travail.
        </p>
      {/if}

      <div class="flex justify-end gap-2 border-t border-edge pt-3">
        <Button
          variant="secondary"
          onclick={() => {
            formOpen = false;
          }}>Annuler</Button
        >
        <Button variant="primary" loading={saving} onclick={submit}>Enregistrer</Button>
      </div>
    </div>
  {/snippet}
</Modal>
