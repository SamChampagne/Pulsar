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
  } from '$lib/components/ui';
  import { untrack } from 'svelte';

  // ── Types ───────────────────────────────────────────────────────────────────

  interface ContactList {
    id: string;
    name: string;
    description: string | null;
    _count?: { members: number };
    memberCount?: number;
    createdAt: string;
  }

  interface ContactRow {
    id: string;
    name: string;
    email: string | null;
    title: string | null;
  }

  interface MemberRow {
    id: string;
    contactId: string;
    name: string;
    email: string | null;
    title: string | null;
  }

  interface CompanyRow {
    id: string;
    name: string;
  }

  // ── State — list of lists ─────────────────────────────────────────────────

  let lists = $state<ContactList[]>([]);
  let total = $state(0);
  let page = $state(1);
  const pageSize = 25;
  const totalPages = $derived(Math.max(1, Math.ceil(total / pageSize)));
  let loading = $state(true);
  let error = $state('');

  // ── State — selected list / members panel ─────────────────────────────────

  let selected = $state<ContactList | null>(null);
  let members = $state<MemberRow[]>([]);
  let membersLoading = $state(false);

  // ── State — create list modal ─────────────────────────────────────────────

  let createOpen = $state(false);
  let createName = $state('');
  let createDescription = $state('');
  let createSaving = $state(false);

  // ── State — add contact modal ─────────────────────────────────────────────

  let addContactOpen = $state(false);
  let allContacts = $state<ContactRow[]>([]);
  let contactSearch = $state('');
  let addingContactId = $state('');
  let addingContact = $state(false);

  // ── State — add company contacts modal ────────────────────────────────────

  let addCompanyOpen = $state(false);
  let allCompanies = $state<CompanyRow[]>([]);
  let companySearch = $state('');
  let addingCompanyId = $state('');
  let addingCompany = $state(false);

  // ── State — remove member ─────────────────────────────────────────────────

  let removingMemberId = $state<string | null>(null);

  // ── Data loading ──────────────────────────────────────────────────────────

  async function load() {
    loading = true;
    error = '';
    try {
      const result = await api<Paginated<ContactList>>('/crm/lists', {
        query: { page, pageSize },
      });
      lists = result.items;
      total = result.total;
    } catch (e) {
      error = e instanceof ApiError ? e.message : 'Impossible de charger les listes';
    } finally {
      loading = false;
    }
  }

  async function loadMembers(listId: string) {
    membersLoading = true;
    members = [];
    try {
      const result = await api<Paginated<MemberRow>>(`/crm/lists/${listId}/members`, {
        query: { pageSize: 100 },
      });
      members = result.items;
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Impossible de charger les membres');
    } finally {
      membersLoading = false;
    }
  }

  async function selectList(list: ContactList) {
    selected = list;
    await loadMembers(list.id);
  }

  // ── Create list ───────────────────────────────────────────────────────────

  function openCreate() {
    createName = '';
    createDescription = '';
    createOpen = true;
  }

  async function submitCreate() {
    if (!createName.trim()) {
      toast.error('Le nom est obligatoire');
      return;
    }
    createSaving = true;
    try {
      await api<ContactList>('/crm/lists', {
        method: 'POST',
        body: {
          name: createName.trim(),
          description: createDescription.trim() || undefined,
        },
      });
      toast.success('Liste créée');
      createOpen = false;
      void load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Échec de la création');
    } finally {
      createSaving = false;
    }
  }

  // ── Add contact ───────────────────────────────────────────────────────────

  async function openAddContact() {
    addingContactId = '';
    contactSearch = '';
    allContacts = [];
    addContactOpen = true;
    try {
      const result = await api<Paginated<ContactRow>>('/crm/contacts', {
        query: { pageSize: 200 },
      });
      allContacts = result.items;
    } catch {
      // non-blocking
    }
  }

  async function submitAddContact() {
    if (!addingContactId || !selected) return;
    addingContact = true;
    try {
      await api(`/crm/lists/${selected.id}/members`, {
        method: 'POST',
        body: { contactId: addingContactId },
      });
      toast.success('Contact ajouté');
      addContactOpen = false;
      await loadMembers(selected.id);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Échec de l'ajout");
    } finally {
      addingContact = false;
    }
  }

  // ── Add company contacts ──────────────────────────────────────────────────

  async function openAddCompany() {
    addingCompanyId = '';
    companySearch = '';
    allCompanies = [];
    addCompanyOpen = true;
    try {
      const result = await api<Paginated<CompanyRow>>('/crm/companies', {
        query: { pageSize: 200 },
      });
      allCompanies = result.items;
    } catch {
      // non-blocking
    }
  }

  async function submitAddCompany() {
    if (!addingCompanyId || !selected) return;
    addingCompany = true;
    try {
      await api(`/crm/lists/${selected.id}/add-company-contacts`, {
        method: 'POST',
        body: { companyId: addingCompanyId },
      });
      toast.success('Contacts de la société ajoutés');
      addCompanyOpen = false;
      await loadMembers(selected.id);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Échec de l'ajout");
    } finally {
      addingCompany = false;
    }
  }

  // ── Remove member ─────────────────────────────────────────────────────────

  async function removeMember(contactId: string) {
    if (!selected) return;
    removingMemberId = contactId;
    try {
      await api(`/crm/lists/${selected.id}/members/${contactId}`, { method: 'DELETE' });
      toast.success('Membre retiré');
      members = members.filter((m) => m.contactId !== contactId);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Impossible de retirer le membre');
    } finally {
      removingMemberId = null;
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  function memberCount(list: ContactList): number {
    return list._count?.members ?? list.memberCount ?? 0;
  }

  const filteredContacts = $derived(
    contactSearch.trim()
      ? allContacts.filter(
          (c) =>
            c.name.toLowerCase().includes(contactSearch.toLowerCase()) ||
            (c.email ?? '').toLowerCase().includes(contactSearch.toLowerCase()),
        )
      : allContacts,
  );

  const filteredCompanies = $derived(
    companySearch.trim()
      ? allCompanies.filter((c) =>
          c.name.toLowerCase().includes(companySearch.toLowerCase()),
        )
      : allCompanies,
  );

  // ── Reactive load ─────────────────────────────────────────────────────────
  // Single $effect — page resets come from filter changes (none here) or explicit pagination.
  $effect(() => {
    const _p = page;
    untrack(() => {
      void load();
    });
  });
</script>

<PageHeader title="Listes de contacts" subtitle="Gérez vos listes marketing." count={total}>
  {#snippet actions()}
    <Button onclick={openCreate}>Nouvelle liste</Button>
  {/snippet}
</PageHeader>

<ErrorNotice message={error} onretry={load} />

<div class={`flex gap-4 ${selected ? 'items-start' : ''}`}>
  <!-- ── List of lists ── -->
  <div class={`min-w-0 flex-1 transition-all ${selected ? 'max-w-[55%]' : ''}`}>
    {#if loading}
      <Card padded={false}><Skeleton rows={6} /></Card>
    {:else if lists.length === 0}
      <Card>
        <EmptyState message="Aucune liste pour le moment." />
      </Card>
    {:else}
      <Table>
        {#snippet head()}
          <th>Nom</th><th>Description</th><th>Membres</th><th>Créée le</th>
        {/snippet}
        {#snippet body()}
          {#each lists as list (list.id)}
            <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
            <tr
              class={`cursor-pointer transition-colors hover:bg-surface-muted ${selected?.id === list.id ? 'bg-accent-soft/20' : ''}`}
              onclick={() => void selectList(list)}
            >
              <td class="font-semibold text-ink">{list.name}</td>
              <td class="text-ink-muted">{list.description ?? '—'}</td>
              <td class="text-ink-muted">{memberCount(list)}</td>
              <td class="text-ink-muted">{formatDate(list.createdAt)}</td>
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
            onclick={() => { page = Math.max(1, page - 1); }}
          >Précédent</Button>
          <span class="font-mono text-xs">Page {page} / {totalPages}</span>
          <Button
            variant="secondary"
            disabled={page >= totalPages}
            onclick={() => { page = Math.min(totalPages, page + 1); }}
          >Suivant</Button>
        </div>
      </div>
    {/if}
  </div>

  <!-- ── Members panel ── -->
  {#if selected}
    <div class="w-[42%] shrink-0">
      <Card>
        <!-- Panel header -->
        <div class="mb-4 flex items-start justify-between gap-2">
          <div class="min-w-0">
            <h2 class="truncate text-base font-bold text-ink">{selected.name}</h2>
            {#if selected.description}
              <p class="mt-0.5 text-xs text-ink-muted">{selected.description}</p>
            {/if}
          </div>
          <button
            class="shrink-0 rounded p-1 text-ink-faint hover:bg-surface-muted hover:text-ink"
            onclick={() => { selected = null; members = []; }}
            aria-label="Fermer"
          >✕</button>
        </div>

        <!-- Actions -->
        <div class="mb-4 flex flex-wrap gap-2">
          <Button variant="secondary" onclick={openAddContact}>Ajouter un contact</Button>
          <Button variant="secondary" onclick={openAddCompany}>Ajouter les contacts d'une société</Button>
        </div>

        <!-- Members list -->
        <div class="text-[10px] font-semibold uppercase tracking-wide text-ink-muted mb-2">
          Membres ({members.length})
        </div>

        {#if membersLoading}
          <Skeleton rows={4} />
        {:else if members.length === 0}
          <p class="text-xs text-ink-faint">Aucun membre dans cette liste.</p>
        {:else}
          <ul class="space-y-1.5 max-h-96 overflow-y-auto pr-1">
            {#each members as member (member.id)}
              <li class="flex items-center justify-between gap-2 rounded-md border border-edge bg-surface-muted px-2.5 py-2 text-xs">
                <div class="min-w-0">
                  <div class="font-semibold text-ink truncate">{member.name}</div>
                  {#if member.email}
                    <div class="text-ink-faint truncate">{member.email}</div>
                  {/if}
                  {#if member.title}
                    <div class="text-ink-muted">{member.title}</div>
                  {/if}
                </div>
                <Button
                  variant="secondary"
                  loading={removingMemberId === member.contactId}
                  onclick={() => void removeMember(member.contactId)}
                >Retirer</Button>
              </li>
            {/each}
          </ul>
        {/if}
      </Card>
    </div>
  {/if}
</div>

<!-- Create list modal -->
<Modal bind:open={createOpen} title="Nouvelle liste">
  <div class="flex flex-col gap-4">
    <Field label="Nom *">
      <Input bind:value={createName} placeholder="Newsletter clients" />
    </Field>
    <Field label="Description">
      <Input bind:value={createDescription} placeholder="Description optionnelle…" />
    </Field>
  </div>
  {#snippet footer()}
    <Button variant="secondary" onclick={() => { createOpen = false; }}>Annuler</Button>
    <Button loading={createSaving} onclick={submitCreate}>Créer</Button>
  {/snippet}
</Modal>

<!-- Add contact modal -->
<Modal bind:open={addContactOpen} title="Ajouter un contact">
  <div class="flex flex-col gap-3">
    <Field label="Rechercher">
      <Input bind:value={contactSearch} placeholder="Nom ou courriel…" />
    </Field>
    <Field label="Contact *">
      <Select bind:value={addingContactId}>
        <option value="">Sélectionner un contact…</option>
        {#each filteredContacts as c (c.id)}
          <option value={c.id}>{c.name}{c.email ? ` — ${c.email}` : ''}</option>
        {/each}
      </Select>
    </Field>
  </div>
  {#snippet footer()}
    <Button variant="secondary" onclick={() => { addContactOpen = false; }}>Annuler</Button>
    <Button loading={addingContact} disabled={!addingContactId} onclick={submitAddContact}>Ajouter</Button>
  {/snippet}
</Modal>

<!-- Add company contacts modal -->
<Modal bind:open={addCompanyOpen} title="Ajouter les contacts d'une société">
  <div class="flex flex-col gap-3">
    <Field label="Rechercher">
      <Input bind:value={companySearch} placeholder="Nom de la société…" />
    </Field>
    <Field label="Société *">
      <Select bind:value={addingCompanyId}>
        <option value="">Sélectionner une société…</option>
        {#each filteredCompanies as c (c.id)}
          <option value={c.id}>{c.name}</option>
        {/each}
      </Select>
    </Field>
  </div>
  {#snippet footer()}
    <Button variant="secondary" onclick={() => { addCompanyOpen = false; }}>Annuler</Button>
    <Button loading={addingCompany} disabled={!addingCompanyId} onclick={submitAddCompany}>Ajouter</Button>
  {/snippet}
</Modal>
