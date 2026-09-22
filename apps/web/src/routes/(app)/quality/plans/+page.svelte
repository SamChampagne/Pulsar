<script lang="ts">
  import { beforeNavigate } from '$app/navigation';
  import { api, ApiError } from '$lib/api/client';
  import { auth } from '$lib/stores/auth';
  import {
    PageHeader,
    Button,
    Drawer,
    Field,
    Input,
    Textarea,
    Select,
    EmptyState,
  } from '$lib/components/ui';
  import { validateQualityCriteria, type Paginated } from '@pulsar/shared';
  import type { Plan } from '$lib/quality/types';
  type Draft = {
    key: string;
    label: string;
    kind: 'CHECK' | 'NUMBER';
    unit: string;
    min: string | number | null;
    max: string | number | null;
  };
  const manage = $derived($auth?.user.permissions.includes('quality.manage'));
  let rows = $state<Plan[]>([]),
    total = $state(0),
    current = $state(1),
    search = $state(''),
    active = $state(''),
    loading = $state(true),
    error = $state(''),
    refresh = $state(0);
  let open = $state(false),
    editing = $state<Plan | null>(null),
    busy = $state(false),
    uncertain = $state(false),
    formError = $state(''),
    code = $state(''),
    name = $state(''),
    instructions = $state(''),
    enabled = $state(true),
    criteria = $state<Draft[]>([]),
    baseline = $state('');
  const dirty = $derived(
    JSON.stringify({ code, name, instructions, enabled, criteria }) !== baseline,
  );
  $effect(() => {
    const q = { search, active: active || undefined, page: current, pageSize: 20 },
      v = refresh;
    let cancelled = false;
    loading = true;
    error = '';
    void api<Paginated<Plan>>('/quality/plans', { query: q })
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
  beforeNavigate((n) => {
    if (open) {
      n.cancel();
      formError = 'Fermez le plan avant de quitter.';
    }
  });
  function show(p: Plan | null) {
    editing = p;
    code = p?.code ?? '';
    name = p?.name ?? '';
    instructions = p?.instructions ?? '';
    enabled = p?.active ?? true;
    criteria = p?.criteria.map((c) => ({
      ...c,
      unit: c.unit ?? '',
      min: c.min ?? '',
      max: c.max ?? '',
    })) ?? [{ key: 'aspect', label: 'État visuel', kind: 'CHECK', unit: '', min: '', max: '' }];
    baseline = JSON.stringify({ code, name, instructions, enabled, criteria });
    formError = '';
    uncertain = false;
    open = true;
  }
  function close() {
    if (busy) return false;
    if (dirty) {
      formError = 'Enregistrez les changements ou choisissez Abandonner et fermer.';
      return false;
    }
    return true;
  }
  async function save() {
    if (busy || uncertain) return;
    formError = '';
    let body;
    try {
      body = {
        name,
        instructions,
        active: enabled,
        criteria: validateQualityCriteria(
          criteria.map((c) => ({
            key: c.key,
            label: c.label,
            kind: c.kind,
            ...(c.kind === 'NUMBER'
              ? {
                  unit: c.unit,
                  min: c.min === '' || c.min === null ? null : Number(c.min),
                  max: c.max === '' || c.max === null ? null : Number(c.max),
                }
              : {}),
          })),
        ),
      };
    } catch (e) {
      formError = (e as Error).message;
      return;
    }
    busy = true;
    try {
      await api(editing ? `/quality/plans/${editing.id}` : '/quality/plans', {
        method: editing ? 'PATCH' : 'POST',
        body: { ...body, ...(editing ? { expectedUpdatedAt: editing.updatedAt } : { code }) },
      });
      open = false;
      refresh++;
    } catch (e) {
      formError = (e as Error).message;
      uncertain = !(e instanceof ApiError) || e.statusCode >= 500 || e.statusCode === 409;
    } finally {
      busy = false;
    }
  }
</script>

<PageHeader
  title="Plans de contrôle"
  subtitle="Définir des critères réutilisables. Chaque contrôle conserve sa propre version du plan."
  >{#snippet actions()}<Button variant="secondary" href="/quality">Contrôles</Button
    >{#if manage}<Button onclick={() => show(null)}>Nouveau plan</Button>{/if}{/snippet}</PageHeader
>
<div class="mb-4 flex flex-wrap gap-3">
  <Input
    aria-label="Rechercher les plans"
    bind:value={search}
    oninput={() => (current = 1)}
  /><Select aria-label="Activation des plans" bind:value={active} onchange={() => (current = 1)}
    ><option value="">Tous les plans</option><option value="true">Actifs</option><option
      value="false">Inactifs</option
    ></Select
  >
</div>
{#if error}<p role="alert" class="text-danger">{error}</p>
  <Button
    variant="secondary"
    onclick={() => {
      refresh++;
    }}>Réessayer</Button
  >{/if}
{#if loading}<p class="p-6 text-ink-muted">
    Chargement des plans…
  </p>{:else if !rows.length}<EmptyState
    title="Aucun plan"
    message="Créez une liste de vérifications et de mesures pour votre premier contrôle."
  />{:else}<div class="overflow-x-auto rounded-lg border border-edge">
    <table class="w-full text-left text-sm">
      <thead class="bg-surface-muted text-xs text-ink-muted"
        ><tr
          ><th class="p-3">Plan</th><th class="p-3">Critères</th><th class="p-3">Version</th><th
            class="p-3">Utilisation</th
          ><th class="p-3">Fiche</th></tr
        ></thead
      ><tbody
        >{#each rows as p (p.id)}<tr class="border-t border-edge"
            ><td class="p-3"
              ><strong>{p.name}</strong>
              <p class="text-xs text-ink-muted">{p.code}</p></td
            ><td class="p-3">{p.criteria.length}</td><td class="p-3">v{p.revision}</td><td
              class="p-3">{p.active ? 'Actif' : 'Inactif'}</td
            ><td class="p-3"
              ><Button variant="secondary" onclick={() => show(p)}
                >{manage ? 'Modifier' : 'Consulter'} {p.name}</Button
              ></td
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
  ><span class="text-sm text-ink-muted">{total} plans · page {current}</span><Button
    variant="secondary"
    disabled={loading || current * 20 >= total}
    onclick={() => {
      current++;
    }}>Suivant</Button
  >
</div>
<Drawer
  bind:open
  title={editing ? 'Plan de contrôle' : 'Nouveau plan'}
  width="xl"
  dismissible={!busy}
  onbeforeclose={close}
>
  <form
    class="space-y-4"
    onsubmit={(e) => {
      e.preventDefault();
      void save();
    }}
  >
    <fieldset disabled={!manage || busy || uncertain} class="space-y-4">
      <div class="grid gap-4 sm:grid-cols-2">
        <Field label="Code"
          ><Input
            aria-label="Code du plan"
            bind:value={code}
            disabled={!!editing}
            maxlength={40}
            pattern={'[A-Z0-9][A-Z0-9_-]{0,39}'}
            required
          /></Field
        ><Field label="Nom"
          ><Input aria-label="Nom du plan" bind:value={name} maxlength={200} required /></Field
        >
      </div>
      <Field label="Instructions opérateur"
        ><Textarea bind:value={instructions} maxlength={4000} /></Field
      >
      <label class="flex items-center gap-2 text-sm"
        ><input type="checkbox" bind:checked={enabled} />Plan actif pour les nouveaux contrôles</label
      >
      <div class="flex items-center justify-between">
        <h2 class="font-semibold">Critères ({criteria.length}/30)</h2>
        <Button
          variant="secondary"
          disabled={criteria.length >= 30 || !manage}
          onclick={() => {
            let n = criteria.length + 1;
            while (criteria.some((c) => c.key === `critere_${n}`)) n++;
            criteria.push({
              key: `critere_${n}`,
              label: '',
              kind: 'CHECK',
              unit: '',
              min: '',
              max: '',
            });
          }}>Ajouter un critère</Button
        >
      </div>
      {#each criteria as c, i}<section
          class="space-y-3 rounded-lg border border-edge bg-surface-muted p-4"
          aria-label={`Critère ${i + 1}`}
        >
          <div class="flex items-center justify-between">
            <h3 class="text-sm font-semibold">Critère {i + 1}</h3>
            <Button
              variant="ghost"
              disabled={criteria.length === 1 || !manage}
              onclick={() => {
                criteria = criteria.filter((_, j) => j !== i);
              }}>Retirer le critère {i + 1}</Button
            >
          </div>
          <div class="grid gap-3 sm:grid-cols-2">
            <Field label="Clé stable"
              ><Input
                aria-label={`Clé ${i + 1}`}
                bind:value={c.key}
                maxlength={40}
                pattern={'[a-z][a-z0-9_]{0,39}'}
                required
              /></Field
            ><Field label="Libellé"
              ><Input
                aria-label={`Libellé ${i + 1}`}
                bind:value={c.label}
                maxlength={200}
                required
              /></Field
            >
          </div>
          <Select aria-label={`Type ${i + 1}`} bind:value={c.kind}
            ><option value="CHECK">Conforme / non conforme</option><option value="NUMBER"
              >Mesure numérique</option
            ></Select
          >{#if c.kind === 'NUMBER'}<div class="grid grid-cols-3 gap-3">
              <Field label="Unité"
                ><Input
                  aria-label={`Unité ${i + 1}`}
                  bind:value={c.unit}
                  maxlength={30}
                  required
                /></Field
              ><Field label="Minimum inclus"
                ><Input
                  aria-label={`Minimum ${i + 1}`}
                  type="number"
                  min={-1e9}
                  max={1e9}
                  bind:value={c.min}
                  required
                /></Field
              ><Field label="Maximum inclus"
                ><Input
                  aria-label={`Maximum ${i + 1}`}
                  type="number"
                  min={-1e9}
                  max={1e9}
                  bind:value={c.max}
                  required
                /></Field
              >
            </div>{/if}
        </section>{/each}
    </fieldset>
    {#if formError}<p role="alert" class="text-sm text-danger">{formError}</p>{/if}
    {#if uncertain}<p class="text-sm text-ink-muted">
        Fermez puis recherchez ce code pour vérifier la version enregistrée avant de poursuivre.
      </p>{/if}
    <div class="flex gap-2">
      {#if manage}<Button type="submit" loading={busy} disabled={uncertain}
          >Enregistrer le plan</Button
        >{/if}<Button
        variant="secondary"
        disabled={busy}
        onclick={() => {
          open = false;
          refresh++;
        }}
      >
        {dirty ? 'Abandonner et fermer' : 'Fermer'}</Button
      >
    </div>
  </form>
</Drawer>
