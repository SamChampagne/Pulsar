<script lang="ts">
  import type { Paginated } from '@pulsar/shared';
  import { api, ApiError } from '$lib/api/client';
  import StatusBadge from '$lib/components/StatusBadge.svelte';

  interface CarrierRow {
    id: string;
    code: string;
    name: string;
    scacCode: string | null;
    contactName: string | null;
    phone: string | null;
    status: string;
  }

  let carriers = $state<CarrierRow[]>([]);
  let total = $state(0);
  let search = $state('');
  let error = $state('');
  let showForm = $state(false);
  let form = $state({ code: '', name: '', scacCode: '', contactName: '', phone: '' });

  async function load() {
    try {
      const result = await api<Paginated<CarrierRow>>('/transportation/carriers', {
        query: { search, pageSize: 50 },
      });
      carriers = result.items;
      total = result.total;
    } catch (e) {
      error = e instanceof ApiError ? e.message : 'Failed to load carriers';
    }
  }

  async function create(event: SubmitEvent) {
    event.preventDefault();
    error = '';
    try {
      await api('/transportation/carriers', {
        method: 'POST',
        body: {
          code: form.code,
          name: form.name,
          scacCode: form.scacCode || undefined,
          contactName: form.contactName || undefined,
          phone: form.phone || undefined,
        },
      });
      showForm = false;
      form = { code: '', name: '', scacCode: '', contactName: '', phone: '' };
      await load();
    } catch (e) {
      error = e instanceof ApiError ? e.message : 'Failed to create carrier';
    }
  }

  $effect(() => {
    void load();
  });
</script>

<div class="page-header">
  <h1>Carriers <span class="muted">({total})</span></h1>
  <button class="btn" onclick={() => (showForm = !showForm)}>New carrier</button>
</div>

{#if error}
  <p class="error-text">{error}</p>
{/if}

{#if showForm}
  <form class="card" style="margin-bottom: 20px;" onsubmit={create}>
    <h2 style="margin-top: 0;">New carrier</h2>
    <div class="form-grid">
      <div class="field">
        <label for="code">Code</label>
        <input id="code" bind:value={form.code} required placeholder="CARR-002" />
      </div>
      <div class="field">
        <label for="name">Name</label>
        <input id="name" bind:value={form.name} required />
      </div>
      <div class="field">
        <label for="scac">SCAC</label>
        <input id="scac" bind:value={form.scacCode} />
      </div>
      <div class="field">
        <label for="contact">Contact</label>
        <input id="contact" bind:value={form.contactName} />
      </div>
      <div class="field">
        <label for="phone">Phone</label>
        <input id="phone" bind:value={form.phone} />
      </div>
    </div>
    <div style="display: flex; gap: 8px;">
      <button class="btn" type="submit">Create</button>
      <button class="btn btn-secondary" type="button" onclick={() => (showForm = false)}>
        Cancel
      </button>
    </div>
  </form>
{/if}

<div class="card" style="padding: 0;">
  <div style="padding: 14px 12px;">
    <input
      placeholder="Search name, code, SCAC…"
      bind:value={search}
      onkeydown={(e) => e.key === 'Enter' && load()}
      style="max-width: 320px;"
    />
  </div>
  <table>
    <thead>
      <tr>
        <th>Code</th>
        <th>Name</th>
        <th>SCAC</th>
        <th>Contact</th>
        <th>Phone</th>
        <th>Status</th>
      </tr>
    </thead>
    <tbody>
      {#each carriers as carrier (carrier.id)}
        <tr>
          <td><strong>{carrier.code}</strong></td>
          <td>{carrier.name}</td>
          <td>{carrier.scacCode ?? '—'}</td>
          <td>{carrier.contactName ?? '—'}</td>
          <td>{carrier.phone ?? '—'}</td>
          <td><StatusBadge status={carrier.status} /></td>
        </tr>
      {:else}
        <tr><td colspan="6" class="muted">No carriers yet.</td></tr>
      {/each}
    </tbody>
  </table>
</div>

<style>
  .form-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0 20px;
  }
</style>
