<script lang="ts">
  import { onMount } from 'svelte';
  import { CURRENCIES, validateAccountingTarget, type AccountingTarget } from '@pulsar/shared';
  import { api, ApiError } from '$lib/api/client';
  import { auth } from '$lib/stores/auth';
  import { confirmAction } from '$lib/stores/confirmation';
  import { toast } from '$lib/stores/toast';
  import {
    readPlanningIntent,
    rememberPlanningIntent,
    type PlanningIntent,
  } from '$lib/billing/planning-intent';
  import {
    PageHeader,
    Card,
    Input,
    Select,
    Button,
    ErrorNotice,
    Skeleton,
    Badge,
  } from '$lib/components/ui';
  interface Revision {
    version: number;
    target: AccountingTarget;
    targetCurrency: string;
    externalSystem: string;
    reason: string;
    createdAt: string;
  }
  let current = $state<Revision | null>(null),
    history = $state<Revision[]>([]),
    loading = $state(true),
    saving = $state(false),
    error = $state(''),
    blocked = $state(false);
  let target = $state(''),
    currency = $state(''),
    external = $state(''),
    reason = $state(''),
    pending = $state<PlanningIntent | null>(null);
  const canManage = $derived(!!$auth?.user.permissions.includes('billing.accounting.configure'));
  const key = $derived(`pulsar.accounting-profile:${$auth?.tenant.id}:${$auth?.user.id}`);
  function restore() {
    try {
      pending = readPlanningIntent(key);
      if (pending) {
        target = String(pending.body.target);
        currency = String(pending.body.targetCurrency);
        external = String(pending.body.externalSystem);
        reason = String(pending.body.reason);
      }
    } catch (e) {
      blocked = true;
      error = (e as Error).message;
    }
  }
  async function load() {
    loading = true;
    error = '';
    current = null;
    history = [];
    try {
      const r = await api<{ current: Revision | null; history: Revision[] }>(
        '/billing/accounting-profile',
      );
      current = r.current;
      history = r.history;
      if (!pending) {
        target = current?.target ?? '';
        currency = current?.targetCurrency ?? '';
        external = current?.externalSystem ?? '';
        reason = '';
      }
    } catch (e) {
      error = (e as Error).message;
    } finally {
      loading = false;
    }
  }
  onMount(() => {
    restore();
    if (!blocked) void load();
  });
  async function save() {
    error = '';
    const wasPending = !!pending;
    try {
      if (!pending) {
        validateAccountingTarget(target, currency, target === 'NATIVE' ? '' : external);
        if (reason.trim().length < 3) throw Error('Expliquez le changement.');
        if (
          !(await confirmAction(
            'Enregistrer cette cible comptable ? Aucune conversion, connexion externe ou comptabilité officielle ne sera activée.',
          ))
        )
          return;
        const p: PlanningIntent = {
          path: '/billing/accounting-profile',
          method: 'PUT',
          body: {
            operationKey: crypto.randomUUID(),
            expectedVersion: current?.version ?? 0,
            target,
            targetCurrency: currency,
            externalSystem: target === 'NATIVE' ? '' : external,
            reason,
          },
        };
        rememberPlanningIntent(key, p);
        pending = p;
      }
      saving = true;
      await api(pending.path, { method: pending.method, body: pending.body });
      localStorage.removeItem(key);
      pending = null;
      toast.success('Cible comptable enregistrée');
      await load();
    } catch (e) {
      if (!wasPending && e instanceof ApiError && [400, 404, 409, 422].includes(e.statusCode)) {
        localStorage.removeItem(key);
        pending = null;
      }
      error = (e as Error).message;
    } finally {
      saving = false;
    }
  }
</script>

<svelte:head><title>Profil comptable · Pulsar</title></svelte:head>
<PageHeader
  title="Profil comptable"
  subtitle="Définir le rôle de Pulsar pour cette entreprise, sans réécrire son historique."
/>
<div class="mb-4 flex flex-wrap gap-2">
  <Button href="/finance" variant="ghost">Retour à Finance</Button><Button
    href="/billing/budgets"
    variant="secondary">Budgets</Button
  ><Button variant="ghost" disabled={loading || !!pending || blocked} onclick={load}
    >Actualiser</Button
  >
</div>
<div class="max-w-4xl space-y-5">
  <section
    class="rounded-lg border border-edge bg-surface-muted p-4 text-sm"
    aria-label="Limites du profil"
  >
    <Badge tone="warn">Cible de préparation</Badge>
    <p class="mt-2">
      Le grand livre reste une vue de contrôle. Choisir Pulsar ne garantit pas encore une
      comptabilité officielle complète. Choisir un logiciel externe ne le connecte pas.
    </p>
    <p class="mt-2 text-ink-muted">
      Aucune conversion, clôture ou synchronisation automatique. Les budgets gardent leur propre
      devise et période, même si ce profil change.
    </p>
  </section>
  <ErrorNotice message={error} />
  {#if pending}<p role="status" class="text-sm text-warn">
      Une demande attend confirmation. Les champs sont verrouillés; reprenez exactement la même
      demande, même après un rechargement.
    </p>{/if}
  {#if loading}<Skeleton rows={5} />{:else}
    <Card>
      <h2 class="mb-4 font-semibold">
        {current ? `Cible actuelle · révision ${current.version}` : 'Aucune cible configurée'}
      </h2>
      <form
        class="space-y-4"
        onsubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <fieldset disabled={!canManage || !!pending || blocked || saving} class="space-y-4">
          <label class="block space-y-1 text-sm"
            ><span>Rôle comptable cible</span><Select
              aria-label="Rôle comptable cible"
              bind:value={target}
              ><option value="">Choisir explicitement</option><option value="NATIVE"
                >Pulsar — comptabilité native cible</option
              ><option value="EXTERNAL">Logiciel externe de référence</option></Select
            ></label
          >
          {#if target === 'EXTERNAL'}<label class="block space-y-1 text-sm"
              ><span>Logiciel de référence</span><Input
                aria-label="Logiciel de référence"
                bind:value={external}
                maxlength={120}
              /></label
            >{/if}
          <label class="block space-y-1 text-sm"
            ><span>Devise fonctionnelle cible</span><Select
              aria-label="Devise fonctionnelle cible"
              bind:value={currency}
              ><option value="">Choisir une devise</option>{#each CURRENCIES as c}<option
                  value={c.code}>{c.code}</option
                >{/each}</Select
            ></label
          >
          <p class="text-xs text-ink-muted">
            Cette intention n’est ni une devise par défaut des écritures ni un taux de change.
          </p>
          <label class="block space-y-1 text-sm"
            ><span>Motif du choix ou du changement</span><Input
              aria-label="Motif du choix ou du changement"
              bind:value={reason}
              maxlength={500}
            /></label
          >
        </fieldset>
        {#if canManage}<Button
            type="submit"
            loading={saving}
            disabled={blocked || (!!error && loading)}
            >{pending ? 'Reprendre la demande' : 'Enregistrer la cible'}</Button
          >{:else}<p class="text-sm text-ink-muted">
            Lecture seule. Le droit « billing.accounting.configure » est requis pour modifier cette
            cible.
          </p>{/if}
      </form>
    </Card>
    {#if history.length}<section aria-label="Historique du profil">
        <h2 class="mb-3 font-semibold">20 dernières révisions</h2>
        <ol class="divide-y divide-edge">
          {#each history as r}<li class="py-3 text-sm">
              <p class="font-medium">
                Révision {r.version} · {r.target === 'NATIVE' ? 'Pulsar' : r.externalSystem} · {r.targetCurrency}
              </p>
              <p class="mt-1 break-words text-ink-muted">{r.reason}</p>
            </li>{/each}
        </ol>
      </section>{/if}
  {/if}
</div>
