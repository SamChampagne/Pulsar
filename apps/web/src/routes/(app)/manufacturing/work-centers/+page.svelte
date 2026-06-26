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

  interface WorkCenter {
    id: string;
    code: string;
    name: string;
    calendarId?: string | null;
    capabilities: string[];
    efficiency: number;
    isActive: boolean;
  }

  interface Calendar {
    id: string;
    name: string;
  }

  let centers = $state<WorkCenter[]>([]);
  let total = $state(0);
  let loading = $state(true);
  let error = $state('');
  let search = $state('');

  let calendars = $state<Calendar[]>([]);
  let calendarsById = $derived(new Map(calendars.map((c) => [c.id, c.name])));

  // Create / edit panel
  let formOpen = $state(false);
  let editId = $state<string | null>(null);
  let formCode = $state('');
  let formName = $state('');
  let formCalendarId = $state('');
  let formCapabilities = $state('');
  let formEfficiency = $state('1');
  let formActive = $state(true);
  let saving = $state(false);

  async function load() {
    loading = true;
    error = '';
    try {
      const res = await api<Paginated<WorkCenter>>('/manufacturing/work-centers', {
        query: { pageSize: 100, search: search.trim() || undefined },
      });
      centers = res.items;
      total = res.total;
    } catch (e) {
      error = e instanceof ApiError ? e.message : 'Échec du chargement des postes de charge';
      toast.error(error);
    } finally {
      loading = false;
    }
  }

  async function loadCalendars() {
    try {
      const res = await api<Paginated<Calendar>>('/manufacturing/calendars', {
        query: { pageSize: 100 },
      });
      calendars = res.items;
    } catch {
      // best-effort: the picker simply stays empty
    }
  }

  $effect(() => {
    void load();
  });

  $effect(() => {
    void loadCalendars();
  });

  function openCreate() {
    editId = null;
    formCode = '';
    formName = '';
    formCalendarId = '';
    formCapabilities = '';
    formEfficiency = '1';
    formActive = true;
    formOpen = true;
  }

  function openEdit(wc: WorkCenter) {
    editId = wc.id;
    formCode = wc.code;
    formName = wc.name;
    formCalendarId = wc.calendarId ?? '';
    formCapabilities = (wc.capabilities ?? []).join(', ');
    formEfficiency = String(wc.efficiency ?? 1);
    formActive = wc.isActive;
    formOpen = true;
  }

  async function submit() {
    if (!formCode.trim() || !formName.trim()) {
      toast.error('Code et nom sont requis');
      return;
    }
    saving = true;
    try {
      const capabilities = formCapabilities
        .split(',')
        .map((c) => c.trim())
        .filter((c) => c.length > 0);
      const body = {
        code: formCode.trim(),
        name: formName.trim(),
        calendarId: formCalendarId || undefined,
        capabilities,
        efficiency: formEfficiency !== '' ? Number(formEfficiency) : 1,
        isActive: formActive,
      };
      if (editId) {
        await api(`/manufacturing/work-centers/${editId}`, { method: 'PATCH', body });
        toast.success('Poste de charge mis à jour');
      } else {
        await api('/manufacturing/work-centers', { method: 'POST', body });
        toast.success('Poste de charge créé');
      }
      formOpen = false;
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Échec de l'enregistrement");
    } finally {
      saving = false;
    }
  }
</script>

<PageHeader title="Postes de charge" count={total}>
  {#snippet actions()}
    <Button onclick={openCreate}>Nouveau poste</Button>
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
{:else if centers.length === 0}
  <Card>
    <EmptyState message="Aucun poste de charge pour le moment.">
      {#snippet children()}
        <Button onclick={openCreate}>Nouveau poste</Button>
      {/snippet}
    </EmptyState>
  </Card>
{:else}
  <Table>
    {#snippet head()}
      <th>Code</th><th>Nom</th><th>Calendrier</th><th class="text-right">Efficacité</th
      ><th>Capacités</th><th>Statut</th>
    {/snippet}
    {#snippet body()}
      {#each centers as wc (wc.id)}
        <tr class="cursor-pointer" onclick={() => openEdit(wc)}>
          <td class="font-mono font-semibold text-ink">{wc.code}</td>
          <td>{wc.name}</td>
          <td class="text-ink-muted">
            {wc.calendarId ? (calendarsById.get(wc.calendarId) ?? '—') : '—'}
          </td>
          <td class="text-right text-ink">{wc.efficiency}</td>
          <td>
            {#if (wc.capabilities ?? []).length > 0}
              <span class="flex flex-wrap gap-1">
                {#each wc.capabilities as cap}
                  <Badge tone="neutral">{cap}</Badge>
                {/each}
              </span>
            {:else}
              <span class="text-xs text-ink-faint">—</span>
            {/if}
          </td>
          <td
            ><Badge tone={wc.isActive ? 'ok' : 'neutral'}>{wc.isActive ? 'Actif' : 'Inactif'}</Badge
            ></td
          >
        </tr>
      {/each}
    {/snippet}
  </Table>
{/if}

<Modal bind:open={formOpen} title={editId ? 'Modifier le poste' : 'Nouveau poste'} size="md">
  {#snippet children()}
    <div class="space-y-3">
      <Field label="Code">
        <Input bind:value={formCode} placeholder="WC-001" />
      </Field>
      <Field label="Nom">
        <Input bind:value={formName} placeholder="Désignation" />
      </Field>
      <Field label="Calendrier">
        <Select bind:value={formCalendarId}>
          <option value="">— Aucun —</option>
          {#each calendars as cal (cal.id)}
            <option value={cal.id}>{cal.name}</option>
          {/each}
        </Select>
      </Field>
      <Field label="Capacités">
        <Input bind:value={formCapabilities} placeholder="Soudure, Usinage, Assemblage" />
      </Field>
      <Field label="Efficacité">
        <Input bind:value={formEfficiency} type="number" min="0" step="any" placeholder="1" />
      </Field>
      <Field label="Actif">
        <label class="flex items-center gap-2 text-sm text-ink">
          <input type="checkbox" bind:checked={formActive} />
          Poste actif
        </label>
      </Field>
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
