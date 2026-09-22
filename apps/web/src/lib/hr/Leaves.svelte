<script lang="ts">
  import { beforeNavigate } from '$app/navigation';
  import { api } from '$lib/api/client';
  import { auth } from '$lib/stores/auth';
  import {
    PageHeader,
    Button,
    Input,
    Field,
    Select,
    Textarea,
    EntityPicker,
    Drawer,
    EmptyState,
    Modal,
  } from '$lib/components/ui';
  import {
    HrLeaveStatus,
    HrLeaveKind,
    HR_LEAVE_LABELS,
    HR_LEAVE_KIND_LABELS,
    canTransitionHrLeave,
    hrLeaveDates,
    type Paginated,
  } from '@pulsar/shared';
  import type { Employee, Leave } from './types';
  let { self = false }: { self?: boolean } = $props();
  const endpoint = $derived(self ? '/hr/self/leaves' : '/hr/leaves'),
    manage = $derived(self || !!$auth?.user.permissions.includes('hr.manage')),
    approve = $derived(!self && !!$auth?.user.permissions.includes('hr.approve'));
  type Intent = {
    employeeId: string;
    kind: HrLeaveKind;
    startDate: string;
    endDate: string;
    note: string;
    operationKey: string;
  };
  type Event = {
    id: string;
    action: string;
    note: string;
    createdAt: string;
    actor: { firstName: string; lastName: string };
  };
  let rows = $state<Leave[]>([]),
    total = $state(0),
    current = $state(1),
    status = $state(''),
    refresh = $state(0),
    error = $state(''),
    loading = $state(true),
    me = $state<Employee | null>(null);
  let open = $state(false),
    editing = $state<Leave | null>(null),
    busy = $state(false),
    uncertain = $state(false),
    formError = $state(''),
    baseline = $state(''),
    employeeId = $state(''),
    kind = $state(HrLeaveKind.TIME_OFF),
    startDate = $state(''),
    endDate = $state(''),
    note = $state(''),
    pending = $state<Intent | null>(null),
    storageError = $state(false);
  let next = $state<HrLeaveStatus | null>(null),
    decisionNote = $state(''),
    events = $state<Event[]>([]),
    historyPage = $state(1),
    historyTotal = $state(0),
    historyError = $state(''),
    historyLoading = $state(false);
  const payload = $derived({ employeeId, kind, startDate, endDate, note }),
    dirty = $derived(JSON.stringify(payload) !== baseline),
    storageKey = $derived(
      `pulsar-hr-leave:${$auth?.tenant.id}:${$auth?.user.id}:${self ? 'self' : 'team'}`,
    );
  const canEdit = $derived(
    manage &&
      !busy &&
      !uncertain &&
      !pending &&
      (!editing || (editing.status === 'DRAFT' && editing.employee.active)),
  );
  $effect(() => {
    const key = storageKey;
    pending = null;
    storageError = false;
    try {
      const raw = localStorage.getItem(key);
      if (raw) {
        const p = JSON.parse(raw);
        if (
          typeof p.employeeId !== 'string' ||
          !p.employeeId ||
          !Object.values(HrLeaveKind).includes(p.kind) ||
          typeof p.note !== 'string' ||
          typeof p.operationKey !== 'string'
        )
          throw new Error();
        hrLeaveDates(p.startDate, p.endDate);
        pending = p;
      }
    } catch {
      storageError = true;
      error =
        'La demande locale ne peut pas être lue. Vérifiez les absences enregistrées avant de la retirer.';
    }
  });
  $effect(() => {
    const path = endpoint,
      q = { status, page: current, pageSize: 20 },
      v = refresh;
    let cancelled = false;
    loading = true;
    error = '';
    void Promise.all([
      api<Paginated<Leave>>(path, { query: q }),
      self ? api<Employee | null>('/hr/self') : Promise.resolve(null),
    ])
      .then(([r, profile]) => {
        if (!cancelled) {
          rows = r.items;
          total = r.total;
          me = profile;
        }
      })
      .catch((e) => {
        if (!cancelled) {
          rows = [];
          error = e.message;
        }
      })
      .finally(() => {
        if (!cancelled) loading = false;
      });
    return () => {
      cancelled = true;
    };
  });
  $effect(() => {
    const id = editing?.id,
      version = editing?.updatedAt,
      page = historyPage,
      path = endpoint;
    if (!id || !open) return;
    let cancelled = false;
    historyLoading = true;
    historyError = '';
    void api<Paginated<Event>>(`${path}/${id}/history`, { query: { page, pageSize: 8 } })
      .then((r) => {
        if (!cancelled) {
          events = r.items;
          historyTotal = r.total;
        }
      })
      .catch((e) => {
        if (!cancelled) {
          events = [];
          historyError = e.message;
        }
      })
      .finally(() => {
        if (!cancelled) historyLoading = false;
      });
    return () => {
      cancelled = true;
    };
  });
  beforeNavigate((n) => {
    if (open) {
      n.cancel();
      formError = 'Fermez le dossier avant de quitter.';
    }
  });
  function adopt(r: Leave | null, intent: Intent | null = null) {
    editing = r;
    employeeId = r?.employeeId ?? intent?.employeeId ?? me?.id ?? '';
    kind = r?.kind ?? intent?.kind ?? HrLeaveKind.TIME_OFF;
    startDate = r?.startDate.slice(0, 10) ?? intent?.startDate ?? '';
    endDate = r?.endDate.slice(0, 10) ?? intent?.endDate ?? '';
    note = r?.note ?? intent?.note ?? '';
    baseline = JSON.stringify({ employeeId, kind, startDate, endDate, note });
    uncertain = false;
    formError = '';
    historyPage = 1;
  }
  function show(r: Leave | null) {
    adopt(r, r ? null : pending);
    open = true;
  }
  function close() {
    if (busy || next || dirty) {
      formError = 'Enregistrez ou abandonnez les changements avant de fermer.';
      return false;
    }
    return true;
  }
  async function save(e?: SubmitEvent) {
    e?.preventDefault();
    if (busy || uncertain || storageError) return;
    busy = true;
    formError = '';
    try {
      hrLeaveDates(startDate, endDate);
      let result: Leave;
      if (editing) {
        const { employeeId: _, ...body } = payload;
        result = await api<Leave>(`${endpoint}/${editing.id}`, {
          method: 'PATCH',
          body: { ...body, expectedUpdatedAt: editing.updatedAt },
        });
      } else {
        const intent = pending ?? {
          ...payload,
          note: note.trim(),
          operationKey: crypto.randomUUID(),
        };
        localStorage.setItem(storageKey, JSON.stringify(intent));
        pending = intent;
        result = await api<Leave>(endpoint, { method: 'POST', body: intent });
        localStorage.removeItem(storageKey);
        pending = null;
      }
      adopt(result);
      refresh++;
    } catch (e) {
      formError = (e as Error).message;
      if (editing) uncertain = true;
    } finally {
      busy = false;
    }
  }
  async function reload() {
    if (!editing || busy) return;
    busy = true;
    formError = '';
    try {
      adopt(await api<Leave>(`${endpoint}/${editing.id}`));
      refresh++;
    } catch (e) {
      formError = (e as Error).message;
    } finally {
      busy = false;
    }
  }
  function allowed(to: HrLeaveStatus) {
    if (!editing || !canTransitionHrLeave(editing.status, to)) return false;
    const decision = ['APPROVED', 'REJECTED'].includes(to) || editing.status === 'APPROVED';
    return decision
      ? approve &&
          editing.createdById !== $auth?.user.id &&
          editing.employee.userId !== $auth?.user.id
      : manage;
  }
  async function transition() {
    if (!editing || !next || busy || dirty || uncertain) return;
    busy = true;
    formError = '';
    try {
      adopt(
        await api<Leave>(`${endpoint}/${editing.id}/transition`, {
          method: 'POST',
          body: { status: next, note: decisionNote.trim(), expectedUpdatedAt: editing.updatedAt },
        }),
      );
      refresh++;
    } catch (e) {
      formError = (e as Error).message;
      uncertain = true;
    } finally {
      busy = false;
      next = null;
    }
  }
  function discardPending() {
    if (
      !window.confirm(
        'Vérifiez la liste avant de retirer cette demande locale. Aucune absence déjà créée ne sera supprimée.',
      )
    )
      return;
    try {
      localStorage.removeItem(storageKey);
      pending = null;
      storageError = false;
      open = false;
      refresh++;
    } catch {
      error = 'Stockage local inaccessible.';
    }
  }
  const actions: Record<string, string> = {
    DRAFT: 'Revenir au brouillon',
    SUBMITTED: 'Soumettre',
    APPROVED: 'Approuver',
    REJECTED: 'Refuser',
    CANCELLED: 'Annuler la demande',
  };
</script>

<PageHeader
  title={self ? 'Mes absences' : 'Absences d’équipe'}
  subtitle="Des dates civiles et une décision tracée. Aucun calcul de paie ni de solde de congés."
>
  {#snippet actions()}{#if manage}<Button
        disabled={loading || storageError || (self && !me?.active && !pending)}
        onclick={() => show(null)}
        >{pending ? 'Reprendre la demande conservée' : 'Nouvelle demande'}</Button
      >{/if}{/snippet}
</PageHeader>
{#if self && !loading}{#if me}<div class="mb-4 rounded-lg border border-edge bg-surface p-4">
      <p class="font-medium">{me.firstName} {me.lastName} · {me.code}</p>
      <p class="text-sm text-ink-muted">
        {me.jobTitle || 'Poste non renseigné'} · {me.team?.name || 'Sans équipe'}{!me.active
          ? ' · Dossier inactif'
          : ''}
      </p>
    </div>{:else}<p class="mb-4 rounded-lg bg-surface-muted p-4">
      Aucun dossier employé n’est associé à votre compte. Un gestionnaire RH doit le créer avant
      votre première demande.
    </p>{/if}{/if}
{#if pending || storageError}<div
    class="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-edge p-4"
  >
    <p class="text-sm">
      Une demande locale nécessite une vérification. Sa reprise utilise la même clé, sans créer de
      doublon.
    </p>
    <Button variant="secondary" onclick={discardPending} disabled={busy}
      >Retirer après vérification</Button
    >
  </div>{/if}
<div class="mb-4">
  <Select aria-label="État des absences" bind:value={status} onchange={() => (current = 1)}
    ><option value="">Tous les états</option
    >{#each Object.entries(HR_LEAVE_LABELS) as [k, label]}<option value={k}>{label}</option
      >{/each}</Select
  >
</div>
{#if error}<p role="alert" class="text-danger">{error}</p>
  <Button
    onclick={() => {
      refresh++;
    }}
    variant="secondary">Recharger</Button
  >{/if}
{#if loading}<p class="p-6 text-ink-muted">
    Lecture des demandes…
  </p>{:else if !rows.length}<EmptyState
    title="Aucune demande dans cette vue"
    message="Préparez une période puis soumettez-la à une autre personne habilitée."
  />{:else}<div class="overflow-x-auto rounded-lg border border-edge">
    <table class="w-full text-left text-sm">
      <thead class="bg-surface-muted text-xs text-ink-muted"
        ><tr
          ><th class="p-3">Demande / employé</th><th class="p-3">Période incluse</th><th class="p-3"
            >Type</th
          ><th class="p-3">État</th><th class="p-3">Dossier</th></tr
        ></thead
      ><tbody
        >{#each rows as r (r.id)}<tr class="border-t border-edge"
            ><td class="p-3"
              ><p class="font-medium">{r.number}</p>
              <p class="text-xs text-ink-muted">{r.employee.firstName} {r.employee.lastName}</p></td
            ><td class="p-3">{r.startDate.slice(0, 10)} → {r.endDate.slice(0, 10)}</td><td
              class="p-3">{HR_LEAVE_KIND_LABELS[r.kind]}</td
            ><td class="p-3">{HR_LEAVE_LABELS[r.status]}</td><td class="p-3"
              ><Button variant="secondary" onclick={() => show(r)}>Ouvrir</Button></td
            ></tr
          >{/each}</tbody
      >
    </table>
  </div>{/if}
<div class="mt-4 flex items-center gap-3">
  <Button
    variant="secondary"
    disabled={loading || current === 1}
    onclick={() => {
      current--;
    }}>Précédent</Button
  ><span class="text-sm text-ink-muted">{total} demandes · page {current}</span><Button
    variant="secondary"
    disabled={loading || current * 20 >= total}
    onclick={() => {
      current++;
    }}>Suivant</Button
  >
</div>
<Drawer
  bind:open
  title={editing
    ? `${editing.number} · ${HR_LEAVE_LABELS[editing.status]}`
    : 'Nouvelle demande d’absence'}
  onbeforeclose={close}
  dismissible={!busy && !next}
  width="xl"
>
  {#if formError}<p role="alert" class="mb-4 text-danger">{formError}</p>{/if}
  {#if uncertain}<Button variant="secondary" disabled={busy} onclick={reload}
      >Relire le dossier et son historique</Button
    >{/if}
  {#if pending && !editing}<p class="mb-4 rounded-lg bg-surface-muted p-3 text-sm">
      La demande est conservée. Les champs sont figés pour reprendre exactement le même envoi après
      une réponse perdue.
    </p>{/if}
  <form class="space-y-4" onsubmit={save}>
    {#if self || editing}<p class="text-sm">
        Employé : {editing
          ? `${editing.employee.firstName} ${editing.employee.lastName}`
          : me
            ? `${me.firstName} ${me.lastName}`
            : employeeId}
      </p>{:else}<EntityPicker
        label="Employé"
        endpoint="/hr/employees"
        filters={{ active: 'true' }}
        bind:value={employeeId}
        disabled={!canEdit}
      />{/if}
    <Field label="Type d’absence"
      ><Select bind:value={kind} disabled={!canEdit}
        >{#each Object.entries(HR_LEAVE_KIND_LABELS) as [k, label]}<option value={k}>{label}</option
          >{/each}</Select
      ></Field
    >
    <div class="grid gap-3 sm:grid-cols-2">
      <Field label="Début inclus"
        ><Input
          type="date"
          bind:value={startDate}
          min="1900-01-01"
          max="2199-12-31"
          required
          disabled={!canEdit}
        /></Field
      ><Field label="Fin incluse"
        ><Input
          type="date"
          bind:value={endDate}
          min={startDate || '1900-01-01'}
          max="2199-12-31"
          required
          disabled={!canEdit}
        /></Field
      >
    </div>
    <Field label="Note professionnelle"
      ><Textarea bind:value={note} maxlength={1000} disabled={!canEdit} /></Field
    >
    <p class="text-xs text-ink-muted">
      Ne saisissez aucun diagnostic, document médical ou renseignement bancaire. Une journée inclut
      toute la date; les fins de semaine et jours fériés ne sont pas déduits. Les chevauchements
      soumis/approuvés pour le même employé sont refusés.
    </p>
    <div class="flex flex-wrap gap-2">
      {#if manage && (!editing || editing.status === 'DRAFT')}<Button
          type="submit"
          loading={busy}
          disabled={uncertain ||
            storageError ||
            !employeeId ||
            !startDate ||
            !endDate ||
            (!!editing && (!dirty || !editing.employee.active))}
          >{pending && !editing
            ? 'Reprendre exactement cette demande'
            : editing
              ? 'Enregistrer les dates'
              : 'Créer le brouillon'}</Button
        >{/if}<Button
        variant="secondary"
        disabled={busy || !!next}
        onclick={() => {
          open = false;
          refresh++;
        }}>{dirty ? 'Abandonner les changements et fermer' : 'Fermer le dossier'}</Button
      >
    </div>
  </form>
  {#if editing}<div class="mt-5 flex flex-wrap gap-2 border-t border-edge pt-5">
      {#each Object.values(HrLeaveStatus) as s}{#if allowed(s)}<Button
            variant={s === 'APPROVED' || s === 'SUBMITTED' ? 'primary' : 'secondary'}
            disabled={busy || dirty || uncertain}
            onclick={() => {
              next = s;
              decisionNote = '';
            }}>{actions[s]}</Button
          >{/if}{/each}
    </div>
    {#if editing.status === 'SUBMITTED' && (editing.createdById === $auth?.user.id || editing.employee.userId === $auth?.user.id)}<p
        class="mt-3 text-sm text-ink-muted"
      >
        Une autre personne avec le droit RH d’approbation doit décider de cette demande.
      </p>{/if}
    <section class="mt-6 border-t border-edge pt-4">
      <h2 class="font-semibold">Historique des décisions</h2>
      {#if historyError}<p role="alert" class="text-danger">
          {historyError}
        </p>{/if}{#if historyLoading}<p>
          Lecture de l’historique…
        </p>{:else}{#each events as event (event.id)}<div class="border-b border-edge py-3">
            <p class="text-sm">{event.note}</p>
            <p class="text-xs text-ink-muted">
              {event.actor.firstName}
              {event.actor.lastName} · {new Date(event.createdAt).toLocaleString('fr-CA')}
            </p>
          </div>{/each}{/if}
      <div class="mt-3 flex gap-3">
        <Button
          variant="secondary"
          disabled={historyLoading || historyPage === 1}
          onclick={() => {
            historyPage--;
          }}>Plus récent</Button
        ><Button
          variant="secondary"
          disabled={historyLoading || historyPage * 8 >= historyTotal}
          onclick={() => {
            historyPage++;
          }}>Plus ancien</Button
        >
      </div>
    </section>
  {/if}
</Drawer>
<Modal
  open={!!next}
  title="Confirmer la décision RH"
  dismissible={!busy}
  onclose={() => {
    if (!busy) next = null;
  }}
  ><p class="mb-3 text-sm">
    {next ? actions[next] : ''}. La décision et son auteur seront conservés dans le dossier.
  </p>
  <Field label="Motif de la décision"
    ><Textarea bind:value={decisionNote} maxlength={1000} disabled={busy} /></Field
  >
  <div class="mt-4 flex gap-2">
    <Button onclick={transition} loading={busy} disabled={!decisionNote.trim()}>Confirmer</Button
    ><Button
      variant="secondary"
      disabled={busy}
      onclick={() => {
        next = null;
      }}>Retour</Button
    >
  </div></Modal
>
