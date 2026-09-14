<script lang="ts">
  import type { Paginated } from '@pulsar/shared';
  import { api, ApiError } from '$lib/api/client';
  import { toast } from '$lib/stores/toast';
  import { formatDate } from '$lib/format';
  import {
    PageHeader,
    Drawer,
    EntityPicker,
    Button,
    FilterBar,
    Table,
    EmptyState,
    Card,
    Skeleton,
    ErrorNotice,
    Modal,
    Field,
    Input,
    Select,
  } from '$lib/components/ui';
  import { untrack } from 'svelte';
  import ActivityTimeline from '$lib/components/crm/ActivityTimeline.svelte';
  import type { Activity } from '$lib/components/crm/ActivityTimeline.svelte';
  import LogActivity from '$lib/components/crm/LogActivity.svelte';
  import CustomFieldInputs from '$lib/components/CustomFieldInputs.svelte';
  import RecordEmails from '$lib/components/crm/RecordEmails.svelte';
  import SequenceRuns from '$lib/components/crm/SequenceRuns.svelte';

  // ── Types ───────────────────────────────────────────────────────────────────

  interface CustomFieldDef {
    key: string;
    label: string;
    type: 'TEXT' | 'NUMBER' | 'DATE' | 'BOOLEAN' | 'SELECT';
    options?: { value: string; label: string }[];
    required: boolean;
  }

  interface ContactRow {
    id: string;
    name: string;
    companyId: string | null;
    title: string | null;
    email: string | null;
    phone: string | null;
    createdAt: string;
  }

  interface ContactDetail extends ContactRow {
    // Activities loaded separately via /crm/activities?contactId=
  }

  // ── State — list ─────────────────────────────────────────────────────────────

  let contacts = $state<ContactRow[]>([]);
  let total = $state(0);
  let page = $state(1);
  const pageSize = 25;
  const totalPages = $derived(Math.max(1, Math.ceil(total / pageSize)));
  let search = $state('');
  let companyIdFilter = $state('');
  let loading = $state(true);
  let error = $state('');

  // ── State — detail panel ─────────────────────────────────────────────────────

  let selected = $state<ContactDetail | null>(null);
  let selectedActivities = $state<Activity[]>([]);
  let detailLoading = $state(false);
  let detailRequest = 0;
  let listRequest = 0;

  function closeDetail() {
    detailRequest++;
    selected = null;
    detailLoading = false;
  }

  // ── State — create modal ─────────────────────────────────────────────────────

  let createOpen = $state(false);
  let createName = $state('');
  let createTitle = $state('');
  let createEmail = $state('');
  let createPhone = $state('');
  let createCompanyId = $state('');
  let createSaving = $state(false);
  let contactFieldDefs = $state<CustomFieldDef[]>([]);
  let createCustomData = $state<Record<string, unknown>>({});

  // ── Data loading ─────────────────────────────────────────────────────────────

  async function load() {
    const request = ++listRequest;
    loading = true;
    error = '';
    try {
      const result = await api<Paginated<ContactRow>>('/crm/contacts', {
        query: {
          search,
          page,
          pageSize,
          companyId: companyIdFilter || undefined,
        },
      });
      if (request !== listRequest) return;
      contacts = result.items;
      total = result.total;
    } catch (e) {
      if (request !== listRequest) return;
      error = e instanceof ApiError ? e.message : 'Impossible de charger les contacts';
    } finally {
      if (request === listRequest) loading = false;
    }
  }

  async function openDetail(contact: { id: string }) {
    const request = ++detailRequest;
    selected = null;
    selectedActivities = [];
    detailLoading = true;
    try {
      // GET /crm/contacts/:id returns the contact itself (no nested activities)
      const detail = await api<ContactDetail>(`/crm/contacts/${contact.id}`);
      if (request !== detailRequest) return;
      selected = detail;
      // Load activities separately
      const actResult = await api<Paginated<Activity>>('/crm/activities', {
        query: { contactId: contact.id, pageSize: 20 },
      });
      if (request === detailRequest) selectedActivities = actResult.items;
    } catch (e) {
      if (request === detailRequest)
        toast.error(e instanceof ApiError ? e.message : 'Impossible de charger le contact');
    } finally {
      if (request === detailRequest) detailLoading = false;
    }
  }

  async function refreshActivities() {
    if (!selected) return;
    const id = selected.id;
    try {
      const actResult = await api<Paginated<Activity>>('/crm/activities', {
        query: { contactId: id, pageSize: 20 },
      });
      if (selected?.id === id) selectedActivities = actResult.items;
    } catch {
      // non-blocking
    }
  }

  // ── Create contact ───────────────────────────────────────────────────────────

  async function openCreate() {
    createName = '';
    createTitle = '';
    createEmail = '';
    createPhone = '';
    createCompanyId = '';
    createCustomData = {};
    createOpen = true;
    contactFieldDefs = await api<CustomFieldDef[]>('/crm/custom-fields', {
      query: { entityType: 'CRM_CONTACT' },
    }).catch(() => [] as CustomFieldDef[]);
  }

  async function submitCreate() {
    if (createSaving) return;
    if (!createName.trim()) {
      toast.error('Le nom est obligatoire');
      return;
    }
    createSaving = true;
    try {
      await api<ContactRow>('/crm/contacts', {
        method: 'POST',
        body: {
          name: createName.trim(),
          title: createTitle.trim() || undefined,
          email: createEmail.trim() || undefined,
          phone: createPhone.trim() || undefined,
          companyId: createCompanyId.trim() || undefined,
          customData: Object.keys(createCustomData).length > 0 ? createCustomData : undefined,
        },
      });
      toast.success('Contact créé');
      createOpen = false;
      void load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Échec de la création');
    } finally {
      createSaving = false;
    }
  }

  // ── Reactive load ─────────────────────────────────────────────────────────────
  // Single effect: tracks filters, resets to page 1, fires exactly one load.
  // Pagination buttons call load() directly and are not tracked here.
  $effect(() => {
    const _s = search;
    const _c = companyIdFilter;
    untrack(() => {
      page = 1;
      void load();
    });
  });
</script>

<PageHeader title="Contacts" subtitle="Personnes associées à vos sociétés CRM." count={total}>
  {#snippet actions()}
    <Button onclick={openCreate}>Nouveau contact</Button>
  {/snippet}
</PageHeader>

<ErrorNotice message={error} onretry={load} />

<FilterBar>
  <div class="w-64">
    <input
      aria-label="Rechercher par nom"
      placeholder="Rechercher par nom…"
      bind:value={search}
      onkeydown={(e) => {
        if (e.key === 'Enter') void load();
      }}
      class="w-full rounded-md border border-edge bg-surface px-3 py-1.5 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
    />
  </div>
  <div class="w-64">
    <EntityPicker
      endpoint="/crm/companies"
      label="Société"
      placeholder="Toutes les sociétés"
      bind:value={companyIdFilter}
    />
  </div>
</FilterBar>

<!-- List / panel layout -->
<div class="min-w-0">
  <!-- ── List ── -->
  <div class="min-w-0">
    {#if loading}
      <Card padded={false}><Skeleton rows={6} /></Card>
    {:else if contacts.length === 0}
      <Card>
        <EmptyState message="Aucun contact pour le moment." />
      </Card>
    {:else}
      <Table>
        {#snippet head()}
          <th>Nom</th><th>Titre</th><th>Courriel</th><th>Téléphone</th><th>Créé le</th>
        {/snippet}
        {#snippet body()}
          {#each contacts as contact (contact.id)}
            <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
            <tr
              class={`cursor-pointer transition-colors hover:bg-surface-muted ${selected?.id === contact.id ? 'bg-accent-soft/20' : ''}`}
              onclick={() => void openDetail(contact)}
            >
              <td class="font-semibold text-ink"
                ><button
                  class="text-left hover:text-accent focus-visible:outline-2 focus-visible:outline-accent"
                  onclick={(e) => {
                    e.stopPropagation();
                    void openDetail(contact);
                  }}>{contact.name}</button
                ></td
              >
              <td class="text-ink-muted">{contact.title ?? '—'}</td>
              <td class="text-ink-muted">{contact.email ?? '—'}</td>
              <td class="font-mono text-ink-muted">{contact.phone ?? '—'}</td>
              <td class="text-ink-muted">{formatDate(contact.createdAt)}</td>
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
              void load();
            }}>Précédent</Button
          >
          <span class="font-mono text-xs">Page {page} / {totalPages}</span>
          <Button
            variant="secondary"
            disabled={page >= totalPages}
            onclick={() => {
              page = Math.min(totalPages, page + 1);
              void load();
            }}>Suivant</Button
          >
        </div>
      </div>
    {/if}
  </div>
</div>

<Drawer
  open={detailLoading || !!selected}
  title={selected?.name ?? 'Chargement de la fiche…'}
  width="xl"
  onclose={closeDetail}
>
  <!-- ── Detail panel ── -->
  {#if detailLoading}
    <div class="min-w-0 space-y-4">
      <Card padded={false}><Skeleton rows={8} /></Card>
    </div>
  {:else if selected}
    <div class="min-w-0 space-y-4">
      <Card>
        <!-- Panel header -->
        <div class="mb-4 flex items-start justify-between gap-2">
          <div class="min-w-0">
            {#if selected.title}
              <p class="text-sm text-ink-muted">{selected.title}</p>
            {/if}
          </div>
        </div>

        <!-- Contact fields -->
        <div class="mb-4 grid grid-cols-2 gap-3 text-xs">
          {#if selected.email}
            <div>
              <div class="mb-0.5 font-medium text-ink-muted">Courriel</div>
              <a href="mailto:{selected.email}" class="text-accent hover:underline"
                >{selected.email}</a
              >
            </div>
          {/if}
          {#if selected.phone}
            <div>
              <div class="mb-0.5 font-medium text-ink-muted">Téléphone</div>
              <div class="font-mono text-ink">{selected.phone}</div>
            </div>
          {/if}
          {#if selected.companyId}
            <div>
              <div class="mb-0.5 font-medium text-ink-muted">Société</div>
              <a
                href="/crm/companies/{selected.companyId}"
                class="text-accent text-xs hover:underline"
                title="Voir la fiche complète de la société"
              >
                Voir la société
              </a>
            </div>
          {/if}
          <div>
            <div class="mb-0.5 font-medium text-ink-muted">Créé le</div>
            <div class="text-ink">{formatDate(selected.createdAt)}</div>
          </div>
        </div>

        <!-- Activity timeline -->
        <div class="mb-4">
          <div class="mb-1.5 text-sm font-medium text-ink-muted">Activités</div>
          <ActivityTimeline activities={selectedActivities} />
        </div>

        <!-- Log activity -->
        <div>
          <div class="mb-1.5 text-sm font-medium text-ink-muted">Enregistrer une activité</div>
          <LogActivity contactId={selected.id} onLogged={() => void refreshActivities()} />
        </div>
      </Card>

      <!-- Emails panel -->
      <div class="mt-4 rounded-lg border border-edge bg-surface p-4">
        {#key selected.id}<SequenceRuns contactId={selected.id} />{/key}
      </div>
      <RecordEmails
        relatedType="crm-contact"
        relatedId={selected.id}
        defaultTo={selected.email ?? undefined}
      />
    </div>
  {/if}
</Drawer>

<!-- Create contact modal -->
<Modal dismissible={!createSaving} bind:open={createOpen} title="Nouveau contact">
  <div class="flex flex-col gap-4">
    <Field label="Nom *">
      <Input bind:value={createName} placeholder="Jean Dupont" />
    </Field>
    <Field label="Titre">
      <Input bind:value={createTitle} placeholder="Directeur logistique" />
    </Field>
    <Field label="Courriel">
      <Input type="email" bind:value={createEmail} placeholder="jean@exemple.com" />
    </Field>
    <Field label="Téléphone">
      <Input bind:value={createPhone} placeholder="+1 514 555 0000" />
    </Field>
    <Field label="Société (optionnel)"
      ><EntityPicker
        endpoint="/crm/companies"
        label="Société"
        placeholder="Associer une société"
        bind:value={createCompanyId}
      /></Field
    >
    {#if contactFieldDefs.length > 0}
      <CustomFieldInputs definitions={contactFieldDefs} bind:data={createCustomData} />
    {/if}
  </div>
  {#snippet footer()}
    <Button
      disabled={createSaving}
      variant="secondary"
      onclick={() => {
        createOpen = false;
      }}>Annuler</Button
    >
    <Button loading={createSaving} onclick={submitCreate}>Créer</Button>
  {/snippet}
</Modal>
