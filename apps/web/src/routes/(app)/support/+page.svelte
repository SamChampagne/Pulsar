<script lang="ts">
  import { formatDateTime as fmtUserInstant } from '$lib/format';
  import { beforeNavigate, goto } from '$app/navigation';
  import { page } from '$app/state';
  import { onMount, tick } from 'svelte';
  import { api, ApiError } from '$lib/api/client';
  import { auth } from '$lib/stores/auth';
  import BusinessAssistant from '$lib/components/business/BusinessAssistant.svelte';
  import {
    SUPPORT_STATUS_LABELS,
    SupportCaseStatus,
    canTransitionSupportCase,
    type Paginated,
  } from '@pulsar/shared';
  import {
    PageHeader,
    Button,
    Drawer,
    Modal,
    Field,
    Input,
    Textarea,
    Select,
    EntityPicker,
    Skeleton,
    EmptyState,
    Badge,
  } from '$lib/components/ui';
  type Case = {
    id: string;
    number: string;
    partnerId: string;
    partner: { name: string };
    title: string;
    description: string;
    priority: string;
    status: SupportCaseStatus;
    jobId: string | null;
    assigneeUserId: string | null;
    assignee: { firstName: string; lastName: string; status: string } | null;
    dueDate: string | null;
    resolution: string;
    updatedAt: string;
  };
  type Event = {
    id: string;
    action: string;
    note: string;
    createdAt: string;
    actor: { firstName: string; lastName: string };
  };
  type CreateBody = {
    partnerId: string;
    title: string;
    description: string;
    priority: string;
    operationKey: string;
  };
  const priorities: Record<string, string> = {
    LOW: 'Faible',
    NORMAL: 'Normale',
    HIGH: 'Haute',
    URGENT: 'Urgente',
  };
  const manage = $derived($auth?.user.permissions.includes('support.manage'));
  const serviceAccess = $derived(
    $auth?.tenant.enabledModules.includes('services') &&
      $auth.user.permissions.includes('services.read'),
  );
  const storageKey = $derived(`pulsar.support.create.v1:${$auth?.tenant.id}:${$auth?.user.id}`);
  let rows = $state<Case[]>([]),
    total = $state(0),
    current = $state(1),
    search = $state(''),
    caseStatus = $state(''),
    followup = $state(''),
    loading = $state(true),
    error = $state('');
  let open = $state(false),
    editing = $state<Case | null>(null),
    busy = $state(false),
    uncertain = $state(false),
    formError = $state(''),
    pending = $state<CreateBody | null>(null),
    storageError = $state('');
  let partnerId = $state(''),
    title = $state(''),
    description = $state(''),
    priority = $state('NORMAL'),
    jobId = $state(''),
    assigneeUserId = $state(''),
    dueDate = $state(''),
    baseline = $state('');
  let events = $state<Event[]>([]),
    historyPage = $state(1),
    historyTotal = $state(0),
    historyError = $state(''),
    nextStatus = $state<SupportCaseStatus | null>(null),
    note = $state('');
  const editable = $derived(!editing || ['OPEN', 'IN_PROGRESS'].includes(editing.status));
  const form = $derived({
    partnerId,
    title,
    description,
    priority,
    jobId,
    assigneeUserId,
    dueDate,
  });
  const dirty = $derived(JSON.stringify(form) !== baseline);
  let generation = 0;
  async function load() {
    const g = ++generation;
    loading = true;
    error = '';
    try {
      const r = await api<Paginated<Case>>('/support/cases', {
        query: {
          page: current,
          pageSize: 20,
          search,
          caseStatus: caseStatus || undefined,
          followup: followup || undefined,
        },
      });
      if (g === generation) {
        rows = r.items;
        total = r.total;
      }
    } catch (e) {
      if (g === generation) error = e instanceof Error ? e.message : 'Lecture impossible.';
    } finally {
      if (g === generation) loading = false;
    }
  }
  $effect(() => {
    void load();
  });
  beforeNavigate((n) => {
    if (open) {
      n.cancel();
      formError = 'Fermez le dossier avant de quitter.';
    }
  });
  $effect(() => {
    const id = page.url.searchParams.get('caseId');
    if (!id) return;
    let cancelled = false;
    void api<Case>(`/support/cases/${encodeURIComponent(id)}`)
      .then((row) => {
        if (!cancelled) show(row);
      })
      .catch((e) => {
        if (!cancelled) error = e.message;
      });
    return () => {
      cancelled = true;
    };
  });
  onMount(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const b = JSON.parse(raw);
        if (
          !b.partnerId ||
          !b.operationKey ||
          !b.title ||
          !b.description ||
          !priorities[b.priority]
        )
          throw new Error(
            'Demande conservée illisible. Vérifiez la liste avant de réinitialiser le stockage.',
          );
        pending = b;
      }
    } catch (e) {
      storageError = e instanceof Error ? e.message : 'Stockage indisponible.';
    }
  });
  function show(row: Case | null) {
    editing = row;
    partnerId = row?.partnerId ?? '';
    title = row?.title ?? '';
    description = row?.description ?? '';
    priority = row?.priority ?? 'NORMAL';
    jobId = row?.jobId ?? '';
    assigneeUserId = row?.assigneeUserId ?? '';
    dueDate = row?.dueDate?.slice(0, 10) ?? '';
    baseline = JSON.stringify({
      partnerId,
      title,
      description,
      priority,
      jobId,
      assigneeUserId,
      dueDate,
    });
    formError = '';
    uncertain = false;
    historyPage = 1;
    events = [];
    open = true;
  }
  async function history() {
    if (!editing) return;
    const id = editing.id;
    const requestedPage = historyPage;
    historyError = '';
    try {
      const r = await api<Paginated<Event>>(`/support/cases/${id}/history`, {
        query: { page: historyPage, pageSize: 10 },
      });
      if (editing?.id === id && historyPage === requestedPage) {
        events = r.items;
        historyTotal = r.total;
      }
    } catch (e) {
      if (editing?.id === id && historyPage === requestedPage)
        historyError = e instanceof Error ? e.message : 'Historique indisponible.';
    }
  }
  $effect(() => {
    void editing?.id;
    void historyPage;
    if (open) void history();
  });
  async function create(body: CreateBody) {
    busy = true;
    formError = '';
    try {
      const row = await api<Case>('/support/cases', { method: 'POST', body });
      localStorage.removeItem(storageKey);
      pending = null;
      show(row);
      await load();
    } catch (e) {
      formError = e instanceof Error ? e.message : 'Réponse incertaine.';
      if (e instanceof ApiError && e.statusCode < 500) {
        try {
          localStorage.removeItem(storageKey);
          pending = null;
        } catch {
          storageError =
            'Impossible de libérer la demande conservée. Vérifiez la liste avant de réinitialiser le stockage.';
        }
      } else uncertain = true;
    } finally {
      busy = false;
    }
  }
  async function save() {
    if (busy || uncertain || pending || storageError) return;
    if (!editing) {
      const body = {
        partnerId,
        title: title.trim(),
        description: description.trim(),
        priority,
        operationKey: crypto.randomUUID(),
      };
      try {
        if (localStorage.getItem(storageKey))
          throw new Error('Une demande attend déjà confirmation.');
        localStorage.setItem(storageKey, JSON.stringify(body));
        pending = body;
      } catch (e) {
        storageError = e instanceof Error ? e.message : 'Aucun envoi : stockage indisponible.';
        return;
      }
      await create(body);
      return;
    }
    busy = true;
    try {
      const row = await api<Case>(`/support/cases/${editing.id}`, {
        method: 'PATCH',
        body: {
          title: title.trim(),
          description: description.trim(),
          priority,
          assigneeUserId: assigneeUserId || null,
          dueDate: dueDate || null,
          ...(serviceAccess ? { jobId: jobId || null } : {}),
          expectedUpdatedAt: editing.updatedAt,
        },
      });
      show(row);
      await load();
    } catch (e) {
      formError = e instanceof Error ? e.message : 'Modification impossible.';
      uncertain = !(e instanceof ApiError) || e.statusCode >= 500;
    } finally {
      busy = false;
    }
  }
  async function transition() {
    if (!editing || !nextStatus || busy || uncertain) return;
    busy = true;
    try {
      const row = await api<Case>(`/support/cases/${editing.id}/transition`, {
        method: 'POST',
        body: { status: nextStatus, note: note.trim(), expectedUpdatedAt: editing.updatedAt },
      });
      nextStatus = null;
      show(row);
      await load();
    } catch (e) {
      formError = e instanceof Error ? e.message : 'Action impossible.';
      uncertain = !(e instanceof ApiError) || e.statusCode >= 500;
    } finally {
      busy = false;
    }
  }
</script>

<svelte:head><title>SAV | Pulsar</title></svelte:head>
<div class="mx-auto max-w-7xl space-y-4">
  <PageHeader title="SAV" subtitle="De la demande client à une résolution traçable." count={total}
    >{#snippet actions()}{#if manage}<Button
          disabled={!!pending || !!storageError}
          onclick={() => show(null)}>Nouvelle demande</Button
        >{/if}{/snippet}</PageHeader
  >
  <div class="flex flex-wrap gap-2" aria-label="Files de traitement SAV">
    {#each [['', 'Toutes les demandes'], ['mine', 'Mes demandes à traiter'], ['unassigned', 'Sans responsable'], ['overdue', 'Échéances dépassées']] as [value, label]}
      <Button
        variant={followup === value ? 'primary' : 'secondary'}
        onclick={() => {
          followup = value;
          caseStatus = '';
          current = 1;
        }}>{label}</Button
      >
    {/each}
  </div>
  {#if followup}<p class="text-xs text-ink-muted">
      Demandes ouvertes ou en traitement. Les échéances sont des dates civiles; le retard est évalué
      au jour UTC.
    </p>{/if}
  {#if error}<p role="alert" class="text-sm text-danger">{error}</p>{/if}{#if storageError}<p
      role="alert"
      class="text-sm text-danger"
    >
      {storageError}
    </p>{/if}
  {#if pending}<section class="rounded-lg border border-warn p-4 space-y-3">
      <p class="text-sm">
        Création à vérifier : {pending.title}. La reprise conserve la même clé pour éviter un
        doublon.
      </p>
      <Button
        disabled={busy || !manage || !!storageError}
        onclick={() => {
          if (pending) void create(pending);
        }}>Reprendre la demande conservée</Button
      >{#if !open && formError}<p role="alert" class="text-sm text-danger">{formError}</p>{/if}
    </section>{/if}
  <div class="flex flex-wrap items-end gap-3">
    <div class="w-72">
      <Input
        aria-label="Rechercher une demande SAV"
        placeholder="Numéro ou titre…"
        bind:value={search}
        oninput={() => {
          current = 1;
        }}
      />
    </div>
    <Field label="État des demandes"
      ><Select
        bind:value={caseStatus}
        onchange={() => {
          current = 1;
        }}
        ><option value="">Tous</option
        >{#each Object.entries(SUPPORT_STATUS_LABELS) as [k, v]}<option value={k}>{v}</option
          >{/each}</Select
      ></Field
    ><a class="text-sm text-accent underline" href="/documentation?module=support"
      >Comprendre le parcours SAV</a
    >
  </div>
  <div class="rounded-lg border border-edge bg-surface overflow-x-auto">
    {#if loading}<Skeleton rows={5} />{:else if !rows.length}<EmptyState
        title={search || followup || caseStatus
          ? 'Aucune demande dans cette vue'
          : 'Votre première demande SAV'}
        message={search || followup || caseStatus
          ? 'Ajustez la recherche ou les filtres pour retrouver un autre dossier.'
          : 'Choisissez ou ajoutez le client dans le sélecteur, décrivez le problème et sa priorité. Catalogue n’est pas requis. Le lien vers une intervention Services reste facultatif.'}
      />{:else}<table class="w-full text-left text-sm">
        <thead class="bg-surface-muted"
          ><tr
            ><th class="p-3">Demande</th><th class="p-3">Client</th><th class="p-3">Priorité</th><th
              class="p-3">Responsable / échéance</th
            ><th class="p-3">État</th></tr
          ></thead
        ><tbody
          >{#each rows as row}<tr class="border-t border-edge hover:bg-surface-muted/50"
              ><td class="p-3"
                ><button class="text-accent underline font-mono" onclick={() => show(row)}
                  >{row.number}</button
                >
                <p class="mt-1">{row.title}</p></td
              ><td class="p-3">{row.partner.name}</td><td class="p-3">{priorities[row.priority]}</td
              ><td class="p-3"
                ><p>
                  {row.assignee
                    ? `${row.assignee.firstName} ${row.assignee.lastName}${row.assignee.status !== 'ACTIVE' ? ' (inactif)' : ''}`
                    : 'Non attribuée'}
                </p>
                <p class="text-xs text-ink-muted">
                  {row.dueDate?.slice(0, 10) ?? 'Sans échéance'}
                </p></td
              ><td class="p-3"
                ><Badge
                  tone={row.status === 'RESOLVED'
                    ? 'ok'
                    : row.status === 'IN_PROGRESS'
                      ? 'info'
                      : 'neutral'}>{SUPPORT_STATUS_LABELS[row.status]}</Badge
                ></td
              ></tr
            >{/each}</tbody
        >
      </table>{/if}
  </div>
  <div class="flex justify-end items-center gap-3">
    <Button
      variant="ghost"
      disabled={loading || current === 1}
      onclick={() => {
        current--;
      }}>Précédent</Button
    ><span class="text-sm">{current} / {Math.max(1, Math.ceil(total / 20))}</span><Button
      variant="ghost"
      disabled={loading || current * 20 >= total}
      onclick={() => {
        current++;
      }}>Suivant</Button
    >
  </div>
</div>
<Drawer
  bind:open
  title={editing ? editing.number : 'Nouvelle demande SAV'}
  width="lg"
  dismissible={!busy}
  onbeforeclose={() => {
    if (dirty && editable) {
      formError = 'Utilisez Fermer pour abandonner la saisie.';
      return false;
    }
    return true;
  }}
>
  {#if editing}<div class="mb-4">
      <BusinessAssistant
        permission="support.read"
        label="Préparer une réponse avec un agent"
        prompt={`Consulte support_case_context pour la demande ${editing.id}. Résume les faits et propose un brouillon de réponse client en citant le numéro du dossier. N’envoie aucun message, ne clôture rien et ne promets pas de délai non confirmé.`}
      />
    </div>{/if}
  <form
    class="space-y-4"
    onsubmit={(e) => {
      e.preventDefault();
      void save();
    }}
  >
    {#if formError}<p role="alert" class="text-sm text-danger">{formError}</p>{/if}{#if uncertain}<p
        class="text-sm text-warn"
      >
        Réponse incertaine. Pour une création, reprendre la demande conservée. Pour une
        modification, fermer et vérifier le dossier avant toute nouvelle action.
      </p>{/if}
    <fieldset disabled={busy || !manage || !editable || uncertain || !!pending} class="space-y-4">
      <EntityPicker
        endpoint="/support/references/customers"
        label="Client SAV"
        bind:value={partnerId}
        selectedLabel={editing?.partner.name ?? ''}
        disabled={!!editing}
      />
      <Field label="Objet de la demande"
        ><Input bind:value={title} required maxlength={200} /></Field
      >
      <Field label="Description du problème"
        ><Textarea bind:value={description} required maxlength={4000} /></Field
      >
      <Field label="Priorité"
        ><Select bind:value={priority}
          >{#each Object.entries(priorities) as [k, v]}<option value={k}>{v}</option>{/each}</Select
        ></Field
      >
      {#if editing}
        <EntityPicker
          endpoint="/support/references/people"
          label="Responsable SAV"
          bind:value={assigneeUserId}
          selectedLabel={editing.assigneeUserId === assigneeUserId && editing.assignee
            ? `${editing.assignee.firstName} ${editing.assignee.lastName}`
            : ''}
        />
        <Field label="Échéance SAV"><Input type="date" bind:value={dueDate} /></Field>
        <p class="text-xs text-ink-muted">
          Le responsable suit le dossier. Cette affectation n’envoie pas de notification et ne
          réserve pas de temps.
        </p>
      {/if}
      {#if editing && serviceAccess}<EntityPicker
          endpoint="/support/references/jobs"
          filters={{ partnerId }}
          label="Intervention liée (facultatif)"
          bind:value={jobId}
          selectedLabel={editing.jobId === jobId && jobId ? 'Intervention liée' : ''}
        />
        <p class="text-xs text-ink-muted">
          Uniquement les interventions du même client. Le lien ne crée ni heures, ni pièces, ni
          résolution automatique.
        </p>{/if}
    </fieldset>
    {#if editing?.jobId && serviceAccess}<Button
        variant="secondary"
        disabled={busy || dirty}
        onclick={async () => {
          const id = editing!.jobId;
          open = false;
          await tick();
          await goto(`/services/interventions?jobId=${id}`);
        }}>Ouvrir l’intervention</Button
      >{/if}
    {#if editing?.resolution}<section class="rounded-md bg-surface-muted p-3">
        <h2 class="text-sm font-semibold">Dernière résolution</h2>
        <p class="mt-2 text-sm whitespace-pre-wrap">{editing.resolution}</p>
      </section>{/if}
    <div class="flex flex-wrap justify-end gap-2">
      <Button
        variant="ghost"
        disabled={busy}
        onclick={() => {
          open = false;
          void load();
        }}>Fermer</Button
      >{#if manage && editable}<Button
          type="submit"
          loading={busy}
          disabled={uncertain ||
            !!pending ||
            !!storageError ||
            !partnerId ||
            !title.trim() ||
            !description.trim()}>Enregistrer la demande</Button
        >{/if}
    </div>
    {#if editing && manage}<section class="border-t border-edge pt-4 space-y-3">
        <h2 class="text-sm font-semibold">Avancer le traitement</h2>
        <div class="flex flex-wrap gap-2">
          {#each Object.values(SupportCaseStatus).filter( (s) => canTransitionSupportCase(editing!.status, s), ) as s}<Button
              variant="secondary"
              disabled={busy || dirty || uncertain}
              onclick={() => {
                nextStatus = s;
                note = '';
              }}
              >{s === 'IN_PROGRESS' && editing.status === 'RESOLVED'
                ? 'Rouvrir'
                : SUPPORT_STATUS_LABELS[s]}</Button
            >{/each}
        </div>
      </section>{/if}
  </form>
  {#if editing}<section
      class="mt-5 border-t border-edge pt-4 space-y-3"
      aria-label="Historique SAV"
    >
      <h2 class="text-sm font-semibold">Historique du dossier</h2>
      {#if historyError}<p role="alert" class="text-danger text-sm">
          {historyError}
        </p>{/if}{#each events as event}<article class="border-l-2 border-edge pl-3">
          <p class="text-xs text-ink-muted">
            {fmtUserInstant(event.createdAt)} · {event.actor.firstName}
            {event.actor.lastName} · {SUPPORT_STATUS_LABELS[event.action as SupportCaseStatus] ??
              (event.action === 'CREATE' ? 'Création' : 'Modification')}
          </p>
          <p class="mt-1 text-sm whitespace-pre-wrap">{event.note}</p>
        </article>{/each}
      <div class="flex gap-2">
        <Button
          variant="ghost"
          disabled={historyPage === 1 || busy}
          onclick={() => {
            historyPage--;
          }}>Historique précédent</Button
        ><Button
          variant="ghost"
          disabled={historyPage * 10 >= historyTotal || busy}
          onclick={() => {
            historyPage++;
          }}>Historique suivant</Button
        >
      </div>
    </section>{/if}
</Drawer>
<Modal
  open={!!nextStatus}
  title="Confirmer le traitement SAV"
  dismissible={!busy}
  onclose={() => {
    nextStatus = null;
  }}
  ><div class="space-y-4">
    <p class="text-sm">
      {editing?.number} → {nextStatus ? SUPPORT_STATUS_LABELS[nextStatus] : ''}. Aucun statut de
      l’intervention liée ne change.
    </p>
    <Field label="Compte rendu ou motif"><Textarea bind:value={note} maxlength={2000} /></Field
    >{#if formError}<p role="alert" class="text-sm text-danger">{formError}</p>{/if}
    <div class="flex justify-end gap-2">
      <Button
        variant="ghost"
        disabled={busy}
        onclick={() => {
          nextStatus = null;
        }}>Retour</Button
      ><Button loading={busy} disabled={!note.trim() || uncertain} onclick={transition}
        >Confirmer</Button
      >
    </div>
  </div></Modal
>
