<script lang="ts">
  import ItemCreateModal from '$lib/components/wms/ItemCreateModal.svelte';
  import { auth } from '$lib/stores/auth';
  let createItem = $state(false);
  const canCreateItem = $derived(
    $auth?.tenant.enabledModules.includes('wms') && $auth?.user.permissions.includes('wms.manage'),
  );
  import type { Paginated } from '@pulsar/shared';
  import { goto } from '$app/navigation';
  import { api, ApiError } from '$lib/api/client';
  import {
    Badge,
    Button,
    Card,
    EmptyState,
    EntityPicker,
    Field,
    FilterBar,
    Input,
    Modal,
    PageHeader,
    Select,
    Skeleton,
    Table,
  } from '$lib/components/ui';
  import { toast } from '$lib/stores/toast';

  type Priority = 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
  type Status = 'DRAFT' | 'RELEASED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
  type Firmness = 'FIRM' | 'FORECAST' | 'TENTATIVE';

  interface Order {
    id: string;
    number: string;
    name: string;
    productRef: string;
    quantity: number;
    dueDate?: string | null;
    releaseDate?: string | null;
    priority: Priority;
    status: Status;
    firmness: Firmness;
  }

  const STATUSES: Status[] = ['DRAFT', 'RELEASED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'];
  const STATUS_LABELS: Record<Status, string> = {
    DRAFT: 'Brouillon',
    RELEASED: 'Libéré',
    IN_PROGRESS: 'En cours',
    COMPLETED: 'Terminé',
    CANCELLED: 'Annulé',
  };
  const PRIORITY_LABELS: Record<Priority, string> = {
    LOW: 'Basse',
    NORMAL: 'Normale',
    HIGH: 'Haute',
    URGENT: 'Urgente',
  };
  const FIRMNESS_LABELS: Record<Firmness, string> = {
    FIRM: 'Ferme',
    FORECAST: 'Prévision',
    TENTATIVE: 'Provisoire',
  };

  function statusTone(s: Status): 'ok' | 'warn' | 'danger' | 'neutral' | 'info' {
    return s === 'COMPLETED'
      ? 'ok'
      : s === 'RELEASED'
        ? 'info'
        : s === 'IN_PROGRESS'
          ? 'warn'
          : s === 'CANCELLED'
            ? 'danger'
            : 'neutral';
  }

  function priorityTone(p: Priority): 'ok' | 'warn' | 'danger' | 'neutral' | 'info' {
    return p === 'URGENT' ? 'danger' : p === 'HIGH' ? 'warn' : p === 'LOW' ? 'neutral' : 'info';
  }

  function fmtDate(d?: string | null): string {
    if (!d) return '—';
    const dt = new Date(d);
    return Number.isNaN(dt.getTime()) ? '—' : dt.toLocaleDateString('fr-CA');
  }

  let orders = $state<Order[]>([]);
  let total = $state(0);
  let loading = $state(true);
  let error = $state('');
  let search = $state('');
  let statusFilter = $state('');

  // Create modal
  let formOpen = $state(false);
  let formName = $state('');
  let formProductRef = $state('');
  let formQuantity = $state('');
  let formReleaseDate = $state('');
  let formDueDate = $state('');
  let formPriority = $state<Priority>('NORMAL');
  let formFirmness = $state<Firmness>('FIRM');
  let saving = $state(false);

  async function load() {
    loading = true;
    error = '';
    try {
      const res = await api<Paginated<Order>>('/manufacturing/orders', {
        query: {
          pageSize: 100,
          search: search.trim() || undefined,
          status: statusFilter || undefined,
        },
      });
      orders = res.items;
      total = res.total;
    } catch (e) {
      error = e instanceof ApiError ? e.message : 'Échec du chargement des ordres';
      toast.error(error);
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    void load();
  });

  function openCreate() {
    formName = '';
    formProductRef = '';
    formQuantity = '';
    formReleaseDate = '';
    formDueDate = '';
    formPriority = 'NORMAL';
    formFirmness = 'FIRM';
    formOpen = true;
  }

  async function submit() {
    if (!formName.trim() || !formProductRef.trim()) {
      toast.error('Nom et produit sont requis');
      return;
    }
    const qty = Number(formQuantity);
    if (formQuantity === '' || Number.isNaN(qty) || qty <= 0) {
      toast.error('Quantité invalide');
      return;
    }
    saving = true;
    try {
      const body = {
        name: formName.trim(),
        productRef: formProductRef.trim(),
        quantity: qty,
        releaseDate: formReleaseDate ? new Date(formReleaseDate).toISOString() : undefined,
        dueDate: formDueDate ? new Date(formDueDate).toISOString() : undefined,
        priority: formPriority,
        firmness: formFirmness,
      };
      const created = await api<Order>('/manufacturing/orders', { method: 'POST', body });
      toast.success('Ordre créé');
      formOpen = false;
      await goto(`/manufacturing/orders/${created.id}`);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Échec de l'enregistrement");
    } finally {
      saving = false;
    }
  }
</script>

<PageHeader title="Ordres de fabrication" count={total}>
  {#snippet actions()}
    <Button onclick={openCreate}>Nouvel ordre</Button>
  {/snippet}
</PageHeader>

<FilterBar>
  <a href="/manufacturing" class="text-sm text-accent hover:underline">← Fabrication</a>
  <div class="w-72">
    <input
      placeholder="Rechercher par n° ou nom…"
      bind:value={search}
      onkeydown={(e) => {
        if (e.key === 'Enter') void load();
      }}
      class="w-full rounded-md border border-edge bg-surface px-3 py-1.5 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
    />
  </div>
  <div class="w-48">
    <Select bind:value={statusFilter}>
      <option value="">Tous les statuts</option>
      {#each STATUSES as s}
        <option value={s}>{STATUS_LABELS[s]}</option>
      {/each}
    </Select>
  </div>
</FilterBar>

{#if loading}
  <Card padded={false}><Skeleton rows={6} /></Card>
{:else if error}
  <Card><p class="text-sm text-danger">{error}</p></Card>
{:else if orders.length === 0}
  <Card>
    <EmptyState message="Aucun ordre de fabrication pour le moment.">
      {#snippet children()}
        <Button onclick={openCreate}>Nouvel ordre</Button>
      {/snippet}
    </EmptyState>
  </Card>
{:else}
  <Table>
    {#snippet head()}
      <th>N°</th><th>Nom</th><th>Produit</th><th class="text-right">Qté</th><th>Échéance</th><th
        >Priorité</th
      ><th>Statut</th>
    {/snippet}
    {#snippet body()}
      {#each orders as o (o.id)}
        <tr>
          <td class="font-mono font-semibold">
            <a href={`/manufacturing/orders/${o.id}`} class="text-accent hover:underline">
              {o.number}
            </a>
          </td>
          <td>{o.name}</td>
          <td class="text-ink-muted">{o.productRef}</td>
          <td class="text-right text-ink">{o.quantity}</td>
          <td class="text-ink-muted">{fmtDate(o.dueDate)}</td>
          <td><Badge tone={priorityTone(o.priority)}>{PRIORITY_LABELS[o.priority]}</Badge></td>
          <td><Badge tone={statusTone(o.status)}>{STATUS_LABELS[o.status]}</Badge></td>
        </tr>
      {/each}
    {/snippet}
  </Table>
{/if}

<Modal bind:open={formOpen} title="Nouvel ordre" size="md">
  {#snippet children()}
    <div class="space-y-3">
      <Field label="Nom">
        <Input bind:value={formName} placeholder="Désignation" />
      </Field>
      <Field label="Produit">
        <EntityPicker
          endpoint="/wms/choices/items"
          label="Produit"
          allowCreate={canCreateItem
            ? {
                label: '+ Créer un article',
                onCreate: () => {
                  createItem = true;
                },
              }
            : undefined}
          placeholder="Réf. produit"
          labelKey="name"
          valueKey="sku"
          selectedLabel={formProductRef}
          bind:value={formProductRef}
        />
      </Field>
      <Field label="Quantité">
        <Input bind:value={formQuantity} type="number" min="0" step="any" placeholder="ex. 100" />
      </Field>
      <div class="grid grid-cols-2 gap-3">
        <Field label="Date de libération">
          <Input bind:value={formReleaseDate} type="date" />
        </Field>
        <Field label="Échéance">
          <Input bind:value={formDueDate} type="date" />
        </Field>
      </div>
      <div class="grid grid-cols-2 gap-3">
        <Field label="Priorité">
          <Select bind:value={formPriority}>
            {#each Object.keys(PRIORITY_LABELS) as p}
              <option value={p}>{PRIORITY_LABELS[p as Priority]}</option>
            {/each}
          </Select>
        </Field>
        <Field label="Fermeté">
          <Select bind:value={formFirmness}>
            {#each Object.keys(FIRMNESS_LABELS) as f}
              <option value={f}>{FIRMNESS_LABELS[f as Firmness]}</option>
            {/each}
          </Select>
        </Field>
      </div>
      <div class="flex justify-end gap-2 border-t border-edge pt-3">
        <Button
          variant="secondary"
          onclick={() => {
            formOpen = false;
          }}>Annuler</Button
        >
        <Button variant="primary" loading={saving} onclick={submit}>Créer</Button>
      </div>
    </div>
  {/snippet}
</Modal>

<ItemCreateModal
  bind:open={createItem}
  oncreated={(item) => {
    formProductRef = item.sku;
  }}
/>
