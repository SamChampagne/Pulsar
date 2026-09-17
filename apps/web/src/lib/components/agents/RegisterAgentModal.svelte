<script lang="ts">
  import { AGENT_ROLE_PRESETS } from '@pulsar/shared';
  import { api, ApiError } from '$lib/api/client';
  import { toast } from '$lib/stores/toast';
  import { Button, Field, Input, Modal, Textarea, Select } from '$lib/components/ui';

  type AutonomyLevel = 'PROPOSE' | 'ACT_LOW' | 'AUTONOMOUS';
  interface AgentCreated { id: string; key: string; name: string }
  interface RuntimeModelOption { value: string; label: string }

  // Real model list for the connected provider (cached at last connection test).
  // Empty until a successful test → the dropdown still offers the safe "tenant default".
  let models = $state<RuntimeModelOption[]>([]);
  let modelsLoaded = $state(false);
  async function loadModels() {
    if (modelsLoaded) return;
    modelsLoaded = true;
    try {
      const rt = await api<{ availableModels?: RuntimeModelOption[] }>('/agent-runtime');
      models = rt.availableModels ?? [];
    } catch {
      models = [];
    }
  }
  $effect(() => {
    if (open) void loadModels();
  });

  let { open = $bindable(false), onCreated }: { open: boolean; onCreated?: (id?: string) => void } = $props();

  // — Accès en langage clair → mappés vers les vraies permissions sous le capot —
  const ACCESS_GROUPS = [
    { id: 'read', label: 'Consulter les opérations', hint: 'Voir ordres, shipments, loads et tarifs', keys: ['transportation.orders.read', 'transportation.planning.read'] },
    { id: 'plan', label: 'Planifier', hint: 'Créer/assigner des loads, tender (proposé → à approuver)', keys: ['transportation.planning.manage'] },
    { id: 'analytics', label: 'Analytics & fiches transporteurs', hint: 'Voir la performance des transporteurs', keys: ['transportation.analytics.read'] },
  ];

  const AUTONOMY = [
    { value: 'PROPOSE' as const, label: 'Propose tout', hint: "L'agent propose, tu approuves chaque action. Le plus sûr." },
    { value: 'ACT_LOW' as const, label: 'Agit (faible risque)', hint: 'Petites actions automatiques ; le sensible reste à approuver.' },
    { value: 'AUTONOMOUS' as const, label: 'Autonome', hint: 'Agit seul, toujours borné par les plafonds.' },
  ];

  // Templates: presets + a blank "from scratch" card.
  const PRESET_EMOJI: Record<string, string> = {
    dispatcher: '🚚', 'billing-clerk': '🧾', analyst: '📊',
    'tender-desk': '🔁', 'freight-auditor': '🔍', 'fleet-maintenance': '🔧',
    'crm-sdr': '🤝',
  };
  const TEMPLATES = [
    ...AGENT_ROLE_PRESETS.map((p) => ({
      id: p.id,
      label: p.label,
      persona: p.persona,
      autonomy: p.suggestedAutonomy as AutonomyLevel,
      keys: p.suggestedPermissions,
      emoji: PRESET_EMOJI[p.id] ?? '🤖',
      alwaysOn: p.alwaysOn ?? false,
      categories: p.handlesCategories ?? [],
      cap: p.suggestedMaxAmountPerAction,
      toolAllowlist: p.suggestedToolAllowlist,
    })),
    { id: 'custom', label: 'Personnalisé', persona: '', autonomy: 'PROPOSE' as AutonomyLevel, keys: [] as string[], emoji: '🤖', alwaysOn: false, categories: [] as string[], cap: undefined as number | undefined, toolAllowlist: undefined as string[] | undefined },
  ];

  let step = $state<'template' | 'form'>('template');
  let name = $state('');
  let emoji = $state('🤖');
  let persona = $state('');
  let autonomyLevel = $state<AutonomyLevel>('PROPOSE');
  let permissions = $state<string[]>([]);
  let role = $state('');
  // Always-on (24/7) employee config, set from a preset.
  let alwaysOn = $state(false);
  let handlesCategories = $state<string[]>([]);
  let toolAllowlist = $state<string[] | undefined>(undefined);
  // advanced
  let showAdvanced = $state(false);
  let model = $state('');
  let maxAmountPerAction = $state('');
  let createdKey = $state('');
  let createdId = $state('');
  let saving = $state(false);

  function pickTemplate(t: (typeof TEMPLATES)[number]) {
    role = t.label === 'Personnalisé' ? '' : t.label;
    persona = t.persona;
    autonomyLevel = t.autonomy;
    permissions = [...t.keys];
    emoji = t.emoji;
    alwaysOn = t.alwaysOn;
    handlesCategories = [...t.categories];
    toolAllowlist = t.toolAllowlist ? [...t.toolAllowlist] : undefined;
    maxAmountPerAction = t.cap != null ? String(t.cap) : '';
    step = 'form';
  }

  function groupOn(g: (typeof ACCESS_GROUPS)[number]) {
    return g.keys.every((k) => permissions.includes(k));
  }
  function toggleGroup(g: (typeof ACCESS_GROUPS)[number]) {
    if (groupOn(g)) permissions = permissions.filter((k) => !g.keys.includes(k));
    else permissions = [...new Set([...permissions, ...g.keys])];
  }

  function reset() {
    step = 'template'; name = ''; emoji = '🤖'; persona = ''; autonomyLevel = 'PROPOSE';
    permissions = []; role = ''; showAdvanced = false; model = ''; maxAmountPerAction = '';
    alwaysOn = false; handlesCategories = [];
    toolAllowlist = undefined;
  }

  async function create(event: SubmitEvent) {
    event.preventDefault();
    saving = true;
    try {
      const caps: { maxAmountPerAction?: number; alwaysOn?: boolean; handlesCategories?: string[]; toolAllowlist?: string[] } = {};
      if (toolAllowlist) caps.toolAllowlist = toolAllowlist;
      const amount = Number(maxAmountPerAction);
      if (String(maxAmountPerAction ?? '').trim() !== '' && amount > 0) caps.maxAmountPerAction = amount;
      if (alwaysOn) {
        caps.alwaysOn = true;
        caps.handlesCategories = handlesCategories;
      }
      const created = await api<AgentCreated>('/agents', {
        method: 'POST',
        body: {
          name, permissions, caps, autonomyLevel,
          ...(persona.trim() ? { persona } : {}),
          ...(role.trim() ? { role } : {}),
          ...(model.trim() ? { model } : {}),
          ...(emoji.trim() ? { avatar: emoji } : {}),
        },
      });
      createdKey = created.key;
      createdId = created.id;
      onCreated?.(created.id);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Échec de la création');
    } finally {
      saving = false;
    }
  }

  function done() { createdKey = ''; createdId = ''; reset(); open = false; }
</script>

<Modal bind:open title={createdKey ? 'Agent créé' : 'Nouvel agent'}>
  {#snippet children()}
    {#if createdKey}
      <div class="text-center">
        <div class="mx-auto mb-2 flex size-12 items-center justify-center rounded-full bg-ok-soft text-2xl">{emoji}</div>
        <p class="text-sm text-ink">Ton agent est prêt. Connecte un modèle (Agents → Connexion du modèle) s'il ne l'est pas déjà, puis parle-lui.</p>
        <div class="mt-4 flex justify-center gap-2">
          <Button variant="secondary" onclick={done}>Fermer</Button>
          <a href="/agents/{createdId}" class="inline-flex items-center rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-hover" onclick={done}>Ouvrir & parler</a>
        </div>
        <details class="mt-4 text-left">
          <summary class="cursor-pointer text-xs text-ink-faint">Clé API de l'agent (avancé — pour un client MCP externe)</summary>
          <code class="mt-2 block break-all rounded bg-surface-muted p-2 text-xs text-ink">{createdKey}</code>
          <p class="mt-1 text-xs text-ink-faint">Affichée une seule fois. Inutile pour parler à l'agent depuis Pulsar.</p>
        </details>
      </div>
    {:else if step === 'template'}
      <p class="mb-3 text-sm text-ink-muted">Choisis un modèle d'employé pour démarrer (tout reste modifiable ensuite).</p>
      <div class="grid gap-2 sm:grid-cols-2">
        {#each TEMPLATES as t (t.id)}
          <button type="button" onclick={() => pickTemplate(t)} class="flex items-start gap-3 rounded-card border border-edge-soft p-3 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-accent hover:shadow-card">
            <span class="text-2xl">{t.emoji}</span>
            <span class="min-w-0">
              <span class="flex items-center gap-1.5">
                <span class="block text-sm font-semibold text-ink">{t.label}</span>
                {#if t.alwaysOn}
                  <span class="rounded-full bg-info-soft px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-info">24/7</span>
                {/if}
              </span>
              <span class="mt-0.5 block text-xs text-ink-muted">{t.id === 'custom' ? 'Partir de zéro.' : t.persona.slice(0, 70) + '…'}</span>
            </span>
          </button>
        {/each}
      </div>
    {:else}
      <form onsubmit={create} class="space-y-4">
        <div class="flex items-end gap-3">
          <div class="w-16">
            <Field label="Emoji"><Input bind:value={emoji} /></Field>
          </div>
          <div class="flex-1">
            <Field label="Nom"><Input bind:value={name} required placeholder="ex. Répartiteur Acme" /></Field>
          </div>
        </div>

        <div>
          <span class="mb-1.5 block text-xs font-semibold tracking-wide text-ink-muted uppercase">Accès</span>
          {#if handlesCategories.includes('MRP_REVIEW') && toolAllowlist}
            <div class="rounded-md border border-edge-soft bg-surface-muted p-3 text-sm text-ink">
              <p>Fabrication et WMS en lecture, sources CRM et tâches MRP. Synthèse et recalcul passent par la gouvernance; aucun achat, OF ou mouvement de stock.</p>
              <p class="mt-2 text-xs text-ink-muted">Worker réveillé sur les revues MRP affectées. Outils limités à la lecture, la synthèse et le recalcul. Configurez la connexion du modèle avant utilisation.</p>
              <details class="mt-2"><summary class="cursor-pointer text-xs text-ink-muted">Permissions et outils du rôle</summary><p class="mt-2 break-words font-mono text-xs">{permissions.join(' · ')}</p><p class="mt-2 break-words font-mono text-xs">{toolAllowlist.join(' · ')}</p></details>
            </div>
          {:else}
          <div class="space-y-1.5">
            {#each ACCESS_GROUPS as g (g.id)}
              <label class="flex cursor-pointer items-start gap-2.5 rounded-md border p-2.5 transition {groupOn(g) ? 'border-accent bg-accent-soft/40' : 'border-edge-soft hover:border-accent'}">
                <input type="checkbox" checked={groupOn(g)} onchange={() => toggleGroup(g)} class="mt-0.5 shrink-0" />
                <span>
                  <span class="block text-sm font-medium text-ink">{g.label}</span>
                  <span class="block text-xs text-ink-muted">{g.hint}</span>
                </span>
              </label>
            {/each}
          </div>
          {/if}
        </div>

        <div>
          <span class="mb-1.5 block text-xs font-semibold tracking-wide text-ink-muted uppercase">Autonomie</span>
          <div class="space-y-1.5">
            {#each AUTONOMY as a (a.value)}
              <label class="flex cursor-pointer items-start gap-2.5 rounded-md border p-2.5 transition {autonomyLevel === a.value ? 'border-accent bg-accent-soft/40' : 'border-edge-soft hover:border-accent'}">
                <input type="radio" name="autonomy" checked={autonomyLevel === a.value} onchange={() => (autonomyLevel = a.value)} class="mt-0.5 shrink-0" />
                <span>
                  <span class="block text-sm font-medium text-ink">{a.label}</span>
                  <span class="block text-xs text-ink-muted">{a.hint}</span>
                </span>
              </label>
            {/each}
          </div>
        </div>

        <div>
          <Field label="Personnalité (optionnel)">
            <Textarea bind:value={persona} rows={3} placeholder="Ton, style, règles métier de cet employé…" />
          </Field>
        </div>

        <details bind:open={showAdvanced}>
          <summary class="cursor-pointer text-xs font-semibold text-ink-muted">Options avancées</summary>
          <div class="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Modèle">
              <Select bind:value={model}>
                <option value="">Défaut du tenant</option>
                {#each models as m (m.value)}
                  <option value={m.value}>{m.label}</option>
                {/each}
              </Select>
              {#if models.length === 0}
                <p class="mt-1 text-xs text-ink-faint">Teste la connexion (Connexion du modèle) pour lister les modèles disponibles.</p>
              {/if}
            </Field>
            <Field label="Plafond $ / action"><Input type="number" bind:value={maxAmountPerAction} placeholder="aucun" /></Field>
          </div>
        </details>

        <div class="flex justify-between gap-2 border-t border-edge-soft pt-3">
          <Button variant="ghost" onclick={() => { step = 'template'; }}>← Modèle</Button>
          <div class="flex gap-2">
            <Button variant="secondary" onclick={() => { open = false; reset(); }}>Annuler</Button>
            <Button variant="primary" type="submit" loading={saving} disabled={!name.trim() || permissions.length === 0}>Créer l'agent</Button>
          </div>
        </div>
      </form>
    {/if}
  {/snippet}
</Modal>
