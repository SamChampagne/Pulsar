<script lang="ts">
  import { untrack } from 'svelte';
  import { page as route } from '$app/stores';
  import { auth, getAccessToken } from '$lib/stores/auth';
  import { api } from '$lib/api/client';
  import {
    PageHeader,
    Button,
    Field,
    Input,
    Select,
    Table,
    Skeleton,
    Tabs,
  } from '$lib/components/ui';
  import { CURRENCIES, formatSupplierDossierMoney as money, type Paginated } from '@pulsar/shared';
  import {
    supplierDocumentHref,
    supplierDocumentLabels as labels,
    type SupplierOverview,
    type SupplierDocumentRow,
    type SupplierEvidenceRow,
  } from '$lib/billing/supplier-dossier';
  import { formatDate, formatDateTime } from '$lib/format';
  const id = $derived($route.params.id);
  const canRead = $derived(!!$auth?.user.permissions.includes('billing.supplier-invoices.read'));
  const base = $derived(`/billing/supplier-dossiers/${id}`);
  let overview = $state<SupplierOverview | null>(null),
    overviewError = $state(''),
    overviewLoading = $state(true);
  let documents = $state<SupplierDocumentRow[]>([]),
    evidence = $state<SupplierEvidenceRow[]>([]),
    total = $state(0),
    page = $state(1),
    tab = $state('documents'),
    loading = $state(true),
    error = $state(''),
    downloading = $state(''),
    downloadError = $state('');
  const blank = () => ({ search: '', kind: '', status: '', currency: '', from: '', to: '' });
  let filters = $state(blank()),
    applied = $state(blank());
  let summaryGeneration = 0,
    generation = 0;
  $effect(() => {
    void id;
    void $auth?.tenant.id;
    if (canRead)
      untrack(() => {
        filters = blank();
        applied = blank();
        void loadOverview();
      });
    else {
      overview = null;
      overviewLoading = false;
    }
    return () => {
      summaryGeneration++;
    };
  });
  $effect(() => {
    void id;
    void $auth?.tenant.id;
    void tab;
    if (canRead)
      untrack(() => {
        page = 1;
        void load();
      });
    else {
      documents = [];
      evidence = [];
      loading = false;
    }
    return () => {
      generation++;
    };
  });
  async function loadOverview() {
    const g = ++summaryGeneration;
    overviewLoading = true;
    overviewError = '';
    overview = null;
    try {
      const r = await api<SupplierOverview>(base);
      if (g === summaryGeneration) overview = r;
    } catch (e) {
      if (g === summaryGeneration) overviewError = (e as Error).message;
    } finally {
      if (g === summaryGeneration) overviewLoading = false;
    }
  }
  async function load() {
    const g = ++generation;
    loading = true;
    error = '';
    downloadError = '';
    documents = [];
    evidence = [];
    total = 0;
    const selected = tab;
    try {
      const r = await api<Paginated<SupplierDocumentRow & SupplierEvidenceRow>>(
        `${base}/${selected}`,
        { query: { page, pageSize: 20, ...applied } },
      );
      if (g === generation) {
        if (selected === 'documents') documents = r.items;
        else evidence = r.items;
        total = r.total;
      }
    } catch (e) {
      if (g === generation) error = (e as Error).message;
    } finally {
      if (g === generation) loading = false;
    }
  }
  function apply() {
    page = 1;
    applied = { ...filters };
    void load();
  }
  async function refresh() {
    await Promise.all([loadOverview(), load()]);
  }
  async function download(r: SupplierEvidenceRow) {
    if (downloading) return;
    downloading = r.id;
    downloadError = '';
    const g = generation;
    try {
      const token = getAccessToken();
      if (!token) throw Error('Reconnectez-vous pour télécharger cette pièce.');
      const family = r.kind === 'INVOICE' ? 'supplier-invoices' : 'supplier-credits';
      const response = await fetch(
        `/api/v1/billing/${family}/${r.parentId}/evidence/${r.id}/download`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (!response.ok)
        throw Error(
          'Téléchargement refusé ou indisponible. Actualisez votre session puis réessayez.',
        );
      const blob = await response.blob();
      if (g !== generation) return;
      const url = URL.createObjectURL(blob),
        a = document.createElement('a');
      a.href = url;
      a.download = r.fileName;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      if (g === generation) downloadError = (e as Error).message;
    } finally {
      downloading = '';
    }
  }
</script>

<PageHeader
  title={overview?.supplier.name ?? 'Dossier fournisseur'}
  eyebrow="Finance · Dossier documentaire"
  subtitle="Un point d’accès aux factures, avoirs et preuves. Aucune écriture comptable ni aucun paiement depuis ce dossier."
>
  {#snippet actions()}<Button href="/billing/suppliers" variant="secondary"
      >Tous les fournisseurs</Button
    ><Button variant="secondary" disabled={loading || overviewLoading || !canRead} onclick={refresh}
      >Actualiser</Button
    ><Button variant="secondary" href={`/billing/supplier-schedules?supplierId=${id}`}>Échéances fournisseur</Button>{/snippet}
</PageHeader>
{#if !canRead}<p role="alert">La lecture des factures fournisseur est nécessaire.</p>{:else}
  {#if overviewError}<div role="alert" class="mb-4 text-danger">
      {overviewError}<Button variant="secondary" onclick={loadOverview}
        >Recharger la synthèse</Button
      >
    </div>{/if}
  {#if overviewLoading}<Skeleton rows={3} />{:else if overview}
    <section aria-label="Synthèse documentaire" class="mb-6 space-y-3">
      <div class="flex flex-wrap items-center justify-between gap-2 text-sm">
        <p>
          <span class="font-mono">{overview.supplier.code}</span> · {overview.supplier.active
            ? 'Fournisseur actif'
            : 'Fournisseur désactivé'}{#if !overview.supplier.isSupplier}
            · Historique conservé{/if}
        </p>
        <p class="text-xs text-ink-muted">Lecture du {formatDateTime(overview.asOf)}</p>
      </div>
      <p class="text-sm text-ink-muted">
        Identité courante du référentiel. Chaque document conserve le nom capturé à sa création.
      </p>
      <div class="rounded-card border border-edge bg-surface p-4">
        <h2 class="mb-3 font-medium">Synthèse des documents qualifiés</h2>
        {#if overview.currencies.length}<div class="hidden sm:block">
            <Table
              >{#snippet head()}<th>Devise</th><th>Factures qualifiées</th><th>Avoirs qualifiés</th
                ><th>Reste documentaire</th>{/snippet}
              {#snippet body()}{#each overview?.currencies ?? [] as r (r.currency)}<tr
                    ><td class="font-medium">{r.currency}</td><td
                      class="whitespace-nowrap font-mono"
                      >{money(r.qualifiedInvoices, r.currency)}
                      <div class="font-sans text-xs text-ink-muted">
                        {r.invoiceCount} facture(s)
                      </div></td
                    ><td class="whitespace-nowrap font-mono"
                      >{money(r.qualifiedCredits, r.currency)}
                      <div class="font-sans text-xs text-ink-muted">
                        {r.creditCount} avoir(s)
                      </div></td
                    ><td class="whitespace-nowrap font-mono"
                      >{#if r.documentaryRemaining !== null}{money(
                          r.documentaryRemaining,
                          r.currency,
                        )}{:else}<span class="text-danger">Incohérence à vérifier</span>{/if}</td
                    ></tr
                  >{/each}{/snippet}
            </Table>
          </div>
          <div class="space-y-3 sm:hidden">
            {#each overview.currencies as r (r.currency)}
              <section
                aria-label={`Synthèse ${r.currency}`}
                class="rounded-md border border-edge p-3"
              >
                <h3 class="mb-2 font-semibold">{r.currency}</h3>
                <dl class="space-y-2 text-sm">
                  <div>
                    <dt class="text-ink-muted">{r.invoiceCount} facture(s) qualifiée(s)</dt>
                    <dd class="break-all font-mono">{money(r.qualifiedInvoices, r.currency)}</dd>
                  </div>
                  <div>
                    <dt class="text-ink-muted">{r.creditCount} avoir(s) qualifié(s)</dt>
                    <dd class="break-all font-mono">{money(r.qualifiedCredits, r.currency)}</dd>
                  </div>
                  <div class="border-t border-edge pt-2">
                    <dt class="font-medium">Reste documentaire</dt>
                    <dd class="break-all font-mono">
                      {#if r.documentaryRemaining !== null}{money(
                          r.documentaryRemaining,
                          r.currency,
                        )}{:else}<span class="text-danger">Incohérence à vérifier</span>{/if}
                    </dd>
                  </div>
                </dl>
              </section>
            {/each}
          </div>
        {:else}<p class="text-sm text-ink-muted">
            Aucun document qualifié : aucun montant à consolider.
          </p>{/if}
        <p class="mt-3 text-xs leading-5 text-ink-muted">
          Historique complet, indépendant des filtres ci-dessous. Factures moins avoirs qualifiés,
          sans conversion de devise. Ce reste n’est pas une dette à payer : il ne tient compte
          d’aucun règlement ni d’aucune comptabilisation.
        </p>
      </div>
      <p class="text-sm text-ink-muted">
        Hors montants : {overview.counts.invoiceDraft} facture(s) et {overview.counts.creditDraft} avoir(s)
        en brouillon · {overview.counts.invoiceCancelled} facture(s) et {overview.counts
          .creditCancelled} avoir(s) annulé(s).
      </p>
    </section>
  {/if}
  <Tabs
    tabs={[
      { id: 'documents', label: 'Factures et avoirs' },
      { id: 'evidence', label: 'Pièces justificatives' },
    ]}
    bind:active={tab}
    label="Contenu du dossier fournisseur"
  >
    <form
      class="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
      onsubmit={(e) => {
        e.preventDefault();
        apply();
      }}
    >
      <Field label="Recherche dans le dossier"
        ><Input
          bind:value={filters.search}
          maxlength={200}
          placeholder={tab === 'evidence'
            ? 'Numéro, fichier ou description'
            : 'Numéro ou nom capturé'}
        /></Field
      >
      <Field label="Type de document"
        ><Select bind:value={filters.kind}
          ><option value="">Factures et avoirs</option><option value="INVOICE">Factures</option
          ><option value="CREDIT">Avoirs</option></Select
        ></Field
      >
      <Field label="Statut documentaire"
        ><Select bind:value={filters.status}
          ><option value="">Tous les statuts</option><option value="DRAFT">Brouillons</option
          ><option value="QUALIFIED">Qualifiés</option><option value="CANCELLED">Annulés</option
          ></Select
        ></Field
      >
      <Field label="Devise"
        ><Select bind:value={filters.currency}
          ><option value="">Toutes les devises</option>{#each CURRENCIES as c}<option value={c.code}
              >{c.code}</option
            >{/each}</Select
        ></Field
      >
      <Field label="Date du document — du"
        ><Input type="date" min="1900-01-01" max="2199-12-31" bind:value={filters.from} /></Field
      >
      <Field label="Date du document — au"
        ><Input type="date" min="1900-01-01" max="2199-12-31" bind:value={filters.to} /></Field
      >
      <div class="flex items-end gap-2">
        <Button type="submit" disabled={loading}>Appliquer</Button><Button
          variant="secondary"
          disabled={loading}
          onclick={() => {
            filters = blank();
            apply();
          }}>Réinitialiser</Button
        >
      </div>
    </form>
    <p class="mb-3 text-xs text-ink-muted">
      Dates civiles inclusives des factures ou avoirs, et non dates de dépôt des pièces. Les filtres
      s’appliquent après « Appliquer ».
    </p>
    {#if error}<div role="alert" class="mb-4 text-danger">
        {error}
        <Button variant="secondary" onclick={load}>Réessayer</Button>
      </div>{/if}
    {#if downloadError}<p role="alert" class="mb-4 text-danger">{downloadError}</p>{/if}
    {#if loading}<Skeleton rows={5} />{:else if !error}
      {#if total === 0}<div class="rounded-card border border-edge bg-surface p-6">
          <h2 class="font-medium">
            {tab === 'documents' ? 'Aucun document trouvé' : 'Aucune pièce trouvée'}
          </h2>
          <p class="mt-2 text-sm text-ink-muted">
            Vérifiez les filtres. Les pièces s’ajoutent sur leur facture ou leur avoir, pas depuis
            ce dossier de consultation.
          </p>
          <Button href="/billing/supplier-invoices" variant="ghost"
            >Ouvrir le registre des factures</Button
          >
        </div>
      {:else if tab === 'documents'}
        <div class="hidden sm:block">
          <Table
            >{#snippet head()}<th>Document</th><th>Date civile</th><th>Statut</th><th
                >Montant déclaré</th
              ><th>Original</th><th><span class="sr-only">Consulter</span></th>{/snippet}
            {#snippet body()}{#each documents as r (`${r.kind}:${r.id}`)}<tr
                  ><td
                    ><div class="font-medium">
                      {r.kind === 'INVOICE' ? 'Facture' : 'Avoir'} · {r.number}
                    </div>
                    <div class="text-xs text-ink-muted">Réf. {r.externalNumber}</div>
                    <div class="text-xs text-ink-muted">Nom capturé : {r.supplierNameSnapshot}</div>
                    {#if r.kind === 'CREDIT'}<div class="text-xs text-ink-muted">
                        Sur {r.invoiceNumber}
                      </div>{/if}</td
                  ><td class="whitespace-nowrap">{formatDate(r.documentDate.slice(0, 10))}</td><td
                    >{labels[r.status] ?? r.status}</td
                  ><td class="whitespace-nowrap font-mono">{money(r.totalAmount, r.currency)}</td
                  ><td>{r.hasOriginal ? 'Sélectionné' : 'Non sélectionné'}</td><td
                    ><Button href={supplierDocumentHref(r)} variant="ghost"
                      >Ouvrir {r.number}</Button
                    ></td
                  ></tr
                >{/each}{/snippet}
          </Table>
        </div>
        <div class="space-y-3 sm:hidden">
          {#each documents as r (`${r.kind}:${r.id}`)}
            <article class="space-y-3 rounded-card border border-edge bg-surface p-4">
              <div>
                <h3 class="font-medium">
                  {r.kind === 'INVOICE' ? 'Facture' : 'Avoir'} · {r.number}
                </h3>
                <p class="break-all text-xs text-ink-muted">Réf. {r.externalNumber}</p>
                <p class="text-xs text-ink-muted">Nom capturé : {r.supplierNameSnapshot}</p>
                {#if r.kind === 'CREDIT'}<p class="text-xs text-ink-muted">
                    Sur {r.invoiceNumber}
                  </p>{/if}
              </div>
              <dl class="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <dt class="text-xs text-ink-muted">Date civile</dt>
                  <dd>{formatDate(r.documentDate.slice(0, 10))}</dd>
                </div>
                <div>
                  <dt class="text-xs text-ink-muted">Statut</dt>
                  <dd>{labels[r.status] ?? r.status}</dd>
                </div>
                <div>
                  <dt class="text-xs text-ink-muted">Montant déclaré</dt>
                  <dd class="break-all font-mono">{money(r.totalAmount, r.currency)}</dd>
                </div>
                <div>
                  <dt class="text-xs text-ink-muted">Original</dt>
                  <dd>{r.hasOriginal ? 'Sélectionné' : 'Non sélectionné'}</dd>
                </div>
              </dl>
              <Button href={supplierDocumentHref(r)} variant="secondary">Ouvrir {r.number}</Button>
            </article>
          {/each}
        </div>
      {:else}
        <div class="hidden sm:block">
          <Table
            >{#snippet head()}<th>Justificatif</th><th>Document parent</th><th>Dépôt</th><th
                ><span class="sr-only">Actions sur la pièce</span></th
              >{/snippet}
            {#snippet body()}{#each evidence as r (`${r.kind}:${r.id}`)}<tr
                  ><td
                    ><div class="break-all font-medium">{r.fileName}</div>
                    <p class="max-w-md text-sm">{r.caption}</p>
                    <div class="text-xs text-ink-muted">
                      {r.mimeType} · {r.sizeBytes} octets · {r.isOriginal
                        ? 'Original sélectionné'
                        : 'Pièce complémentaire'}
                    </div></td
                  ><td
                    ><div>{r.kind === 'INVOICE' ? 'Facture' : 'Avoir'} · {r.number}</div>
                    <div class="text-xs text-ink-muted">{labels[r.status]} · {r.currency}</div></td
                  ><td class="whitespace-nowrap text-xs">{formatDateTime(r.createdAt)}</td><td
                    ><div class="flex flex-col items-start gap-1">
                      <Button variant="ghost" href={supplierDocumentHref(r)}
                        >Ouvrir {r.number}</Button
                      ><Button
                        variant="secondary"
                        disabled={!!downloading}
                        onclick={() => download(r)}>Télécharger {r.fileName}</Button
                      >
                    </div></td
                  ></tr
                >{/each}{/snippet}
          </Table>
        </div>
        <div class="space-y-3 sm:hidden">
          {#each evidence as r (`${r.kind}:${r.id}`)}
            <article class="space-y-3 rounded-card border border-edge bg-surface p-4">
              <div>
                <h3 class="break-all font-medium">{r.fileName}</h3>
                <p class="break-words text-sm">{r.caption}</p>
                <p class="text-xs text-ink-muted">{r.mimeType} · {r.sizeBytes} octets</p>
              </div>
              <div class="text-sm">
                <p>{r.kind === 'INVOICE' ? 'Facture' : 'Avoir'} · {r.number}</p>
                <p>{labels[r.status]} · {r.currency}</p>
                <p class="font-medium">
                  {r.isOriginal ? 'Original sélectionné' : 'Pièce complémentaire'}
                </p>
                <p class="text-xs text-ink-muted">Dépôt : {formatDateTime(r.createdAt)}</p>
              </div>
              <div class="flex flex-col items-start gap-2">
                <Button variant="secondary" href={supplierDocumentHref(r)}>Ouvrir {r.number}</Button
                ><Button
                  variant="secondary"
                  disabled={!!downloading}
                  onclick={() => download(r)}
                  class="max-w-full break-all">Télécharger {r.fileName}</Button
                >
              </div>
            </article>
          {/each}
        </div>
      {/if}
      <div class="mt-4 flex flex-wrap items-center gap-3">
        <span class="text-sm text-ink-muted">{total} résultat(s) · page {page}</span><Button
          variant="secondary"
          disabled={page === 1}
          onclick={() => {
            page--;
            void load();
          }}>Précédent</Button
        ><Button
          variant="secondary"
          disabled={page * 20 >= total}
          onclick={() => {
            page++;
            void load();
          }}>Suivant</Button
        >
      </div>
    {/if}
  </Tabs>
{/if}
