<script lang="ts">
  import { api, ApiError } from '$lib/api/client';
  import { toast } from '$lib/stores/toast';
  import { Badge, Button, Card, Field, Input, Modal, Table, EmptyState } from '$lib/components/ui';
  import type { Tone } from '$lib/components/ui';

  type TaxType = 'SALES' | 'PURCHASE';

  interface TaxTemplateLine {
    description: string;
    rate: string; // Decimal arrives as string
    accountCode: string;
    sortOrder: number;
  }

  interface TaxTemplate {
    id: string;
    name: string;
    type: TaxType;
    isDefault: boolean;
    lines: TaxTemplateLine[];
  }

  // ── State — list ──────────────────────────────────────────────────────────────

  let templates = $state<TaxTemplate[]>([]);
  let loading = $state(true);
  let error = $state('');

  // ── State — create/edit modal ─────────────────────────────────────────────────

  let formOpen = $state(false);
  let formMode = $state<'create' | 'edit'>('create');
  let formId = $state('');
  let formName = $state('');
  let formType = $state<TaxType>('SALES');
  let formIsDefault = $state(false);
  let formLines = $state<{ description: string; rate: number | undefined; accountCode: string }[]>([]);
  let formSaving = $state(false);

  // ── State — delete ────────────────────────────────────────────────────────────

  let deleting = $state<string | null>(null);
  let deleteError = $state('');

  // ── Data loading ──────────────────────────────────────────────────────────────

  async function load() {
    loading = true;
    error = '';
    try {
      templates = await api<TaxTemplate[]>('/billing/tax-templates');
    } catch (e) {
      error = e instanceof ApiError ? e.message : 'Impossible de charger les gabarits de taxes';
    } finally {
      loading = false;
    }
  }

  // ── Create / Edit ─────────────────────────────────────────────────────────────

  function openCreate() {
    formMode = 'create';
    formId = '';
    formName = '';
    formType = 'SALES';
    formIsDefault = false;
    formLines = [{ description: '', rate: undefined, accountCode: '' }];
    deleteError = '';
    formOpen = true;
  }

  function openEdit(tpl: TaxTemplate) {
    formMode = 'edit';
    formId = tpl.id;
    formName = tpl.name;
    formType = tpl.type;
    formIsDefault = tpl.isDefault;
    formLines = tpl.lines.map((l) => ({
      description: l.description,
      rate: Number(l.rate),
      accountCode: l.accountCode,
    }));
    if (formLines.length === 0) {
      formLines = [{ description: '', rate: undefined, accountCode: '' }];
    }
    deleteError = '';
    formOpen = true;
  }

  function addLine() {
    formLines = [...formLines, { description: '', rate: undefined, accountCode: '' }];
  }

  function removeLine(index: number) {
    formLines = formLines.filter((_, i) => i !== index);
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
        type: formType,
        isDefault: formIsDefault,
        lines: formLines
          .filter((l) => l.description.trim() || (l.rate !== undefined && String(l.rate).trim() !== ''))
          .map((l, i) => ({
            description: l.description.trim(),
            rate: Number(l.rate ?? 0),
            accountCode: l.accountCode.trim(),
            sortOrder: i,
          })),
      };
      if (formMode === 'create') {
        await api<TaxTemplate>('/billing/tax-templates', { method: 'POST', body });
        toast.success('Gabarit de taxes créé');
      } else {
        await api<TaxTemplate>(`/billing/tax-templates/${formId}`, { method: 'PATCH', body });
        toast.success('Gabarit de taxes mis à jour');
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

  async function deleteTemplate(tpl: TaxTemplate) {
    if (!confirm(`Supprimer « ${tpl.name} » ?`)) return;
    deleting = tpl.id;
    deleteError = '';
    try {
      await api(`/billing/tax-templates/${tpl.id}`, { method: 'DELETE' });
      toast.success('Gabarit de taxes supprimé');
      void load();
    } catch (e) {
      if (e instanceof ApiError && (e.statusCode === 409 || e.statusCode === 400)) {
        deleteError = e.message;
      } else {
        toast.error(e instanceof ApiError ? e.message : 'Impossible de supprimer le gabarit');
      }
    } finally {
      deleting = null;
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────────

  function typeTone(type: TaxType): Tone {
    return type === 'SALES' ? 'info' : 'neutral';
  }

  function typeLabel(type: TaxType): string {
    return type === 'SALES' ? 'Vente' : 'Achat';
  }

  function defaultTone(isDefault: boolean): Tone {
    return isDefault ? 'ok' : 'neutral';
  }

  function linesSummary(lines: TaxTemplateLine[]): string {
    if (lines.length === 0) return '—';
    return lines
      .map((l) => `${l.description} ${Number(l.rate)}%`)
      .join(' · ');
  }

  // ── Initial load ──────────────────────────────────────────────────────────────

  $effect(() => {
    void load();
  });
</script>

<Card>
  <div class="mb-3 flex items-center justify-between">
    <h2 class="font-semibold text-ink">Gabarits de taxes</h2>
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
  {:else if templates.length === 0}
    <EmptyState message="Aucun gabarit de taxes configuré." />
  {:else}
    <Table>
      {#snippet head()}
        <th>Nom</th><th>Type</th><th>Lignes</th><th>Par défaut</th><th></th>
      {/snippet}
      {#snippet body()}
        {#each templates as tpl (tpl.id)}
          <tr>
            <td class="font-medium text-ink">{tpl.name}</td>
            <td>
              <Badge tone={typeTone(tpl.type)}>{typeLabel(tpl.type)}</Badge>
            </td>
            <td class="text-xs text-ink-muted">{linesSummary(tpl.lines)}</td>
            <td>
              <Badge tone={defaultTone(tpl.isDefault)}>
                {tpl.isDefault ? 'Par défaut' : 'Non'}
              </Badge>
            </td>
            <td class="text-right">
              <div class="flex justify-end gap-2">
                <Button variant="secondary" onclick={() => openEdit(tpl)}>Modifier</Button>
                <Button
                  variant="danger"
                  loading={deleting === tpl.id}
                  onclick={() => void deleteTemplate(tpl)}
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
  title={formMode === 'create' ? 'Nouveau gabarit de taxes' : 'Modifier le gabarit de taxes'}
>
  <div class="flex flex-col gap-4">
    <Field label="Nom *">
      <Input bind:value={formName} placeholder="Ex. : Taxes Canada" />
    </Field>
    <Field label="Type">
      <select
        bind:value={formType}
        class="h-9 w-full rounded-md border border-edge bg-surface px-3 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-accent"
      >
        <option value="SALES">Vente</option>
        <option value="PURCHASE">Achat</option>
      </select>
    </Field>
    <Field label="Par défaut">
      <div class="flex h-9 items-center">
        <input
          type="checkbox"
          bind:checked={formIsDefault}
          class="h-4 w-4 rounded border-edge accent-accent"
        />
        <span class="ml-2 text-sm text-ink-muted">Définir comme gabarit par défaut</span>
      </div>
    </Field>

    <!-- Lines editor -->
    <div>
      <div class="mb-2 flex items-center justify-between">
        <span class="text-sm font-medium text-ink">Lignes de taxes</span>
        <Button variant="secondary" onclick={addLine}>+ Ajouter une ligne</Button>
      </div>
      {#if formLines.length === 0}
        <p class="text-xs text-ink-muted">Aucune ligne. Cliquez sur « Ajouter une ligne ».</p>
      {:else}
        <div class="flex flex-col gap-2">
          {#each formLines as line, i (i)}
            <div class="flex items-center gap-2 rounded-md border border-edge bg-surface-alt p-2">
              <div class="flex-1">
                <Input
                  bind:value={line.description}
                  placeholder="Description (ex. : TPS)"
                />
              </div>
              <div class="w-24">
                <input
                  type="number"
                  bind:value={line.rate}
                  placeholder="Taux %"
                  class="w-full rounded-md border border-edge bg-surface px-3 py-1.5 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
                />
              </div>
              <div class="w-28">
                <Input
                  bind:value={line.accountCode}
                  placeholder="Compte"
                />
              </div>
              <Button
                variant="danger"
                onclick={() => removeLine(i)}
              >✕</Button>
            </div>
          {/each}
        </div>
      {/if}
    </div>
  </div>
  {#snippet footer()}
    <Button variant="secondary" onclick={() => { formOpen = false; }}>Annuler</Button>
    <Button loading={formSaving} onclick={submitForm}>
      {formMode === 'create' ? 'Créer' : 'Enregistrer'}
    </Button>
  {/snippet}
</Modal>
