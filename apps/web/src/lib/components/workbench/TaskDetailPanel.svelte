<script lang="ts">
  import { api, ApiError } from '$lib/api/client';
  import { uploadDocument } from '$lib/api/files';
  import { toast } from '$lib/stores/toast';
  import { formatDateTime } from '$lib/format';
  import { getPlaybook, isSlaBreached } from '@pulsar/shared';
  import {
    Modal,
    Badge,
    Button,
    Textarea,
    Skeleton,
    type Tone,
  } from '$lib/components/ui';

  // ──────────────────────────────────────────────────────────
  // Types
  // ──────────────────────────────────────────────────────────

  interface ProposedActionRef {
    id: string;
    tool: string;
    riskTier: string;
    status: string;
    triggeredByRef: string | null;
    proposedAt: string;
    decidedAt: string | null;
  }

  interface NoteEntry {
    at: string;
    byUserId: string;
    text: string;
  }

  interface TaskDetail {
    id: string;
    type: string;
    category: string;
    status: string;
    severity: string;
    title: string;
    details: Record<string, unknown> | null;
    subjectType: string | null;
    subjectId: string | null;
    assigneeType: string;
    assigneeUserId: string | null;
    assigneeAgentId: string | null;
    createdAt: string;
    resolvedAt: string | null;
    caseNumber: string | null;
    slaDueAt: string | null;
    escalatedAt: string | null;
    slaBreached?: boolean;
    notes?: NoteEntry[] | null;
    proposedActions?: ProposedActionRef[];
  }

  interface TimelineEntry {
    at: string;
    kind: string;
    summary: string;
    ref?: string;
  }

  interface Document {
    id: string;
    fileName: string;
    mimeType: string;
    createdAt: string;
  }

  // ──────────────────────────────────────────────────────────
  // Props
  // ──────────────────────────────────────────────────────────

  let {
    task,
    canManage,
    onclose,
    onrefresh,
  }: {
    task: TaskDetail;
    canManage: boolean;
    onclose: () => void;
    onrefresh: () => void;
  } = $props();

  // ──────────────────────────────────────────────────────────
  // State
  // ──────────────────────────────────────────────────────────

  let timeline = $state<TimelineEntry[]>([]);
  let timelineLoading = $state(false);
  let timelineError = $state('');

  let documents = $state<Document[]>([]);
  let docsLoading = $state(false);

  let note = $state('');
  let noteSubmitting = $state(false);

  let actionBusy = $state(false);

  let uploadInput = $state<HTMLInputElement | null>(null);
  let uploading = $state(false);

  // Checklist completion state
  let checkedItems = $state<boolean[]>([]);

  // ──────────────────────────────────────────────────────────
  // Derived
  // ──────────────────────────────────────────────────────────

  const playbook = $derived(getPlaybook(task.category));

  const slaStatus = $derived((): 'breached' | 'escalated' | 'ok' | 'none' => {
    if (!task.slaDueAt) return 'none';
    if ((task.slaBreached ?? false) || isSlaBreached(task.slaDueAt, Date.now())) return 'breached';
    if (task.escalatedAt) return 'escalated';
    return 'ok';
  });

  const slaLabel = $derived((): string => {
    if (!task.slaDueAt) return '';
    const due = new Date(task.slaDueAt).getTime();
    const now = Date.now();
    const diffMs = due - now;
    if (diffMs <= 0) return 'En retard';
    const diffMin = Math.floor(diffMs / 60_000);
    if (diffMin < 60) return `SLA ${diffMin}m`;
    const h = Math.floor(diffMin / 60);
    const m = diffMin % 60;
    return m > 0 ? `SLA ${h}h${m}m` : `SLA ${h}h`;
  });

  // ──────────────────────────────────────────────────────────
  // Helpers
  // ──────────────────────────────────────────────────────────

  function severityTone(severity: string): Tone {
    switch (severity?.toUpperCase()) {
      case 'CRITICAL': return 'danger';
      case 'WARNING': return 'warn';
      case 'INFO': return 'info';
      default: return 'neutral';
    }
  }

  function statusTone(status: string): Tone {
    switch (status?.toUpperCase()) {
      case 'OPEN': return 'warn';
      case 'IN_PROGRESS': return 'info';
      case 'RESOLVED': return 'ok';
      case 'DISMISSED': return 'neutral';
      default: return 'neutral';
    }
  }

  function riskTierTone(tier: string): Tone {
    switch (tier?.toUpperCase()) {
      case 'READ': case 'LOW': return 'info';
      case 'MUTATING': return 'warn';
      case 'SENSITIVE': return 'danger';
      default: return 'neutral';
    }
  }

  function timelineKindTone(kind: string): Tone {
    switch (kind?.toUpperCase()) {
      case 'STATUS_CHANGE': return 'info';
      case 'NOTE': return 'neutral';
      case 'PROPOSED_ACTION': return 'warn';
      case 'RESOLVED': return 'ok';
      default: return 'neutral';
    }
  }

  function detailEntries(details: Record<string, unknown> | null): [string, string][] {
    if (!details || typeof details !== 'object') return [];
    return Object.entries(details).map(([k, v]) => [
      k,
      typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v),
    ]);
  }

  function assigneeLabel(): string {
    if (task.assigneeType === 'UNASSIGNED') return 'Non assigné';
    if (task.assigneeType === 'HUMAN') return 'Humain';
    if (task.assigneeType === 'AGENT') return 'Agent';
    return task.assigneeType;
  }

  // ──────────────────────────────────────────────────────────
  // Data loading
  // ──────────────────────────────────────────────────────────

  async function loadTimeline() {
    timelineLoading = true;
    timelineError = '';
    try {
      timeline = await api<TimelineEntry[]>(`/operational-tasks/${task.id}/timeline`);
    } catch (e) {
      timelineError = e instanceof ApiError ? e.message : 'Impossible de charger la timeline';
    } finally {
      timelineLoading = false;
    }
  }

  async function loadDocuments() {
    docsLoading = true;
    try {
      documents = await api<Document[]>('/documents', {
        query: { entityType: 'operational-task', entityId: task.id },
      });
    } catch {
      // non-blocking
    } finally {
      docsLoading = false;
    }
  }

  // Init checklist
  $effect(() => {
    checkedItems = playbook.checklist.map(() => false);
    void loadTimeline();
    void loadDocuments();
  });

  // ──────────────────────────────────────────────────────────
  // Actions
  // ──────────────────────────────────────────────────────────

  async function start() {
    actionBusy = true;
    try {
      await api(`/operational-tasks/${task.id}/start`, { method: 'POST' });
      toast.success('Tâche démarrée');
      onrefresh();
      onclose();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Erreur au démarrage');
    } finally {
      actionBusy = false;
    }
  }

  async function resolve() {
    actionBusy = true;
    try {
      await api(`/operational-tasks/${task.id}/resolve`, {
        method: 'POST',
        body: note ? { note } : {},
      });
      toast.success('Tâche résolue');
      onrefresh();
      onclose();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Erreur à la résolution');
    } finally {
      actionBusy = false;
    }
  }

  async function dismiss() {
    actionBusy = true;
    try {
      await api(`/operational-tasks/${task.id}/dismiss`, {
        method: 'POST',
        body: note ? { note } : {},
      });
      toast.success('Tâche ignorée');
      onrefresh();
      onclose();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Erreur à l\'ignorance');
    } finally {
      actionBusy = false;
    }
  }

  async function addNote() {
    if (!note.trim()) return;
    noteSubmitting = true;
    try {
      await api(`/operational-tasks/${task.id}/note`, {
        method: 'POST',
        body: { text: note.trim() },
      });
      note = '';
      toast.success('Note ajoutée');
      await loadTimeline();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Erreur à l\'ajout de note');
    } finally {
      noteSubmitting = false;
    }
  }

  async function handleFileUpload(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    uploading = true;
    try {
      await uploadDocument(file, 'operational-task', task.id);
      toast.success('Document ajouté');
      await loadDocuments();
    } catch {
      toast.error('Erreur lors du téléversement');
    } finally {
      uploading = false;
      if (uploadInput) uploadInput.value = '';
    }
  }
</script>

<Modal open={true} size="xl" title={task.caseNumber ? `${task.caseNumber} — ${task.title}` : task.title} {onclose}>
  {#snippet footer()}
    {#if canManage}
      {#if task.status === 'OPEN'}
        <Button variant="secondary" disabled={actionBusy} onclick={() => void start()}>Démarrer</Button>
        <Button variant="secondary" disabled={actionBusy} onclick={() => void dismiss()}>Ignorer</Button>
        <Button variant="primary" disabled={actionBusy} onclick={() => void resolve()}>Résoudre</Button>
      {:else if task.status === 'IN_PROGRESS'}
        <Button variant="secondary" disabled={actionBusy} onclick={() => void dismiss()}>Ignorer</Button>
        <Button variant="primary" disabled={actionBusy} onclick={() => void resolve()}>Résoudre</Button>
      {/if}
    {/if}
  {/snippet}

  <div class="space-y-5">
    <!-- Header row: badges -->
    <div class="flex flex-wrap items-center gap-2">
      <Badge tone={severityTone(task.severity)}>{task.severity}</Badge>
      <Badge tone={statusTone(task.status)}>{task.status.replaceAll('_', ' ')}</Badge>
      {#if task.slaDueAt}
        {@const st = slaStatus()}
        {@const lbl = slaLabel()}
        <span class={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${
          st === 'breached' ? 'bg-danger-soft text-danger' :
          st === 'escalated' ? 'bg-warn-soft text-warn' :
          'bg-ok-soft text-ok'
        }`}>
          <span class="text-[8px] leading-none" aria-hidden="true">⏱</span>
          {lbl}
        </span>
      {/if}
      {#if task.escalatedAt}
        <Badge tone="danger">Escaladé</Badge>
      {/if}
    </div>

    <!-- Core metadata grid -->
    <div class="grid grid-cols-2 gap-3 sm:grid-cols-3">
      <div>
        <div class="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-ink-muted">Catégorie</div>
        <div class="text-sm text-ink">{task.category.replaceAll('_', ' ')}</div>
      </div>
      <div>
        <div class="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-ink-muted">Assigné à</div>
        <div class="text-sm text-ink">{assigneeLabel()}</div>
      </div>
      <div>
        <div class="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-ink-muted">Créé le</div>
        <div class="text-sm text-ink">{formatDateTime(task.createdAt)}</div>
      </div>
      {#if task.subjectType || task.subjectId}
        <div>
          <div class="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-ink-muted">Sujet</div>
          <div class="text-sm text-ink">{task.subjectType ?? ''} {task.subjectId ?? ''}</div>
        </div>
      {/if}
      {#if task.slaDueAt}
        <div>
          <div class="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-ink-muted">Échéance SLA</div>
          <div class="text-sm text-ink">{formatDateTime(task.slaDueAt)}</div>
        </div>
      {/if}
      {#if task.resolvedAt}
        <div>
          <div class="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-ink-muted">Résolu le</div>
          <div class="text-sm text-ink">{formatDateTime(task.resolvedAt)}</div>
        </div>
      {/if}
    </div>

    <!-- Playbook checklist -->
    <div>
      <div class="mb-2 text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
        Playbook — {playbook.checklist.length} étapes
      </div>
      <ul class="space-y-1.5">
        {#each playbook.checklist as item, i (i)}
          <li class="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              id={`chk-${task.id}-${i}`}
              bind:checked={checkedItems[i]}
              class="mt-0.5 shrink-0 accent-accent"
            />
            <label
              for={`chk-${task.id}-${i}`}
              class={`cursor-pointer leading-snug ${checkedItems[i] ? 'line-through text-ink-faint' : 'text-ink'}`}
            >{item}</label>
          </li>
        {/each}
      </ul>
    </div>

    <!-- Details payload -->
    {#if detailEntries(task.details).length > 0}
      <div>
        <div class="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-ink-muted">Détails</div>
        <dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
          {#each detailEntries(task.details) as [k, v] (k)}
            <dt class="font-medium text-ink-muted">{k}</dt>
            <dd class="break-all text-ink">{v}</dd>
          {/each}
        </dl>
      </div>
    {/if}

    <!-- Proposed actions -->
    {#if task.proposedActions && task.proposedActions.length > 0}
      <div>
        <div class="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
          Actions proposées ({task.proposedActions.length})
        </div>
        <div class="space-y-1.5">
          {#each task.proposedActions as pa (pa.id)}
            <div class="rounded-md border border-edge bg-surface-muted px-2.5 py-2 text-xs">
              <div class="flex flex-wrap items-center gap-2">
                <code class="font-mono text-ink">{pa.tool}</code>
                <Badge tone={riskTierTone(pa.riskTier)}>{pa.riskTier}</Badge>
                <Badge tone={statusTone(pa.status)}>{pa.status}</Badge>
              </div>
              <div class="mt-0.5 text-ink-faint">{formatDateTime(pa.proposedAt)}</div>
              {#if pa.decidedAt}
                <div class="mt-0.5 text-ink-faint">Décidé: {formatDateTime(pa.decidedAt)}</div>
              {/if}
            </div>
          {/each}
        </div>
      </div>
    {/if}

    <!-- Notes -->
    <div>
      <div class="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-ink-muted">Notes</div>
      {#if task.notes && task.notes.length > 0}
        <div class="mb-2 space-y-1.5">
          {#each task.notes as n, i (i)}
            <div class="rounded-md border border-edge bg-surface-muted px-2.5 py-2 text-xs">
              <div class="text-ink">{n.text}</div>
              <div class="mt-0.5 text-ink-faint">{formatDateTime(n.at)}</div>
            </div>
          {/each}
        </div>
      {:else}
        <p class="mb-2 text-xs text-ink-faint">Aucune note pour l'instant.</p>
      {/if}
      {#if canManage}
        <div class="flex gap-2">
          <div class="flex-1">
            <Textarea bind:value={note} placeholder="Ajouter une note…" rows={2} disabled={noteSubmitting} />
          </div>
          <div class="flex items-end">
            <Button
              variant="secondary"
              disabled={noteSubmitting || !note.trim()}
              onclick={() => void addNote()}
            >Ajouter</Button>
          </div>
        </div>
      {/if}
    </div>

    <!-- Note for resolve/dismiss (shown only when action in footer) -->
    {#if canManage && (task.status === 'OPEN' || task.status === 'IN_PROGRESS')}
      <div>
        <div class="mb-1 text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
          Note de résolution (optionnel)
        </div>
        <Textarea bind:value={note} placeholder="Note pour la résolution ou l'ignorance…" rows={2} />
      </div>
    {/if}

    <!-- Documents -->
    <div>
      <div class="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-ink-muted">Documents</div>
      {#if docsLoading}
        <div class="text-xs text-ink-faint">Chargement…</div>
      {:else if documents.length === 0}
        <p class="mb-2 text-xs text-ink-faint">Aucun document joint.</p>
      {:else}
        <ul class="mb-2 space-y-1">
          {#each documents as doc (doc.id)}
            <li class="flex items-center gap-2 text-xs">
              <span class="text-ink">{doc.fileName}</span>
              <span class="text-ink-faint">{formatDateTime(doc.createdAt)}</span>
            </li>
          {/each}
        </ul>
      {/if}
      {#if canManage}
        <label class="inline-flex cursor-pointer items-center gap-2 rounded-md border border-edge bg-surface px-3 py-1.5 text-sm font-medium text-ink-muted hover:bg-surface-muted hover:text-ink">
          <input
            bind:this={uploadInput}
            type="file"
            class="hidden"
            onchange={handleFileUpload}
            disabled={uploading}
          />
          {uploading ? 'Téléversement…' : 'Joindre un fichier'}
        </label>
      {/if}
    </div>

    <!-- Timeline -->
    <div>
      <div class="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-ink-muted">Timeline</div>
      {#if timelineLoading}
        <Skeleton rows={3} />
      {:else if timelineError}
        <p class="text-xs text-danger">{timelineError}</p>
      {:else if timeline.length === 0}
        <p class="text-xs text-ink-faint">Aucun événement enregistré.</p>
      {:else}
        <ol class="space-y-2">
          {#each timeline as entry, i (i)}
            <li class="flex items-start gap-2.5 text-xs">
              <div class="mt-0.5 shrink-0">
                <Badge tone={timelineKindTone(entry.kind)}>{entry.kind.replaceAll('_', ' ')}</Badge>
              </div>
              <div class="flex-1">
                <div class="text-ink">{entry.summary}</div>
                {#if entry.ref}
                  <div class="text-ink-faint">{entry.ref}</div>
                {/if}
                <div class="mt-0.5 text-ink-faint">{formatDateTime(entry.at)}</div>
              </div>
            </li>
          {/each}
        </ol>
      {/if}
    </div>
  </div>
</Modal>
