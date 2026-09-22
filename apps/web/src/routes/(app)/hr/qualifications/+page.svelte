<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import { beforeNavigate } from '$app/navigation';
  import { api, ApiError } from '$lib/api/client';
  import { auth } from '$lib/stores/auth';
  import { qualificationState, QUALIFICATION_LABELS, type Paginated } from '@pulsar/shared';
  import {
    PageHeader,
    Button,
    Drawer,
    Modal,
    Field,
    Input,
    Textarea,
    EntityPicker,
    Skeleton,
    EmptyState,
    Badge,
  } from '$lib/components/ui';
  type Person = { firstName: string; lastName: string };
  type Qualification = {
    id: string;
    employee: Person & { code: string; active: boolean };
    skill: { name: string; code: string; active: boolean };
    status: string;
    validFrom: string;
    expiresOn: string | null;
    reference: string;
    createdBy: Person;
    updatedAt: string;
    revokeReason: string | null;
    revokedBy: Person | null;
  };
  type Intent = {
    employeeId: string;
    skillId: string;
    validFrom: string;
    expiresOn: string | null;
    reference: string;
    operationKey: string;
  };
  const manage = $derived($auth?.user.permissions.includes('hr.qualifications.manage'));
  function stateAtDate(row: Qualification) {
    try {
      return qualificationState(row, day);
    } catch {
      return null;
    }
  }
  const storageKey = $derived(`pulsar.hr.qualification.v1:${$auth?.tenant.id}:${$auth?.user.id}`);
  let rows = $state<Qualification[]>([]),
    total = $state(0),
    current = $state(1),
    search = $state(page.url.searchParams.get('search') ?? ''),
    loading = $state(true),
    error = $state(''),
    refresh = $state(0),
    day = $state(new Date().toISOString().slice(0, 10));
  let open = $state(false),
    busy = $state(false),
    formError = $state(''),
    pending = $state<Intent | null>(null),
    storageError = $state('');
  let employeeId = $state(''),
    skillId = $state(''),
    validFrom = $state(new Date().toISOString().slice(0, 10)),
    expiresOn = $state(''),
    reference = $state(''),
    verified = $state(false);
  let revoking = $state<Qualification | null>(null),
    reason = $state(''),
    uncertain = $state(false);
  $effect(() => {
    const query = { search, page: current, pageSize: 20 },
      v = refresh;
    let cancelled = false;
    loading = true;
    error = '';
    void api<Paginated<Qualification>>('/hr/qualifications', { query })
      .then((r) => {
        if (!cancelled) {
          rows = r.items;
          total = r.total;
        }
      })
      .catch((e) => {
        if (!cancelled) error = e.message;
      })
      .finally(() => {
        if (!cancelled) loading = false;
      });
    return () => {
      cancelled = true;
    };
  });
  onMount(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const value = JSON.parse(raw);
        if (
          !value.operationKey ||
          !value.employeeId ||
          !value.skillId ||
          !value.reference ||
          !value.validFrom
        )
          throw new Error(
            'Attestation conservée illisible : vérifiez le registre avant de libérer le stockage.',
          );
        pending = value;
      }
    } catch (e) {
      storageError = (e as Error).message;
    }
  });
  beforeNavigate((n) => {
    if (open || revoking) {
      n.cancel();
      formError = 'Fermez le formulaire avant de quitter.';
    }
  });
  function start() {
    employeeId = '';
    skillId = '';
    validFrom = new Date().toISOString().slice(0, 10);
    expiresOn = '';
    reference = '';
    verified = false;
    formError = '';
    open = true;
  }
  async function send(body: Intent) {
    if (busy) return;
    busy = true;
    formError = '';
    try {
      await api('/hr/qualifications', { method: 'POST', body });
      localStorage.removeItem(storageKey);
      pending = null;
      open = false;
      refresh++;
    } catch (e) {
      formError = e instanceof Error ? e.message : 'Réponse incertaine.';
      if (e instanceof ApiError && e.statusCode < 500) {
        try {
          localStorage.removeItem(storageKey);
          pending = null;
        } catch {
          storageError = 'Stockage indisponible : vérifiez le registre.';
        }
      }
    } finally {
      busy = false;
    }
  }
  async function issue() {
    if (busy || pending || storageError || !verified) return;
    const body = {
      employeeId,
      skillId,
      validFrom,
      expiresOn: expiresOn || null,
      reference: reference.trim(),
      operationKey: crypto.randomUUID(),
    };
    try {
      if (localStorage.getItem(storageKey))
        throw new Error('Une attestation attend déjà confirmation.');
      localStorage.setItem(storageKey, JSON.stringify(body));
      pending = body;
    } catch (e) {
      storageError = (e as Error).message;
      return;
    }
    await send(body);
  }
  async function revoke() {
    if (!revoking || busy || uncertain) return;
    busy = true;
    formError = '';
    try {
      await api(`/hr/qualifications/${revoking.id}/revoke`, {
        method: 'POST',
        body: { reason, expectedUpdatedAt: revoking.updatedAt },
      });
      revoking = null;
      refresh++;
    } catch (e) {
      formError = e instanceof Error ? e.message : 'Révocation impossible.';
      uncertain = !(e instanceof ApiError) || e.statusCode >= 500;
    } finally {
      busy = false;
    }
  }
</script>

<svelte:head><title>Habilitations | Pulsar</title></svelte:head>
<div class="mx-auto max-w-7xl space-y-4">
  <PageHeader
    title="Habilitations"
    subtitle="Les qualifications vérifiées, leur validité et leur historique."
    count={total}
    >{#snippet actions()}{#if manage}<Button disabled={!!pending || !!storageError} onclick={start}
          >Attester une qualification</Button
        >{/if}{/snippet}</PageHeader
  >
  <p class="rounded-lg border border-edge bg-surface p-4 text-sm text-ink-muted">
    Une attestation est conservée sans réécriture. Pour renouveler, créez une nouvelle période; pour
    retirer une autorisation, révoquez avec un motif. Les dates sont inclusives. Ce registre n’est
    ni une signature réglementaire ni une réservation d’opérateur.
  </p>
  {#if storageError}<p role="alert" class="text-danger">{storageError}</p>{/if}
  {#if pending}<section class="rounded-lg border border-warn p-4 space-y-2">
      <p>
        Une attestation attend confirmation. Reprendre conserve la même clé, même après
        actualisation.
      </p>
      <Button
        disabled={busy || !manage || !!storageError}
        onclick={() => {
          if (pending) void send(pending);
        }}>Reprendre l’attestation conservée</Button
      >{#if !open && formError}<p role="alert" class="text-danger">{formError}</p>{/if}
    </section>{/if}
  <div class="flex flex-wrap items-end gap-3">
    <div class="min-w-64">
      <Input
        aria-label="Rechercher une habilitation"
        placeholder="Employé, matricule ou compétence…"
        bind:value={search}
        oninput={() => {
          current = 1;
        }}
      />
    </div>
    <Field label="Validité à la date"
      ><Input type="date" min="1900-01-01" max="2199-12-31" required bind:value={day} /></Field
    ><a class="text-accent underline text-sm" href="/hr/skills">Gérer le référentiel</a>
  </div>
  {#if error}<p role="alert" class="text-danger">{error}</p>{/if}
  <div class="overflow-x-auto rounded-lg border border-edge bg-surface">
    {#if loading}<Skeleton rows={5} />{:else if !rows.length}<EmptyState
        title="Aucune qualification enregistrée"
        message="Vérifiez la compétence et son justificatif avant de l’attester pour un employé."
      />{:else}<table class="w-full text-left text-sm">
        <thead class="bg-surface-muted"
          ><tr
            ><th class="p-3">Employé / compétence</th><th class="p-3">Validité</th><th class="p-3"
              >Vérification / historique</th
            ><th class="p-3">Action</th></tr
          ></thead
        ><tbody
          >{#each rows as row}{@const state = stateAtDate(row)}<tr
              class="border-t border-edge align-top"
              ><td class="p-3"
                ><p class="font-medium">{row.employee.firstName} {row.employee.lastName}</p>
                <p>{row.skill.code} · {row.skill.name}</p>
                {#if !row.employee.active || !row.skill.active}<p class="text-warn text-xs">
                    Employé ou référence inactive : non utilisable en Fabrication.
                  </p>{/if}</td
              ><td class="p-3"
                ><p>
                  {row.validFrom.slice(0, 10)} → {row.expiresOn?.slice(0, 10) ??
                    'Sans fin déclarée'}
                </p>
                {#if state}<Badge
                    tone={state === 'VALID' ? 'ok' : state === 'REVOKED' ? 'danger' : 'warn'}
                    >{QUALIFICATION_LABELS[state]}</Badge
                  >{/if}</td
              ><td class="max-w-md p-3"
                ><p class="whitespace-pre-wrap break-words">{row.reference}</p>
                <p class="text-xs text-ink-muted">
                  Vérifié par {row.createdBy.firstName}
                  {row.createdBy.lastName}
                </p>
                {#if row.revokeReason}<p class="mt-2 whitespace-pre-wrap">
                    Révoquée : {row.revokeReason}
                  </p>
                  <p class="text-xs text-ink-muted">
                    Par {row.revokedBy?.firstName}
                    {row.revokedBy?.lastName}
                  </p>{/if}</td
              ><td class="p-3"
                >{#if manage && row.status === 'ACTIVE'}<Button
                    variant="ghost"
                    onclick={() => {
                      revoking = row;
                      reason = '';
                      formError = '';
                      uncertain = false;
                    }}>Révoquer</Button
                  >{/if}</td
              ></tr
            >{/each}</tbody
        >
      </table>{/if}
  </div>
  <div class="flex items-center justify-end gap-3">
    <Button
      variant="ghost"
      disabled={loading || current === 1}
      onclick={() => {
        current--;
      }}>Précédent</Button
    ><span>{current} / {Math.max(1, Math.ceil(total / 20))}</span><Button
      variant="ghost"
      disabled={loading || current * 20 >= total}
      onclick={() => {
        current++;
      }}>Suivant</Button
    >
  </div>
</div>
<Drawer bind:open title="Attester une qualification" width="lg" dismissible={!busy}>
  <form
    class="space-y-4"
    onsubmit={(e) => {
      e.preventDefault();
      void issue();
    }}
  >
    {#if formError}<p role="alert" class="text-danger">{formError}</p>{/if}
    <fieldset class="space-y-4" disabled={busy || !!pending || !manage}>
      <EntityPicker
        endpoint="/hr/employees"
        label="Employé à qualifier"
        labelKey="firstName lastName"
        detailKey="code"
        bind:value={employeeId}
      />
      <EntityPicker
        endpoint="/hr/skills"
        label="Compétence à attester"
        detailKey="code"
        bind:value={skillId}
      />
      <div class="grid grid-cols-2 gap-3">
        <Field label="Valide à partir du"
          ><Input type="date" required bind:value={validFrom} /></Field
        ><Field label="Valide jusqu’au (inclus)"
          ><Input type="date" min={validFrom} bind:value={expiresOn} /></Field
        >
      </div>
      <Field label="Référence vérifiée"
        ><Textarea required maxlength={500} bind:value={reference} /></Field
      >
      <p class="text-xs text-ink-muted">
        Indiquez la référence du certificat ou de l’évaluation, sans donnée médicale. Pas
        d’auto-attestation; une autre personne autorisée doit vérifier votre propre qualification.
      </p>
      <label class="flex items-start gap-2 text-sm"
        ><input class="mt-1" type="checkbox" required bind:checked={verified} />J’ai vérifié cette
        qualification et ses dates auprès de la source.</label
      >
    </fieldset>
    <div class="flex justify-end gap-2">
      <Button
        variant="ghost"
        disabled={busy}
        onclick={() => {
          open = false;
        }}>Fermer</Button
      ><Button
        type="submit"
        loading={busy}
        disabled={!verified || !employeeId || !skillId || !!pending || !!storageError}
        >Confirmer l’attestation</Button
      >
    </div>
  </form>
</Drawer>
<Modal
  open={!!revoking}
  title="Révoquer la qualification"
  dismissible={!busy}
  onclose={() => {
    revoking = null;
    refresh++;
  }}
>
  <div class="space-y-4">
    <p class="text-sm">
      La révocation est définitive et prend effet dès maintenant. L’ancienne attestation reste
      visible; un renouvellement nécessite une nouvelle attestation.
    </p>
    <Field label="Motif de révocation"
      ><Textarea bind:value={reason} maxlength={1000} required /></Field
    >{#if formError}<p role="alert" class="text-danger">{formError}</p>{/if}{#if uncertain}<p
        class="text-warn"
      >
        Réponse incertaine : fermez et vérifiez le registre avant toute autre action.
      </p>{/if}
    <div class="flex justify-end gap-2">
      <Button
        variant="ghost"
        disabled={busy}
        onclick={() => {
          revoking = null;
          refresh++;
        }}>Retour</Button
      ><Button loading={busy} disabled={!reason.trim() || uncertain} onclick={revoke}
        >Confirmer la révocation</Button
      >
    </div>
  </div>
</Modal>
