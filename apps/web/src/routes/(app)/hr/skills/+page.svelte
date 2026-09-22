<script lang="ts">
  import { api, ApiError } from '$lib/api/client';
  import { auth } from '$lib/stores/auth';
  import {
    PageHeader,
    Button,
    Drawer,
    Field,
    Input,
    Select,
    Skeleton,
    EmptyState,
    Badge,
  } from '$lib/components/ui';
  import type { Paginated } from '@pulsar/shared';
  type Skill = {
    id: string;
    code: string;
    name: string;
    kind: string;
    active: boolean;
    updatedAt: string;
  };
  const manage = $derived($auth?.user.permissions.includes('hr.manage'));
  let rows = $state<Skill[]>([]),
    search = $state(''),
    current = $state(1),
    total = $state(0),
    loading = $state(true),
    error = $state(''),
    refresh = $state(0);
  let open = $state(false),
    editing = $state<Skill | null>(null),
    code = $state(''),
    name = $state(''),
    kind = $state('COMPETENCE'),
    active = $state(true),
    busy = $state(false),
    uncertain = $state(false),
    formError = $state('');
  $effect(() => {
    const query = { search, page: current, pageSize: 20 },
      v = refresh;
    let cancelled = false;
    loading = true;
    error = '';
    void api<Paginated<Skill>>('/hr/skills', { query })
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
  function show(row: Skill | null) {
    editing = row;
    code = row?.code ?? '';
    name = row?.name ?? '';
    kind = row?.kind ?? 'COMPETENCE';
    active = row?.active ?? true;
    formError = '';
    uncertain = false;
    open = true;
  }
  async function save() {
    if (busy || uncertain) return;
    busy = true;
    formError = '';
    try {
      await api('/hr/skills' + (editing ? '/' + editing.id : ''), {
        method: editing ? 'PATCH' : 'POST',
        body: editing
          ? { name, active, expectedUpdatedAt: editing.updatedAt }
          : { code, name, kind },
      });
      open = false;
      refresh++;
    } catch (e) {
      formError = e instanceof Error ? e.message : 'Enregistrement impossible.';
      uncertain = !(e instanceof ApiError) || e.statusCode >= 500;
    } finally {
      busy = false;
    }
  }
</script>

<svelte:head><title>Compétences | Pulsar</title></svelte:head>
<div class="mx-auto max-w-6xl space-y-4">
  <PageHeader
    title="Compétences"
    subtitle="Le référentiel des savoir-faire et autorisations attendus."
    count={total}
    >{#snippet actions()}{#if manage}<Button onclick={() => show(null)}>Nouvelle compétence</Button
        >{/if}{/snippet}</PageHeader
  >
  <div class="rounded-lg border border-edge bg-surface p-4 text-sm text-ink-muted">
    Une compétence décrit un savoir-faire; une habilitation décrit une autorisation. L’attestation
    d’un employé se fait dans <a class="text-accent underline" href="/hr/qualifications"
      >Habilitations</a
    >. Désactiver une référence conserve l’historique mais empêche sa couverture en Fabrication.
  </div>
  <Input
    aria-label="Rechercher une compétence"
    placeholder="Code ou nom…"
    bind:value={search}
    oninput={() => {
      current = 1;
    }}
  />
  {#if error}<p role="alert" class="text-danger">{error}</p>{/if}
  <div class="overflow-x-auto rounded-lg border border-edge bg-surface">
    {#if loading}<Skeleton rows={4} />{:else if !rows.length}<EmptyState
        title="Aucune compétence"
        message="Définissez les savoir-faire utiles à vos équipes, par exemple conduite de chariot ou contrôle dimensionnel."
      />{:else}
      <table class="w-full text-left text-sm">
        <thead class="bg-surface-muted"
          ><tr
            ><th class="p-3">Code / nom</th><th class="p-3">Nature</th><th class="p-3">État</th></tr
          ></thead
        ><tbody
          >{#each rows as row}<tr class="border-t border-edge"
              ><td class="p-3"
                ><button class="text-accent underline" onclick={() => show(row)}
                  >{row.code} · {row.name}</button
                ></td
              ><td class="p-3">{row.kind === 'AUTHORIZATION' ? 'Habilitation' : 'Compétence'}</td
              ><td class="p-3"
                ><Badge tone={row.active ? 'ok' : 'neutral'}
                  >{row.active ? 'Active' : 'Inactive'}</Badge
                ></td
              ></tr
            >{/each}</tbody
        >
      </table>
    {/if}
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
<Drawer
  bind:open
  title={editing ? 'Modifier la compétence' : 'Nouvelle compétence'}
  dismissible={!busy}
>
  <form
    class="space-y-4"
    onsubmit={(e) => {
      e.preventDefault();
      void save();
    }}
  >
    {#if formError}<p role="alert" class="text-danger">{formError}</p>{/if}
    {#if uncertain}<p class="text-warn text-sm">
        Réponse incertaine : fermez et vérifiez le référentiel avant une nouvelle action.
      </p>{/if}
    <fieldset class="space-y-4" disabled={busy || !manage || uncertain}>
      <Field label="Code"
        ><Input
          bind:value={code}
          required
          maxlength={40}
          pattern="[A-Z0-9][A-Z0-9_-]*"
          disabled={!!editing}
        /></Field
      >
      <Field label="Nom de la compétence"
        ><Input bind:value={name} required maxlength={150} /></Field
      >
      <Field label="Nature"
        ><Select aria-label="Nature" bind:value={kind} disabled={!!editing}
          ><option value="COMPETENCE">Compétence</option><option value="AUTHORIZATION"
            >Habilitation</option
          ></Select
        ></Field
      >
      {#if editing}<label class="flex gap-2 text-sm"
          ><input type="checkbox" bind:checked={active} /> Référence active</label
        >{/if}
    </fieldset>
    <div class="flex justify-end gap-2">
      <Button
        variant="ghost"
        disabled={busy}
        onclick={() => {
          open = false;
          refresh++;
        }}>Fermer</Button
      >{#if manage}<Button type="submit" loading={busy} disabled={uncertain}
          >Enregistrer la compétence</Button
        >{/if}
    </div>
  </form>
</Drawer>
