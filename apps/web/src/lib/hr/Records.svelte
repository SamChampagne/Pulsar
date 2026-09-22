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
    EntityPicker,
    Drawer,
    EmptyState,
  } from '$lib/components/ui';
  import type { Paginated } from '@pulsar/shared';
  import type { Team, Employee } from './types';
  let { kind }: { kind: 'employees' | 'teams' } = $props();
  const isEmployee = $derived(kind === 'employees'),
    manage = $derived($auth?.user.permissions.includes('hr.manage'));
  let rows = $state<(Employee & Team)[]>([]),
    total = $state(0),
    current = $state(1),
    search = $state(''),
    active = $state('true'),
    refresh = $state(0),
    error = $state(''),
    loading = $state(true);
  let open = $state(false),
    editing = $state<(Employee & Team) | null>(null),
    busy = $state(false),
    uncertain = $state(false),
    formError = $state(''),
    baseline = $state('');
  let code = $state(''),
    name = $state(''),
    firstName = $state(''),
    lastName = $state(''),
    jobTitle = $state(''),
    teamId = $state(''),
    userId = $state(''),
    enabled = $state(true);
  const payload = $derived(
    isEmployee
      ? { firstName, lastName, jobTitle, teamId: teamId || null, active: enabled }
      : { name, active: enabled },
  );
  const dirty = $derived(JSON.stringify({ payload, code, userId }) !== baseline);
  $effect(() => {
    const endpoint = kind,
      q = { search, active, page: current, pageSize: 20 },
      v = refresh;
    let cancelled = false;
    loading = true;
    error = '';
    void api<Paginated<Employee & Team>>(`/hr/${endpoint}`, { query: q })
      .then((r) => {
        if (!cancelled) {
          rows = r.items;
          total = r.total;
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
  beforeNavigate((n) => {
    if (open) {
      n.cancel();
      formError = 'Fermez la fiche avant de quitter.';
    }
  });
  function show(r: (Employee & Team) | null) {
    editing = r;
    code = r?.code ?? '';
    name = r?.name ?? '';
    firstName = r?.firstName ?? '';
    lastName = r?.lastName ?? '';
    jobTitle = r?.jobTitle ?? '';
    teamId = r?.teamId ?? '';
    userId = r?.userId ?? '';
    enabled = r?.active ?? true;
    baseline = JSON.stringify({
      payload: isEmployee
        ? { firstName, lastName, jobTitle, teamId: teamId || null, active: enabled }
        : { name, active: enabled },
      code,
      userId,
    });
    uncertain = false;
    formError = '';
    open = true;
  }
  function close() {
    if (busy || dirty) {
      formError = 'Enregistrez la fiche ou abandonnez les changements.';
      return false;
    }
    return true;
  }
  async function save(e: SubmitEvent) {
    e.preventDefault();
    if (busy || uncertain) return;
    busy = true;
    formError = '';
    try {
      await api(`/hr/${kind}${editing ? `/${editing.id}` : ''}`, {
        method: editing ? 'PATCH' : 'POST',
        body: {
          ...payload,
          ...(editing
            ? { expectedUpdatedAt: editing.updatedAt }
            : { code, ...(isEmployee ? { userId: userId || null } : {}) }),
        },
      });
      open = false;
      refresh++;
    } catch (e) {
      uncertain = true;
      formError = `${(e as Error).message} Fermez puis vérifiez la liste avant de réessayer.`;
    } finally {
      busy = false;
    }
  }
</script>

<PageHeader
  title={isEmployee ? 'Employés' : 'Équipes'}
  subtitle={isEmployee
    ? 'Le dossier professionnel, distinct du compte de connexion.'
    : 'Organisez les dossiers employés sans modifier les rôles de sécurité.'}
>
  {#snippet actions()}{#if manage}<Button onclick={() => show(null)}
        >{isEmployee ? 'Nouvel employé' : 'Nouvelle équipe'}</Button
      >{/if}{/snippet}
</PageHeader>
<div class="mb-4 flex flex-wrap gap-3">
  <Input aria-label="Rechercher" bind:value={search} oninput={() => (current = 1)} /><Select
    aria-label="Activité"
    bind:value={active}
    onchange={() => (current = 1)}
    ><option value="true">Actifs</option><option value="false">Inactifs</option><option value=""
      >Tous</option
    ></Select
  >
</div>
{#if error}<p role="alert" class="mb-3 text-danger">{error}</p>
  <Button
    variant="secondary"
    onclick={() => {
      refresh++;
    }}>Recharger</Button
  >{/if}
{#if loading}<p class="p-6 text-ink-muted">Chargement…</p>{:else if !rows.length}<EmptyState
    title={isEmployee ? 'Aucun employé dans cette vue' : 'Aucune équipe dans cette vue'}
    message="Créez votre référentiel professionnel pour préparer le suivi des absences."
  />{:else}
  <div class="overflow-x-auto rounded-lg border border-edge">
    <table class="w-full text-left text-sm">
      <thead class="bg-surface-muted text-xs text-ink-muted"
        ><tr
          ><th class="p-3">{isEmployee ? 'Employé' : 'Équipe'}</th>{#if isEmployee}<th class="p-3"
              >Poste / équipe</th
            ><th class="p-3">Compte associé</th>{/if}<th class="p-3">État</th><th class="p-3"
            >Fiche</th
          ></tr
        ></thead
      ><tbody>
        {#each rows as r (r.id)}<tr class="border-t border-edge"
            ><td class="p-3"
              ><p class="font-medium">{isEmployee ? `${r.firstName} ${r.lastName}` : r.name}</p>
              <span class="text-xs text-ink-muted">{r.code}</span></td
            >{#if isEmployee}<td class="p-3"
                >{r.jobTitle || 'Poste non renseigné'}
                <p class="text-xs text-ink-muted">{r.team?.name || 'Sans équipe'}</p></td
              ><td class="p-3"
                >{r.user ? `${r.user.firstName} ${r.user.lastName}` : 'Aucun compte'}</td
              >{/if}<td class="p-3">{r.active ? 'Actif' : 'Inactif'}</td><td class="p-3"
              ><Button variant="secondary" onclick={() => show(r)}
                >{manage ? 'Modifier' : 'Consulter'}</Button
              ></td
            ></tr
          >{/each}
      </tbody>
    </table>
  </div>{/if}
<div class="mt-4 flex items-center gap-3">
  <Button
    variant="secondary"
    disabled={loading || current === 1}
    onclick={() => {
      current--;
    }}>Précédent</Button
  ><span class="text-sm text-ink-muted">{total} dossiers · page {current}</span><Button
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
    ? isEmployee
      ? 'Dossier employé'
      : 'Équipe'
    : isEmployee
      ? 'Nouvel employé'
      : 'Nouvelle équipe'}
  onbeforeclose={close}
  dismissible={!busy}
  width="xl"
>
  {#if formError}<p role="alert" class="mb-4 text-danger">{formError}</p>{/if}
  <form class="space-y-4" onsubmit={save}>
    <Field label={isEmployee ? 'Matricule' : 'Code équipe'}
      ><Input
        bind:value={code}
        required
        maxlength={40}
        pattern={'[A-Z0-9][A-Z0-9_-]{0,39}'}
        disabled={!!editing || !manage || busy || uncertain}
      /></Field
    >
    {#if isEmployee}
      <div class="grid gap-3 sm:grid-cols-2">
        <Field label="Prénom"
          ><Input
            bind:value={firstName}
            required
            maxlength={100}
            disabled={!manage || busy || uncertain}
          /></Field
        ><Field label="Nom"
          ><Input
            bind:value={lastName}
            required
            maxlength={100}
            disabled={!manage || busy || uncertain}
          /></Field
        >
      </div>
      <Field label="Poste"
        ><Input
          bind:value={jobTitle}
          maxlength={150}
          disabled={!manage || busy || uncertain}
        /></Field
      >
      <EntityPicker
        label="Équipe"
        endpoint="/hr/teams"
        filters={{ active: 'true' }}
        bind:value={teamId}
        selectedLabel={editing?.team?.name ?? ''}
        disabled={!manage || busy || uncertain}
      />
      <EntityPicker
        label="Compte utilisateur associé"
        endpoint="/hr/people"
        bind:value={userId}
        selectedLabel={editing?.user ? `${editing.user.firstName} ${editing.user.lastName}` : ''}
        disabled={!!editing || !manage || busy || uncertain}
      />
      <p class="text-xs text-ink-muted">
        Le compte est facultatif et fixé à la création dans ce premier lot. Il permet l’espace Mes
        absences si le rôle possède hr.self. Cette fiche ne crée pas de compte, n’accorde aucun
        accès et ne contient ni paie ni données médicales.
      </p>
    {:else}<Field label="Nom de l’équipe"
        ><Input
          bind:value={name}
          required
          maxlength={150}
          disabled={!manage || busy || uncertain}
        /></Field
      >{/if}
    <label class="flex items-center gap-2 text-sm"
      ><input
        type="checkbox"
        bind:checked={enabled}
        disabled={!manage || busy || uncertain}
      />Dossier actif</label
    >
    <p class="text-xs text-ink-muted">
      {isEmployee
        ? 'Désactiver le dossier conserve son historique. Les absences soumises ou approuvées non terminées doivent être traitées avant désactivation. Le compte utilisateur reste inchangé.'
        : 'Une équipe avec des employés actifs ne peut pas être désactivée; réaffectez-les d’abord.'}
    </p>
    <div class="flex gap-2">
      {#if manage}<Button type="submit" loading={busy} disabled={uncertain || (!!editing && !dirty)}
          >Enregistrer</Button
        >{/if}<Button
        variant="secondary"
        disabled={busy}
        onclick={() => {
          open = false;
          refresh++;
        }}>Abandonner et fermer</Button
      >
    </div>
  </form>
</Drawer>
