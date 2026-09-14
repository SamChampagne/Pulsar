<script lang="ts">
  import { confirmAction } from '$lib/stores/confirmation';
  import {
    AUTOMATION_EVENT_CATALOG,
    REACTION_CATALOG,
    RULE_OPERATORS,
    SUGGESTED_TASK_CATEGORIES,
    type ReactionDescriptor,
    type RuleCondition,
    type RuleAction,
    type RuleMatch,
    type RuleOperator,
    type AutomationEventDescriptor,
  } from '@pulsar/shared';
  import { api, ApiError } from '$lib/api/client';
  import { toast } from '$lib/stores/toast';
  import {
    PageHeader,
    Button,
    Field,
    Input,
    Select,
    Table,
    Badge,
    EmptyState,
    Card,
    Skeleton,
    Modal,
  } from '$lib/components/ui';

  interface AutomationRule {
    id: string;
    tenantId: string;
    name: string;
    eventType: string;
    enabled: boolean;
    match: RuleMatch;
    conditions: RuleCondition[];
    action: RuleAction;
    createdById?: string;
    createdAt: string;
    updatedAt: string;
  }

  // Form-local condition: value is always a string for binding; coerced at save time.
  type FormCondition = { field: string; operator: RuleOperator; value: string };

  type FormActionKind = 'CREATE_TASK' | 'RUN_ACTION';

  type FormState = {
    name: string;
    eventType: string;
    enabled: boolean;
    match: RuleMatch;
    conditions: FormCondition[];
    actionKind: FormActionKind;
    // CREATE_TASK fields
    taskCategory: string;
    taskSeverity: 'INFO' | 'WARNING' | 'CRITICAL';
    taskTitleTemplate: string;
    taskAssignHint: 'AUTO' | 'UNASSIGNED';
    taskSubjectField: string;
    taskSubjectType: string;
    // RUN_ACTION fields
    reactionKey: string;
    reactionArgs: Record<string, string>;
  };

  const SEVERITIES = ['INFO', 'WARNING', 'CRITICAL'] as const;
  const ASSIGN_HINTS = ['AUTO', 'UNASSIGNED'] as const;

  // Operators that take no value input.
  const VALUELESS_OPERATORS: RuleOperator[] = ['exists', 'not_exists'];

  let rules = $state<AutomationRule[]>([]);
  let error = $state('');
  let loading = $state(true);
  let saving = $state(false);
  let showForm = $state(false);
  let editingId = $state<string | null>(null);
  let form = $state<FormState>(blankForm());

  function blankForm(): FormState {
    return {
      name: '',
      eventType: '',
      enabled: true,
      match: 'ALL',
      conditions: [],
      actionKind: 'CREATE_TASK',
      taskCategory: '',
      taskSeverity: 'WARNING',
      taskTitleTemplate: '',
      taskAssignHint: 'AUTO',
      taskSubjectField: '',
      taskSubjectType: '',
      reactionKey: REACTION_CATALOG[0]?.key ?? '',
      reactionArgs: defaultArgsFor(REACTION_CATALOG[0]?.key ?? ''),
    };
  }

  function defaultArgsFor(key: string): Record<string, string> {
    const descriptor = REACTION_CATALOG.find((r) => r.key === key);
    if (!descriptor) return {};
    return Object.fromEntries(descriptor.argKeys.map((k) => [k, `{${k}}`]));
  }

  function eventLabel(type: string): string {
    return AUTOMATION_EVENT_CATALOG.find((e) => e.type === type)?.label ?? type;
  }

  function reactionLabel(key: string): string {
    return REACTION_CATALOG.find((r) => r.key === key)?.label ?? key;
  }

  // Descriptor for the event currently selected in the form (drives field dropdowns + helper text).
  const selectedEvent = $derived<AutomationEventDescriptor | undefined>(
    AUTOMATION_EVENT_CATALOG.find((e) => e.type === form.eventType),
  );

  // Descriptor for the reaction currently selected in the form.
  const selectedReaction = $derived<ReactionDescriptor | undefined>(
    REACTION_CATALOG.find((r) => r.key === form.reactionKey),
  );

  function actionSummary(rule: AutomationRule): string {
    if (rule.action.kind === 'RUN_ACTION') {
      return `→ Réaction : ${reactionLabel(rule.action.action)}`;
    }
    return `→ Tâche ${rule.action.category} (${rule.action.severity})`;
  }

  async function load() {
    try {
      rules = await api<AutomationRule[]>('/automation/rules');
    } catch (e) {
      error = e instanceof ApiError ? e.message : 'Échec du chargement des règles';
    } finally {
      loading = false;
    }
  }

  function openNew() {
    editingId = null;
    form = blankForm();
    error = '';
    showForm = true;
  }

  function openEdit(rule: AutomationRule) {
    editingId = rule.id;
    const baseFields = {
      name: rule.name,
      eventType: rule.eventType,
      enabled: rule.enabled,
      match: rule.match,
      // Clone so edits don't mutate the list row before save; stringify values for binding.
      conditions: rule.conditions.map((c) => ({
        field: c.field,
        operator: c.operator,
        value: c.value === undefined || c.value === null ? '' : String(c.value),
      })),
    };

    if (rule.action.kind === 'RUN_ACTION') {
      form = {
        ...baseFields,
        actionKind: 'RUN_ACTION',
        taskCategory: '',
        taskSeverity: 'WARNING',
        taskTitleTemplate: '',
        taskAssignHint: 'AUTO',
        taskSubjectField: '',
        taskSubjectType: '',
        reactionKey: rule.action.action,
        reactionArgs: { ...rule.action.args },
      };
    } else {
      form = {
        ...baseFields,
        actionKind: 'CREATE_TASK',
        taskCategory: rule.action.category,
        taskSeverity: rule.action.severity,
        taskTitleTemplate: rule.action.titleTemplate,
        taskAssignHint: rule.action.assignHint,
        taskSubjectField: rule.action.subjectField ?? '',
        taskSubjectType: rule.action.subjectType ?? '',
        reactionKey: REACTION_CATALOG[0]?.key ?? '',
        reactionArgs: defaultArgsFor(REACTION_CATALOG[0]?.key ?? ''),
      };
    }
    error = '';
    showForm = true;
  }

  // When the event changes, default subjectField to the event's defaultSubjectField
  // (only if the user hasn't set one yet, so editing an existing rule is preserved).
  function onEventChange(e: Event & { currentTarget: HTMLSelectElement }) {
    form.eventType = e.currentTarget.value;
    const ev = AUTOMATION_EVENT_CATALOG.find((evt) => evt.type === form.eventType);
    if (ev && !form.taskSubjectField) {
      form.taskSubjectField = ev.defaultSubjectField;
    }
  }

  // When the reaction changes, reset args to defaults for the new reaction.
  function onReactionChange(e: Event & { currentTarget: HTMLSelectElement }) {
    const key = e.currentTarget.value;
    form.reactionKey = key;
    form.reactionArgs = defaultArgsFor(key);
  }

  function addCondition() {
    const defaultField = selectedEvent?.fields[0]?.path ?? '';
    form.conditions = [...form.conditions, { field: defaultField, operator: 'eq', value: '' }];
  }

  function removeCondition(index: number) {
    form.conditions = form.conditions.filter((_, i) => i !== index);
  }

  function isValueless(op: RuleOperator): boolean {
    return VALUELESS_OPERATORS.includes(op);
  }

  async function toggleEnabled(rule: AutomationRule) {
    try {
      await api(`/automation/rules/${rule.id}`, {
        method: 'PATCH',
        body: { enabled: !rule.enabled },
      });
      toast.success(rule.enabled ? `« ${rule.name} » désactivée` : `« ${rule.name} » activée`);
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Échec de la mise à jour');
    }
  }

  async function remove(rule: AutomationRule) {
    if (!(await confirmAction(`Supprimer la règle « ${rule.name} » ?`))) return;
    try {
      await api(`/automation/rules/${rule.id}`, { method: 'DELETE' });
      toast.success(`Règle « ${rule.name} » supprimée`);
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Échec de la suppression');
    }
  }

  async function save(event: SubmitEvent) {
    event.preventDefault();
    error = '';

    if (!form.name.trim()) {
      error = 'Le nom est requis.';
      return;
    }
    if (!form.eventType) {
      error = "L'événement est requis.";
      return;
    }

    if (form.actionKind === 'CREATE_TASK') {
      if (!form.taskCategory.trim()) {
        error = 'La catégorie de tâche est requise.';
        return;
      }
      if (!form.taskTitleTemplate.trim()) {
        error = 'Le gabarit de titre est requis.';
        return;
      }
    } else {
      if (!form.reactionKey) {
        error = 'La réaction est requise.';
        return;
      }
    }

    // Drop the value for valueless operators; trim empty optional action fields.
    // Values stay strings — the server/shared evaluator bridges "5" vs 5 with loose ==.
    const conditions: RuleCondition[] = form.conditions
      .filter((c) => c.field.trim())
      .map((c) =>
        isValueless(c.operator)
          ? { field: c.field.trim(), operator: c.operator }
          : { field: c.field.trim(), operator: c.operator, value: c.value },
      );

    let action: RuleAction;
    if (form.actionKind === 'RUN_ACTION') {
      action = {
        kind: 'RUN_ACTION',
        action: form.reactionKey,
        args: { ...form.reactionArgs },
      };
    } else {
      const taskAction: RuleAction = {
        kind: 'CREATE_TASK',
        category: form.taskCategory.trim(),
        severity: form.taskSeverity,
        titleTemplate: form.taskTitleTemplate,
        assignHint: form.taskAssignHint,
      };
      if (form.taskSubjectField?.trim()) taskAction.subjectField = form.taskSubjectField.trim();
      if (form.taskSubjectType?.trim()) taskAction.subjectType = form.taskSubjectType.trim();
      action = taskAction;
    }

    const body = {
      name: form.name.trim(),
      eventType: form.eventType,
      enabled: form.enabled,
      match: form.match,
      conditions,
      action,
    };

    saving = true;
    try {
      if (editingId) {
        await api(`/automation/rules/${editingId}`, { method: 'PATCH', body });
        toast.success('Règle mise à jour');
      } else {
        await api('/automation/rules', { method: 'POST', body });
        toast.success('Règle créée');
      }
      showForm = false;
      await load();
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : "Échec de l'enregistrement";
      error = msg;
      toast.error(msg);
    } finally {
      saving = false;
    }
  }

  $effect(() => {
    void load();
  });
</script>

<PageHeader
  title="Règles d'automatisation"
  count={rules.length}
  subtitle="« Quand un événement survient — Si des conditions sont remplies — Alors créer une tâche. » Ces règles s'ajoutent aux automatisations intégrées sans les remplacer."
>
  {#snippet actions()}
    <Button onclick={openNew}>Nouvelle règle</Button>
  {/snippet}
</PageHeader>

{#if error && !showForm}<p class="mb-3 text-sm text-danger">{error}</p>{/if}

{#if loading}
  <Card padded={false}><Skeleton rows={6} /></Card>
{:else if rules.length === 0}
  <Card>
    <EmptyState message="Aucune règle d'automatisation pour le moment.">
      {#snippet children()}
        <Button onclick={openNew}>Créer une règle</Button>
      {/snippet}
    </EmptyState>
  </Card>
{:else}
  <Table>
    {#snippet head()}
      <th>Nom</th>
      <th>Événement</th>
      <th>Correspondance</th>
      <th>Action</th>
      <th>État</th>
      <th></th>
    {/snippet}
    {#snippet body()}
      {#each rules as rule (rule.id)}
        <tr>
          <td class="font-semibold text-ink">{rule.name}</td>
          <td class="text-ink-muted">{eventLabel(rule.eventType)}</td>
          <td>
            <Badge tone="neutral">{rule.match === 'ALL' ? 'Toutes' : 'Au moins une'}</Badge>
          </td>
          <td>
            <div class="flex flex-wrap items-center gap-1.5">
              {#if rule.action.kind === 'RUN_ACTION'}
                <Badge tone="info">Réaction</Badge>
                <span class="text-sm text-ink-muted">{reactionLabel(rule.action.action)}</span>
              {:else}
                <Badge tone="neutral">Tâche</Badge>
                <span class="text-sm text-ink-muted">{actionSummary(rule)}</span>
              {/if}
            </div>
          </td>
          <td>
            <button
              type="button"
              onclick={() => void toggleEnabled(rule)}
              title={rule.enabled ? 'Désactiver' : 'Activer'}
            >
              {#if rule.enabled}
                <Badge tone="ok">Active</Badge>
              {:else}
                <Badge tone="neutral">Inactive</Badge>
              {/if}
            </button>
          </td>
          <td class="text-right">
            <div class="inline-flex gap-2">
              <Button variant="secondary" onclick={() => openEdit(rule)}>Modifier</Button>
              <Button variant="danger" onclick={() => void remove(rule)}>Supprimer</Button>
            </div>
          </td>
        </tr>
      {/each}
    {/snippet}
  </Table>
{/if}

<Modal bind:open={showForm} title={editingId ? 'Modifier la règle' : 'Nouvelle règle'} size="xl">
  {#snippet children()}
    <form onsubmit={save} class="space-y-4">
      {#if error}<p class="text-sm text-danger">{error}</p>{/if}

      <Field label="Nom">
        <Input
          bind:value={form.name}
          placeholder="Ex. Escalader les stops très en retard"
          required
        />
      </Field>

      <!-- Quand : événement -->
      <Field label="Quand — événement">
        <Select bind:value={form.eventType} onchange={onEventChange} required>
          <option value="" disabled>Choisir un événement…</option>
          {#each AUTOMATION_EVENT_CATALOG as ev (ev.type)}
            <option value={ev.type}>{ev.label}</option>
          {/each}
        </Select>
      </Field>
      {#if selectedEvent}
        <p class="-mt-2 text-xs text-ink-muted">{selectedEvent.description}</p>
      {/if}

      <!-- Si : conditions -->
      <div class="rounded-card border border-edge-soft p-3">
        <div class="mb-2 flex items-center justify-between">
          <span class="text-xs font-semibold tracking-wide text-ink-muted uppercase"
            >Si — conditions</span
          >
          <div class="flex items-center gap-2">
            <Select bind:value={form.match}>
              <option value="ALL">Toutes les conditions (ALL)</option>
              <option value="ANY">Au moins une (ANY)</option>
            </Select>
            <Button variant="secondary" onclick={addCondition}>+ Condition</Button>
          </div>
        </div>

        {#if form.conditions.length === 0}
          <p class="text-xs text-ink-faint">
            Aucune condition — la règle se déclenche pour chaque occurrence de l'événement.
          </p>
        {:else}
          <div class="space-y-2">
            {#each form.conditions as condition, i (i)}
              <div class="flex flex-wrap items-start gap-2">
                <div class="min-w-[12rem] flex-1">
                  {#if selectedEvent && selectedEvent.fields.length > 0}
                    <Select bind:value={condition.field}>
                      {#each selectedEvent.fields as fld (fld.path)}
                        <option value={fld.path}>{fld.label} ({fld.path})</option>
                      {/each}
                      <!-- allow a free-text field not listed in the catalog -->
                      {#if !selectedEvent.fields.some((fl) => fl.path === condition.field)}
                        <option value={condition.field}
                          >{condition.field || 'Champ personnalisé'}</option
                        >
                      {/if}
                    </Select>
                  {:else}
                    <Input bind:value={condition.field} placeholder="champ.du.payload" />
                  {/if}
                </div>
                <div class="min-w-[10rem]">
                  <Select bind:value={condition.operator}>
                    {#each RULE_OPERATORS as op (op.operator)}
                      <option value={op.operator}>{op.label}</option>
                    {/each}
                  </Select>
                </div>
                {#if !isValueless(condition.operator)}
                  <div class="min-w-[8rem] flex-1">
                    <Input bind:value={condition.value} placeholder="valeur" />
                  </div>
                {/if}
                <Button variant="ghost" onclick={() => removeCondition(i)}>Retirer</Button>
              </div>
            {/each}
          </div>
        {/if}
      </div>

      <!-- Alors : action kind selector -->
      <div class="rounded-card border border-edge-soft p-3">
        <div class="mb-3">
          <span class="mb-2 block text-xs font-semibold tracking-wide text-ink-muted uppercase">
            Alors — type d'action
          </span>
          <div class="flex gap-3">
            <label class="flex cursor-pointer items-center gap-1.5 text-sm text-ink">
              <input type="radio" bind:group={form.actionKind} value="CREATE_TASK" />
              Créer une tâche
            </label>
            <label class="flex cursor-pointer items-center gap-1.5 text-sm text-ink">
              <input type="radio" bind:group={form.actionKind} value="RUN_ACTION" />
              Déclencher une réaction
            </label>
          </div>
        </div>

        {#if form.actionKind === 'CREATE_TASK'}
          <!-- CREATE_TASK fields (unchanged behaviour) -->
          <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Catégorie">
              <Input
                bind:value={form.taskCategory}
                placeholder="DELAY, FREIGHT_AUDIT, …"
                required
              />
            </Field>
            <Field label="Suggestions de catégorie">
              <Select
                value=""
                onchange={(e: Event) => {
                  const v = (e.currentTarget as HTMLSelectElement).value;
                  if (v) form.taskCategory = v;
                }}
              >
                <option value="">Choisir une catégorie suggérée…</option>
                {#each SUGGESTED_TASK_CATEGORIES as cat (cat)}
                  <option value={cat}>{cat}</option>
                {/each}
              </Select>
            </Field>
            <Field label="Sévérité">
              <Select bind:value={form.taskSeverity}>
                {#each SEVERITIES as sev (sev)}
                  <option value={sev}>{sev}</option>
                {/each}
              </Select>
            </Field>
            <Field label="Assignation">
              <Select bind:value={form.taskAssignHint}>
                {#each ASSIGN_HINTS as hint (hint)}
                  <option value={hint}
                    >{hint === 'AUTO' ? 'Automatique (AUTO)' : 'Non assignée (UNASSIGNED)'}</option
                  >
                {/each}
              </Select>
            </Field>
          </div>

          <div class="mt-3">
            <Field label="Gabarit de titre">
              <Input
                bind:value={form.taskTitleTemplate}
                placeholder="Ex. Stop {'{stopId}'} en retard de {'{minutesLate}'} min"
                required
              />
            </Field>
            <p class="mt-1 text-xs text-ink-faint">
              Utilisez <code class="font-mono">{'{chemin}'}</code> pour insérer une valeur du
              payload.
              {#if selectedEvent && selectedEvent.fields.length > 0}
                Champs disponibles :
                {#each selectedEvent.fields as fld, idx (fld.path)}<code class="font-mono"
                    >{'{' + fld.path + '}'}</code
                  >{#if idx < selectedEvent.fields.length - 1}<span>, </span>{/if}{/each}.
              {/if}
            </p>
          </div>

          <div class="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Champ du sujet (subjectField, optionnel)">
              <Input
                bind:value={form.taskSubjectField}
                placeholder={selectedEvent?.defaultSubjectField ?? 'subjectId'}
              />
            </Field>
            <Field label="Type de sujet (subjectType, optionnel)">
              <Input bind:value={form.taskSubjectType} placeholder={form.eventType || 'type'} />
            </Field>
          </div>
        {:else}
          <!-- RUN_ACTION fields -->
          <Field label="Réaction">
            <Select bind:value={form.reactionKey} onchange={onReactionChange}>
              {#each REACTION_CATALOG as reaction (reaction.key)}
                <option value={reaction.key}>{reaction.label}</option>
              {/each}
            </Select>
          </Field>
          {#if selectedReaction}
            <p class="mt-1 text-xs text-ink-muted">{selectedReaction.description}</p>
            <p class="mt-0.5 text-xs text-ink-faint">
              Module : <span class="font-mono">{selectedReaction.module}</span>
            </p>
          {/if}

          {#if selectedReaction && selectedReaction.argKeys.length > 0}
            <div class="mt-3 space-y-2">
              <span class="text-xs font-semibold text-ink-muted"
                >Arguments (gabarits de payload)</span
              >
              {#each selectedReaction.argKeys as argKey (argKey)}
                <Field label={argKey}>
                  <Input
                    value={form.reactionArgs[argKey] ?? `{${argKey}}`}
                    oninput={(e: Event) => {
                      form.reactionArgs = {
                        ...form.reactionArgs,
                        [argKey]: (e.currentTarget as HTMLInputElement).value,
                      };
                    }}
                    placeholder={`{${argKey}}`}
                  />
                </Field>
              {/each}
              <p class="text-xs text-ink-faint">
                Utilisez <code class="font-mono">{'{chemin}'}</code> pour insérer une valeur du payload
                événement.
              </p>
            </div>
          {/if}
        {/if}
      </div>

      <label class="flex cursor-pointer items-center gap-2 text-sm text-ink">
        <input type="checkbox" bind:checked={form.enabled} />
        Activer cette règle immédiatement
      </label>

      <div class="flex justify-end gap-2 border-t border-edge pt-3">
        <Button
          variant="secondary"
          onclick={() => {
            showForm = false;
          }}>Annuler</Button
        >
        <Button variant="primary" type="submit" loading={saving}>
          {editingId ? 'Enregistrer' : 'Créer la règle'}
        </Button>
      </div>
    </form>
  {/snippet}
</Modal>
