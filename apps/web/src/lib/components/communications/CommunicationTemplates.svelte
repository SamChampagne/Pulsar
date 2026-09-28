<script lang="ts">
  import { CommunicationChannel, COMMUNICATION_VARIABLES } from '@pulsar/shared';
  import { api } from '$lib/api/client';
  import { Button, Field, Input, Textarea, ErrorNotice } from '$lib/components/ui';
  type Template = {
    id: string;
    name: string;
    subject: string | null;
    text: string;
    active: boolean;
    updatedAt: string;
    channel: CommunicationChannel;
  };
  let {
    channel,
    templates,
    canManage,
    busy = $bindable(false),
    onchanged,
  }: {
    channel: CommunicationChannel;
    templates: Template[];
    canManage: boolean;
    busy?: boolean;
    onchanged: () => Promise<void>;
  } = $props();
  let editing = $state<Template | null>(null),
    open = $state(false),
    name = $state(''),
    subject = $state(''),
    text = $state(''),
    active = $state(true),
    error = $state('');
  function edit(row: Template | null) {
    editing = row;
    name = row?.name ?? '';
    subject = row?.subject ?? '';
    text = row?.text ?? '';
    active = row?.active ?? true;
    error = '';
    open = true;
  }
  async function save() {
    if (busy || !name.trim() || !text.trim()) return;
    busy = true;
    error = '';
    try {
      await api('/communications/templates' + (editing ? `/${editing.id}` : ''), {
        method: editing ? 'PUT' : 'POST',
        body: {
          channel,
          name,
          subject: channel === 'EMAIL' ? subject : '',
          text,
          active,
          expectedUpdatedAt: editing?.updatedAt ?? null,
        },
      });
      open = false;
      await onchanged();
    } catch (e) {
      error = (e as Error).message;
    } finally {
      busy = false;
    }
  }
</script>

<section class="space-y-4">
  <div class="flex items-start justify-between gap-4">
    <div>
      <h3 class="font-semibold">Modèles opérationnels</h3>
      <p class="mt-1 text-sm text-ink-muted">
        Partagés entre les dossiers de l’entreprise. Le contenu reste modifiable avant chaque envoi.
      </p>
    </div>
    {#if canManage}<Button disabled={busy} onclick={() => edit(null)}>Nouveau modèle</Button>{/if}
  </div>
  <ErrorNotice message={error} />
  {#if open}<fieldset disabled={busy} class="space-y-4 rounded-lg border border-edge p-4">
      <Field label="Nom du modèle"><Input bind:value={name} maxlength={120} /></Field
      >{#if channel === 'EMAIL'}<Field label="Objet du modèle"
          ><Input bind:value={subject} maxlength={200} /></Field
        >{/if}<Field label="Texte du modèle"
        ><Textarea bind:value={text} rows={6} maxlength={channel === 'SMS' ? 1600 : 10000} /></Field
      >
      <p class="text-xs text-ink-muted">
        Variables : {COMMUNICATION_VARIABLES.map((v) => `{{${v}}}`).join(', ')}. Elles sont
        remplacées à la sélection, puis vérifiées avant l’envoi.
      </p>
      <label class="flex items-center gap-2 text-sm"
        ><input type="checkbox" bind:checked={active} />Disponible pour les nouveaux messages</label
      >
      <div class="flex gap-2">
        <Button
          disabled={!name.trim() || !text.trim() || (channel === 'EMAIL' && !subject.trim())}
          onclick={save}>Enregistrer le modèle</Button
        ><Button
          variant="ghost"
          onclick={() => {
            open = false;
          }}>Annuler</Button
        >
      </div>
    </fieldset>{/if}
  {#each templates as t}<article class="rounded-lg border border-edge p-4">
      <div class="flex justify-between gap-3">
        <h4 class="font-medium">
          {t.name}{#if !t.active}<span class="ml-2 text-xs text-ink-muted">Inactif</span>{/if}
        </h4>
        {#if canManage}<Button variant="ghost" disabled={busy} onclick={() => edit(t)}
            >Modifier</Button
          >{/if}
      </div>
      {#if t.subject}<p class="mt-2 text-sm font-medium">{t.subject}</p>{/if}
      <p class="mt-2 whitespace-pre-wrap break-words text-sm text-ink-muted">{t.text}</p>
    </article>{:else}<p
      class="rounded-lg border border-dashed border-edge p-6 text-sm text-ink-muted"
    >
      Aucun modèle pour ce canal. Vous pouvez composer un message libre ou créer un modèle adapté à
      votre activité.
    </p>{/each}
</section>
