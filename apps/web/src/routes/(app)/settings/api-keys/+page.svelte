<script lang="ts">
  import { PERMISSION_CATALOG } from '@pulsar/shared';
  import { api, ApiError } from '$lib/api/client';
  import { toast } from '$lib/stores/toast';
  import { formatDateTime } from '$lib/format';
  import {
    PageHeader,
    Button,
    Field,
    Input,
    Table,
    Badge,
    EmptyState,
    Card,
    Skeleton,
    Modal,
  } from '$lib/components/ui';

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
  let loading = $state(true);
  let showForm = $state(false);
  let name = $state('');
  let scopes = $state<string[]>([]);
  let createdKey = $state('');

  async function load() {
    try {
      keys = await api<KeyRow[]>('/api-keys');
    } catch (e) {
      error = e instanceof ApiError ? e.message : 'Failed to load API keys';
    } finally {
      loading = false;
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
      showForm = false;
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

<PageHeader title="API keys">
  {#snippet actions()}
    <Button onclick={() => { showForm = true; }}>New API key</Button>
  {/snippet}
</PageHeader>

<p class="mb-4 text-sm text-ink-muted">
  Machine-to-machine access via the <code class="rounded bg-surface-muted px-1 text-xs">X-Api-Key</code> header.
  Read-only scopes for now — write access will come with service accounts.
</p>

{#if error}<p class="mb-3 text-sm text-danger">{error}</p>{/if}

{#if createdKey}
  <Card>
    <div class="flex flex-wrap items-center gap-3">
      <div class="flex-1">
        <p class="mb-1 text-xs font-semibold tracking-wide text-ink-muted uppercase">Your new API key — shown once</p>
        <code class="break-all text-sm text-ink">{createdKey}</code>
      </div>
      <Button variant="secondary" onclick={copyKey}>Copy</Button>
    </div>
    <p class="mt-2 text-xs text-ink-muted">Store it somewhere safe. You will not be able to view it again.</p>
  </Card>
{/if}

{#if loading}
  <Card padded={false}><Skeleton rows={5} /></Card>
{:else}
  <Table>
    {#snippet head()}
      <th>Name</th>
      <th>Prefix</th>
      <th>Scopes</th>
      <th>Last used</th>
      <th>Status</th>
      <th></th>
    {/snippet}
    {#snippet body()}
      {#each keys as key (key.id)}
        <tr>
          <td class="font-semibold">{key.name}</td>
          <td><code class="text-xs text-ink-muted">{key.prefix}…</code></td>
          <td class="max-w-xs truncate text-xs text-ink-muted">{key.scopes.join(', ')}</td>
          <td class="text-ink-muted">{formatDateTime(key.lastUsedAt)}</td>
          <td>
            {#if key.revokedAt}
              <Badge tone="danger">Revoked</Badge>
            {:else}
              <Badge tone="ok">Active</Badge>
            {/if}
          </td>
          <td class="text-right">
            {#if !key.revokedAt}
              <Button
                variant="danger"
                onclick={(e) => { e.stopPropagation(); void revoke(key); }}
              >Revoke</Button>
            {/if}
          </td>
        </tr>
      {:else}
        <tr>
          <td colspan={6}><EmptyState message="No API keys yet." /></td>
        </tr>
      {/each}
    {/snippet}
  </Table>
{/if}

<Modal bind:open={showForm} title="New API key">
  {#snippet children()}
    <form onsubmit={create}>
      <Field label="Name">
        <Input bind:value={name} required placeholder="ERP read access" />
      </Field>
      <div class="mt-3">
        <span class="mb-1.5 block text-xs font-semibold tracking-wide text-ink-muted uppercase">Scopes</span>
        <div class="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
          {#each readScopes as scope (scope.key)}
            <label class="flex cursor-pointer items-center gap-1.5 text-xs text-ink">
              <input
                type="checkbox"
                checked={scopes.includes(scope.key)}
                onchange={() => toggleScope(scope.key)}
              />
              <code class="text-ink-muted">{scope.key}</code>
            </label>
          {/each}
        </div>
      </div>
      <div class="mt-4 flex justify-end gap-2 border-t border-edge pt-3">
        <Button variant="secondary" onclick={() => { showForm = false; }}>Cancel</Button>
        <Button variant="primary" type="submit" disabled={scopes.length === 0}>Create key</Button>
      </div>
    </form>
  {/snippet}
</Modal>
