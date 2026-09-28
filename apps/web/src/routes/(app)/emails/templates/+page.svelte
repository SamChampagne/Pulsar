<script lang="ts">
  import EmailPreview from '$lib/components/email/EmailPreview.svelte';
  import EmailBodyEditor from '$lib/components/email/EmailBodyEditor.svelte';
  import { confirmAction } from '$lib/stores/confirmation';
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
    Input,
    Field,
    ErrorNotice,
    Modal,
  } from '$lib/components/ui';

  interface EmailTemplate {
    id: string;
    key: string;
    name: string;
    subject: string;
    html: string;
    category: string | null;
  }

  // — Data —
  let templates = $state<EmailTemplate[]>([]);
  let loading = $state(true);
  let error = $state('');

  // — Form modal —
  let showForm = $state(false);
  let editingId = $state<string | null>(null);
  let formSaving = $state(false);

  interface TemplateForm {
    key: string;
    name: string;
    subject: string;
    html: string;
    category: string;
  }

  let form = $state<TemplateForm>({
    key: '',
    name: '',
    subject: '',
    html: '',
    category: '',
  });

  // — Delete confirm —
  let deletingId = $state<string | null>(null);

  async function load() {
    loading = true;
    error = '';
    try {
      const result = await api<EmailTemplate[]>('/emails/templates');
      templates = result;
    } catch (e) {
      error = e instanceof ApiError ? e.message : 'Échec du chargement';
    } finally {
      loading = false;
    }
  }

  function openCreate() {
    editingId = null;
    form = { key: '', name: '', subject: '', html: '', category: '' };
    showForm = true;
  }

  function openEdit(tpl: EmailTemplate) {
    editingId = tpl.id;
    form = {
      key: tpl.key,
      name: tpl.name,
      subject: tpl.subject,
      html: tpl.html,
      category: tpl.category ?? '',
    };
    showForm = true;
  }

  function closeForm() {
    showForm = false;
  }

  async function saveForm() {
    if (!form.key.trim() || !form.name.trim()) {
      toast.error('La clé et le nom sont obligatoires');
      return;
    }
    formSaving = true;
    try {
      if (editingId) {
        await api(`/emails/templates/${editingId}`, {
          method: 'PUT',
          body: {
            name: form.name,
            subject: form.subject,
            html: form.html,
            category: form.category || undefined,
          },
        });
        toast.success('Gabarit mis à jour');
      } else {
        await api('/emails/templates', {
          method: 'POST',
          body: {
            key: form.key,
            name: form.name,
            subject: form.subject,
            html: form.html,
            category: form.category || undefined,
          },
        });
        toast.success('Gabarit créé');
      }
      closeForm();
      void load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Erreur lors de la sauvegarde');
    } finally {
      formSaving = false;
    }
  }

  async function deleteTemplate(id: string) {
    if (
      !(await confirmAction('Supprimer ce gabarit ? Les courriels déjà envoyés seront conservés.', {
        confirmLabel: 'Supprimer',
      }))
    )
      return;
    deletingId = id;
    try {
      await api(`/emails/templates/${id}`, { method: 'DELETE' });
      toast.success('Gabarit supprimé');
      void load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Erreur lors de la suppression');
    } finally {
      deletingId = null;
    }
  }

  $effect(() => {
    void load();
  });
</script>

<PageHeader title="Gabarits de courriels" eyebrow="Courriels" count={templates.length}>
  {#snippet actions()}
    <Button onclick={openCreate}>Nouveau gabarit</Button>
  {/snippet}
</PageHeader>

<ErrorNotice message={error} onretry={load} />

{#if loading}
  <Card padded={false}><div class="p-4"><Skeleton rows={5} /></div></Card>
{:else}
  <Table>
    {#snippet head()}
      <th>Clé</th>
      <th>Nom</th>
      <th>Catégorie</th>
      <th>Sujet</th>
      <th class="text-right">Actions</th>
    {/snippet}
    {#snippet body()}
      {#each templates as tpl (tpl.id)}
        <tr>
          <td><span class="font-mono text-xs text-ink-muted">{tpl.key}</span></td>
          <td class="font-medium">{tpl.name}</td>
          <td>
            {#if tpl.category}
              <Badge tone="neutral">{tpl.category}</Badge>
            {:else}
              <span class="text-ink-faint">—</span>
            {/if}
          </td>
          <td class="max-w-[20rem] truncate text-sm text-ink-muted">{tpl.subject}</td>
          <td class="text-right">
            <div class="inline-flex items-center gap-1.5">
              <button
                type="button"
                onclick={() => openEdit(tpl)}
                class="inline-flex items-center justify-center rounded-md border border-edge bg-surface px-3 py-1 text-xs font-medium text-ink transition-colors hover:bg-surface-muted"
                >Modifier</button
              >
              <button
                type="button"
                onclick={() => deleteTemplate(tpl.id)}
                disabled={deletingId === tpl.id}
                class="inline-flex items-center justify-center rounded-md border border-danger/30 bg-danger-soft px-3 py-1 text-xs font-medium text-danger transition-colors hover:bg-danger/10 disabled:opacity-50"
                >{deletingId === tpl.id ? '…' : 'Supprimer'}</button
              >
            </div>
          </td>
        </tr>
      {:else}
        <tr>
          <td colspan="5">
            <EmptyState
              title="Aucun gabarit"
              message="Créez un gabarit de courriel pour l'utiliser lors de la rédaction."
            />
          </td>
        </tr>
      {/each}
    {/snippet}
  </Table>
{/if}

<!-- Form Modal -->
<Modal
  bind:open={showForm}
  title={editingId ? 'Modifier le gabarit' : 'Nouveau gabarit'}
  size="xl"
  onclose={closeForm}
>
  <div class="grid items-start gap-5 lg:grid-cols-2">
    <div class="flex flex-col gap-4">
      <div>
        <Field label="Clé">
          <Input bind:value={form.key} placeholder="tender_accepted" disabled={!!editingId} />
        </Field>
        <p class="mt-1 text-xs text-ink-faint">
          Identifiant technique unique (ex. <code class="font-mono">tender_accepted</code>)
        </p>
      </div>

      <Field label="Nom">
        <Input bind:value={form.name} placeholder="Appel d'offres accepté" />
      </Field>

      <Field label="Catégorie (optionnelle)">
        <Input bind:value={form.category} placeholder="TMS, Facturation…" />
      </Field>

      <div>
        <Field label="Sujet">
          <Input
            bind:value={form.subject}
            placeholder="Votre appel d'offres {'{ref}'} a été accepté"
          />
        </Field>
        <p class="mt-1 text-xs text-ink-faint">
          Variables : utilisez <code class="font-mono">{'{variable}'}</code> (accolades simples)
        </p>
      </div>

      <div>
        <EmailBodyEditor bind:html={form.html} />
        <p class="mt-1 text-xs text-ink-faint">
          Variables : utilisez <code class="font-mono">{'{variable}'}</code> (accolades simples)
        </p>
      </div>
    </div>

    <EmailPreview html={form.html} subject={form.subject} />
  </div>
  {#snippet footer()}
    <Button variant="secondary" onclick={closeForm} disabled={formSaving}>Annuler</Button>
    <Button onclick={saveForm} disabled={formSaving}>
      {formSaving ? 'Sauvegarde…' : editingId ? 'Mettre à jour' : 'Créer'}
    </Button>
  {/snippet}
</Modal>
