<script lang="ts">
  import { api, ApiError } from '$lib/api/client';
  import { toast } from '$lib/stores/toast';
  import { Button, Field, Select, Textarea } from '$lib/components/ui';

  // ── Props ───────────────────────────────────────────────────────────────────

  let {
    companyId = undefined as string | undefined,
    contactId = undefined as string | undefined,
    dealId = undefined as string | undefined,
    onLogged,
  }: {
    companyId?: string;
    contactId?: string;
    dealId?: string;
    onLogged: () => void;
  } = $props();

  // ── State ────────────────────────────────────────────────────────────────────

  let type = $state('NOTE');
  let body = $state('');
  let dueAt = $state('');
  let submitting = $state(false);

  // ── Submit ───────────────────────────────────────────────────────────────────

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    if (!body.trim()) return;

    submitting = true;
    try {
      await api('/crm/activities', {
        method: 'POST',
        body: {
          type,
          body: body.trim(),
          ...(companyId ? { companyId } : {}),
          ...(contactId ? { contactId } : {}),
          ...(dealId ? { dealId } : {}),
          ...(type === 'TASK' && dueAt ? { dueAt: new Date(dueAt).toISOString() } : {}),
        },
      });
      body = '';
      dueAt = '';
      type = 'NOTE';
      toast.success('Activité enregistrée');
      onLogged();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Erreur lors de l\'enregistrement';
      toast.error(msg);
    } finally {
      submitting = false;
    }
  }
</script>

<form onsubmit={submit} class="space-y-2">
  <div class="flex gap-2">
    <div class="w-36 shrink-0">
      <Select bind:value={type}>
        <option value="NOTE">📝 Note</option>
        <option value="CALL">📞 Appel</option>
        <option value="EMAIL">✉️ Courriel</option>
        <option value="MEETING">🤝 Réunion</option>
        <option value="TASK">✅ Tâche</option>
      </Select>
    </div>
    <div class="flex-1">
      <Textarea
        bind:value={body}
        placeholder="Description de l'activité…"
        rows={2}
        disabled={submitting}
      />
    </div>
  </div>

  {#if type === 'TASK'}
    <Field label="Échéance (optionnel)">
      <input
        type="datetime-local"
        bind:value={dueAt}
        disabled={submitting}
        class="w-full rounded-md border border-edge bg-surface px-3 py-1.5 text-sm text-ink focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
      />
    </Field>
  {/if}

  <div class="flex justify-end">
    <Button variant="secondary" type="submit" loading={submitting} disabled={!body.trim()}>
      Enregistrer
    </Button>
  </div>
</form>
