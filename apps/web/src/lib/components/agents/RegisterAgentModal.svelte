<script lang="ts">
  import { PERMISSION_CATALOG } from '@pulsar/shared';
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
    { value: 'PROPOSE', label: 'PROPOSE', hint: 'Every mutation needs approval' },
    { value: 'ACT_LOW', label: 'ACT_LOW', hint: 'Auto-runs low-risk mutations' },
    { value: 'AUTONOMOUS', label: 'AUTONOMOUS', hint: 'Auto-runs all (still bounded by caps)' },
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

<Modal bind:open title="Register agent">
  {#snippet children()}
    {#if createdKey}
      <Card>
        <div class="flex flex-wrap items-center gap-3">
          <div class="flex-1">
            <p class="mb-1 text-xs font-semibold tracking-wide text-ink-muted uppercase">
              Your new agent key — shown once
            </p>
            <code class="break-all text-sm text-ink">{createdKey}</code>
          </div>
          <Button variant="secondary" onclick={copyKey}>Copy</Button>
        </div>
        <p class="mt-2 text-xs text-ink-muted">
          Store it somewhere safe. You will not be able to view it again.
        </p>
      </Card>
      <div class="mt-4 flex justify-end border-t border-edge pt-3">
        <Button variant="secondary" onclick={dismiss}>Close</Button>
      </div>
    {:else}
      <form onsubmit={create}>
        <Field label="Name">
          <Input bind:value={name} required placeholder="Dispatch copilot" />
        </Field>
        <div class="mt-3">
          <Field label="Description">
            <Input bind:value={description} placeholder="Optional — what this agent does" />
          </Field>
        </div>
        <div class="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Role">
            <Input bind:value={role} placeholder="e.g. Répartiteur" />
          </Field>
          <Field label="Avatar (emoji)">
            <Input bind:value={avatar} placeholder="e.g. 🚛" />
          </Field>
        </div>
        <div class="mt-3">
          <Field label="Model">
            <Input bind:value={model} placeholder="e.g. anthropic:claude-sonnet-4-6" />
          </Field>
        </div>
        <div class="mt-3">
          <Field label="Persona">
            <Textarea bind:value={persona} rows={4} placeholder="Personality and instructions for this agent…" />
          </Field>
        </div>
        <div class="mt-3">
          <Field label="Autonomy level">
            <Select bind:value={autonomyLevel}>
              {#each AUTONOMY_OPTIONS as opt (opt.value)}
                <option value={opt.value}>{opt.label} — {opt.hint}</option>
              {/each}
            </Select>
          </Field>
        </div>
        <div class="mt-3">
          <span class="mb-1.5 block text-xs font-semibold tracking-wide text-ink-muted uppercase">
            Permissions
          </span>
          <div class="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
            {#each dispatchScopes as scope (scope.key)}
              <label class="flex cursor-pointer items-center gap-1.5 text-xs text-ink">
                <input
                  type="checkbox"
                  checked={permissions.includes(scope.key)}
                  onchange={() => togglePermission(scope.key)}
                />
                <code class="text-ink-muted">{scope.key}</code>
              </label>
            {/each}
          </div>
        </div>
        <div class="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Max amount per action">
            <Input type="number" bind:value={maxAmountPerAction} placeholder="Optional" />
          </Field>
          <Field label="Max actions per minute">
            <Input type="number" bind:value={maxActionsPerMinute} placeholder="Optional" />
          </Field>
        </div>
        <div class="mt-4 flex justify-end gap-2 border-t border-edge pt-3">
          <Button variant="secondary" onclick={() => { open = false; }}>Cancel</Button>
          <Button variant="primary" type="submit" disabled={permissions.length === 0}>
            Register agent
          </Button>
        </div>
      </form>
    {/if}
  {/snippet}
</Modal>
