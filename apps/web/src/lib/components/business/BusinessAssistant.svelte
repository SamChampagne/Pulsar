<script lang="ts">
  import { api } from '$lib/api/client';
  import { auth } from '$lib/stores/auth';
  import { Button, Modal, Select, Field, ErrorNotice, Skeleton } from '$lib/components/ui';
  import Conversation from '$lib/components/agents/Conversation.svelte';
  let {
    prompt,
    permission,
    label = 'Analyser avec un agent',
  }: { prompt: string; permission: string; label?: string } = $props();
  let open = $state(false),
    loading = $state(false),
    error = $state(''),
    agentId = $state('');
  let agents = $state<{ id: string; name: string; status: string; permissions: string[] }[]>([]);
  const can = $derived(
    $auth?.user.permissions.includes('core.agents.read') &&
      $auth?.user.permissions.includes('core.agents.chat'),
  );
  async function show() {
    open = true;
    loading = true;
    error = '';
    agentId = '';
    try {
      agents = (await api<typeof agents>('/agents')).filter(
        (a) => a.status === 'ACTIVE' && a.permissions.includes(permission),
      );
    } catch (e) {
      error = (e as Error).message;
    } finally {
      loading = false;
    }
  }
</script>

{#if can}<Button variant="secondary" onclick={show}>{label}</Button>{/if}
<Modal bind:open title="Assistant métier" size="lg">
  <p class="mb-4 text-sm text-ink-muted">
    Lisez la demande avant de l’envoyer. L’agent consulte les sources avec ses propres droits; les
    changements passent par les propositions et les règles de gouvernance. Aucun message client
    n’est envoyé par ces outils.
  </p>
  <ErrorNotice message={error} />
  {#if loading}<Skeleton rows={2} />{:else if !agents.length}<p class="text-sm">
      Aucun agent actif avec le droit {permission}. Un administrateur peut créer le rôle «
      Coordinateur Services et SAV » dans Agents et configurer le runtime.
    </p>{:else}<Field label="Agent"
      ><Select bind:value={agentId}
        ><option value="">Choisir un agent…</option>{#each agents as agent}<option value={agent.id}
            >{agent.name}</option
          >{/each}</Select
      ></Field
    >{#if agentId}{#key agentId}<Conversation {agentId} initialPrompt={prompt} />{/key}{/if}{/if}
</Modal>
