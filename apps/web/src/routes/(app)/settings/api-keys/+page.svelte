<script lang="ts">
  import { API_KEY_SCOPE_PRESETS, PERMISSION_CATALOG } from '@pulsar/shared';
  import { api, ApiError } from '$lib/api/client';
  import { toast } from '$lib/stores/toast';
  import { formatDateTime } from '$lib/format';
  import {
    PageHeader,
    Button,
    Field,
    Input,
    ReferenceSelect,
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
    expiresAt: string | null;
    revokedAt: string | null;
    createdAt: string;
  }

  const allScopes = PERMISSION_CATALOG;
  const presetOptions = API_KEY_SCOPE_PRESETS.map((p) => ({ value: p.key, label: p.label }));

  let keys = $state<KeyRow[]>([]);
  let error = $state('');
  let loading = $state(true);
  let saving = $state(false);
  let showForm = $state(false);
  let name = $state('');
  let scopes = $state<string[]>([]);
  let preset = $state('');
  let expiresAt = $state('');
  let createdKey = $state('');

  function isExpired(key: KeyRow): boolean {
    return !!key.expiresAt && new Date(key.expiresAt).getTime() <= Date.now();
  }

  async function load() {
    try {
      keys = await api<KeyRow[]>('/api-keys');
    } catch (e) {
      error = e instanceof ApiError ? e.message : 'Échec du chargement des clés API';
    } finally {
      loading = false;
    }
  }

  function openNew() {
    name = '';
    scopes = [];
    preset = '';
    expiresAt = '';
    error = '';
    showForm = true;
  }

  function toggleScope(key: string) {
    scopes = scopes.includes(key) ? scopes.filter((s) => s !== key) : [...scopes, key];
  }

  function applyPreset(value: string) {
    const found = API_KEY_SCOPE_PRESETS.find((p) => p.key === value);
    if (found) scopes = [...found.scopes];
  }

  async function create(event: SubmitEvent) {
    event.preventDefault();
    error = '';
    saving = true;
    try {
      const created = await api<KeyRow & { key: string }>('/api-keys', {
        method: 'POST',
        body: { name, scopes, expiresAt: expiresAt || undefined },
      });
      createdKey = created.key;
      name = '';
      scopes = [];
      preset = '';
      expiresAt = '';
      showForm = false;
      await load();
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : 'Échec de la création de la clé';
      error = msg;
      toast.error(msg);
    } finally {
      saving = false;
    }
  }

  async function copyKey() {
    await navigator.clipboard.writeText(createdKey);
    toast.success('Clé API copiée — conservez-la, elle ne sera plus affichée');
  }

  async function revoke(key: KeyRow) {
    try {
      await api(`/api-keys/${key.id}`, { method: 'DELETE' });
      toast.success(`${key.name} révoquée`);
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Échec de la révocation');
    }
  }

  $effect(() => {
    void load();
  });
</script>

<PageHeader title="Clés API" count={keys.length}>
  {#snippet actions()}
    <Button onclick={openNew}>Nouvelle clé API</Button>
  {/snippet}
</PageHeader>

<p class="mb-4 text-sm text-ink-muted">
  Accès machine-à-machine via l'en-tête
  <code class="rounded bg-surface-muted px-1 font-mono text-xs">X-Api-Key</code>. Choisissez un
  modèle de portée puis ajustez-le au besoin, avec une expiration optionnelle.
</p>

{#if error && !showForm}<p class="mb-3 text-sm text-danger">{error}</p>{/if}

{#if createdKey}
  <Card>
    <div class="flex flex-wrap items-center gap-3">
      <div class="flex-1">
        <p class="mb-1 text-xs font-semibold tracking-wide text-ink-muted uppercase">
          Votre nouvelle clé API — affichée une seule fois
        </p>
        <code class="block break-all font-mono text-sm text-ink">{createdKey}</code>
      </div>
      <Button variant="secondary" onclick={copyKey}>Copier</Button>
    </div>
    <p class="mt-2 text-xs text-ink-muted">
      Conservez-la en lieu sûr. Vous ne pourrez plus la consulter.
    </p>
  </Card>
{/if}

{#if loading}
  <Card padded={false}><Skeleton rows={5} /></Card>
{:else if keys.length === 0}
  <Card>
    <EmptyState message="Aucune clé API pour le moment.">
      {#snippet children()}
        <Button onclick={openNew}>Nouvelle clé API</Button>
      {/snippet}
    </EmptyState>
  </Card>
{:else}
  <Table>
    {#snippet head()}
      <th>Nom</th>
      <th>Préfixe</th>
      <th>Portées</th>
      <th>Dernière utilisation</th>
      <th>Expiration</th>
      <th>Statut</th>
      <th></th>
    {/snippet}
    {#snippet body()}
      {#each keys as key (key.id)}
        <tr>
          <td class="font-semibold text-ink">{key.name}</td>
          <td><code class="font-mono text-xs text-ink-muted">{key.prefix}…</code></td>
          <td class="max-w-xs truncate font-mono text-xs text-ink-muted">{key.scopes.join(', ')}</td
          >
          <td class="font-mono text-ink-muted">{formatDateTime(key.lastUsedAt)}</td>
          <td class="font-mono text-ink-muted">
            {key.expiresAt ? formatDateTime(key.expiresAt) : 'Jamais'}
          </td>
          <td>
            {#if key.revokedAt}
              <Badge tone="danger">Révoquée</Badge>
            {:else if isExpired(key)}
              <Badge tone="danger">Expirée</Badge>
            {:else}
              <Badge tone="ok">Active</Badge>
            {/if}
          </td>
          <td class="text-right">
            {#if !key.revokedAt}
              <Button
                variant="danger"
                onclick={(e) => {
                  e.stopPropagation();
                  void revoke(key);
                }}>Révoquer</Button
              >
            {/if}
          </td>
        </tr>
      {/each}
    {/snippet}
  </Table>
{/if}

<Modal bind:open={showForm} title="Nouvelle clé API" size="md">
  {#snippet children()}
    <form onsubmit={create} class="space-y-3">
      {#if error}<p class="text-sm text-danger">{error}</p>{/if}
      <Field label="Nom">
        <Input bind:value={name} required placeholder="Accès lecture ERP" />
      </Field>
      <Field label="Modèle de portée">
        <ReferenceSelect
          options={presetOptions}
          bind:value={preset}
          clearable
          placeholder="Aucun (choisir manuellement)"
          onchange={(e) => applyPreset(e.currentTarget.value)}
        />
        <p class="mt-1 text-xs text-ink-muted">
          Pré-remplit les portées ci-dessous — vous pouvez ensuite les ajuster.
        </p>
      </Field>
      <div>
        <span class="mb-1.5 block text-xs font-semibold tracking-wide text-ink-muted uppercase"
          >Portées</span
        >
        <div class="grid max-h-64 grid-cols-1 gap-1.5 overflow-y-auto">
          {#each allScopes as scope (scope.key)}
            <label class="flex cursor-pointer items-center gap-1.5 text-xs text-ink">
              <input
                type="checkbox"
                checked={scopes.includes(scope.key)}
                onchange={() => toggleScope(scope.key)}
              />
              <code class="font-mono text-ink-muted">{scope.key}</code>
            </label>
          {/each}
        </div>
      </div>
      <Field label="Expiration (optionnelle)">
        <Input type="date" bind:value={expiresAt} />
      </Field>
      <div class="flex justify-end gap-2 border-t border-edge pt-3">
        <Button
          variant="secondary"
          onclick={() => {
            showForm = false;
          }}>Annuler</Button
        >
        <Button variant="primary" type="submit" loading={saving} disabled={scopes.length === 0}>
          Créer la clé
        </Button>
      </div>
    </form>
  {/snippet}
</Modal>
