<script lang="ts">
  import { api, ApiError } from '$lib/api/client';
  import { toast } from '$lib/stores/toast';
  import { Badge, Button, Card, Field, Input, Modal, Table, EmptyState } from '$lib/components/ui';
  import type { Tone } from '$lib/components/ui';

  interface ModeOfPayment {
    id: string;
    name: string;
    accountCode: string;
    isDefault: boolean;
  }

  // ── State — list ──────────────────────────────────────────────────────────────

  let modes = $state<ModeOfPayment[]>([]);
  let loading = $state(true);
  let error = $state('');

  // ── State — create/edit modal ─────────────────────────────────────────────────

  let formOpen = $state(false);
  let formMode = $state<'create' | 'edit'>('create');
  let formId = $state('');
  let formName = $state('');
  let formAccountCode = $state('');
  let formIsDefault = $state(false);
  let formSaving = $state(false);

  // ── State — delete ────────────────────────────────────────────────────────────

  let deleting = $state<string | null>(null);
  let deleteError = $state('');

  // ── Data loading ──────────────────────────────────────────────────────────────

  async function load() {
    loading = true;
    error = '';
    try {
      modes = await api<ModeOfPayment[]>('/billing/modes-of-payment');
    } catch (e) {
      error = e instanceof ApiError ? e.message : 'Impossible de charger les modes de paiement';
    } finally {
      loading = false;
    }
  }

  // ── Create / Edit ─────────────────────────────────────────────────────────────

  function openCreate() {
    formMode = 'create';
    formId = '';
    formName = '';
    formAccountCode = '';
    formIsDefault = false;
    deleteError = '';
    formOpen = true;
  }

  function openEdit(mode: ModeOfPayment) {
    formMode = 'edit';
    formId = mode.id;
    formName = mode.name;
    formAccountCode = mode.accountCode;
    formIsDefault = mode.isDefault;
    deleteError = '';
    formOpen = true;
  }

  async function submitForm() {
    if (!formName.trim()) {
      toast.error('Le nom est obligatoire');
      return;
    }
    formSaving = true;
    try {
      const body = {
        name: formName.trim(),
        accountCode: formAccountCode.trim(),
        isDefault: formIsDefault,
      };
      if (formMode === 'create') {
        await api<ModeOfPayment>('/billing/modes-of-payment', { method: 'POST', body });
        toast.success('Mode de paiement créé');
      } else {
        await api<ModeOfPayment>(`/billing/modes-of-payment/${formId}`, { method: 'PATCH', body });
        toast.success('Mode de paiement mis à jour');
      }
      formOpen = false;
      void load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Échec de l'enregistrement");
    } finally {
      formSaving = false;
    }
  }

  // ── Delete ────────────────────────────────────────────────────────────────────

  async function deleteMode(mode: ModeOfPayment) {
    if (!confirm(`Supprimer « ${mode.name} » ?`)) return;
    deleting = mode.id;
    deleteError = '';
    try {
      await api(`/billing/modes-of-payment/${mode.id}`, { method: 'DELETE' });
      toast.success('Mode de paiement supprimé');
      void load();
    } catch (e) {
      if (e instanceof ApiError && (e.statusCode === 409 || e.statusCode === 400)) {
        deleteError = e.message;
      } else {
        toast.error(e instanceof ApiError ? e.message : 'Impossible de supprimer le mode de paiement');
      }
    } finally {
      deleting = null;
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────────

  function defaultTone(isDefault: boolean): Tone {
    return isDefault ? 'ok' : 'neutral';
  }

  // ── Initial load ──────────────────────────────────────────────────────────────

  $effect(() => {
    void load();
  });
</script>

<Card>
  <div class="mb-3 flex items-center justify-between">
    <h2 class="font-semibold text-ink">Modes de paiement</h2>
    <Button onclick={openCreate}>Ajouter</Button>
  </div>

  {#if deleteError}
    <div class="mb-3 rounded-md border border-danger bg-danger-soft/20 px-3 py-2 text-xs text-danger">
      {deleteError}
    </div>
  {/if}

  {#if loading}
    <p class="text-sm text-ink-muted">Chargement…</p>
  {:else if error}
    <p class="text-sm text-danger">{error}</p>
  {:else if modes.length === 0}
    <EmptyState message="Aucun mode de paiement configuré." />
  {:else}
    <Table>
      {#snippet head()}
        <th>Nom</th><th>Code de compte</th><th>Par défaut</th><th></th>
      {/snippet}
      {#snippet body()}
        {#each modes as mode (mode.id)}
          <tr>
            <td class="font-medium text-ink">{mode.name}</td>
            <td class="font-mono text-xs text-ink-muted">{mode.accountCode || '—'}</td>
            <td>
              <Badge tone={defaultTone(mode.isDefault)}>
                {mode.isDefault ? 'Par défaut' : 'Non'}
              </Badge>
            </td>
            <td class="text-right">
              <div class="flex justify-end gap-2">
                <Button variant="secondary" onclick={() => openEdit(mode)}>Modifier</Button>
                <Button
                  variant="danger"
                  loading={deleting === mode.id}
                  onclick={() => void deleteMode(mode)}
                >Supprimer</Button>
              </div>
            </td>
          </tr>
        {/each}
      {/snippet}
    </Table>
  {/if}
</Card>

<!-- Create / Edit modal -->
<Modal
  bind:open={formOpen}
  title={formMode === 'create' ? 'Nouveau mode de paiement' : 'Modifier le mode de paiement'}
>
  <div class="flex flex-col gap-4">
    <Field label="Nom *">
      <Input bind:value={formName} placeholder="Ex. : Virement bancaire" />
    </Field>
    <Field label="Code de compte">
      <Input bind:value={formAccountCode} placeholder="Ex. : 1010" />
    </Field>
    <Field label="Par défaut">
      <div class="flex h-9 items-center">
        <input
          type="checkbox"
          bind:checked={formIsDefault}
          class="h-4 w-4 rounded border-edge accent-accent"
        />
        <span class="ml-2 text-sm text-ink-muted">Définir comme mode de paiement par défaut</span>
      </div>
    </Field>
  </div>
  {#snippet footer()}
    <Button variant="secondary" onclick={() => { formOpen = false; }}>Annuler</Button>
    <Button loading={formSaving} onclick={submitForm}>
      {formMode === 'create' ? 'Créer' : 'Enregistrer'}
    </Button>
  {/snippet}
</Modal>
