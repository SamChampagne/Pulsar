<script lang="ts">
  import { page } from '$app/state';
  import type { Paginated } from '@pulsar/shared';
  import { PERMISSIONS } from '@pulsar/shared';
  import { api, ApiError } from '$lib/api/client';
  import { auth } from '$lib/stores/auth';
  import { toast } from '$lib/stores/toast';
  import {
    PageHeader,
    Button,
    Badge,
    Card,
    Table,
    EmptyState,
    Skeleton,
    Modal,
    Field,
    Input,
    Select,
    toneFor,
    labelFor,
  } from '$lib/components/ui';
  import { endpointLabel, laneLabel, formatDate } from '$lib/procurement/helpers';
  import type { LaneEndpoint, EndpointType } from '$lib/procurement/helpers';

  // ─── Types ────────────────────────────────────────────────────────────────────

  interface Lane {
    id: string;
    name: string | null;
    originType: EndpointType;
    originCity: string | null;
    originState: string | null;
    originCountry: string | null;
    originLocation: LaneEndpoint | null;
    destinationType: EndpointType;
    destinationCity: string | null;
    destinationState: string | null;
    destinationCountry: string | null;
    destinationLocation: LaneEndpoint | null;
  }

  interface RfpLane {
    id: string;
    rfpId: string;
    laneId: string;
    mode: string | null;
    volumeEstimate: number | null;
    lane: Lane;
  }

  interface CarrierRef {
    id: string;
    code: string;
    name: string;
  }

  interface Invite {
    id: string;
    carrierId: string;
    status: string;
    sentAt: string;
    respondedAt: string | null;
    carrier: CarrierRef;
  }

  interface Bid {
    id: string;
    rfpLaneId: string;
    carrierId: string;
    rateType: string;
    amount: string | number;
    currency: string;
    transitDays: number | null;
    notes: string | null;
    status: string;
    carrier: CarrierRef;
  }

  interface Award {
    id: string;
    rfpLaneId: string;
    carrierId: string;
    bidId: string | null;
    rateId: string | null;
    awardedAt: string;
    carrier: CarrierRef;
  }

  interface Rfp {
    id: string;
    rfpNumber: string;
    title: string;
    description: string | null;
    status: string;
    deadline: string | null;
    rfpLanes: RfpLane[];
    invites: Invite[];
    bids: Bid[];
    awards: Award[];
  }

  interface LaneOption {
    id: string;
    name: string | null;
    originType: EndpointType;
    originCity: string | null;
    originState: string | null;
    originCountry: string | null;
    originLocation: LaneEndpoint | null;
    destinationType: EndpointType;
    destinationCity: string | null;
    destinationState: string | null;
    destinationCountry: string | null;
    destinationLocation: LaneEndpoint | null;
  }

  interface CarrierOption {
    id: string;
    code: string;
    name: string;
    email?: string | null;
  }

  // ─── Permissions ─────────────────────────────────────────────────────────────
  const canManage = $derived(
    $auth?.user.permissions.includes(PERMISSIONS.PROCUREMENT.MANAGE) ?? false,
  );

  // ─── Data ─────────────────────────────────────────────────────────────────────
  const rfpId = $derived(page.params.id as string);

  let rfp = $state<Rfp | null>(null);
  let allLanes = $state<LaneOption[]>([]);
  let allCarriers = $state<CarrierOption[]>([]);
  let loading = $state(true);
  let error = $state('');

  // ─── Lane add modal ───────────────────────────────────────────────────────────
  let showAddLane = $state(false);
  let addLaneId = $state('');
  let addLaneMode = $state('');
  let addLaneVolume = $state('');

  // ─── Invite modal ─────────────────────────────────────────────────────────────
  let showInvite = $state(false);
  let inviteCarrierId = $state('');
  let inviteLink = $state('');

  // ─── Award modal ─────────────────────────────────────────────────────────────
  let showAward = $state(false);
  let awardBid = $state<Bid | null>(null);
  let awardCreateRate = $state(false);

  // ─── Load ─────────────────────────────────────────────────────────────────────
  async function load() {
    loading = true;
    error = '';
    try {
      const [rfpRes, lanesRes, carriersRes] = await Promise.all([
        api<Rfp>(`/procurement/rfps/${rfpId}`),
        api<Paginated<LaneOption>>('/transportation/lanes', { query: { pageSize: 100 } }),
        api<Paginated<CarrierOption>>('/transportation/carriers', { query: { pageSize: 100 } }),
      ]);
      rfp = rfpRes;
      allLanes = lanesRes.items;
      allCarriers = carriersRes.items;
    } catch (e) {
      error = e instanceof ApiError ? e.message : 'Échec du chargement';
    } finally {
      loading = false;
    }
  }

  // ─── Transitions ─────────────────────────────────────────────────────────────
  async function transition(verb: string) {
    try {
      await api(`/procurement/rfps/${rfpId}/${verb}`, { method: 'POST' });
      toast.success('Statut mis à jour');
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Échec de la transition');
    }
  }

  // ─── Lanes ────────────────────────────────────────────────────────────────────
  async function addLane(event: SubmitEvent) {
    event.preventDefault();
    try {
      const body: Record<string, unknown> = { laneId: addLaneId };
      if (addLaneMode) body.mode = addLaneMode;
      if (addLaneVolume) body.volumeEstimate = Number(addLaneVolume);
      await api(`/procurement/rfps/${rfpId}/lanes`, { method: 'POST', body });
      toast.success('Lane ajoutée');
      resetAddLane();
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Échec de l\'ajout');
    }
  }

  function resetAddLane() {
    addLaneId = '';
    addLaneMode = '';
    addLaneVolume = '';
    showAddLane = false;
  }

  async function deleteLane(rfpLaneId: string) {
    try {
      await api(`/procurement/rfps/${rfpId}/lanes/${rfpLaneId}`, { method: 'DELETE' });
      toast.success('Lane retirée');
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Échec de la suppression');
    }
  }

  // ─── Invites ─────────────────────────────────────────────────────────────────
  async function invite(event: SubmitEvent) {
    event.preventDefault();
    try {
      const result = await api<{ token: string }>(`/procurement/rfps/${rfpId}/invites`, {
        method: 'POST',
        body: { carrierId: inviteCarrierId },
      });
      inviteLink = window.location.origin + '/public/rfp-invites/' + result.token;
      toast.success('Invitation envoyée');
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Échec de l\'invitation');
    }
  }

  function resetInvite() {
    inviteCarrierId = '';
    inviteLink = '';
    showInvite = false;
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(inviteLink);
      toast.success('Lien copié');
    } catch {
      toast.error('Échec de la copie');
    }
  }

  // ─── Bid actions ─────────────────────────────────────────────────────────────
  async function shortlistBid(bidId: string) {
    try {
      await api(`/procurement/rfps/${rfpId}/bids/${bidId}/shortlist`, { method: 'POST' });
      toast.success('Bid présélectionné');
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Échec');
    }
  }

  async function rejectBid(bidId: string) {
    try {
      await api(`/procurement/rfps/${rfpId}/bids/${bidId}/reject`, { method: 'POST' });
      toast.success('Bid rejeté');
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Échec');
    }
  }

  function openAward(bid: Bid) {
    awardBid = bid;
    awardCreateRate = false;
    showAward = true;
  }

  async function doAward(event: SubmitEvent) {
    event.preventDefault();
    if (!awardBid) return;
    try {
      await api(`/procurement/rfps/${rfpId}/award`, {
        method: 'POST',
        body: { rfpLaneId: awardBid.rfpLaneId, bidId: awardBid.id, createRate: awardCreateRate },
      });
      toast.success('Lane attribuée');
      showAward = false;
      awardBid = null;
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Échec de l\'attribution');
    }
  }

  $effect(() => {
    rfpId;
    void load();
  });
</script>

{#if loading}
  <Card padded={false}><Skeleton rows={8} /></Card>
{:else if error}
  <p class="text-sm text-danger">{error}</p>
{:else if rfp}
  <PageHeader title="{rfp.rfpNumber} — {rfp.title}">
    {#snippet actions()}
      <div class="flex items-center gap-2">
        <Badge tone={toneFor(rfp!.status)}>{labelFor(rfp!.status)}</Badge>
        {#if canManage}
          {#if rfp!.status === 'DRAFT'}
            <Button onclick={() => transition('open')}>Ouvrir</Button>
            <Button variant="danger" onclick={() => transition('cancel')}>Annuler</Button>
          {:else if rfp!.status === 'OPEN'}
            <Button onclick={() => transition('evaluation')}>Passage en évaluation</Button>
            <Button variant="danger" onclick={() => transition('cancel')}>Annuler</Button>
          {:else if rfp!.status === 'EVALUATION'}
            <Button variant="secondary" onclick={() => transition('open')}>Re-ouvrir</Button>
            <Button variant="danger" onclick={() => transition('cancel')}>Annuler</Button>
          {/if}
        {/if}
      </div>
    {/snippet}
  </PageHeader>

  <!-- ─── Lanes section ─────────────────────────────────────────────────────── -->
  <div class="mb-4 rounded-card border border-edge-soft bg-surface shadow-sm">
    <div class="flex items-center justify-between border-b border-edge-soft px-4 py-3">
      <span class="font-semibold text-ink">Lanes</span>
      {#if canManage}
        <Button variant="secondary" onclick={() => { addLaneId = ''; addLaneMode = ''; addLaneVolume = ''; showAddLane = true; }}>Ajouter</Button>
      {/if}
    </div>
    <div class="p-4">
      {#if rfp!.rfpLanes.length === 0}
        <EmptyState message="Aucune lane ajoutée." />
      {:else}
        <Table>
          {#snippet head()}
            <th>Lane</th>
            <th>Mode</th>
            <th>Volume estimé</th>
            <th></th>
          {/snippet}
          {#snippet body()}
            {#each rfp!.rfpLanes as rl (rl.id)}
              <tr>
                <td class="text-sm text-ink">{laneLabel(rl.lane)}</td>
                <td>{rl.mode ? rl.mode : '—'}</td>
                <td>{rl.volumeEstimate !== null && rl.volumeEstimate !== undefined ? rl.volumeEstimate : '—'}</td>
                <td class="text-right">
                  {#if canManage}
                    <Button variant="danger" onclick={() => deleteLane(rl.id)}>Retirer</Button>
                  {/if}
                </td>
              </tr>
            {/each}
          {/snippet}
        </Table>
      {/if}
    </div>
  </div>

  <!-- ─── Invites section ───────────────────────────────────────────────────── -->
  <div class="mb-4 rounded-card border border-edge-soft bg-surface shadow-sm">
    <div class="flex items-center justify-between border-b border-edge-soft px-4 py-3">
      <span class="font-semibold text-ink">Invitations</span>
      {#if canManage}
        <Button variant="secondary" onclick={() => { inviteCarrierId = ''; inviteLink = ''; showInvite = true; }}>Inviter</Button>
      {/if}
    </div>
    <div class="p-4">
      {#if rfp!.invites.length === 0}
        <EmptyState message="Aucune invitation envoyée." />
      {:else}
        <Table>
          {#snippet head()}
            <th>Transporteur</th>
            <th>Statut</th>
            <th>Envoyé le</th>
          {/snippet}
          {#snippet body()}
            {#each rfp!.invites as inv (inv.id)}
              <tr>
                <td class="font-semibold text-ink">{inv.carrier.name}</td>
                <td><Badge tone={toneFor(inv.status)}>{labelFor(inv.status)}</Badge></td>
                <td class="text-sm text-ink-muted">{formatDate(inv.sentAt)}</td>
              </tr>
            {/each}
          {/snippet}
        </Table>
      {/if}
    </div>
  </div>

  <!-- ─── Bids section ──────────────────────────────────────────────────────── -->
  <div class="mb-4 rounded-card border border-edge-soft bg-surface shadow-sm">
    <div class="border-b border-edge-soft px-4 py-3">
      <span class="font-semibold text-ink">Soumissions (bids)</span>
    </div>
    <div class="p-4">
      {#if rfp!.rfpLanes.length === 0}
        <EmptyState message="Ajoutez des lanes pour voir les soumissions." />
      {:else}
        {#each rfp!.rfpLanes as rl (rl.id)}
          {@const laneBids = rfp!.bids.filter((b) => b.rfpLaneId === rl.id)}
          {@const award = rfp!.awards.find((a) => a.rfpLaneId === rl.id)}
          <div class="mb-6 last:mb-0">
            <div class="mb-2 flex items-center gap-2">
              <span class="text-sm font-semibold text-ink">{laneLabel(rl.lane)}</span>
              {#if award}
                <Badge tone="ok">Attribué: {award.carrier.name}</Badge>
              {/if}
            </div>
            {#if laneBids.length === 0}
              <p class="text-sm text-ink-faint">Aucune soumission pour cette lane.</p>
            {:else}
              <Table>
                {#snippet head()}
                  <th>Transporteur</th>
                  <th>Montant</th>
                  <th>Type</th>
                  <th>Délai</th>
                  <th>Statut</th>
                  <th></th>
                {/snippet}
                {#snippet body()}
                  {#each laneBids as bid (bid.id)}
                    <tr>
                      <td class="font-semibold text-ink">{bid.carrier.name}</td>
                      <td class="text-sm text-ink">{bid.amount} {bid.currency}</td>
                      <td class="text-sm text-ink-muted">{bid.rateType}</td>
                      <td class="text-sm text-ink-muted">{bid.transitDays !== null && bid.transitDays !== undefined ? bid.transitDays + ' j' : '—'}</td>
                      <td><Badge tone={toneFor(bid.status)}>{labelFor(bid.status)}</Badge></td>
                      <td class="text-right">
                        {#if canManage}
                          <div class="inline-flex gap-1">
                            {#if bid.status === 'SUBMITTED'}
                              <Button variant="secondary" onclick={() => shortlistBid(bid.id)}>Présélectionner</Button>
                            {/if}
                            {#if bid.status === 'SUBMITTED' || bid.status === 'SHORTLISTED'}
                              <Button variant="danger" onclick={() => rejectBid(bid.id)}>Rejeter</Button>
                            {/if}
                            {#if bid.status !== 'ACCEPTED' && bid.status !== 'REJECTED'}
                              <Button onclick={() => openAward(bid)}>Attribuer</Button>
                            {/if}
                          </div>
                        {/if}
                      </td>
                    </tr>
                  {/each}
                {/snippet}
              </Table>
            {/if}
          </div>
        {/each}
      {/if}
    </div>
  </div>
{/if}

<!-- ─── Add Lane Modal ────────────────────────────────────────────────────────── -->
{#if canManage}
<Modal bind:open={showAddLane} title="Ajouter une lane" size="md">
  {#snippet children()}
    <form onsubmit={addLane} class="space-y-4">
      <Field label="Lane">
        <Select bind:value={addLaneId} required>
          <option value="" disabled>Sélectionner une lane…</option>
          {#each allLanes as l (l.id)}
            <option value={l.id}>{l.name ? l.name + ' — ' : ''}{laneLabel(l)}</option>
          {/each}
        </Select>
      </Field>
      <Field label="Mode (optionnel)">
        <Select bind:value={addLaneMode}>
          <option value="">—</option>
          <option value="LTL">LTL</option>
          <option value="FTL">FTL</option>
          <option value="PTL">PTL</option>
          <option value="PARCEL">PARCEL</option>
        </Select>
      </Field>
      <Field label="Volume estimé (optionnel)">
        <Input type="number" bind:value={addLaneVolume} placeholder="ex. 100" min="0" />
      </Field>
      <div class="flex justify-end gap-2 border-t border-edge pt-3">
        <Button variant="secondary" onclick={resetAddLane}>Annuler</Button>
        <Button variant="primary" type="submit">Ajouter</Button>
      </div>
    </form>
  {/snippet}
</Modal>
{/if}

<!-- ─── Invite Modal ─────────────────────────────────────────────────────────── -->
{#if canManage}
<Modal bind:open={showInvite} title="Inviter un transporteur" size="md" onclose={resetInvite}>
  {#snippet children()}
    <div class="space-y-4">
      {#if !inviteLink}
        <form onsubmit={invite} class="space-y-4">
          <Field label="Transporteur">
            <Select bind:value={inviteCarrierId} required>
              <option value="" disabled>Sélectionner un transporteur…</option>
              {#each allCarriers as c (c.id)}
                <option value={c.id}>{c.name} ({c.code})</option>
              {/each}
            </Select>
          </Field>
          <div class="flex justify-end gap-2 border-t border-edge pt-3">
            <Button variant="secondary" onclick={resetInvite}>Annuler</Button>
            <Button variant="primary" type="submit">Inviter</Button>
          </div>
        </form>
      {:else}
        <div class="rounded-inner border border-edge bg-surface-muted p-3 space-y-2">
          <p class="text-sm font-semibold text-ink">Lien d'invitation publique</p>
          <p class="break-all font-mono text-xs text-ink-muted">{inviteLink}</p>
          <Button variant="secondary" onclick={copyLink}>Copier</Button>
        </div>
        <div class="flex justify-end pt-2">
          <Button onclick={resetInvite}>Fermer</Button>
        </div>
      {/if}
    </div>
  {/snippet}
</Modal>
{/if}

<!-- ─── Award Modal ──────────────────────────────────────────────────────────── -->
{#if canManage}
<Modal bind:open={showAward} title="Attribuer la lane" size="sm">
  {#snippet children()}
    {#if awardBid}
      <form onsubmit={doAward} class="space-y-4">
        <p class="text-sm text-ink">
          Attribuer <span class="font-semibold">{awardBid.carrier.name}</span> pour cette lane ?
        </p>
        <label class="flex items-center gap-2 text-sm text-ink cursor-pointer">
          <input type="checkbox" bind:checked={awardCreateRate} class="rounded" />
          Créer un tarif actif depuis ce bid
        </label>
        <div class="flex justify-end gap-2 border-t border-edge pt-3">
          <Button variant="secondary" onclick={() => { showAward = false; awardBid = null; }}>Annuler</Button>
          <Button variant="primary" type="submit">Attribuer</Button>
        </div>
      </form>
    {/if}
  {/snippet}
</Modal>
{/if}
