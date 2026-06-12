<script lang="ts">
  import type { Paginated } from '@pulsar/shared';
  import { api, ApiError } from '$lib/api/client';
  import { toast } from '$lib/stores/toast';
  import {
    PageHeader,
    Button,
    Card,
    Table,
    Badge,
    EmptyState,
    Skeleton,
    Modal,
    Field,
  } from '$lib/components/ui';

  interface Accessorial {
    id: string;
    code: string;
    name: string;
    unit: 'FLAT' | 'PER_HOUR' | 'PER_UNIT';
  }

  let accessorials = $state<Accessorial[]>([]);
  let total = $state(0);
  let error = $state('');
  let showForm = $state(false);
  let loading = $state(true);

  // Form state
  let editingId = $state<string | null>(null);
  let code = $state('');
  let name = $state('');
  let unit = $state<'FLAT' | 'PER_HOUR' | 'PER_UNIT'>('FLAT');

  const inputCls = 'w-full rounded-md border border-edge bg-surface px-3 py-1.5 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none';

  async function load() {
    try {
      const result = await api<Paginated<Accessorial>>('/transportation/accessorials', {
        query: { pageSize: 100 },
      });
      accessorials = result.items;
      total = result.total;
    } catch (e) {
      error = e instanceof ApiError ? e.message : 'Failed to load accessorials';
    } finally {
      loading = false;
    }
  }

  function reset() {
    editingId = null;
    code = '';
    name = '';
    unit = 'FLAT';
    showForm = false;
    error = '';
  }

  function edit(acc: Accessorial) {
    editingId = acc.id;
    code = acc.code;
    name = acc.name;
    unit = acc.unit;
    showForm = true;
  }

  async function save(event: SubmitEvent) {
    event.preventDefault();
    error = '';
    try {
      const body = { code: code.toUpperCase(), name, unit };
      if (editingId) {
        await api(`/transportation/accessorials/${editingId}`, { method: 'PATCH', body });
        toast.success('Accessorial updated');
      } else {
        await api('/transportation/accessorials', { method: 'POST', body });
        toast.success('Accessorial created');
      }
      reset();
      await load();
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : 'Failed to save accessorial';
      error = msg;
      toast.error(msg);
    }
  }

  async function remove(acc: Accessorial) {
    try {
      await api(`/transportation/accessorials/${acc.id}`, { method: 'DELETE' });
      toast.success(`Accessorial ${acc.code} deleted`);
      await load();
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : 'Failed to delete accessorial';
      toast.error(msg);
    }
  }

  $effect(() => {
    void load();
  });
</script>

<PageHeader title="Accessorials" count={total}>
  {#snippet actions()}
    <Button onclick={() => { reset(); showForm = true; }}>New accessorial</Button>
  {/snippet}
</PageHeader>

{#if error}<p class="mb-3 text-sm text-danger">{error}</p>{/if}

{#if loading}
  <Card padded={false}><Skeleton rows={6} /></Card>
{:else}
<Table>
  {#snippet head()}
    <th>Code</th><th>Name</th><th>Unit</th><th></th>
  {/snippet}
  {#snippet body()}
    {#each accessorials as acc (acc.id)}
      <tr>
        <td><span class="font-semibold text-ink">{acc.code}</span></td>
        <td>{acc.name}</td>
        <td><Badge tone="neutral">{acc.unit}</Badge></td>
        <td class="text-right">
          <div class="inline-flex gap-2">
            <Button variant="secondary" onclick={() => edit(acc)}>Edit</Button>
            <Button variant="danger" onclick={() => remove(acc)}>Delete</Button>
          </div>
        </td>
      </tr>
    {:else}
      <tr><td colspan="4"><EmptyState message="No accessorials yet." /></td></tr>
    {/each}
  {/snippet}
</Table>
{/if}

<!-- ─── Accessorial form Modal ────────────────────────────────────────────────── -->
<Modal bind:open={showForm} title={editingId ? 'Edit accessorial' : 'New accessorial'}>
  {#snippet children()}
    <form id="acc-form" onsubmit={save}>
      <div class="grid grid-cols-3 gap-x-4">
        <Field label="Code">
          <input
            bind:value={code}
            required
            placeholder="FUEL_SUR"
            oninput={(e) => { code = (e.target as HTMLInputElement).value.toUpperCase(); }}
            class={inputCls}
          />
        </Field>
        <Field label="Name">
          <input bind:value={name} required placeholder="Fuel surcharge" class={inputCls} />
        </Field>
        <Field label="Unit">
          <select bind:value={unit} required class={inputCls}>
            <option value="FLAT">FLAT</option>
            <option value="PER_HOUR">PER_HOUR</option>
            <option value="PER_UNIT">PER_UNIT</option>
          </select>
        </Field>
      </div>
    </form>
  {/snippet}
  {#snippet footer()}
    <Button variant="secondary" onclick={reset}>Cancel</Button>
    <button
      type="submit"
      form="acc-form"
      class="inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors bg-accent text-white hover:bg-accent-hover"
    >{editingId ? 'Update' : 'Create'}</button>
  {/snippet}
</Modal>
