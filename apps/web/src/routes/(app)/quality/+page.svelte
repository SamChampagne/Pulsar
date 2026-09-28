<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import { beforeNavigate, goto } from '$app/navigation';
  import { api, ApiError } from '$lib/api/client';
  import { auth } from '$lib/stores/auth';
  import {
    PageHeader,
    Button,
    Drawer,
    Field,
    Input,
    Select,
    EntityPicker,
    EmptyState,
  } from '$lib/components/ui';
  import { QUALITY_INSPECTION_LABELS, type Paginated } from '@pulsar/shared';
  import { readInspectionIntent, type Inspection, type InspectionIntent } from '$lib/quality/types';
  const manage = $derived($auth?.user.permissions.includes('quality.manage'));
  const storageKey = $derived(`pulsar.quality.create.v1:${$auth?.tenant.id}:${$auth?.user.id}`);
  const sources = $derived([
    { key: 'MANUAL', label: 'Contrôle indépendant' },
    ...[
      { key: 'RECEIPT', label: 'Réception WMS validée', module: 'wms', permission: 'wms.read' },
      { key: 'LOT', label: 'Lot de stock WMS', module: 'wms', permission: 'wms.read' },
      {
        key: 'MANUFACTURING',
        label: 'Ordre de fabrication',
        module: 'manufacturing',
        permission: 'manufacturing.read',
      },
      { key: 'SUPPORT', label: 'Demande SAV', module: 'support', permission: 'support.read' },
    ].filter(
      (s) =>
        $auth?.tenant.enabledModules.some((m) => m === s.module) &&
        ($auth.user.permissions as string[]).includes(s.permission),
    ),
  ]);
  let rows = $state<Inspection[]>([]),
    total = $state(0),
    current = $state(1),
    search = $state(''),
    status = $state(''),
    loading = $state(true),
    error = $state(''),
    refresh = $state(0);
  let summary = $state<{
    draft: number;
    inProgress: number;
    failed: number;
    openNonconformities: number;
  } | null>(null);
  let open = $state(false),
    busy = $state(false),
    formError = $state(''),
    pending = $state<InspectionIntent | null>(null),
    storageError = $state('');
  let planId = $state(''),
    title = $state(''),
    sourceKind = $state('MANUAL'),
    sourceId = $state(''),
    sourceLabel = $state('');
  $effect(() => {
    if (!sourceId) sourceLabel = '';
  });
  $effect(() => {
    const q = { search, status: status || undefined, page: current, pageSize: 20 },
      v = refresh;
    let cancelled = false;
    loading = true;
    error = '';
    void Promise.all([
      api<Paginated<Inspection>>('/quality/inspections', { query: q }),
      api<typeof summary>('/quality/summary'),
    ])
      .then(([r, s]) => {
        if (!cancelled) {
          rows = r.items;
          total = r.total;
          summary = s;
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
      formError = 'Fermez le formulaire avant de quitter.';
    }
  });
  onMount(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) pending = readInspectionIntent(raw);
    } catch (e) {
      storageError = (e as Error).message;
    }
    const lotId = page.url.searchParams.get('lotId'),
      itemId = page.url.searchParams.get('itemId');
    if (
      lotId &&
      itemId &&
      manage &&
      !pending &&
      !storageError &&
      sources.some((s) => s.key === 'LOT')
    ) {
      void api<{ id: string; code: string }>(
        `/wms/items/${encodeURIComponent(itemId)}/lots/${encodeURIComponent(lotId)}`,
      )
        .then((lot) => {
          start();
          sourceKind = 'LOT';
          sourceId = lot.id;
          sourceLabel = lot.code;
          title = `Contrôle du lot ${lot.code}`;
        })
        .catch((e) => {
          error = e.message;
        });
    }
  });
  function start() {
    formError = '';
    planId = '';
    title = '';
    sourceKind = 'MANUAL';
    sourceId = '';
    sourceLabel = '';
    open = true;
  }
  function clearPending() {
    try {
      localStorage.removeItem(storageKey);
      pending = null;
      storageError = '';
    } catch (e) {
      storageError = (e as Error).message;
    }
  }
  async function create() {
    if (busy) return;
    busy = true;
    formError = '';
    try {
      const body = pending ?? {
        planId,
        title: title.trim(),
        sourceKind,
        ...(sourceKind !== 'MANUAL' ? { sourceId } : {}),
        operationKey: crypto.randomUUID(),
      };
      localStorage.setItem(storageKey, JSON.stringify(body));
      pending = body;
      const result = await api<Inspection>('/quality/inspections', { method: 'POST', body });
      localStorage.removeItem(storageKey);
      pending = null;
      open = false;
      await goto(`/quality/inspections/${result.id}`);
    } catch (e) {
      formError = (e as Error).message;
      if (e instanceof ApiError && [400, 422].includes(e.statusCode)) {
        clearPending();
      } else formError += ' La demande est conservée : reprenez exactement ce contrôle.';
    } finally {
      busy = false;
    }
  }
</script>

<PageHeader
  title="Qualité"
  subtitle="Préparer les contrôles, mesurer les écarts et suivre les actions correctives."
>
  {#snippet actions()}<Button variant="secondary" href="/quality/plans">Plans de contrôle</Button
    ><Button variant="secondary" href="/quality/nonconformities">Non-conformités</Button
    >{#if manage}<Button onclick={start} disabled={!!pending || !!storageError}
        >Nouveau contrôle</Button
      >{/if}{/snippet}
</PageHeader>
{#if summary}<div
    class="mb-5 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-edge bg-edge md:grid-cols-4"
  >
    {#each [[summary.draft, 'À préparer'], [summary.inProgress, 'En contrôle'], [summary.failed, 'Contrôles échoués'], [summary.openNonconformities, 'Actions à clôturer']] as stat}<div
        class="bg-surface p-4"
      >
        <div class="text-2xl font-semibold tabular-nums">{stat[0]}</div>
        <div class="mt-1 text-xs text-ink-muted">{stat[1]}</div>
      </div>{/each}
  </div>{/if}
<p class="mb-4 text-sm text-ink-muted">
  Les contrôles documentent une décision. Ils ne bloquent ni ne libèrent du stock.
</p>
{#if pending || storageError}<div
    class="mb-4 space-y-2 rounded-lg border border-edge bg-surface-muted p-4"
  >
    <strong>Une création reste à vérifier</strong>
    <p class="text-sm">{pending?.title ?? storageError}</p>
    {#if manage && pending}<Button
        onclick={() => {
          open = true;
          formError = '';
        }}>Reprendre le contrôle conservé</Button
      >{/if}
    <p class="text-xs text-ink-muted">
      Avant de retirer une demande conservée, recherchez son titre dans les contrôles pour éviter un
      doublon.
    </p>
    <Button variant="secondary" disabled={busy} onclick={clearPending}
      >Retirer après vérification</Button
    >
  </div>{/if}
<div class="mb-4 flex flex-wrap gap-3">
  <div class="min-w-48 flex-1">
    <Input
      aria-label="Rechercher les contrôles"
      bind:value={search}
      oninput={() => (current = 1)}
    />
  </div>
  <Select aria-label="État des contrôles" bind:value={status} onchange={() => (current = 1)}
    ><option value="">Tous les états</option
    >{#each Object.entries(QUALITY_INSPECTION_LABELS) as [key, label]}<option value={key}
        >{label}</option
      >{/each}</Select
  >
</div>
{#if error}<p role="alert" class="mb-3 text-danger">{error}</p>
  <Button
    variant="secondary"
    onclick={() => {
      refresh++;
    }}>Réessayer la lecture</Button
  >{/if}
{#if loading}<p class="p-6 text-sm text-ink-muted">
    Chargement des contrôles…
  </p>{:else if !rows.length}<EmptyState
    title="Aucun contrôle dans cette vue"
    message="Préparez un plan, puis créez un contrôle indépendant ou lié à un dossier métier."
  />{:else}<div class="overflow-x-auto rounded-lg border border-edge">
    <table class="w-full text-left text-sm">
      <thead class="bg-surface-muted text-xs text-ink-muted"
        ><tr
          ><th class="p-3">Contrôle</th><th class="p-3">Plan figé</th><th class="p-3">État</th><th
            class="p-3">Résultat</th
          ></tr
        ></thead
      ><tbody
        >{#each rows as r (r.id)}<tr class="border-t border-edge hover:bg-surface-muted"
            ><td class="p-3"
              ><a
                class="font-medium text-accent hover:underline"
                href={`/quality/inspections/${r.id}`}>{r.number} · {r.title}</a
              ></td
            ><td class="p-3"
              >{r.planName}<span class="ml-2 text-xs text-ink-muted">v{r.planRevision}</span></td
            ><td class="p-3">{QUALITY_INSPECTION_LABELS[r.status]}</td><td class="p-3"
              >{r.outcome === 'FAIL'
                ? 'Non conforme'
                : r.outcome === 'PASS'
                  ? 'Conforme'
                  : 'Non conclu'}</td
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
  ><span class="text-sm text-ink-muted">{total} contrôles · page {current}</span><Button
    variant="secondary"
    disabled={loading || current * 20 >= total}
    onclick={() => {
      current++;
    }}>Suivant</Button
  >
</div>
<Drawer
  bind:open
  title={pending ? 'Reprendre le contrôle' : 'Nouveau contrôle'}
  dismissible={!busy}
>
  <form
    class="space-y-4"
    onsubmit={(e) => {
      e.preventDefault();
      void create();
    }}
  >
    {#if pending}<p class="rounded bg-surface-muted p-3 text-sm">
        {pending.title} — la même demande sera renvoyée, sans créer de doublon si le serveur l’a déjà
        reçue.
      </p>{:else}
      <Field label="Plan actif"
        ><EntityPicker
          endpoint="/quality/plans"
          label="Plan actif"
          filters={{ active: 'true' }}
          bind:value={planId}
        /></Field
      >
      <Field label="Objet du contrôle"
        ><Input aria-label="Objet du contrôle" bind:value={title} maxlength={200} required /></Field
      >
      <Field label="Dossier source"
        ><Select
          aria-label="Type de dossier source"
          bind:value={sourceKind}
          onchange={() => {
            sourceId = '';
            sourceLabel = '';
          }}
          >{#each sources as s}<option value={s.key}>{s.label}</option>{/each}</Select
        ></Field
      >
      {#if sourceKind !== 'MANUAL'}<EntityPicker
          endpoint="/quality/references"
          label="Dossier source"
          filters={{ kind: sourceKind }}
          bind:value={sourceId}
          selectedLabel={sourceLabel}
          onselect={(r) => {
            sourceLabel = String(r.name ?? '');
          }}
        />{/if}
      <p class="text-sm text-ink-muted">
        Les critères du plan sont copiés à la création. Le dossier source ne sera pas modifié.
      </p>
    {/if}
    {#if formError}<p role="alert" class="text-sm text-danger">{formError}</p>{/if}
    <div class="flex gap-2">
      <Button
        type="submit"
        loading={busy}
        disabled={!manage ||
          (!pending && (!planId || !title.trim() || (sourceKind !== 'MANUAL' && !sourceId)))}
      >
        {pending ? 'Reprendre cette demande' : 'Créer le contrôle'}</Button
      ><Button
        variant="secondary"
        disabled={busy}
        onclick={() => {
          open = false;
        }}>Fermer</Button
      >
    </div>
  </form>
</Drawer>
