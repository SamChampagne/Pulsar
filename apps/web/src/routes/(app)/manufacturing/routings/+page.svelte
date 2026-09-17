<script lang="ts">
  import type { Paginated } from '@pulsar/shared';
  import { api, ApiError } from '$lib/api/client';
  import {
    Badge,
    Button,
    Card,
    EmptyState,
    EntityPicker,
    Field,
    FilterBar,
    Input,
    Modal,
    PageHeader,
    Skeleton,
    Table,
  } from '$lib/components/ui';
  import { toast } from '$lib/stores/toast';

  interface RoutingStep {
    id: string;
    sequence: number;
    name: string;
    durationMinutes: number;
    setupMinutes?: number;
    eligibleWorkCenterIds: string[];
  }

  interface Routing {
    id: string;
    code: string;
    name: string;
    productRef?: string | null;
    isActive: boolean;
    steps?: RoutingStep[];
  }

  interface WorkCenter {
    id: string;
    name: string;
    code: string;
  }

  let routings = $state<Routing[]>([]);
  let total = $state(0);
  let loading = $state(true);
  let error = $state('');
  let search = $state('');

  let workCenters = $state<WorkCenter[]>([]);

  // Create / edit panel
  let formOpen = $state(false);
  let editId = $state<string | null>(null);
  let formCode = $state('');
  let formName = $state('');
  let formProductRef = $state('');
  let formActive = $state(true);
  let saving = $state(false);

  // Steps editor
  let steps = $state<RoutingStep[]>([]);
  let stepSeq = $state('');
  let stepName = $state('');
  let stepDuration = $state('');
  let stepSetup = $state('');
  let stepWcIds = $state<string[]>([]);
  let addingStep = $state(false);

  async function load() {
    loading = true;
    error = '';
    try {
      const res = await api<Paginated<Routing>>('/manufacturing/routings', {
        query: { pageSize: 100, search: search.trim() || undefined },
      });
      routings = res.items;
      total = res.total;
    } catch (e) {
      error = e instanceof ApiError ? e.message : 'Échec du chargement des gammes';
      toast.error(error);
    } finally {
      loading = false;
    }
  }

  async function loadWorkCenters() {
    try {
      const res = await api<Paginated<WorkCenter>>('/manufacturing/work-centers', {
        query: { pageSize: 100 },
      });
      workCenters = res.items;
    } catch {
      // best-effort: step editor still works without the toggles
    }
  }

  $effect(() => {
    void load();
  });

  $effect(() => {
    void loadWorkCenters();
  });

  function wcLabel(id: string): string {
    const wc = workCenters.find((w) => w.id === id);
    return wc ? wc.name : id;
  }

  function openCreate() {
    editId = null;
    formCode = '';
    formName = '';
    formProductRef = '';
    formActive = true;
    steps = [];
    resetStepForm();
    formOpen = true;
  }

  async function openEdit(r: Routing) {
    editId = r.id;
    formCode = r.code;
    formName = r.name;
    formProductRef = r.productRef ?? '';
    formActive = r.isActive;
    steps = (r.steps ?? []).slice().sort((a, b) => a.sequence - b.sequence);
    resetStepForm();
    formOpen = true;
    await refetchOne(r.id);
  }

  async function refetchOne(id: string) {
    try {
      const fresh = await api<Routing>(`/manufacturing/routings/${id}`);
      steps = (fresh.steps ?? []).slice().sort((a, b) => a.sequence - b.sequence);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Échec du chargement des étapes');
    }
  }

  function resetStepForm() {
    stepSeq = '';
    stepName = '';
    stepDuration = '';
    stepSetup = '';
    stepWcIds = [];
  }

  function toggleWc(id: string) {
    stepWcIds = stepWcIds.includes(id) ? stepWcIds.filter((x) => x !== id) : [...stepWcIds, id];
  }

  async function addStep() {
    if (!editId) {
      toast.error("Enregistrez d'abord la gamme");
      return;
    }
    if (!stepName.trim() || stepSeq === '' || stepDuration === '') {
      toast.error('Séquence, nom et durée sont requis');
      return;
    }
    addingStep = true;
    try {
      await api(`/manufacturing/routings/${editId}/steps`, {
        method: 'POST',
        body: {
          sequence: Number(stepSeq),
          name: stepName.trim(),
          durationMinutes: Number(stepDuration),
          setupMinutes: stepSetup !== '' ? Number(stepSetup) : undefined,
          eligibleWorkCenterIds: stepWcIds.length ? stepWcIds : undefined,
        },
      });
      toast.success('Étape ajoutée');
      resetStepForm();
      await refetchOne(editId);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Échec de l'ajout de l'étape");
    } finally {
      addingStep = false;
    }
  }

  async function removeStep(stepId: string) {
    if (!editId) return;
    try {
      await api(`/manufacturing/routings/${editId}/steps/${stepId}`, { method: 'DELETE' });
      toast.success('Étape supprimée');
      await refetchOne(editId);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Échec de la suppression de l'étape");
    }
  }

  async function submit() {
    if (!formCode.trim() || !formName.trim()) {
      toast.error('Code et nom sont requis');
      return;
    }
    saving = true;
    try {
      const body = {
        code: formCode.trim(),
        name: formName.trim(),
        productRef: formProductRef.trim() || undefined,
        isActive: formActive,
      };
      if (editId) {
        await api(`/manufacturing/routings/${editId}`, { method: 'PATCH', body });
        toast.success('Gamme mise à jour');
      } else {
        const created = await api<Routing>('/manufacturing/routings', { method: 'POST', body });
        editId = created.id;
        steps = (created.steps ?? []).slice().sort((a, b) => a.sequence - b.sequence);
        toast.success('Gamme créée — ajoutez ses étapes');
        saving = false;
        await load();
        return;
      }
      formOpen = false;
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Échec de l'enregistrement");
    } finally {
      saving = false;
    }
  }
</script>

<PageHeader title="Gammes" count={total}>
  {#snippet actions()}
    <Button onclick={openCreate}>Nouvelle gamme</Button>
  {/snippet}
</PageHeader>

<FilterBar>
  <a href="/manufacturing" class="text-sm text-accent hover:underline">← Fabrication</a>
  <div class="w-72">
    <input
      placeholder="Rechercher par code ou nom…"
      bind:value={search}
      onkeydown={(e) => {
        if (e.key === 'Enter') void load();
      }}
      class="w-full rounded-md border border-edge bg-surface px-3 py-1.5 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
    />
  </div>
</FilterBar>

{#if loading}
  <Card padded={false}><Skeleton rows={6} /></Card>
{:else if error}
  <Card><p class="text-sm text-danger">{error}</p></Card>
{:else if routings.length === 0}
  <Card>
    <EmptyState message="Aucune gamme pour le moment.">
      {#snippet children()}
        <Button onclick={openCreate}>Nouvelle gamme</Button>
      {/snippet}
    </EmptyState>
  </Card>
{:else}
  <Table>
    {#snippet head()}
      <th>Code</th><th>Nom</th><th>Produit</th><th class="text-right">Nb étapes</th><th>Statut</th>
    {/snippet}
    {#snippet body()}
      {#each routings as r (r.id)}
        <tr class="cursor-pointer" onclick={() => openEdit(r)}>
          <td class="font-mono font-semibold text-ink">{r.code}</td>
          <td>{r.name}</td>
          <td class="text-ink-muted">{r.productRef || '—'}</td>
          <td class="text-right text-ink">{r.steps?.length ?? 0}</td>
          <td>
            <Badge tone={r.isActive ? 'ok' : 'neutral'}>{r.isActive ? 'Actif' : 'Inactif'}</Badge>
          </td>
        </tr>
      {/each}
    {/snippet}
  </Table>
{/if}

<Modal bind:open={formOpen} title={editId ? 'Modifier la gamme' : 'Nouvelle gamme'} size="lg">
  {#snippet children()}
    <div class="space-y-3">
      <div class="grid grid-cols-2 gap-3">
        <Field label="Code">
          <Input bind:value={formCode} placeholder="GAM-001" />
        </Field>
        <Field label="Produit">
          <EntityPicker
            endpoint="/wms/choices/items"
            label="Produit"
            placeholder="Optionnel"
            labelKey="name"
            valueKey="sku"
            selectedLabel={formProductRef}
            bind:value={formProductRef}
          />
        </Field>
      </div>
      <Field label="Nom">
        <Input bind:value={formName} placeholder="Désignation" />
      </Field>
      <Field label="Actif">
        <label class="flex items-center gap-2 text-sm text-ink">
          <input type="checkbox" bind:checked={formActive} />
          Gamme active
        </label>
      </Field>

      {#if editId}
        <div class="space-y-2 border-t border-edge pt-3">
          <h3 class="text-sm font-bold text-ink">Étapes</h3>
          {#if steps.length === 0}
            <p class="text-sm text-ink-faint">Aucune étape pour le moment.</p>
          {:else}
            <ul class="space-y-1">
              {#each steps as step (step.id)}
                <li
                  class="flex items-start justify-between gap-2 rounded-md border border-edge bg-surface px-3 py-2"
                >
                  <div class="text-sm">
                    <span class="font-mono text-ink-muted">#{step.sequence}</span>
                    <span class="ml-2 font-semibold text-ink">{step.name}</span>
                    <span class="ml-2 text-ink-muted">
                      {step.durationMinutes} min{step.setupMinutes
                        ? ` (+${step.setupMinutes} setup)`
                        : ''}
                    </span>
                    {#if step.eligibleWorkCenterIds?.length}
                      <div class="mt-1 flex flex-wrap gap-1">
                        {#each step.eligibleWorkCenterIds as wcId (wcId)}
                          <Badge tone="neutral">{wcLabel(wcId)}</Badge>
                        {/each}
                      </div>
                    {/if}
                  </div>
                  <button
                    class="text-xs text-danger hover:underline"
                    onclick={() => removeStep(step.id)}>Retirer</button
                  >
                </li>
              {/each}
            </ul>
          {/if}

          <div class="space-y-2 rounded-md border border-edge bg-surface-muted p-3">
            <div class="grid grid-cols-4 gap-2">
              <Field label="Séquence">
                <Input bind:value={stepSeq} type="number" min="0" placeholder="10" />
              </Field>
              <Field label="Durée (min)">
                <Input bind:value={stepDuration} type="number" min="0" placeholder="60" />
              </Field>
              <Field label="Setup (min)">
                <Input bind:value={stepSetup} type="number" min="0" placeholder="0" />
              </Field>
              <Field label="Nom de l'étape">
                <Input bind:value={stepName} placeholder="Découpe" />
              </Field>
            </div>
            {#if workCenters.length}
              <div>
                <span class="text-xs font-medium text-ink-muted">Centres de charge éligibles</span>
                <div class="mt-1 flex flex-wrap gap-1.5">
                  {#each workCenters as wc (wc.id)}
                    <button
                      type="button"
                      onclick={() => toggleWc(wc.id)}
                      class="rounded-full border px-2.5 py-0.5 text-xs transition-colors {stepWcIds.includes(
                        wc.id,
                      )
                        ? 'border-accent bg-accent/10 text-accent'
                        : 'border-edge text-ink-muted hover:border-accent'}"
                    >
                      {wc.name}
                    </button>
                  {/each}
                </div>
              </div>
            {/if}
            <div class="flex justify-end">
              <Button variant="secondary" loading={addingStep} onclick={addStep}>
                Ajouter l'étape
              </Button>
            </div>
          </div>
        </div>
      {/if}

      <div class="flex justify-end gap-2 border-t border-edge pt-3">
        <Button
          variant="secondary"
          onclick={() => {
            formOpen = false;
          }}>Fermer</Button
        >
        <Button variant="primary" loading={saving} onclick={submit}>Enregistrer</Button>
      </div>
    </div>
  {/snippet}
</Modal>
