<script lang="ts">
  import type { Paginated } from '@pulsar/shared';
  import { api, ApiError } from '$lib/api/client';
  import { toast } from '$lib/stores/toast';

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

  // Form state
  let editingId = $state<string | null>(null);
  let code = $state('');
  let name = $state('');
  let unit = $state<'FLAT' | 'PER_HOUR' | 'PER_UNIT'>('FLAT');

  async function load() {
    try {
      const result = await api<Paginated<Accessorial>>('/transportation/accessorials', {
        query: { pageSize: 100 },
      });
      accessorials = result.items;
      total = result.total;
    } catch (e) {
      error = e instanceof ApiError ? e.message : 'Failed to load accessorials';
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

<div class="page-header">
  <h1>Accessorials <span class="muted">({total})</span></h1>
  <button class="btn" onclick={() => { reset(); showForm = !showForm; }}>New accessorial</button>
</div>

{#if error}
  <p class="error-text">{error}</p>
{/if}

{#if showForm}
  <form class="card" style="margin-bottom: 20px;" onsubmit={save}>
    <h2 style="margin-top: 0;">{editingId ? 'Edit accessorial' : 'New accessorial'}</h2>

    <div class="form-grid">
      <div class="field">
        <label for="acc-code">Code</label>
        <input
          id="acc-code"
          bind:value={code}
          required
          placeholder="FUEL_SUR"
          oninput={(e) => { code = (e.target as HTMLInputElement).value.toUpperCase(); }}
        />
      </div>
      <div class="field">
        <label for="acc-name">Name</label>
        <input id="acc-name" bind:value={name} required placeholder="Fuel surcharge" />
      </div>
      <div class="field">
        <label for="acc-unit">Unit</label>
        <select id="acc-unit" bind:value={unit} required>
          <option value="FLAT">FLAT</option>
          <option value="PER_HOUR">PER_HOUR</option>
          <option value="PER_UNIT">PER_UNIT</option>
        </select>
      </div>
    </div>

    <div style="display: flex; gap: 8px; margin-top: 12px;">
      <button class="btn" type="submit">{editingId ? 'Update' : 'Create'}</button>
      <button class="btn btn-secondary" type="button" onclick={reset}>Cancel</button>
    </div>
  </form>
{/if}

<div class="card" style="padding: 0;">
  <table>
    <thead>
      <tr>
        <th>Code</th>
        <th>Name</th>
        <th>Unit</th>
        <th></th>
      </tr>
    </thead>
    <tbody>
      {#each accessorials as acc (acc.id)}
        <tr>
          <td><strong>{acc.code}</strong></td>
          <td>{acc.name}</td>
          <td>
            <span class="badge badge-muted">{acc.unit}</span>
          </td>
          <td style="text-align: right;">
            <button class="btn btn-secondary btn-sm" onclick={() => edit(acc)}>Edit</button>
            <button class="btn btn-danger btn-sm" onclick={() => remove(acc)}>Delete</button>
          </td>
        </tr>
      {:else}
        <tr><td colspan="4" class="muted">No accessorials yet.</td></tr>
      {/each}
    </tbody>
  </table>
</div>

<style>
  .form-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 0 20px;
  }
</style>
