<script lang="ts">
  import type { Paginated } from '@pulsar/shared';
  import { api, ApiError } from '$lib/api/client';
  import { toast } from '$lib/stores/toast';
  import { formatDate } from '$lib/format';
  import {
    PageHeader,
    Button,
    Table,
    Badge,
    EmptyState,
    Card,
    Skeleton,
    ErrorNotice,
    Modal,
    Field,
    Input,
    Select,
    Textarea,
    type Tone,
  } from '$lib/components/ui';
  import { untrack } from 'svelte';

  // ── Types ───────────────────────────────────────────────────────────────────

  type CampaignStatus = 'DRAFT' | 'SENDING' | 'SENT';

  interface CampaignRow {
    id: string;
    name: string;
    listId: string;
    listName?: string;
    subject: string;
    html: string;
    templateKey: string | null;
    status: CampaignStatus;
    sentAt: string | null;
    createdAt: string;
  }

  interface CampaignStats {
    enqueueFailed: number;
    total: number;
    sent: number;
    failed: number;
    queued: number;
  }

  interface ContactList {
    id: string;
    name: string;
  }

  interface EmailTemplate {
    key: string;
    name: string;
    subject?: string;
    html?: string;
  }

  // ── State — campaign list ─────────────────────────────────────────────────

  let campaigns = $state<CampaignRow[]>([]);
  let total = $state(0);
  let page = $state(1);
  const pageSize = 25;
  const totalPages = $derived(Math.max(1, Math.ceil(total / pageSize)));
  let loading = $state(true);
  let error = $state('');

  // ── State — detail / stats panel ─────────────────────────────────────────

  let selected = $state<CampaignRow | null>(null);
  let stats = $state<CampaignStats | null>(null);
  let statsLoading = $state(false);

  // ── State — create/edit modal ─────────────────────────────────────────────

  let formOpen = $state(false);
  let formMode = $state<'create' | 'edit'>('create');
  let formId = $state('');
  let formName = $state('');
  let formListId = $state('');
  let formSubject = $state('');
  let formHtml = $state('');
  let formSaving = $state(false);

  let availableLists = $state<ContactList[]>([]);
  let availableTemplates = $state<EmailTemplate[]>([]);
  let selectedTemplateKey = $state('');
  let aiDrafting = $state(false);
  let aiPrompt = $state('');
  let aiPromptOpen = $state(false);

  // ── State — send confirm ──────────────────────────────────────────────────

  let sendConfirmOpen = $state(false);
  let sendingId = $state<string | null>(null);

  // ── Data loading ──────────────────────────────────────────────────────────

  async function load() {
    loading = true;
    error = '';
    try {
      const result = await api<Paginated<CampaignRow>>('/crm/campaigns', {
        query: { page, pageSize },
      });
      campaigns = result.items;
      total = result.total;
    } catch (e) {
      error = e instanceof ApiError ? e.message : 'Impossible de charger les campagnes';
    } finally {
      loading = false;
    }
  }

  async function loadStats(campaignId: string) {
    statsLoading = true;
    stats = null;
    try {
      stats = await api<CampaignStats>(`/crm/campaigns/${campaignId}/stats`);
    } catch {
      // non-blocking
    } finally {
      statsLoading = false;
    }
  }

  async function selectCampaign(campaign: CampaignRow) {
    selected = campaign;
    await loadStats(campaign.id);
  }

  // ── Create / Edit ─────────────────────────────────────────────────────────

  async function openCreate() {
    formMode = 'create';
    formId = '';
    formName = '';
    formListId = '';
    formSubject = '';
    formHtml = '';
    selectedTemplateKey = '';
    aiPrompt = '';
    formOpen = true;
    await loadFormData();
  }

  async function openEdit(campaign: CampaignRow) {
    formMode = 'edit';
    formId = campaign.id;
    formName = campaign.name;
    formListId = campaign.listId;
    formSubject = campaign.subject;
    formHtml = campaign.html;
    selectedTemplateKey = campaign.templateKey ?? '';
    aiPrompt = '';
    formOpen = true;
    await loadFormData();
  }

  async function loadFormData() {
    const [listsResult, templatesResult] = await Promise.allSettled([
      api<Paginated<ContactList>>('/crm/lists', { query: { pageSize: 100 } }),
      api<EmailTemplate[]>('/emails/templates'),
    ]);
    availableLists = listsResult.status === 'fulfilled' ? listsResult.value.items : [];
    availableTemplates = templatesResult.status === 'fulfilled' ? templatesResult.value : [];
  }

  async function applyTemplate() {
    if (!selectedTemplateKey) return;
    const tpl = availableTemplates.find((t) => t.key === selectedTemplateKey);
    if (!tpl) return;
    if (tpl.subject) formSubject = tpl.subject;
    if (tpl.html) formHtml = tpl.html;
  }

  async function draftWithAI() {
    if (!aiPrompt.trim()) {
      toast.error('Décrivez le contenu souhaité pour la rédaction IA');
      return;
    }
    aiDrafting = true;
    try {
      const result = await api<{ subject: string; html: string }>('/emails/draft', {
        method: 'POST',
        body: { prompt: aiPrompt.trim() },
      });
      formSubject = result.subject;
      formHtml = result.html;
      aiPromptOpen = false;
      toast.success('Brouillon IA généré');
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Échec de la génération IA');
    } finally {
      aiDrafting = false;
    }
  }

  async function submitForm() {
    if (!formName.trim() || !formListId || !formSubject.trim()) {
      toast.error('Nom, liste et sujet sont obligatoires');
      return;
    }
    formSaving = true;
    try {
      const body = {
        name: formName.trim(),
        listId: formListId,
        subject: formSubject.trim(),
        html: formHtml,
        templateKey: selectedTemplateKey || undefined,
      };
      if (formMode === 'create') {
        await api<CampaignRow>('/crm/campaigns', { method: 'POST', body });
        toast.success('Campagne créée');
      } else {
        await api<CampaignRow>(`/crm/campaigns/${formId}`, { method: 'PATCH', body });
        toast.success('Campagne mise à jour');
      }
      formOpen = false;
      void load();
      if (selected?.id === formId) {
        // Refresh selected if it was the one edited
        const updated = await api<CampaignRow>(`/crm/campaigns/${formId}`).catch(() => null);
        if (updated) selected = updated;
      }
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Échec de l'enregistrement");
    } finally {
      formSaving = false;
    }
  }

  // ── Send campaign ─────────────────────────────────────────────────────────

  function openSendConfirm(campaign: CampaignRow) {
    sendingId = campaign.id;
    sendConfirmOpen = true;
  }

  async function confirmSend() {
    if (!sendingId) return;
    try {
      await api(`/crm/campaigns/${sendingId}/send`, { method: 'POST' });
      toast.success('Envoi lancé');
      sendConfirmOpen = false;
      void load();
      if (selected?.id === sendingId) {
        // Refresh selected and its stats
        const updated = await api<CampaignRow>(`/crm/campaigns/${sendingId}`).catch(() => null);
        if (updated) {
          selected = updated;
          await loadStats(sendingId);
        }
      }
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Échec de l'envoi");
    } finally {
      sendingId = null;
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  function statusTone(status: CampaignStatus): Tone {
    switch (status) {
      case 'DRAFT':
        return 'neutral';
      case 'SENDING':
        return 'warn';
      case 'SENT':
        return 'ok';
      default:
        return 'neutral';
    }
  }

  function statusLabel(status: CampaignStatus): string {
    switch (status) {
      case 'DRAFT':
        return 'Brouillon';
      case 'SENDING':
        return 'En cours';
      case 'SENT':
        return 'Traitement terminé';
      default:
        return status;
    }
  }

  function listName(campaign: CampaignRow): string {
    return (
      campaign.listName ??
      availableLists.find((l) => l.id === campaign.listId)?.name ??
      campaign.listId
    );
  }

  // ── Reactive load ─────────────────────────────────────────────────────────

  $effect(() => {
    const _p = page;
    untrack(() => {
      void load();
    });
  });
</script>

<PageHeader title="Campagnes" subtitle="Gérez vos campagnes courriel marketing." count={total}>
  {#snippet actions()}
    <Button onclick={openCreate}>Nouvelle campagne</Button>
  {/snippet}
</PageHeader>

<ErrorNotice message={error} onretry={load} />

<div class={`flex gap-4 ${selected ? 'items-start' : ''}`}>
  <!-- ── Campaign list ── -->
  <div class={`min-w-0 flex-1 transition-all ${selected ? 'max-w-[55%]' : ''}`}>
    {#if loading}
      <Card padded={false}><Skeleton rows={6} /></Card>
    {:else if campaigns.length === 0}
      <Card>
        <EmptyState message="Aucune campagne pour le moment." />
      </Card>
    {:else}
      <Table>
        {#snippet head()}
          <th>Nom</th><th>Liste</th><th>Sujet</th><th>Statut</th><th>Traitée le</th>
        {/snippet}
        {#snippet body()}
          {#each campaigns as campaign (campaign.id)}
            <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
            <tr
              class={`cursor-pointer transition-colors hover:bg-surface-muted ${selected?.id === campaign.id ? 'bg-accent-soft/20' : ''}`}
              onclick={() => void selectCampaign(campaign)}
            >
              <td class="font-semibold text-ink">{campaign.name}</td>
              <td class="text-ink-muted">{listName(campaign)}</td>
              <td class="text-ink-muted truncate max-w-[160px]">{campaign.subject}</td>
              <td
                ><Badge tone={statusTone(campaign.status)}>{statusLabel(campaign.status)}</Badge
                ></td
              >
              <td class="text-ink-muted">{campaign.sentAt ? formatDate(campaign.sentAt) : '—'}</td>
            </tr>
          {/each}
        {/snippet}
      </Table>
    {/if}

    {#if total > pageSize}
      <div class="mt-3 flex items-center justify-between text-sm text-ink-muted">
        <span class="font-mono text-xs">
          {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} sur {total}
        </span>
        <div class="flex items-center gap-2">
          <Button
            variant="secondary"
            disabled={page <= 1}
            onclick={() => {
              page = Math.max(1, page - 1);
            }}>Précédent</Button
          >
          <span class="font-mono text-xs">Page {page} / {totalPages}</span>
          <Button
            variant="secondary"
            disabled={page >= totalPages}
            onclick={() => {
              page = Math.min(totalPages, page + 1);
            }}>Suivant</Button
          >
        </div>
      </div>
    {/if}
  </div>

  <!-- ── Detail panel ── -->
  {#if selected}
    <div class="w-[42%] shrink-0">
      <Card>
        <!-- Header -->
        <div class="mb-4 flex items-start justify-between gap-2">
          <div class="min-w-0">
            <h2 class="truncate text-base font-bold text-ink">{selected.name}</h2>
            <div class="mt-1 flex items-center gap-2">
              <Badge tone={statusTone(selected.status)}>{statusLabel(selected.status)}</Badge>
            </div>
          </div>
          <button
            class="shrink-0 rounded p-1 text-ink-faint hover:bg-surface-muted hover:text-ink"
            onclick={() => {
              selected = null;
              stats = null;
            }}
            aria-label="Fermer">✕</button
          >
        </div>

        <!-- Campaign metadata -->
        <div class="mb-4 grid grid-cols-2 gap-3 text-xs">
          <div>
            <div class="mb-0.5 font-semibold uppercase tracking-wide text-ink-muted">Liste</div>
            <div class="text-ink">{listName(selected)}</div>
          </div>
          <div>
            <div class="mb-0.5 font-semibold uppercase tracking-wide text-ink-muted">Sujet</div>
            <div class="text-ink truncate">{selected.subject}</div>
          </div>
          {#if selected.sentAt}
            <div>
              <div class="mb-0.5 font-semibold uppercase tracking-wide text-ink-muted">
                Traitée le
              </div>
              <div class="text-ink">{formatDate(selected.sentAt)}</div>
            </div>
          {/if}
        </div>

        <!-- CASL warning -->
        <div class="mb-4 rounded-md border border-warn bg-warn-soft/20 px-3 py-2 text-xs text-warn">
          ⚠ Avant un envoi marketing réel, ajoutez un lien de désinscription (CASL).
        </div>

        <!-- Actions -->
        <div class="mb-4 flex flex-wrap gap-2">
          {#if selected.status === 'DRAFT'}
            <Button onclick={() => void openEdit(selected!)}>Modifier</Button>
          {/if}
          <Button
            variant="primary"
            disabled={selected.status !== 'DRAFT'}
            onclick={() => openSendConfirm(selected!)}>Envoyer</Button
          >
        </div>

        <!-- Stats -->
        <div class="text-[10px] font-semibold uppercase tracking-wide text-ink-muted mb-2">
          Statistiques d'envoi
        </div>
        {#if statsLoading}
          <Skeleton rows={2} />
        {:else if stats}
          <div class="grid grid-cols-2 gap-3 text-xs">
            <div class="rounded-md border border-edge bg-surface-muted px-3 py-2 text-center">
              <div class="text-lg font-bold text-ink">{stats.total}</div>
              <div class="text-ink-muted">Total</div>
            </div>
            <div class="rounded-md border border-edge bg-surface-muted px-3 py-2 text-center">
              <div class="text-lg font-bold text-ok">{stats.sent}</div>
              <div class="text-ink-muted">Acceptés par le transport</div>
            </div>
            <div class="rounded-md border border-edge bg-surface-muted px-3 py-2 text-center">
              <div class="text-lg font-bold text-warn">{stats.queued}</div>
              <div class="text-ink-muted">En attente</div>
            </div>
            <div class="rounded-md border border-edge bg-surface-muted px-3 py-2 text-center">
              <div class="text-lg font-bold text-danger">
                {stats.failed + (stats.enqueueFailed ?? 0)}
              </div>
              <div class="text-ink-muted">Échecs</div>
            </div>
          </div>
          <p class="mt-3 text-xs text-ink-muted">
            Le traitement de la campagne ne prouve pas la livraison. Échecs de mise en file : {stats.enqueueFailed ??
              0}. Les messages acceptés par le transport peuvent encore être rejetés par le
            destinataire.
          </p>
        {:else}
          <p class="text-xs text-ink-faint">Aucune statistique disponible.</p>
        {/if}
      </Card>
    </div>
  {/if}
</div>

<!-- Create/Edit modal -->
<Modal
  bind:open={formOpen}
  title={formMode === 'create' ? 'Nouvelle campagne' : 'Modifier la campagne'}
>
  <div class="flex flex-col gap-4">
    <Field label="Nom *">
      <Input bind:value={formName} placeholder="Campagne printemps 2026" />
    </Field>
    <Field label="Liste *">
      <Select bind:value={formListId}>
        <option value="">Sélectionner une liste…</option>
        {#each availableLists as list (list.id)}
          <option value={list.id}>{list.name}</option>
        {/each}
      </Select>
    </Field>

    <!-- Template picker -->
    {#if availableTemplates.length > 0}
      <Field label="Gabarit">
        <div class="flex gap-2">
          <div class="flex-1">
            <Select bind:value={selectedTemplateKey}>
              <option value="">Aucun gabarit…</option>
              {#each availableTemplates as tpl (tpl.key)}
                <option value={tpl.key}>{tpl.name}</option>
              {/each}
            </Select>
          </div>
          <Button variant="secondary" disabled={!selectedTemplateKey} onclick={applyTemplate}>
            Appliquer
          </Button>
        </div>
      </Field>
    {/if}

    <Field label="Sujet *">
      <Input bind:value={formSubject} placeholder="Sujet du courriel" />
    </Field>

    <Field label="Contenu HTML">
      <div class="mb-1 text-[11px] text-ink-muted">
        Variables disponibles : <span class="font-mono">{'{name}'}</span>
        <span class="font-mono">{'{company}'}</span> <span class="font-mono">{'{title}'}</span>
        <span class="font-mono">{'{email}'}</span>
      </div>
      <Textarea bind:value={formHtml} rows={8} placeholder="<p>Bonjour {'{name}'},</p>…" />
    </Field>

    <!-- AI draft -->
    <div>
      <Button
        variant="secondary"
        onclick={() => {
          aiPromptOpen = !aiPromptOpen;
        }}
      >
        ✦ Rédiger avec l'IA
      </Button>
      {#if aiPromptOpen}
        <div class="mt-2 flex flex-col gap-2">
          <Input
            bind:value={aiPrompt}
            placeholder="Décrivez le courriel à rédiger (sujet, ton, offre…)"
          />
          <Button loading={aiDrafting} onclick={draftWithAI}>Générer</Button>
        </div>
      {/if}
    </div>
  </div>
  {#snippet footer()}
    <Button
      variant="secondary"
      onclick={() => {
        formOpen = false;
      }}>Annuler</Button
    >
    <Button loading={formSaving} onclick={submitForm}>
      {formMode === 'create' ? 'Créer' : 'Enregistrer'}
    </Button>
  {/snippet}
</Modal>

<!-- Send confirmation dialog -->
<Modal bind:open={sendConfirmOpen} title="Confirmer l'envoi">
  <div class="flex flex-col gap-3">
    <p class="text-sm text-ink">
      Vous êtes sur le point d'envoyer cette campagne à tous les membres de la liste associée. Cette
      action est irréversible.
    </p>
    <div class="rounded-md border border-warn bg-warn-soft/20 px-3 py-2 text-xs text-warn">
      ⚠ Avant un envoi marketing réel, assurez-vous d'avoir inclus un lien de désinscription (CASL).
    </div>
  </div>
  {#snippet footer()}
    <Button
      variant="secondary"
      onclick={() => {
        sendConfirmOpen = false;
        sendingId = null;
      }}>Annuler</Button
    >
    <Button variant="primary" onclick={confirmSend}>Confirmer l'envoi</Button>
  {/snippet}
</Modal>
