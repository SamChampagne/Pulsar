<script lang="ts">
  import { MODULE_CATALOG, MODULE_KEYS, PERMISSIONS, slugify } from '@pulsar/shared';
  import { api, ApiError } from '$lib/api/client';
  import { auth } from '$lib/stores/auth';
  import { toast } from '$lib/stores/toast';
  import { confirmAction } from '$lib/stores/confirmation';
  import { navCatalogue } from '$lib/modules/navigation';
  import {
    PageHeader,
    Button,
    Card,
    Field,
    Input,
    Textarea,
    Table,
    Badge,
    EmptyState,
    ErrorNotice,
    Skeleton,
    Modal,
  } from '$lib/components/ui';

  interface PermissionRow {
    id: string;
    key: string;
    module: string;
    description: string;
  }

  interface RoleRow {
    id: string;
    key: string;
    name: string;
    description: string | null;
    isSystem: boolean;
    permissions: { permission: { id: string; key: string; module: string; description: string } }[];
    _count: { users: number };
  }

  interface TemplateRow {
    key: string;
    name: string;
    description: string;
    module: string | null;
    permissionKeys: string[];
    exists: boolean;
  }

  interface PermGroup {
    moduleKey: string;
    label: string;
    perms: PermissionRow[];
    readOnly: boolean;
  }

  let roles = $state<RoleRow[]>([]);
  let permissions = $state<PermissionRow[]>([]);
  let templates = $state<TemplateRow[]>([]);
  let loading = $state(true);
  let error = $state('');
  let saving = $state(false);

  let showForm = $state(false);
  let editingRole = $state<RoleRow | null>(null);
  let keyTouched = $state(false);
  let form = $state({ name: '', key: '', description: '', permissionKeys: [] as string[] });

  const customRoleCount = $derived(roles.filter((r) => !r.isSystem).length);

  const canManage = $derived(
    ($auth?.user.permissions ?? []).includes(PERMISSIONS.CORE.ROLES_MANAGE),
  );

  // French domain labels from the sidebar catalogue, keyed by module.
  const moduleLabels = $derived.by(() => {
    const map = new Map<string, string>();
    for (const d of navCatalogue()) {
      if (d.module) map.set(d.module, d.label);
    }
    return map;
  });

  // Modules with no sidebar domain of their own (not yet built out) fall back to the
  // English MODULE_CATALOG name; a tiny French override keeps the group headers consistent.
  const MODULE_LABEL_OVERRIDES: Record<string, string> = {
    [MODULE_KEYS.CUSTOMER_PORTAL]: 'Portail client',
    [MODULE_KEYS.CARRIER_PORTAL]: 'Portail transporteur',
  };

  function labelForModule(key: string): string {
    if (key === MODULE_KEYS.CORE) return 'Plateforme';
    return (
      moduleLabels.get(key) ??
      MODULE_LABEL_OVERRIDES[key] ??
      MODULE_CATALOG.find((m) => m.key === key)?.name ??
      key
    );
  }

  const allowedModuleKeys = $derived<string[]>([
    MODULE_KEYS.CORE,
    ...($auth?.tenant.enabledModules ?? []),
  ]);

  const permGroups = $derived.by((): PermGroup[] => {
    const selected = new Set(form.permissionKeys);
    const groups: PermGroup[] = [];
    for (const m of MODULE_CATALOG) {
      if (!allowedModuleKeys.includes(m.key)) continue;
      const perms = permissions.filter((p) => p.module === m.key);
      if (perms.length === 0) continue;
      groups.push({ moduleKey: m.key, label: labelForModule(m.key), perms, readOnly: false });
    }
    const otherPerms = permissions.filter(
      (p) => !allowedModuleKeys.includes(p.module) && selected.has(p.key),
    );
    if (otherPerms.length > 0) {
      groups.push({
        moduleKey: '__other__',
        label: 'Autres (module inactif)',
        perms: otherPerms,
        readOnly: true,
      });
    }
    return groups;
  });

  const keyError = $derived(
    !editingRole && form.key && !/^[a-z0-9-]+$/.test(form.key)
      ? 'La clé doit être en kebab-case (lettres minuscules, chiffres, tirets).'
      : '',
  );

  async function load() {
    loading = true;
    error = '';
    try {
      const [rolesResult, permissionsResult, templatesResult] = await Promise.all([
        api<RoleRow[]>('/roles'),
        api<PermissionRow[]>('/permissions'),
        api<TemplateRow[]>('/roles/templates'),
      ]);
      roles = rolesResult;
      permissions = permissionsResult;
      templates = templatesResult;
    } catch (e) {
      error = e instanceof ApiError ? e.message : 'Échec du chargement des rôles';
    } finally {
      loading = false;
    }
  }

  function openNew() {
    if (!canManage) return;
    editingRole = null;
    keyTouched = false;
    form = { name: '', key: '', description: '', permissionKeys: [] };
    error = '';
    showForm = true;
  }

  function openEdit(role: RoleRow) {
    if (!canManage) return;
    editingRole = role;
    keyTouched = true;
    form = {
      name: role.name,
      key: role.key,
      description: role.description ?? '',
      permissionKeys: role.permissions.map((p) => p.permission.key),
    };
    error = '';
    showForm = true;
  }

  function onNameInput() {
    if (!keyTouched) form.key = slugify(form.name);
  }

  function onKeyInput() {
    keyTouched = true;
  }

  function togglePerm(key: string) {
    form.permissionKeys = form.permissionKeys.includes(key)
      ? form.permissionKeys.filter((k) => k !== key)
      : [...form.permissionKeys, key];
  }

  function addKeys(keys: string[]) {
    const set = new Set(form.permissionKeys);
    for (const k of keys) set.add(k);
    form.permissionKeys = [...set];
  }

  function toggleAllRead(group: PermGroup) {
    addKeys(group.perms.filter((p) => p.key.endsWith('.read')).map((p) => p.key));
  }

  function toggleAllManage(group: PermGroup) {
    addKeys(group.perms.map((p) => p.key));
  }

  function toggleNone(group: PermGroup) {
    const drop = new Set(group.perms.map((p) => p.key));
    form.permissionKeys = form.permissionKeys.filter((k) => !drop.has(k));
  }

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    if (!editingRole && keyError) return;
    error = '';
    saving = true;
    try {
      if (editingRole) {
        await api(`/roles/${editingRole.id}`, {
          method: 'PATCH',
          body: {
            name: form.name,
            // Unlike create, an edit must be able to CLEAR the description — sending
            // `undefined` here would be dropped by the DTO and the field left unchanged.
            description: form.description,
            ...(editingRole.isSystem ? {} : { permissionKeys: form.permissionKeys }),
          },
        });
        toast.success('Rôle mis à jour');
      } else {
        await api('/roles', {
          method: 'POST',
          body: {
            key: form.key,
            name: form.name,
            description: form.description || undefined,
            permissionKeys: form.permissionKeys,
          },
        });
        toast.success('Rôle créé');
      }
      showForm = false;
      await load();
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : "Échec de l'enregistrement du rôle";
      error = msg;
      toast.error(msg);
    } finally {
      saving = false;
    }
  }

  async function createFromTemplate(t: TemplateRow) {
    if (!canManage) return;
    try {
      await api('/roles/from-template', { method: 'POST', body: { templateKey: t.key } });
      toast.success(`Rôle « ${t.name} » créé`);
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Échec de la création du rôle');
    }
  }

  async function remove(role: RoleRow) {
    if (!canManage || role.isSystem || role._count.users > 0) return;
    if (!(await confirmAction(`Supprimer le rôle « ${role.name} » ?`))) return;
    try {
      await api(`/roles/${role.id}`, { method: 'DELETE' });
      toast.success('Rôle supprimé');
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Échec de la suppression');
    }
  }

  $effect(() => {
    void load();
  });
</script>

<svelte:head><title>Rôles — Pulsar</title></svelte:head>

<PageHeader
  title="Rôles"
  subtitle="Regroupez des permissions en rôles et attribuez-les à vos utilisateurs."
  count={roles.length}
>
  {#snippet actions()}
    {#if canManage}
      <Button onclick={openNew}>Créer un rôle</Button>
    {/if}
  {/snippet}
</PageHeader>

<ErrorNotice message={error && !showForm ? error : ''} onretry={load} />

{#if loading}
  <Card padded={false}><Skeleton rows={6} /></Card>
{:else}
  {#if customRoleCount === 0}
    <Card>
      <EmptyState
        message="Aucun rôle personnalisé — commencez par un rôle suggéré ou créez le vôtre."
      >
        {#snippet children()}
          {#if canManage}
            <Button onclick={openNew}>Créer un rôle</Button>
          {/if}
        {/snippet}
      </EmptyState>
    </Card>
  {/if}

  <Table>
    {#snippet head()}
      <th>Nom</th>
      <th>Clé</th>
      <th>Description</th>
      <th>Utilisateurs</th>
      <th></th>
      <th></th>
    {/snippet}
    {#snippet body()}
      {#each roles as role (role.id)}
        <tr>
          <td class="font-semibold text-ink">{role.name}</td>
          <td class="font-mono text-ink-muted">{role.key}</td>
          <td class="text-ink-muted">{role.description || '—'}</td>
          <td class="font-mono text-ink-muted">{role._count.users}</td>
          <td
            >{#if role.isSystem}<Badge tone="info">Système</Badge>{/if}</td
          >
          <td class="text-right">
            {#if canManage}
              <div class="flex justify-end gap-2">
                <Button variant="secondary" onclick={() => openEdit(role)}>Modifier</Button>
                {#if role.isSystem}
                  <span title="Rôle système : ne peut pas être supprimé">
                    <Button variant="danger" disabled>Supprimer</Button>
                  </span>
                {:else if role._count.users > 0}
                  <span
                    title={`Assigné à ${role._count.users} utilisateur(s) : retirez-le avant de supprimer`}
                  >
                    <Button variant="danger" disabled>Supprimer</Button>
                  </span>
                {:else}
                  <Button variant="danger" onclick={() => remove(role)}>Supprimer</Button>
                {/if}
              </div>
            {/if}
          </td>
        </tr>
      {/each}
    {/snippet}
  </Table>

  {#if canManage && templates.filter((t) => !t.exists).length > 0}
    <Card>
      <h2 class="mb-3 text-sm font-semibold text-ink">Rôles suggérés</h2>
      <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {#each templates.filter((t) => !t.exists) as t (t.key)}
          <div class="flex flex-col rounded-lg border border-edge-soft p-3">
            <div class="font-semibold text-ink">{t.name}</div>
            <p class="mt-1 flex-1 text-xs text-ink-muted">{t.description}</p>
            <details class="mt-2 text-xs text-ink-faint">
              <summary class="cursor-pointer select-none"
                >{t.permissionKeys.length} permissions</summary
              >
              <ul class="mt-1 max-h-40 space-y-0.5 overflow-y-auto font-mono">
                {#each t.permissionKeys as key (key)}
                  <li>{key}</li>
                {/each}
              </ul>
            </details>
            <div class="mt-3">
              <Button variant="secondary" onclick={() => createFromTemplate(t)}
                >Créer ce rôle</Button
              >
            </div>
          </div>
        {/each}
      </div>
    </Card>
  {/if}
{/if}

<Modal
  bind:open={showForm}
  title={editingRole ? `Modifier « ${editingRole.name} »` : 'Créer un rôle'}
  size="xl"
  onclose={() => {
    error = '';
  }}
>
  {#snippet children()}
    <form onsubmit={submit} class="space-y-4">
      {#if error}<p class="text-sm text-danger">{error}</p>{/if}
      <div class="grid gap-3 sm:grid-cols-2">
        <Field label="Nom">
          <Input bind:value={form.name} oninput={onNameInput} required />
        </Field>
        <Field label="Clé" error={keyError}>
          <Input bind:value={form.key} oninput={onKeyInput} disabled={!!editingRole} required />
        </Field>
      </div>
      <Field label="Description">
        <Textarea bind:value={form.description} rows={2} />
      </Field>

      {#if editingRole?.isSystem}
        <p class="text-xs text-ink-muted">
          Les permissions d'un rôle système ne sont pas modifiables.
        </p>
      {/if}

      <div class="space-y-3">
        {#each permGroups as group (group.moduleKey)}
          <div class="rounded-lg border border-edge-soft p-3">
            <div class="mb-2 flex flex-wrap items-center justify-between gap-2">
              <div class="flex items-center gap-2">
                <span class="text-sm font-semibold text-ink">{group.label}</span>
                <span class="font-mono text-xs text-ink-faint">
                  {group.perms.filter((p) => form.permissionKeys.includes(p.key)).length} / {group
                    .perms.length}
                </span>
              </div>
              {#if !group.readOnly && !editingRole?.isSystem}
                <div class="flex gap-1">
                  <Button variant="ghost" onclick={() => toggleAllRead(group)}>Tout lire</Button>
                  <Button variant="ghost" onclick={() => toggleAllManage(group)}>Tout gérer</Button>
                  <Button variant="ghost" onclick={() => toggleNone(group)}>Aucun</Button>
                </div>
              {/if}
            </div>
            <div class="grid gap-1.5 sm:grid-cols-2">
              {#each group.perms as perm (perm.key)}
                <label class="flex items-start gap-2 text-sm text-ink">
                  <input
                    type="checkbox"
                    class="mt-0.5"
                    checked={form.permissionKeys.includes(perm.key)}
                    disabled={group.readOnly || !!editingRole?.isSystem}
                    onchange={() => togglePerm(perm.key)}
                  />
                  <span>
                    <span class="block">{perm.description}</span>
                    <span class="block font-mono text-xs text-ink-faint">{perm.key}</span>
                  </span>
                </label>
              {/each}
            </div>
          </div>
        {/each}
      </div>

      <div class="flex justify-end gap-2 border-t border-edge pt-3">
        <Button
          variant="secondary"
          onclick={() => {
            showForm = false;
            error = '';
          }}>Annuler</Button
        >
        <Button variant="primary" type="submit" loading={saving} disabled={!!keyError}>
          {editingRole ? 'Enregistrer' : 'Créer le rôle'}
        </Button>
      </div>
    </form>
  {/snippet}
</Modal>
