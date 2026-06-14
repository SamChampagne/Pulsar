<script lang="ts">
  import { PERMISSION_CATALOG, AGENT_ROLE_PRESETS } from '@pulsar/shared';
  import { api, ApiError } from '$lib/api/client';
  import { toast } from '$lib/stores/toast';
  import {
    Button,
    Card,
    Field,
    Input,
    Modal,
    Select,
    Textarea,
  } from '$lib/components/ui';

  type AutonomyLevel = 'PROPOSE' | 'ACT_LOW' | 'AUTONOMOUS';

  interface AgentCreated {
    id: string;
    key: string;
    name: string;
  }

  // Dispatch-relevant scopes the agent tools use (transportation read/manage + analytics).
  const DISPATCH_KEYS = [
    'transportation.orders.read',
    'transportation.planning.read',
    'transportation.planning.manage',
    'transportation.analytics.read',
  ];
  const dispatchScopes = DISPATCH_KEYS.map((key) => ({
    key,
    description: PERMISSION_CATALOG.find((p) => p.key === key)?.description ?? key,
  }));

  const AUTONOMY_OPTIONS: { value: AutonomyLevel; label: string; hint: string }[] = [
    {
      value: 'PROPOSE',
      label: 'PROPOSE',
      hint: 'Toute mutation validée par un humain avant exécution.',
    },
    {
      value: 'ACT_LOW',
      label: 'ACT_LOW',
      hint: 'Mutations à faible risque auto-exécutées ; les mutations sensibles restent en file.',
    },
    {
      value: 'AUTONOMOUS',
      label: 'AUTONOMOUS',
      hint: 'Tout auto-exécuté, toujours borné par les plafonds de capacité.',
    },
  ];

  // Preset select options — "none" sentinel + one per preset.
  const PRESET_OPTIONS = [
    { value: '', label: 'Aucun preset' },
    ...AGENT_ROLE_PRESETS.map((p) => ({ value: p.id, label: p.label })),
  ];

  let { open = $bindable(false), onCreated }: { open: boolean; onCreated?: () => void } = $props();

  let name = $state('');
  let description = $state('');
  let permissions = $state<string[]>([]);
  let maxAmountPerAction = $state('');
  let maxActionsPerMinute = $state('');
  let persona = $state('');
  let role = $state('');
  let model = $state('');
  let autonomyLevel = $state<AutonomyLevel>('PROPOSE');
  let avatar = $state('');
  let createdKey = $state('');
  let selectedPresetId = $state('');
  // Track the last preset we applied so we only fire once per selection.
  let appliedPresetId = $state('');

  $effect(() => {
    if (selectedPresetId && selectedPresetId !== appliedPresetId) {
      const preset = AGENT_ROLE_PRESETS.find((p) => p.id === selectedPresetId);
      if (preset) {
        persona = preset.persona;
        autonomyLevel = preset.suggestedAutonomy as AutonomyLevel;
        const merged = new Set([...permissions, ...preset.suggestedPermissions]);
        permissions = [...merged];
      }
      appliedPresetId = selectedPresetId;
    }
  });

  function resetForm() {
    name = '';
    description = '';
    permissions = [];
    maxAmountPerAction = '';
    maxActionsPerMinute = '';
    persona = '';
    role = '';
    model = '';
    autonomyLevel = 'PROPOSE';
    avatar = '';
    selectedPresetId = '';
    appliedPresetId = '';
  }

  function togglePermission(key: string) {
    permissions = permissions.includes(key)
      ? permissions.filter((p) => p !== key)
      : [...permissions, key];
  }

  async function create(event: SubmitEvent) {
    event.preventDefault();
    try {
      const caps: { maxAmountPerAction?: number; maxActionsPerMinute?: number } = {};
      const amount = Number(maxAmountPerAction);
      const rate = Number(maxActionsPerMinute);
      if (maxAmountPerAction.trim() !== '' && amount > 0) caps.maxAmountPerAction = amount;
      if (maxActionsPerMinute.trim() !== '' && rate > 0) caps.maxActionsPerMinute = rate;

      const created = await api<AgentCreated>('/agents', {
        method: 'POST',
        body: {
          name,
          ...(description.trim() ? { description } : {}),
          permissions,
          caps,
          ...(persona.trim() ? { persona } : {}),
          ...(role.trim() ? { role } : {}),
          ...(model.trim() ? { model } : {}),
          autonomyLevel,
          ...(avatar.trim() ? { avatar } : {}),
        },
      });
      createdKey = created.key;
      resetForm();
      open = false;
      onCreated?.();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to register agent');
    }
  }

  async function copyKey() {
    await navigator.clipboard.writeText(createdKey);
    toast.success('Agent key copied — store it now, it will not be shown again');
  }

  function dismiss() {
    createdKey = '';
  }
</script>

<Modal bind:open title="Engager un agent">
  {#snippet children()}
    {#if createdKey}
      <Card>
        <div class="flex flex-wrap items-center gap-3">
          <div class="flex-1">
            <p class="mb-1 text-xs font-semibold tracking-wide text-ink-muted uppercase">
              Clé de l'agent — affichée une seule fois
            </p>
            <code class="break-all text-sm text-ink">{createdKey}</code>
          </div>
          <Button variant="secondary" onclick={copyKey}>Copier</Button>
        </div>
        <p class="mt-2 text-xs text-ink-muted">
          Conservez-la en lieu sûr. Elle ne sera plus affichée.
        </p>
      </Card>
      <div class="mt-4 flex justify-end border-t border-edge pt-3">
        <Button variant="secondary" onclick={dismiss}>Fermer</Button>
      </div>
    {:else}
      <form onsubmit={create}>
        <!-- Role preset -->
        <div class="mb-4 rounded-lg border border-edge bg-surface-muted p-3">
          <Field label="Preset de rôle">
            <Select bind:value={selectedPresetId}>
              {#each PRESET_OPTIONS as opt (opt.value)}
                <option value={opt.value}>{opt.label}</option>
              {/each}
            </Select>
          </Field>
          <p class="mt-1 text-xs text-ink-muted">
            Choisir un preset pré-remplit la persona, le niveau d'autonomie et les permissions suggérées. Tout reste modifiable.
          </p>
        </div>

        <Field label="Nom">
          <Input bind:value={name} required placeholder="Dispatch copilot" />
        </Field>
        <div class="mt-3">
          <Field label="Description">
            <Input bind:value={description} placeholder="Optionnel — ce que fait cet agent" />
          </Field>
        </div>
        <div class="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Rôle">
            <Input bind:value={role} placeholder="ex. Répartiteur" />
          </Field>
          <Field label="Avatar (emoji)">
            <Input bind:value={avatar} placeholder="ex. 🚛" />
          </Field>
        </div>
        <div class="mt-3">
          <Field label="Modèle">
            <Input bind:value={model} placeholder="ex. anthropic:claude-sonnet-4-6" />
          </Field>
        </div>

        <!-- Persona -->
        <div class="mt-3">
          <Field label="Persona">
            <Textarea bind:value={persona} rows={4} placeholder="Personnalité et instructions système de cet employé…" />
          </Field>
          <p class="mt-1 text-xs text-ink-muted">
            Personnalité + instructions système de l'employé. Définit le ton, le style de réponse et les règles métier internes.
          </p>
        </div>

        <!-- Autonomy level -->
        <div class="mt-3">
          <span class="mb-1.5 block text-xs font-semibold tracking-wide text-ink-muted uppercase">
            Niveau d'autonomie
          </span>
          <div class="space-y-1.5">
            {#each AUTONOMY_OPTIONS as opt (opt.value)}
              <label class="flex cursor-pointer items-start gap-2.5 rounded border border-edge p-2.5 transition hover:border-accent {autonomyLevel === opt.value ? 'border-accent bg-accent-soft/30' : ''}">
                <input
                  type="radio"
                  name="modal-autonomy"
                  value={opt.value}
                  checked={autonomyLevel === opt.value}
                  onchange={() => { autonomyLevel = opt.value; }}
                  class="mt-0.5 shrink-0"
                />
                <div>
                  <p class="text-xs font-semibold text-ink">{opt.label}</p>
                  <p class="text-xs text-ink-muted">{opt.hint}</p>
                </div>
              </label>
            {/each}
          </div>
        </div>

        <!-- Permissions -->
        <div class="mt-3">
          <span class="mb-1.5 block text-xs font-semibold tracking-wide text-ink-muted uppercase">
            Permissions
          </span>
          <p class="mb-2 text-xs text-ink-muted">
            Scopes accordés à l'agent. Seules les permissions listées seront disponibles dans les outils MCP.
          </p>
          <div class="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
            {#each dispatchScopes as scope (scope.key)}
              <label class="flex cursor-pointer items-start gap-1.5 rounded border border-edge p-2 text-xs transition hover:border-accent">
                <input
                  type="checkbox"
                  checked={permissions.includes(scope.key)}
                  onchange={() => togglePermission(scope.key)}
                  class="mt-0.5 shrink-0"
                />
                <div>
                  <code class="font-mono text-ink">{scope.key}</code>
                  <p class="mt-0.5 text-ink-muted">{scope.description}</p>
                </div>
              </label>
            {/each}
          </div>
        </div>

        <!-- Caps -->
        <div class="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <Field label="Plafond $ par action">
              <Input type="number" bind:value={maxAmountPerAction} placeholder="Optionnel" />
            </Field>
            <p class="mt-1 text-xs text-ink-muted">Plafond $/action.</p>
          </div>
          <div>
            <Field label="Actions max par minute">
              <Input type="number" bind:value={maxActionsPerMinute} placeholder="Optionnel" />
            </Field>
            <p class="mt-1 text-xs text-ink-muted">Débit max/min.</p>
          </div>
        </div>

        <div class="mt-4 flex justify-end gap-2 border-t border-edge pt-3">
          <Button variant="secondary" onclick={() => { open = false; }}>Annuler</Button>
          <Button variant="primary" type="submit" disabled={permissions.length === 0}>
            Engager l'agent
          </Button>
        </div>
      </form>
    {/if}
  {/snippet}
</Modal>
