<script lang="ts">
  import { goto } from '$app/navigation';
  import { getPlatformToken, platformApi, PlatformApiError } from '$lib/api/platform';
  import {
    Badge,
    Button,
    EmptyState,
    Field,
    Input,
    Modal,
    PageHeader,
    Select,
    Skeleton,
    Table,
    Textarea,
  } from '$lib/components/ui';

  type Kind = 'FEATURE' | 'IMPROVEMENT' | 'FIX';
  type Status = 'DRAFT' | 'PUBLISHED';

  interface ReleaseNote {
    id: string;
    title: string;
    body: string;
    bodyHtml: string;
    kind: Kind;
    version: string | null;
    status: Status;
    publishedAt: string | null;
    createdByEmail: string;
    createdAt: string;
    updatedAt: string;
  }

  const KIND_LABELS: Record<Kind, string> = {
    FEATURE: 'Nouveauté',
    IMPROVEMENT: 'Amélioration',
    FIX: 'Correctif',
  };
  const KIND_TONES: Record<Kind, 'ok' | 'info' | 'warn'> = {
    FEATURE: 'ok',
    IMPROVEMENT: 'info',
    FIX: 'warn',
  };

  let notes = $state<ReleaseNote[]>([]);
  let loadingData = $state(true);
  let error = $state('');
  let busy = $state(false);

  let showForm = $state(false);
  let editing = $state<ReleaseNote | null>(null);
  let title = $state('');
  let kind = $state<Kind>('FEATURE');
  let version = $state('');
  let body = $state('');

  let confirmTarget = $state<{ note: ReleaseNote; action: 'publish' | 'unpublish' | 'delete' } | null>(
    null,
  );
  let confirmOpen = $state(false);

  async function load() {
    if (!getPlatformToken()) {
      void goto('/platform/login');
      return;
    }
    loadingData = true;
    error = '';
    try {
      notes = await platformApi<ReleaseNote[]>('/platform/release-notes');
    } catch (e) {
      error = e instanceof PlatformApiError ? e.message : 'Failed to load release notes';
    } finally {
      loadingData = false;
    }
  }

  function openCreate() {
    editing = null;
    title = '';
    kind = 'FEATURE';
    version = '';
    body = '';
    error = '';
    showForm = true;
  }

  function openEdit(note: ReleaseNote) {
    editing = note;
    title = note.title;
    kind = note.kind;
    version = note.version ?? '';
    body = note.body;
    error = '';
    showForm = true;
  }

  async function saveNote(event: SubmitEvent) {
    event.preventDefault();
    if (busy) return;
    busy = true;
    error = '';
    try {
      const dto = { title, kind, body, version: version || undefined };
      if (editing) {
        await platformApi(`/platform/release-notes/${editing.id}`, { method: 'PATCH', body: dto });
      } else {
        await platformApi('/platform/release-notes', { method: 'POST', body: dto });
      }
      showForm = false;
      await load();
    } catch (e) {
      error = e instanceof PlatformApiError ? e.message : 'Failed to save release note';
    } finally {
      busy = false;
    }
  }

  async function runConfirmed() {
    if (!confirmTarget || busy) return;
    const { note, action } = confirmTarget;
    busy = true;
    error = '';
    try {
      if (action === 'delete') {
        await platformApi(`/platform/release-notes/${note.id}`, { method: 'DELETE' });
      } else {
        await platformApi(`/platform/release-notes/${note.id}/${action}`, { method: 'POST' });
      }
      confirmOpen = false;
      confirmTarget = null;
      await load();
    } catch (e) {
      error = e instanceof PlatformApiError ? e.message : `Failed to ${action}`;
    } finally {
      busy = false;
    }
  }

  $effect(() => {
    void load();
  });
</script>

<svelte:head><title>Nouveautés | Pulsar</title></svelte:head>
<div>
  <PageHeader
    title="Nouveautés"
    subtitle="Fil « Quoi de neuf » lu par les entreprises clientes."
    count={loadingData ? undefined : notes.length}
  >
    {#snippet actions()}
      <Button variant="primary" onclick={openCreate}>Nouvelle note</Button>
    {/snippet}
  </PageHeader>

  {#if error}
    <p class="mb-4 text-sm text-danger">{error}</p>
  {/if}

  {#if loadingData}
    <Skeleton rows={5} />
  {:else}
    <Table>
      {#snippet head()}
        <th>Titre</th>
        <th>Type</th>
        <th>Version</th>
        <th>Statut</th>
        <th>Publié le</th>
        <th></th>
      {/snippet}
      {#snippet body()}
        {#each notes as note (note.id)}
          <tr>
            <td class="font-medium text-ink"
              ><button class="text-left text-accent hover:underline" onclick={() => openEdit(note)}
                >{note.title}</button
              ></td
            >
            <td><Badge tone={KIND_TONES[note.kind]}>{KIND_LABELS[note.kind]}</Badge></td>
            <td class="font-mono text-xs text-ink-muted">{note.version ?? '—'}</td>
            <td
              ><Badge tone={note.status === 'PUBLISHED' ? 'ok' : 'neutral'}
                >{note.status === 'PUBLISHED' ? 'Publiée' : 'Brouillon'}</Badge
              ></td
            >
            <td class="text-ink-muted"
              >{note.publishedAt ? new Date(note.publishedAt).toLocaleString('fr-CA') : '—'}</td
            >
            <td class="text-right">
              <div class="flex justify-end gap-2">
                {#if note.status === 'DRAFT'}
                  <Button
                    variant="secondary"
                    onclick={() => {
                      confirmTarget = { note, action: 'publish' };
                      confirmOpen = true;
                    }}>Publier</Button
                  >
                  <Button
                    variant="ghost"
                    onclick={() => {
                      confirmTarget = { note, action: 'delete' };
                      confirmOpen = true;
                    }}>Supprimer</Button
                  >
                {:else}
                  <Button
                    variant="secondary"
                    onclick={() => {
                      confirmTarget = { note, action: 'unpublish' };
                      confirmOpen = true;
                    }}>Dépublier</Button
                  >
                {/if}
              </div>
            </td>
          </tr>
        {:else}
          <tr>
            <td colspan="6">
              <EmptyState message="Aucune note pour l’instant. Créez la première." />
            </td>
          </tr>
        {/each}
      {/snippet}
    </Table>
  {/if}
</div>

<Modal bind:open={showForm} title={editing ? 'Modifier la note' : 'Nouvelle note'} size="lg">
  <form onsubmit={saveNote} class="space-y-4">
    <Field label="Titre">
      <Input bind:value={title} required maxlength={160} />
    </Field>
    <Field label="Type">
      <Select bind:value={kind}>
        <option value="FEATURE">Nouveauté</option>
        <option value="IMPROVEMENT">Amélioration</option>
        <option value="FIX">Correctif</option>
      </Select>
    </Field>
    <Field label="Version (optionnel)">
      <Input bind:value={version} maxlength={40} placeholder="1.4.0" />
    </Field>
    <Field label="Corps">
      <Textarea bind:value={body} rows={8} required maxlength={8000} />
      <p class="mt-1 text-xs text-ink-faint">
        Mise en forme simple : **gras**, listes avec des lignes commençant par « - », paragraphes
        séparés par une ligne vide.
      </p>
    </Field>

    {#if error}
      <p class="text-sm text-danger">{error}</p>
    {/if}

    <div class="flex justify-end gap-2 pt-2">
      <Button
        variant="secondary"
        disabled={busy}
        onclick={() => {
          showForm = false;
        }}>Annuler</Button
      >
      <Button type="submit" variant="primary" loading={busy}
        >{editing ? 'Enregistrer' : 'Créer'}</Button
      >
    </div>
  </form>
</Modal>

<Modal
  bind:open={confirmOpen}
  title={confirmTarget?.action === 'publish'
    ? 'Publier la note'
    : confirmTarget?.action === 'unpublish'
      ? 'Dépublier la note'
      : 'Supprimer la note'}
>
  {#if confirmTarget}
    <p class="text-sm leading-6">{confirmTarget.note.title}</p>
    <p class="mt-2 text-sm text-ink-muted">
      {#if confirmTarget.action === 'publish'}
        Les entreprises clientes verront cette note dans leur fil « Quoi de neuf ».
      {:else if confirmTarget.action === 'unpublish'}
        La note redevient un brouillon et disparaît du fil des entreprises clientes.
      {:else}
        Cette action est définitive.
      {/if}
    </p>
    <div class="mt-5 flex justify-end gap-2">
      <Button
        variant="secondary"
        disabled={busy}
        onclick={() => {
          confirmOpen = false;
          confirmTarget = null;
        }}>Annuler</Button
      >
      <Button
        variant={confirmTarget.action === 'delete' ? 'danger' : 'primary'}
        loading={busy}
        onclick={runConfirmed}>Confirmer</Button
      >
    </div>
  {/if}
</Modal>
