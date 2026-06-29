<script lang="ts">
  import {
    AUTOMATION_EVENT_CATALOG,
    REACTION_CATALOG,
    type ReactionDescriptor,
    type RuleCondition,
    type RuleAction,
    type RuleMatch,
    type AutomationEventDescriptor,
  } from '@pulsar/shared';
  import { api, ApiError } from '$lib/api/client';
  import { goto } from '$app/navigation';
  import {
    PageHeader,
    Card,
    Badge,
    Button,
    EmptyState,
    ErrorNotice,
    Select,
    Input,
    Modal,
    Skeleton,
  } from '$lib/components/ui';

  // Mirror the automation page's interface exactly so payloads/types match.
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

  // Shape of GET /analytics/flow/timeline reactionKpis (best-effort, may be unavailable).
  interface ReactionKpis {
    executed: number;
    failed: number;
    byAction: { action: string; executed: number; failed: number }[];
  }

  let rules = $state<AutomationRule[]>([]);
  let error = $state('');
  let loading = $state(true);
  let kpis = $state<ReactionKpis | null>(null);

  // In-row delete confirmation state (rule id awaiting confirm).
  let confirmingDeleteId = $state<string | null>(null);
  // Per-rule busy flags for toggle/delete (avoid double-fire).
  let busyId = $state<string | null>(null);

  // ── Quick-wire modal state ────────────────────────────────────────────────
  let showQuickWire = $state(false);
  let saving = $state(false);
  let quickError = $state('');
  let qwName = $state('');
  let qwEventType = $state('');
  let qwReactionKey = $state<string>(REACTION_CATALOG[0]?.key ?? '');
  let qwArgs = $state<Record<string, string>>(
    defaultArgsFor(REACTION_CATALOG[0]?.key ?? '', ''),
  );

  // ── Helpers ───────────────────────────────────────────────────────────────
  function eventLabel(type: string): string {
    return AUTOMATION_EVENT_CATALOG.find((e) => e.type === type)?.label ?? type;
  }

  function reactionLabel(key: string): string {
    return REACTION_CATALOG.find((r) => r.key === key)?.label ?? key;
  }

  // Derive a display module label from REACTION_CATALOG / event prefix.
  function moduleOf(eventType: string): string {
    return eventType.split('.')[0] || eventType;
  }

  // Pre-fill each argKey with a payload-template guess from the event's defaultSubjectField,
  // falling back to the argKey itself.
  function defaultArgsFor(reactionKey: string, eventType: string): Record<string, string> {
    const descriptor = REACTION_CATALOG.find((r) => r.key === reactionKey);
    if (!descriptor) return {};
    const ev = AUTOMATION_EVENT_CATALOG.find((e) => e.type === eventType);
    const guess = ev?.defaultSubjectField;
    return Object.fromEntries(
      descriptor.argKeys.map((k) => [k, guess ? `{${guess}}` : `{${k}}`]),
    );
  }

  const selectedReaction = $derived<ReactionDescriptor | undefined>(
    REACTION_CATALOG.find((r) => r.key === qwReactionKey),
  );

  // Human-readable condition summary: "si field op value et …" or "toujours".
  function conditionSummary(rule: AutomationRule): string {
    if (!rule.conditions || rule.conditions.length === 0) return 'toujours';
    const join = rule.match === 'ALL' ? ' et ' : ' ou ';
    const parts = rule.conditions.map((c) => {
      const valuelessOps = ['exists', 'not_exists'];
      if (valuelessOps.includes(c.operator)) return `${c.field} ${c.operator}`;
      return `${c.field} ${c.operator} ${c.value ?? ''}`.trim();
    });
    return 'si ' + parts.join(join);
  }

  // ── KPIs (computed) ─────────────────────────────────────────────────────────
  const eventsCovered = $derived.by(() => new Set(rules.map((r) => r.eventType)).size);
  const activeCount = $derived(rules.filter((r) => r.enabled).length);

  // Per-action KPI lookup for the flow board chips.
  function actionKpi(action: string): { executed: number; failed: number } | null {
    return kpis?.byAction.find((b) => b.action === action) ?? null;
  }

  // Group rules by eventType → board columns (only events with ≥1 rule).
  const board = $derived.by(() => {
    const map = new Map<string, AutomationRule[]>();
    for (const r of rules) {
      const list = map.get(r.eventType) ?? [];
      list.push(r);
      map.set(r.eventType, list);
    }
    return [...map.entries()]
      .map(([eventType, eventRules]) => ({ eventType, rules: eventRules }))
      .sort((a, b) => eventLabel(a.eventType).localeCompare(eventLabel(b.eventType)));
  });

  // Reactions grouped by module (palette reference).
  const reactionsByModule = $derived.by(() => {
    const map = new Map<string, ReactionDescriptor[]>();
    for (const r of REACTION_CATALOG) {
      const list = map.get(r.module) ?? [];
      list.push(r);
      map.set(r.module, list);
    }
    return [...map.entries()]
      .map(([module, items]) => ({ module, items }))
      .sort((a, b) => a.module.localeCompare(b.module));
  });

  // Events that have NO rule yet (automation gaps).
  const uncoveredEvents = $derived.by(() => {
    const covered = new Set(rules.map((r) => r.eventType));
    return AUTOMATION_EVENT_CATALOG.filter((e) => !covered.has(e.type));
  });

  // ── Data loading ──────────────────────────────────────────────────────────
  async function load() {
    loading = true;
    error = '';
    try {
      rules = await api<AutomationRule[]>('/automation/rules');
    } catch (e) {
      error = e instanceof ApiError ? e.message : 'Échec du chargement des règles';
    } finally {
      loading = false;
    }
    // Live firing KPIs — best-effort; ANALYTICS module may be off (403/404). Never break the page.
    try {
      const tl = await api<{ reactionKpis?: ReactionKpis }>('/analytics/flow/timeline?days=30');
      kpis = tl?.reactionKpis ?? null;
    } catch {
      kpis = null;
    }
  }

  // ── Inline actions ──────────────────────────────────────────────────────────
  async function toggleEnabled(rule: AutomationRule) {
    busyId = rule.id;
    try {
      await api(`/automation/rules/${rule.id}`, {
        method: 'PATCH',
        body: { enabled: !rule.enabled },
      });
      // Update local state in place (no full reload needed for a toggle).
      rules = rules.map((r) => (r.id === rule.id ? { ...r, enabled: !r.enabled } : r));
    } catch (e) {
      error = e instanceof ApiError ? e.message : 'Échec de la mise à jour';
    } finally {
      busyId = null;
    }
  }

  async function remove(rule: AutomationRule) {
    busyId = rule.id;
    try {
      await api(`/automation/rules/${rule.id}`, { method: 'DELETE' });
      confirmingDeleteId = null;
      await load();
    } catch (e) {
      error = e instanceof ApiError ? e.message : 'Échec de la suppression';
    } finally {
      busyId = null;
    }
  }

  // ── Quick-wire modal ──────────────────────────────────────────────────────
  function openQuickWire() {
    quickError = '';
    qwName = '';
    qwEventType = '';
    qwReactionKey = REACTION_CATALOG[0]?.key ?? '';
    qwArgs = defaultArgsFor(qwReactionKey, '');
    showQuickWire = true;
  }

  function onQwEventChange(e: Event & { currentTarget: HTMLSelectElement }) {
    qwEventType = e.currentTarget.value;
    // Re-seed arg guesses from the new event's defaultSubjectField.
    qwArgs = defaultArgsFor(qwReactionKey, qwEventType);
  }

  function onQwReactionChange(e: Event & { currentTarget: HTMLSelectElement }) {
    qwReactionKey = e.currentTarget.value;
    qwArgs = defaultArgsFor(qwReactionKey, qwEventType);
  }

  async function submitQuickWire(event: SubmitEvent) {
    event.preventDefault();
    quickError = '';
    if (!qwName.trim()) {
      quickError = 'Le nom est requis.';
      return;
    }
    if (!qwEventType) {
      quickError = "L'événement déclencheur est requis.";
      return;
    }
    if (!qwReactionKey) {
      quickError = 'La réaction est requise.';
      return;
    }

    const body = {
      name: qwName.trim(),
      eventType: qwEventType,
      enabled: true,
      match: 'ALL' as RuleMatch,
      conditions: [] as RuleCondition[],
      action: {
        kind: 'RUN_ACTION' as const,
        action: qwReactionKey,
        args: { ...qwArgs },
      },
    };

    saving = true;
    try {
      await api('/automation/rules', { method: 'POST', body });
      showQuickWire = false;
      await load();
    } catch (e) {
      quickError = e instanceof ApiError ? e.message : "Échec de l'enregistrement";
    } finally {
      saving = false;
    }
  }

  $effect(() => {
    void load();
  });
</script>

<PageHeader
  title="Workflow Designer"
  eyebrow="Automatisation"
  subtitle="Visualisez et câblez les réactions automatiques : chaque événement métier déclenche des tâches ou des actions cross-module."
  count={rules.length}
>
  {#snippet actions()}
    <Button variant="secondary" onclick={() => goto('/automation')}>Règle avancée</Button>
    <Button onclick={openQuickWire}>Connexion rapide</Button>
  {/snippet}
</PageHeader>

<ErrorNotice message={error} onretry={() => void load()} />

<!-- KPI cards -->
<div class="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
  <Card>
    <div class="text-xs font-semibold uppercase tracking-wide text-ink-faint">Règles totales</div>
    <div class="mt-1 text-2xl font-bold text-ink">{rules.length}</div>
  </Card>
  <Card>
    <div class="text-xs font-semibold uppercase tracking-wide text-ink-faint">Règles actives</div>
    <div class="mt-1 text-2xl font-bold text-ink">{activeCount}</div>
  </Card>
  <Card>
    <div class="text-xs font-semibold uppercase tracking-wide text-ink-faint">Événements couverts</div>
    <div class="mt-1 text-2xl font-bold text-ink">{eventsCovered}</div>
  </Card>
  <Card>
    <div class="text-xs font-semibold uppercase tracking-wide text-ink-faint">Réactions exécutées</div>
    <div class="mt-1 text-2xl font-bold text-ink">{kpis ? kpis.executed : '—'}</div>
  </Card>
  <Card>
    <div class="text-xs font-semibold uppercase tracking-wide text-ink-faint">Réactions en échec</div>
    <div class="mt-1 text-2xl font-bold {kpis && kpis.failed > 0 ? 'text-danger' : 'text-ink'}">
      {kpis ? kpis.failed : '—'}
    </div>
  </Card>
</div>

{#if loading}
  <Card padded={false}><Skeleton rows={8} /></Card>
{:else}
  <!-- ── FLOW BOARD ──────────────────────────────────────────────────────── -->
  <div class="space-y-3">
    {#if board.length === 0}
      <Card>
        <EmptyState message="Aucune règle d'automatisation pour le moment.">
          {#snippet children()}
            <Button onclick={openQuickWire}>Connexion rapide</Button>
          {/snippet}
        </EmptyState>
      </Card>
    {:else}
      {#each board as col (col.eventType)}
        <Card padded={false}>
          <div
            class="flex flex-wrap items-center gap-2 border-b border-edge-soft bg-surface-muted px-4 py-2.5"
          >
            <span class="text-sm font-bold text-ink">{eventLabel(col.eventType)}</span>
            <Badge tone="neutral">{moduleOf(col.eventType)}</Badge>
            <span class="font-mono text-xs text-ink-faint">{col.eventType}</span>
            <span class="ml-auto text-xs text-ink-muted">
              {col.rules.length}
              {col.rules.length > 1 ? 'règles' : 'règle'}
            </span>
          </div>
          <div class="divide-y divide-edge-soft">
            {#each col.rules as rule (rule.id)}
              <div class="overflow-x-auto px-4 py-3">
                <div class="flex min-w-[44rem] items-center gap-3">
                  <!-- Rule name + condition -->
                  <div class="min-w-0 flex-1">
                    <div class="flex items-center gap-2">
                      <span class="truncate text-sm font-semibold text-ink">{rule.name}</span>
                      {#if !rule.enabled}
                        <Badge tone="neutral">Inactive</Badge>
                      {/if}
                    </div>
                    <div class="mt-0.5 truncate font-mono text-xs text-ink-faint">
                      {conditionSummary(rule)}
                    </div>
                  </div>

                  <span class="shrink-0 text-lg text-ink-faint">&rarr;</span>

                  <!-- Action chip -->
                  <div class="shrink-0">
                    {#if rule.action.kind === 'CREATE_TASK'}
                      <Badge tone="info">
                        Tâche : {rule.action.category} · {rule.action.severity}
                      </Badge>
                    {:else}
                      {@const ak = actionKpi(rule.action.action)}
                      <Badge tone="warn">
                        {reactionLabel(rule.action.action)}{#if ak}
                          <span class="text-[10px] font-normal opacity-80">
                            · {ak.executed}&check; {ak.failed}&cross;</span
                          >{/if}
                      </Badge>
                    {/if}
                  </div>

                  <!-- Enable toggle -->
                  <button
                    type="button"
                    class="shrink-0"
                    onclick={() => void toggleEnabled(rule)}
                    disabled={busyId === rule.id}
                    title={rule.enabled ? 'Désactiver' : 'Activer'}
                  >
                    {#if rule.enabled}
                      <Badge tone="ok">Active</Badge>
                    {:else}
                      <Badge tone="neutral">Activer</Badge>
                    {/if}
                  </button>

                  <!-- Delete (in-row confirm) -->
                  <div class="shrink-0">
                    {#if confirmingDeleteId === rule.id}
                      <div class="flex items-center gap-1.5">
                        <button
                          type="button"
                          class="rounded-inner bg-danger-soft px-2 py-1 text-xs font-semibold text-danger"
                          onclick={() => void remove(rule)}
                          disabled={busyId === rule.id}
                        >
                          Confirmer
                        </button>
                        <button
                          type="button"
                          class="rounded-inner px-2 py-1 text-xs text-ink-muted hover:text-ink"
                          onclick={() => (confirmingDeleteId = null)}
                        >
                          Annuler
                        </button>
                      </div>
                    {:else}
                      <button
                        type="button"
                        class="rounded-inner px-2 py-1 text-xs text-ink-muted hover:text-danger"
                        onclick={() => (confirmingDeleteId = rule.id)}
                      >
                        Supprimer
                      </button>
                    {/if}
                  </div>
                </div>
              </div>
            {/each}
          </div>
        </Card>
      {/each}
    {/if}
  </div>

  <!-- ── REACTION PALETTE ─────────────────────────────────────────────────── -->
  <div class="mt-8">
    <h2 class="mb-2 text-sm font-bold text-ink">Palette de réactions</h2>
    <p class="mb-3 text-sm text-ink-muted">
      Les actions cross-module disponibles. Utilisez « Connexion rapide » pour câbler l'une d'elles à un
      événement.
    </p>
    <div class="grid gap-3 md:grid-cols-2">
      {#each reactionsByModule as group (group.module)}
        <Card>
          <div class="mb-2 flex items-center gap-2">
            <Badge tone="neutral">{group.module}</Badge>
            <span class="text-xs text-ink-faint">{group.items.length}</span>
          </div>
          <div class="space-y-3">
            {#each group.items as reaction (reaction.key)}
              <div class="rounded-inner border border-edge-soft bg-surface-muted p-2.5">
                <div class="flex flex-wrap items-center gap-2">
                  <span class="text-sm font-semibold text-ink">{reaction.label}</span>
                  {#each reaction.argKeys as argKey (argKey)}
                    <code class="rounded bg-surface px-1.5 py-0.5 font-mono text-[11px] text-ink-muted">
                      {argKey}
                    </code>
                  {/each}
                </div>
                <p class="mt-1 text-xs leading-5 text-ink-muted">{reaction.description}</p>
              </div>
            {/each}
          </div>
        </Card>
      {/each}
    </div>
  </div>

  <!-- ── AVAILABLE (UNCOVERED) EVENTS ─────────────────────────────────────── -->
  {#if uncoveredEvents.length > 0}
    <div class="mt-8">
      <h2 class="mb-2 text-sm font-bold text-ink">Événements sans règle</h2>
      <p class="mb-3 text-sm text-ink-muted">
        Ces événements métier ne déclenchent encore aucune automatisation — autant de lacunes à combler.
      </p>
      <Card>
        <div class="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {#each uncoveredEvents as ev (ev.type)}
            <div class="flex items-center justify-between gap-2 rounded-inner border border-edge-soft p-2.5">
              <div class="min-w-0">
                <div class="truncate text-sm font-medium text-ink">{ev.label}</div>
                <div class="truncate font-mono text-[11px] text-ink-faint">{ev.type}</div>
              </div>
              <button
                type="button"
                class="shrink-0 text-xs font-semibold text-accent hover:underline"
                onclick={() => goto('/automation')}
              >
                Créer une règle
              </button>
            </div>
          {/each}
        </div>
      </Card>
    </div>
  {/if}
{/if}

<!-- ── QUICK-WIRE MODAL ─────────────────────────────────────────────────────── -->
<Modal bind:open={showQuickWire} title="Connexion rapide — réaction" size="lg">
  {#snippet children()}
    <form onsubmit={submitQuickWire} class="space-y-4">
      {#if quickError}<p class="text-sm text-danger">{quickError}</p>{/if}

      <div>
        <label class="mb-1 block text-xs font-semibold text-ink-muted" for="qw-name">Nom</label>
        <Input bind:value={qwName} name="qw-name" placeholder="Ex. Préparer le picking à la planification" required />
      </div>

      <div>
        <label class="mb-1 block text-xs font-semibold text-ink-muted" for="qw-event">
          Événement déclencheur
        </label>
        <Select bind:value={qwEventType} onchange={onQwEventChange} name="qw-event" required>
          <option value="" disabled>Choisir un événement…</option>
          {#each AUTOMATION_EVENT_CATALOG as ev (ev.type)}
            <option value={ev.type}>{ev.label}</option>
          {/each}
        </Select>
      </div>

      <div>
        <label class="mb-1 block text-xs font-semibold text-ink-muted" for="qw-reaction">Réaction</label>
        <Select bind:value={qwReactionKey} onchange={onQwReactionChange} name="qw-reaction">
          {#each REACTION_CATALOG as reaction (reaction.key)}
            <option value={reaction.key}>{reaction.label} ({reaction.module})</option>
          {/each}
        </Select>
        {#if selectedReaction}
          <p class="mt-1 text-xs text-ink-muted">{selectedReaction.description}</p>
        {/if}
      </div>

      {#if selectedReaction && selectedReaction.argKeys.length > 0}
        <div class="space-y-2 rounded-card border border-edge-soft p-3">
          <span class="text-xs font-semibold text-ink-muted">Arguments (gabarits de payload)</span>
          {#each selectedReaction.argKeys as argKey (argKey)}
            <div>
              <label class="mb-1 block font-mono text-xs text-ink-faint" for={`qw-arg-${argKey}`}>
                {argKey}
              </label>
              <Input
                value={qwArgs[argKey] ?? `{${argKey}}`}
                name={`qw-arg-${argKey}`}
                oninput={(e: Event) => {
                  qwArgs = {
                    ...qwArgs,
                    [argKey]: (e.currentTarget as HTMLInputElement).value,
                  };
                }}
                placeholder={`{${argKey}}`}
              />
            </div>
          {/each}
          <p class="text-xs text-ink-faint">
            Utilisez <code class="font-mono">{'{chemin}'}</code> pour insérer une valeur du payload de
            l'événement.
          </p>
        </div>
      {/if}

      <p class="text-xs text-ink-faint">
        Pour les conditions, sévérités et tâches (CREATE_TASK), utilisez la
        <button type="button" class="font-semibold text-accent hover:underline" onclick={() => goto('/automation')}>
          règle avancée
        </button>.
      </p>

      <div class="flex justify-end gap-2 border-t border-edge pt-3">
        <Button variant="secondary" onclick={() => { showQuickWire = false; }}>Annuler</Button>
        <Button variant="primary" type="submit" loading={saving}>Câbler la réaction</Button>
      </div>
    </form>
  {/snippet}
</Modal>
