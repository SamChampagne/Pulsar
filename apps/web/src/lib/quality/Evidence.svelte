<script lang="ts">
  import { api } from '$lib/api/client';
  import { auth, getAccessToken } from '$lib/stores/auth';
  import { Button, Field, Input } from '$lib/components/ui';
  import type { Nonconformity } from './types';
  let {
    row,
    manage,
    disabled,
    busy = $bindable(false),
    onupdated,
  }: {
    row: Nonconformity;
    manage: boolean;
    disabled: boolean;
    busy?: boolean;
    onupdated: (row: Nonconformity) => void;
  } = $props();
  type Proof = {
    id: string;
    caption: string;
    createdAt: string;
    document: {
      fileName: string;
      sizeBytes: number;
      uploadedBy: { firstName: string; lastName: string };
    };
  };
  type Intent = {
    operationKey: string;
    expectedUpdatedAt: string;
    caption: string;
    hash: string;
    fileName: string;
    mimeType: string;
  };
  let proofs = $state<Proof[]>([]),
    caption = $state(''),
    file = $state<File | null>(null),
    error = $state(''),
    loading = $state(true),
    pending = $state<Intent | null>(null),
    refresh = $state(0),
    storageError = $state(false);
  const storageKey = $derived(
    `pulsar-quality-proof:${$auth?.tenant.id}:${$auth?.user.id}:${row.id}`,
  );
  $effect(() => {
    const key = storageKey;
    pending = null;
    file = null;
    caption = '';
    storageError = false;
    try {
      const raw = localStorage.getItem(key);
      if (raw) {
        const p = JSON.parse(raw);
        if (
          !p.operationKey ||
          !p.hash ||
          !p.caption ||
          !p.expectedUpdatedAt ||
          !p.fileName ||
          !p.mimeType
        )
          throw new Error();
        pending = p;
        caption = p.caption;
      }
    } catch {
      storageError = true;
      error =
        'Impossible de lire la demande conservée. Vérifiez les preuves existantes avant de retirer cette demande.';
    }
  });
  $effect(() => {
    const id = row.id,
      version = row.updatedAt,
      r = refresh;
    let cancelled = false;
    loading = true;
    void api<Proof[]>(`/quality/nonconformities/${id}/evidence`)
      .then((p) => {
        if (!cancelled) proofs = p;
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
  async function responseError(res: Response) {
    const p = await res.json().catch(() => null);
    return new Error(
      Array.isArray(p?.message) ? p.message.join(', ') : p?.message || `Erreur ${res.status}`,
    );
  }
  async function upload() {
    if (!file || busy || disabled || storageError) return;
    busy = true;
    error = '';
    try {
      if (
        file.size > 10 * 1024 * 1024 ||
        !['application/pdf', 'image/png', 'image/jpeg'].includes(file.type)
      )
        throw new Error('PDF, PNG ou JPEG uniquement, 10 Mo maximum.');
      const hash = Array.from(
        new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer())),
      )
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
      const intent: Intent = pending ?? {
        operationKey: crypto.randomUUID(),
        expectedUpdatedAt: row.updatedAt,
        caption: caption.trim(),
        hash,
        fileName: file.name,
        mimeType: file.type,
      };
      if (intent.hash !== hash || intent.fileName !== file.name || intent.mimeType !== file.type)
        throw new Error('Rechoisissez exactement le fichier de la demande conservée.');
      localStorage.setItem(storageKey, JSON.stringify(intent));
      pending = intent;
      const body = new FormData();
      body.append('file', file);
      body.append('caption', intent.caption);
      body.append('operationKey', intent.operationKey);
      body.append('expectedUpdatedAt', intent.expectedUpdatedAt);
      const res = await fetch(`/api/v1/quality/nonconformities/${row.id}/evidence`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${getAccessToken()}` },
        body,
      });
      if (!res.ok) throw await responseError(res);
      const result = await res.json();
      localStorage.removeItem(storageKey);
      pending = null;
      file = null;
      caption = '';
      onupdated(result.nonconformity);
      refresh++;
    } catch (e) {
      error = (e as Error).message;
    } finally {
      busy = false;
    }
  }
  async function download(p: Proof) {
    busy = true;
    error = '';
    try {
      const res = await fetch(
        `/api/v1/quality/nonconformities/${row.id}/evidence/${p.id}/download`,
        { headers: { Authorization: `Bearer ${getAccessToken()}` } },
      );
      if (!res.ok) throw await responseError(res);
      const url = URL.createObjectURL(await res.blob()),
        a = document.createElement('a');
      a.href = url;
      a.download = p.document.fileName;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      error = (e as Error).message;
    } finally {
      busy = false;
    }
  }
  function discard() {
    if (
      !window.confirm(
        'Avez-vous vérifié la liste des preuves ? Retirer cette demande locale ne supprime aucun fichier déjà enregistré.',
      )
    )
      return;
    try {
      localStorage.removeItem(storageKey);
      pending = null;
      storageError = false;
      error = '';
      file = null;
      caption = '';
    } catch {
      error = 'Le stockage local reste inaccessible.';
    }
  }
</script>

<section
  class="mt-5 space-y-4 rounded-lg border border-edge bg-surface p-5"
  aria-label="Justificatifs qualité"
>
  <h2 class="font-semibold">
    Justificatifs <span class="text-ink-muted">· {proofs.length}/30</span>
  </h2>
  <p class="text-sm text-ink-muted">
    Preuves consultables avec le droit Qualité, hors du centre Documents générique. PDF, PNG et JPEG
    · 10 Mo maximum. Conservez uniquement des informations utiles au contrôle, sans données RH
    sensibles.
  </p>
  {#if error}<p role="alert" class="text-danger">{error}</p>{/if}
  {#if loading}<p>Lecture des justificatifs…</p>{:else if !proofs.length}<p class="text-ink-muted">
      Aucun justificatif ajouté.
    </p>{/if}
  {#each proofs as p (p.id)}<div
      class="flex flex-wrap items-center justify-between gap-2 border-b border-edge pb-3"
    >
      <div>
        <p class="font-medium">{p.caption}</p>
        <p class="text-xs text-ink-muted">
          {p.document.fileName} · {Math.ceil(p.document.sizeBytes / 1024)} Ko · {p.document
            .uploadedBy.firstName}
          {p.document.uploadedBy.lastName}
        </p>
      </div>
      <Button variant="secondary" disabled={busy || disabled} onclick={() => download(p)}
        >Télécharger</Button
      >
    </div>{/each}
  {#if manage && (row.status !== 'CLOSED' || pending)}
    {#if pending}<p class="rounded-lg bg-surface-muted p-3 text-sm">
        Demande conservée : {pending.fileName}. En cas de réponse perdue, rechoisissez ce fichier
        puis reprenez la même demande. Aucun nouvel envoi n’est créé.
      </p>{/if}
    <Field label="Description de la preuve"
      ><Input
        bind:value={caption}
        maxlength={500}
        disabled={busy || disabled || !!pending || storageError}
      /></Field
    >
    <Field label="Fichier justificatif"
      ><input
        type="file"
        accept="application/pdf,image/png,image/jpeg"
        disabled={busy || disabled || storageError}
        onchange={(e) => {
          file = e.currentTarget.files?.[0] ?? null;
        }}
        class="block w-full text-sm"
      /></Field
    >
    <Button
      onclick={upload}
      loading={busy}
      disabled={disabled || storageError || !file || !caption.trim() || loading}
      >{pending ? 'Reprendre la même demande' : 'Ajouter le justificatif'}</Button
    >
  {/if}
  {#if pending || storageError}<Button
      variant="secondary"
      onclick={discard}
      disabled={busy || disabled}>Retirer la demande locale après vérification</Button
    >{/if}
</section>
