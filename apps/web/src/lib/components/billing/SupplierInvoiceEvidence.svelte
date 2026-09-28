<script lang="ts">
  import { auth, getAccessToken } from '$lib/stores/auth';
  import { api, ApiError } from '$lib/api/client';
  import { Button, Field, Textarea, Skeleton } from '$lib/components/ui';
  import { formatDateTime } from '$lib/format';
  import {
    readEvidenceIntent,
    rememberEvidenceIntent,
    sameEvidenceFile,
    type EvidenceIntent,
  } from '$lib/wms/evidence-intent';
  let {
    id,
    status,
    disabled = false,
    busy = $bindable(false),
    onloaded,
  }: {
    id: string;
    status: string;
    disabled?: boolean;
    busy?: boolean;
    onloaded?: (rows: Evidence[]) => void;
  } = $props();
  type Evidence = {
    id: string;
    caption: string;
    sha256: string;
    createdAt: string;
    document: {
      fileName: string;
      mimeType: string;
      sizeBytes: number;
      uploadedBy: { firstName: string; lastName: string } | null;
    };
  };
  const key = $derived(`pulsar:supplier-invoice-file:${$auth?.tenant.id}:${$auth?.user.id}:${id}`);
  const canManage = $derived($auth?.user.permissions.includes('billing.supplier-invoices.manage'));
  let rows = $state<Evidence[]>([]),
    pending = $state<EvidenceIntent | null>(null),
    file = $state<File | null>(null),
    caption = $state(''),
    error = $state(''),
    notice = $state(''),
    storageError = $state(''),
    loading = $state(true);
  let generation = 0;
  let fileInput = $state<HTMLInputElement>();
  $effect(() => {
    void id;
    try {
      pending = readEvidenceIntent(key);
      storageError = '';
    } catch (e) {
      storageError = (e as Error).message;
    }
    file = null;
    caption = '';
    void load();
  });
  async function load() {
    const g = ++generation;
    loading = true;
    try {
      const r = await api<Evidence[]>(`/billing/supplier-invoices/${id}/evidence`);
      if (g === generation) {
        rows = r;
        onloaded?.(r);
      }
    } catch (e) {
      if (g === generation) error = (e as Error).message;
    } finally {
      if (g === generation) loading = false;
    }
  }
  function clear() {
    localStorage.removeItem(key);
    pending = null;
    file = null;
    caption = '';
    if (fileInput) fileInput.value = '';
  }
  async function reconcile() {
    if (!pending || busy) return;
    busy = true;
    error = '';
    notice = '';
    try {
      const r = await api<{ sha256: string }>(
        `/billing/supplier-invoices/${id}/evidence/requests/${pending.operationKey}`,
      );
      if (r.sha256 !== pending.sha256)
        throw Error('Empreinte différente. Faites vérifier le registre.');
      clear();
      notice = 'Pièce déjà enregistrée : aucune copie ajoutée.';
      await load();
    } catch (e) {
      error =
        e instanceof ApiError && e.statusCode === 404
          ? 'Aucune pièce confirmée pour cette demande. Resélectionnez exactement le même fichier pour reprendre.'
          : (e as Error).message;
    } finally {
      busy = false;
    }
  }
  async function upload() {
    if (!file || busy || storageError || disabled || !canManage) return;
    const recovering = !!pending;
    busy = true;
    error = '';
    notice = '';
    try {
      if (
        file.size <= 0 ||
        file.size > 10 * 1024 * 1024 ||
        !['application/pdf', 'image/png', 'image/jpeg'].includes(file.type)
      )
        throw Error('Choisissez un PDF, PNG ou JPEG non vide, de 10 Mo maximum.');
      const sha256 = Array.from(
        new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer())),
      )
        .map((n) => n.toString(16).padStart(2, '0'))
        .join('');
      if (pending && !sameEvidenceFile(pending, file, sha256))
        throw Error(
          'Reprise : choisissez exactement le même fichier, avec le même nom et le même contenu.',
        );
      const p = pending ?? {
        operationKey: crypto.randomUUID(),
        caption,
        fileName: file.name,
        mimeType: file.type,
        size: file.size,
        sha256,
      };
      rememberEvidenceIntent(key, p);
      pending = p;
      const body = new FormData();
      body.set('operationKey', p.operationKey);
      body.set('caption', p.caption);
      body.set('file', file, p.fileName);
      const r = await fetch(`/api/v1/billing/supplier-invoices/${id}/evidence`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${getAccessToken() ?? ''}` },
        body,
      });
      if (!r.ok) {
        const data = await r.json().catch(() => ({}));
        throw new ApiError(
          r.status,
          Array.isArray(data.message)
            ? data.message.join(' ')
            : (data.message ?? 'Enregistrement non confirmé.'),
        );
      }
      const data = await r.json();
      if (data.sha256 !== p.sha256)
        throw Error('Confirmation incohérente. Faites vérifier le registre.');
      clear();
      notice = 'Pièce conservée. Sélectionnez ensuite l’original pour qualifier le dossier.';
      await load();
    } catch (e) {
      error = (e as Error).message;
      if (
        !recovering &&
        e instanceof ApiError &&
        e.statusCode >= 400 &&
        e.statusCode < 500 &&
        ![401, 408, 429].includes(e.statusCode)
      ) {
        try {
          clear();
        } catch {
          storageError = 'Impossible de réconcilier la demande locale.';
        }
      }
    } finally {
      busy = false;
    }
  }
  async function download(row: Evidence) {
    busy = true;
    error = '';
    try {
      const r = await fetch(`/api/v1/billing/supplier-invoices/${id}/evidence/${row.id}/download`, {
        headers: { Authorization: `Bearer ${getAccessToken() ?? ''}` },
      });
      if (!r.ok) throw Error('Téléchargement refusé ou session expirée.');
      const url = URL.createObjectURL(await r.blob()),
        a = document.createElement('a');
      a.href = url;
      a.download = row.document.fileName;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      error = (e as Error).message;
    } finally {
      busy = false;
    }
  }
</script>

<section
  class="space-y-3 border-t border-edge pt-4"
  aria-label="Justificatifs de facture fournisseur"
>
  <h3 class="font-semibold">Pièces justificatives</h3>
  <p class="text-xs text-ink-muted">
    Facture reçue et annexes : visibles aux lecteurs Finance autorisés, conservées sans remplacement
    ni suppression. Seul le brouillon reçoit des pièces; aucune comptabilisation ni paiement.
  </p>
  {#if error}<p role="alert" class="text-sm text-danger">{error}</p>{/if}
  {#if storageError}<p role="alert" class="text-sm text-danger">{storageError}</p>{/if}
  {#if notice}<p role="status" class="text-sm">{notice}</p>{/if}
  {#if loading}<Skeleton rows={2} />{:else if !rows.length}<p class="text-sm text-ink-muted">
      Aucune pièce jointe. Conservez le document reçu avant de qualifier la facture.
    </p>{:else}
    <ul class="divide-y divide-edge">
      {#each rows as row (row.id)}<li class="space-y-1 py-3">
          <p class="text-sm whitespace-pre-wrap break-words">{row.caption}</p>
          <p class="text-xs text-ink-muted">
            Ajout au brouillon · {formatDateTime(row.createdAt)} · {row.document.uploadedBy
              ?.firstName}
            {row.document.uploadedBy?.lastName}
          </p>
          <Button
            variant="ghost"
            class="max-w-full break-all text-left"
            disabled={busy || disabled}
            onclick={() => download(row)}>Télécharger {row.document.fileName}</Button
          >
        </li>{/each}
    </ul>{/if}
  {#if canManage && (status === 'DRAFT' || pending)}
    {#if pending}<div class="space-y-2 rounded-lg bg-surface-muted p-3">
        <p class="text-sm break-words">
          Pièce en attente : {pending.fileName}. La même clé sera conservée après rechargement. Le
          fichier reste sur votre ordinateur.
        </p>
        <Button
          variant="secondary"
          disabled={busy || disabled || !!storageError}
          onclick={reconcile}>Vérifier l’enregistrement</Button
        >
      </div>{/if}
    {#if status === 'DRAFT' || pending}
      <Field
        label={pending
          ? 'Resélectionner le même justificatif'
          : 'Fichier justificatif (PDF, PNG, JPEG)'}
        ><input
          bind:this={fileInput}
          class="block w-full min-w-0 rounded-lg border border-edge p-2 text-sm"
          type="file"
          accept="application/pdf,image/png,image/jpeg"
          disabled={busy || disabled || !!storageError}
          onchange={(e) => {
            file = e.currentTarget.files?.[0] ?? null;
          }}
        /></Field
      >
      {#if !pending}<Field label="Description du justificatif"
          ><Textarea bind:value={caption} maxlength={1000} disabled={busy || disabled} /></Field
        >{/if}
      <Button
        variant="secondary"
        disabled={busy ||
          disabled ||
          !!storageError ||
          !file ||
          (!pending && caption.trim().length < 3)}
        onclick={upload}>{pending ? 'Reprendre la même pièce' : 'Conserver le justificatif'}</Button
      >
    {/if}
  {/if}
</section>
