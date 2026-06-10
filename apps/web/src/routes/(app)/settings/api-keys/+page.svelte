<script lang="ts">
  import { PERMISSION_CATALOG } from '@pulsar/shared';
  import { api, ApiError } from '$lib/api/client';
  import { toast } from '$lib/stores/toast';

  interface KeyRow {
    id: string;
    name: string;
    prefix: string;
    scopes: string[];
    lastUsedAt: string | null;
    revokedAt: string | null;
    createdAt: string;
  }

  const readScopes = PERMISSION_CATALOG.filter((p) => p.key.endsWith('.read'));

  let keys = $state<KeyRow[]>([]);
  let error = $state('');
  let showForm = $state(false);
  let name = $state('');
  let scopes = $state<string[]>([]);
  let createdKey = $state('');

  async function load() {
    try {
      keys = await api<KeyRow[]>('/api-keys');
    } catch (e) {
      error = e instanceof ApiError ? e.message : 'Failed to load API keys';
    }
  }

  function toggleScope(key: string) {
    scopes = scopes.includes(key) ? scopes.filter((s) => s !== key) : [...scopes, key];
  }

  async function create(event: SubmitEvent) {
    event.preventDefault();
    try {
      const created = await api<KeyRow & { key: string }>('/api-keys', {
        method: 'POST',
        body: { name, scopes },
      });
      createdKey = created.key;
      name = '';
      scopes = [];
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to create key');
    }
  }

  async function copyKey() {
    await navigator.clipboard.writeText(createdKey);
    toast.success('API key copied — store it now, it will not be shown again');
  }

  async function revoke(key: KeyRow) {
    try {
      await api(`/api-keys/${key.id}`, { method: 'DELETE' });
      toast.success(`${key.name} revoked`);
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to revoke');
    }
  }

  $effect(() => {
    void load();
  });
</script>

<div class="page-header">
  <h1>API keys</h1>
  <button class="btn" onclick={() => (showForm = !showForm)}>New API key</button>
</div>

<p class="muted">
  Machine-to-machine access via the <code>X-Api-Key</code> header. Read-only scopes for now —
  write access will come with service accounts.
</p>

{#if error}
  <p class="error-text">{error}</p>
{/if}

{#if showForm}
  <form class="card" style="margin-bottom: 20px;" onsubmit={create}>
    <h2 style="margin-top: 0;">New API key</h2>
    <div class="field" style="max-width: 360px;">
      <label for="name">Name</label>
      <input id="name" bind:value={name} required placeholder="ERP read access" />
    </div>
    <div class="field">
      <span class="muted" style="font-size: 12px; font-weight: 550;">Scopes</span>
      <div class="scopes">
        {#each readScopes as scope (scope.key)}
          <label class="scope-check">
            <input
              type="checkbox"
              checked={scopes.includes(scope.key)}
              onchange={() => toggleScope(scope.key)}
            />
            <code>{scope.key}</code>
          </label>
        {/each}
      </div>
    </div>
    <button class="btn" type="submit" disabled={scopes.length === 0}>Create key</button>
    {#if createdKey}
      <div class="created-key">
        <code>{createdKey}</code>
        <button class="btn btn-secondary btn-sm" type="button" onclick={copyKey}>Copy</button>
        <span class="muted">Shown once — store it safely.</span>
      </div>
    {/if}
  </form>
{/if}

<div class="card" style="padding: 0;">
  <table>
    <thead>
      <tr><th>Name</th><th>Prefix</th><th>Scopes</th><th>Last used</th><th>Status</th><th></th></tr>
    </thead>
    <tbody>
      {#each keys as key (key.id)}
        <tr>
          <td><strong>{key.name}</strong></td>
          <td><code>{key.prefix}…</code></td>
          <td class="muted" style="max-width: 320px;">{key.scopes.join(', ')}</td>
          <td>{key.lastUsedAt ? new Date(key.lastUsedAt).toLocaleString() : '—'}</td>
          <td>
            <span class="badge {key.revokedAt ? 'badge-danger' : 'badge-success'}">
              {key.revokedAt ? 'REVOKED' : 'ACTIVE'}
            </span>
          </td>
          <td style="text-align: right;">
            {#if !key.revokedAt}
              <button class="btn btn-danger btn-sm" onclick={() => revoke(key)}>Revoke</button>
            {/if}
          </td>
        </tr>
      {:else}
        <tr><td colspan="6" class="muted">No API keys yet.</td></tr>
      {/each}
    </tbody>
  </table>
</div>

<style>
  .scopes {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 6px;
    margin-top: 6px;
  }

  .scope-check {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    color: var(--color-text);
  }

  .scope-check input {
    width: auto;
  }

  .created-key {
    margin-top: 14px;
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
    background: var(--color-bg);
    border: 1px solid var(--color-border);
    border-radius: var(--radius);
    padding: 10px;
  }
</style>
