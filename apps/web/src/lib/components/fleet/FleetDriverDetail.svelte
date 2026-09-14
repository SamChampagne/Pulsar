<script lang="ts">
  import { confirmAction } from '$lib/stores/confirmation';
  import { api, ApiError } from '$lib/api/client';
  import {
    Badge,
    Button,
    Card,
    EmptyState,
    Field,
    Input,
    PageHeader,
    Select,
    Skeleton,
    Textarea,
  } from '$lib/components/ui';
  import type { Tone } from '$lib/components/ui';
  import { toast } from '$lib/stores/toast';

  let { driverId }: { driverId: string } = $props();

  interface Driver {
    id: string;
    firstName: string;
    lastName: string;
    status: string;
    licenseNumber?: string | null;
    phone?: string | null;
    email?: string | null;
    carrierId: string | null;
  }

  interface ComplianceDoc {
    id: string;
    docType: string;
    reference?: string | null;
    expiresAt: string;
    issuedAt?: string | null;
    notes?: string | null;
    status: 'VALID' | 'EXPIRING' | 'EXPIRED';
  }

  let driver = $state<Driver | null>(null);
  let docs = $state<ComplianceDoc[]>([]);
  let loading = $state(true);
  let error = $state('');

  // Profile edit form
  let editOpen = $state(false);
  let saving = $state(false);
  let editForm = $state({
    firstName: '',
    lastName: '',
    licenseNumber: '',
    phone: '',
    email: '',
    status: 'ACTIVE',
  });

  // New compliance-document form
  let docFormOpen = $state(false);
  let docForm = $state({
    docType: 'LICENSE',
    reference: '',
    expiresAt: '',
    issuedAt: '',
    notes: '',
  });

  const DOC_TYPES = ['LICENSE', 'MEDICAL', 'CERTIFICATION', 'INSURANCE', 'OTHER'];

  function driverTone(status: string): Tone {
    return status === 'ACTIVE' ? 'ok' : 'neutral';
  }
  function complianceTone(status: string): Tone {
    return status === 'EXPIRED' ? 'danger' : status === 'EXPIRING' ? 'warn' : 'ok';
  }
  function fmtDate(d: string | null | undefined): string {
    return d ? new Date(d).toLocaleDateString() : '—';
  }

  async function load() {
    loading = true;
    error = '';
    try {
      const [d, cd] = await Promise.all([
        api<Driver>(`/transportation/drivers/${driverId}`),
        api<ComplianceDoc[]>('/fleet/compliance-documents', {
          query: { subjectType: 'DRIVER', subjectId: driverId },
        }),
      ]);
      driver = d;
      docs = Array.isArray(cd) ? cd : [];
    } catch (e) {
      error = e instanceof ApiError ? e.message : 'Échec du chargement';
      toast.error(error);
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    if (driverId) void load();
  });

  function openEdit() {
    if (!driver) return;
    editForm = {
      firstName: driver.firstName,
      lastName: driver.lastName,
      licenseNumber: driver.licenseNumber ?? '',
      phone: driver.phone ?? '',
      email: driver.email ?? '',
      status: driver.status,
    };
    editOpen = true;
  }

  async function saveProfile() {
    if (!editForm.firstName.trim() || !editForm.lastName.trim()) {
      toast.error('Le prénom et le nom sont requis');
      return;
    }
    saving = true;
    try {
      await api(`/transportation/drivers/${driverId}`, {
        method: 'PATCH',
        body: {
          firstName: editForm.firstName.trim(),
          lastName: editForm.lastName.trim(),
          licenseNumber: editForm.licenseNumber.trim() || undefined,
          phone: editForm.phone.trim() || undefined,
          email: editForm.email.trim() || undefined,
          status: editForm.status,
        },
      });
      toast.success('Chauffeur mis à jour');
      editOpen = false;
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Échec de la mise à jour');
    } finally {
      saving = false;
    }
  }

  async function createDoc() {
    if (!docForm.expiresAt) {
      toast.error("La date d'expiration est requise");
      return;
    }
    try {
      await api('/fleet/compliance-documents', {
        method: 'POST',
        body: {
          subjectType: 'DRIVER',
          subjectId: driverId,
          docType: docForm.docType,
          reference: docForm.reference.trim() || undefined,
          expiresAt: new Date(docForm.expiresAt).toISOString(),
          issuedAt: docForm.issuedAt ? new Date(docForm.issuedAt).toISOString() : undefined,
          notes: docForm.notes.trim() || undefined,
        },
      });
      toast.success('Document ajouté');
      docFormOpen = false;
      docForm = { docType: 'LICENSE', reference: '', expiresAt: '', issuedAt: '', notes: '' };
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Échec de l'ajout");
    }
  }

  async function deleteDoc(id: string) {
    if (!(await confirmAction('Supprimer ce document ?'))) return;
    try {
      await api(`/fleet/compliance-documents/${id}`, { method: 'DELETE' });
      toast.success('Document supprimé');
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Échec de la suppression');
    }
  }
</script>

{#if loading}
  <div class="flex flex-col gap-3">
    {#each Array(3) as _, i (i)}<Skeleton />{/each}
  </div>
{:else if error}
  <Card><p class="text-sm text-danger">{error}</p></Card>
{:else if driver}
  <PageHeader title={`${driver.firstName} ${driver.lastName}`}>
    {#snippet actions()}
      <Badge tone={driverTone(driver!.status)}>{driver!.status}</Badge>
      {#if !editOpen}<Button variant="secondary" onclick={openEdit}>Éditer</Button>{/if}
    {/snippet}
  </PageHeader>

  <div class="mb-4 flex flex-wrap items-center gap-3 text-sm text-ink-muted">
    <a href="/fleet" class="text-accent hover:underline">← Flotte</a>
    {#if driver.licenseNumber}<span>· permis {driver.licenseNumber}</span>{/if}
    {#if driver.phone}<span>· {driver.phone}</span>{/if}
    {#if driver.email}<span>· {driver.email}</span>{/if}
  </div>

  <div class="grid gap-4 lg:grid-cols-2">
    <!-- Profile / edit -->
    <Card>
      <h2 class="mb-3 font-semibold text-ink">Profil</h2>
      {#if editOpen}
        <div class="flex flex-col gap-3">
          <div class="grid grid-cols-2 gap-3">
            <Field label="Prénom"><Input bind:value={editForm.firstName} /></Field>
            <Field label="Nom"><Input bind:value={editForm.lastName} /></Field>
          </div>
          <Field label="Permis #"><Input bind:value={editForm.licenseNumber} /></Field>
          <div class="grid grid-cols-2 gap-3">
            <Field label="Téléphone"><Input bind:value={editForm.phone} /></Field>
            <Field label="Courriel"><Input bind:value={editForm.email} type="email" /></Field>
          </div>
          <Field label="Statut">
            <Select bind:value={editForm.status}>
              <option value="ACTIVE">ACTIVE</option>
              <option value="INACTIVE">INACTIVE</option>
            </Select>
          </Field>
          <div class="flex gap-2">
            <Button variant="primary" onclick={saveProfile} loading={saving}>Enregistrer</Button>
            <Button
              variant="secondary"
              onclick={() => {
                editOpen = false;
              }}>Annuler</Button
            >
          </div>
        </div>
      {:else}
        <dl class="grid grid-cols-2 gap-3 text-sm">
          <div>
            <dt class="text-ink-faint">Permis</dt>
            <dd class="text-ink">{driver.licenseNumber ?? '—'}</dd>
          </div>
          <div>
            <dt class="text-ink-faint">Statut</dt>
            <dd class="text-ink">{driver.status}</dd>
          </div>
          <div>
            <dt class="text-ink-faint">Téléphone</dt>
            <dd class="text-ink">{driver.phone ?? '—'}</dd>
          </div>
          <div>
            <dt class="text-ink-faint">Courriel</dt>
            <dd class="break-all text-ink">{driver.email ?? '—'}</dd>
          </div>
        </dl>
      {/if}
    </Card>

    <!-- Compliance -->
    <Card>
      <div class="mb-3 flex items-center justify-between">
        <h2 class="font-semibold text-ink">Conformité</h2>
        {#if !docFormOpen}
          <Button
            variant="secondary"
            onclick={() => {
              docFormOpen = true;
            }}>Ajouter un document</Button
          >
        {/if}
      </div>

      {#if docFormOpen}
        <div class="mb-4 flex flex-col gap-3 rounded-card border border-edge bg-surface-muted p-3">
          <Field label="Type de document">
            <Select bind:value={docForm.docType}>
              {#each DOC_TYPES as t (t)}<option value={t}>{t}</option>{/each}
            </Select>
          </Field>
          <Field label="Référence">
            <Input bind:value={docForm.reference} placeholder="N° de permis / certificat" />
          </Field>
          <Field label="Date d'expiration">
            <Input type="date" bind:value={docForm.expiresAt} required />
          </Field>
          <Field label="Date d'émission">
            <Input type="date" bind:value={docForm.issuedAt} />
          </Field>
          <Field label="Notes">
            <Textarea bind:value={docForm.notes} rows={2} />
          </Field>
          <div class="flex gap-2">
            <Button variant="primary" onclick={createDoc}>Ajouter</Button>
            <Button
              variant="secondary"
              onclick={() => {
                docFormOpen = false;
              }}>Annuler</Button
            >
          </div>
        </div>
      {/if}

      {#if docs.length === 0}
        <EmptyState message="Aucun document de conformité." />
      {:else}
        <div class="divide-y divide-edge">
          {#each docs as doc (doc.id)}
            <div class="flex items-center gap-3 py-2.5 text-sm">
              <Badge tone={complianceTone(doc.status)}>{doc.status}</Badge>
              <span class="font-medium text-ink">{doc.docType}</span>
              {#if doc.reference}<span class="text-ink-faint">{doc.reference}</span>{/if}
              <span class="ml-auto text-ink-muted">expire le {fmtDate(doc.expiresAt)}</span>
              <Button variant="ghost" onclick={() => deleteDoc(doc.id)}>Supprimer</Button>
            </div>
          {/each}
        </div>
      {/if}
    </Card>
  </div>
{:else}
  <p class="text-sm text-ink-muted">Introuvable.</p>
{/if}
