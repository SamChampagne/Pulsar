<script lang="ts">
  import { PERMISSIONS, CURRENCIES } from '@pulsar/shared';
  import { auth } from '$lib/stores/auth';
  import { confirmAction } from '$lib/stores/confirmation';
  import {
    freightStatus,
    type FreightInvoice as IncomingInvoice,
  } from '$lib/billing/freight-audit';
  import { api, ApiError } from '$lib/api/client';
  import { toast } from '$lib/stores/toast';
  import { fmtCustomValue, formatMoney as money } from '$lib/format';
  import CustomFieldInputs from '$lib/components/CustomFieldInputs.svelte';
  import {
    PageHeader,
    Button,
    Card,
    Table,
    Badge,
    EmptyState,
    Skeleton,
    Drawer,
    EntityPicker,
    ReferenceSelect,
    Select,
    Field,
    Input,
    ErrorNotice,
    type Tone,
  } from '$lib/components/ui';

  interface Savings {
    byCurrency: { currency: string; recovered: number }[];
    byAgent: { agentId: string; recovered: string }[];
  }

  interface CustomFieldDef {
    key: string;
    label: string;
    type: 'TEXT' | 'NUMBER' | 'DATE' | 'BOOLEAN' | 'SELECT';
    options?: { value: string; label: string }[];
    required: boolean;
    showInList: boolean;
  }

  function statusTone(status: string): Tone {
    return freightStatus[status]?.tone ?? 'neutral';
  }
  const canManage = $derived(
    $auth?.user.permissions.includes(PERMISSIONS.BILLING.FREIGHT_AUDIT_MANAGE),
  );
  let search = $state('');
  let status = $state('');
  let auxiliaryError = $state('');
  let definitionsReady = $state(false);
  let invoices = $state<IncomingInvoice[]>([]);
  const visible = $derived(
    invoices.filter(
      (invoice) =>
        (!status || invoice.status === status) &&
        `${invoice.carrierInvoiceNumber} ${invoice.carrier.name}`
          .toLocaleLowerCase()
          .includes(search.trim().toLocaleLowerCase()),
    ),
  );
  let savings = $state<Savings | null>(null);
  let loading = $state(true);
  let error = $state('');
  let customFieldDefs = $state<CustomFieldDef[]>([]);

  const flaggedCount = $derived(
    invoices.filter((i) => i.status === 'FLAGGED' || i.status === 'DISPUTED').length,
  );
  const receivedCount = $derived(invoices.filter((i) => i.status === 'RECEIVED').length);
  const currencySavings = $derived(savings?.byCurrency ?? []);
  const listCustomDefs = $derived(customFieldDefs.filter((d) => d.showInList));

  async function load() {
    loading = true;
    error = '';
    try {
      invoices = await api<IncomingInvoice[]>('/freight-audit/incoming-invoices');
    } catch (e) {
      error = e instanceof ApiError ? e.message : 'Échec du chargement des factures transporteur';
    } finally {
      loading = false;
    }
  }
  async function loadAuxiliary() {
    auxiliaryError = '';
    const [sav, defs] = await Promise.allSettled([
      api<Savings>('/freight-audit/savings', { query: { days: 30 } }),
      api<CustomFieldDef[]>('/billing/custom-fields', {
        query: { entityType: 'INCOMING_CARRIER_INVOICE' },
      }),
    ]);
    if (sav.status === 'fulfilled') savings = sav.value;
    else {
      savings = null;
      auxiliaryError = 'Les économies sont temporairement indisponibles. ';
    }
    definitionsReady = defs.status === 'fulfilled';
    if (defs.status === 'fulfilled') customFieldDefs = defs.value;
    else
      auxiliaryError +=
        'Les champs personnalisés sont indisponibles. La saisie est suspendue pour conserver leurs validations.';
  }
  $effect(() => {
    void load();
    void loadAuxiliary();
  });

  // ── Manual intake form (modal) ─────────────────────────────────────────────
  interface LineDraft {
    lineRef: string;
    chargedAmount: string;
  }

  let modalOpen = $state(false);
  let carrierId = $state('');
  let carrierInvoiceNumber = $state('');
  let currency = $state('');
  let lines = $state<LineDraft[]>([{ lineRef: '', chargedAmount: '' }]);
  let customData = $state<Record<string, unknown>>({});
  let saving = $state(false);
  let formError = $state('');
  const dirty = $derived(
    Boolean(
      carrierId ||
      carrierInvoiceNumber ||
      currency ||
      Object.keys(customData).length ||
      lines.length > 1 ||
      lines.some((l) => l.lineRef || String(l.chargedAmount ?? '')),
    ),
  );
  function closeForm() {
    if (saving) return false;
    if (!dirty) return true;
    void confirmAction('La facture non enregistrée sera abandonnée.', {
      title: 'Fermer la saisie ?',
      confirmLabel: 'Abandonner',
    }).then((accepted) => {
      if (accepted) {
        resetForm();
        modalOpen = false;
      }
    });
    return false;
  }

  function resetForm() {
    formError = '';
    carrierId = '';
    carrierInvoiceNumber = '';
    currency = '';
    lines = [{ lineRef: '', chargedAmount: '' }];
    customData = {};
  }

  function addLine() {
    lines = [...lines, { lineRef: '', chargedAmount: '' }];
  }

  function removeLine(index: number) {
    lines = lines.filter((_, i) => i !== index);
  }

  const canSubmit = $derived(
    definitionsReady &&
      canManage &&
      carrierId.trim() !== '' &&
      carrierInvoiceNumber.trim() !== '' &&
      lines.length > 0 &&
      lines.every((l) => l.lineRef.trim() !== '' && String(l.chargedAmount ?? '').trim() !== ''),
  );

  async function create(event: SubmitEvent) {
    event.preventDefault();
    if (!canSubmit || saving) return;
    formError = '';
    saving = true;
    try {
      await api<IncomingInvoice>('/freight-audit/incoming-invoices', {
        method: 'POST',
        body: {
          carrierId: carrierId.trim(),
          carrierInvoiceNumber: carrierInvoiceNumber.trim(),
          ...(currency.trim() ? { currency: currency.trim().toUpperCase() } : {}),
          lines: lines.map((l) => ({
            lineRef: l.lineRef.trim(),
            chargedAmount: Number(l.chargedAmount),
          })),
          ...(Object.keys(customData).length > 0 ? { customData } : {}),
        },
      });
      toast.success('Facture transporteur saisie');
      resetForm();
      modalOpen = false;
      await load();
    } catch (e) {
      formError = e instanceof ApiError ? e.message : 'Échec de la saisie de la facture';
    } finally {
      saving = false;
    }
  }
</script>

<PageHeader
  title="Audit transporteur"
  subtitle="Comparer les factures aux coûts figés, examiner les écarts et suivre les litiges."
>
  {#snippet actions()}
    {#if canManage}<Button
        variant="primary"
        disabled={!definitionsReady}
        onclick={() => {
          modalOpen = true;
        }}>Saisir une facture</Button
      >{/if}
  {/snippet}
</PageHeader>

<svelte:head><title>Audit transporteur · Pulsar</title></svelte:head>
<div class="mb-5 grid gap-4 lg:grid-cols-[2fr_1fr]">
  <Card>
    <h2 class="text-sm font-medium">File de travail</h2>
    <div class="mt-3 flex flex-wrap gap-5 text-sm">
      <span
        ><strong class="text-xl tabular-nums">{loading || error ? '—' : receivedCount}</strong> à rapprocher</span
      >
      <span
        ><strong class="text-xl tabular-nums">{loading || error ? '—' : flaggedCount}</strong> écarts
        ou litiges</span
      >
    </div>
    <p class="mt-3 text-xs text-ink-muted">
      Comptages sur les {invoices.length} derniers dossiers chargés (50 maximum).
    </p>
  </Card>
  <Card>
    <h2 class="text-sm font-medium">Économies suivies · 30 jours</h2>
    <div class="mt-3 space-y-1 text-lg font-semibold tabular-nums">
      {#if !savings}—{:else}{#each currencySavings as bucket}<div>
            {money(bucket.recovered, bucket.currency)}
          </div>{:else}<span class="text-sm font-normal text-ink-muted"
            >Aucune résolution sur la période</span
          >{/each}{/if}
    </div>
    <p class="mt-3 text-xs text-ink-muted">
      Montants issus des résolutions, séparés par devise. Aucun encaissement bancaire confirmé.
    </p>
  </Card>
</div>
<ErrorNotice message={auxiliaryError} onretry={loadAuxiliary} />
<div class="mb-4 grid gap-3 sm:grid-cols-[1fr_14rem]">
  <Field label="Rechercher dans les dossiers chargés"
    ><Input bind:value={search} placeholder="Facture ou transporteur" /></Field
  >
  <Field label="Statut"
    ><Select bind:value={status}
      ><option value="">Tous les statuts</option
      >{#each Object.entries(freightStatus) as [code, item]}<option value={code}
          >{item.label}</option
        >{/each}</Select
    ></Field
  >
</div>

<ErrorNotice message={error} onretry={load} />

{#if loading}
  <Card padded={false}><Skeleton rows={6} /></Card>
{:else if !error}
  <Table>
    {#snippet head()}
      <th>Facture #</th><th>Transporteur</th><th class="text-right">Total facturé</th>
      <th>Statut</th><th class="text-right">Écart (brut)</th>
      {#each listCustomDefs as def (def.key)}<th>{def.label}</th>{/each}
    {/snippet}
    {#snippet body()}
      {#each visible as invoice (invoice.id)}
        <tr>
          <td>
            <a
              href={`/billing/freight-audit/${invoice.id}`}
              class="text-sm font-semibold text-accent hover:underline"
              >{invoice.carrierInvoiceNumber}</a
            >
          </td>
          <td>{invoice.carrier.name}</td>
          <td class="text-right">{money(invoice.chargedTotal, invoice.currency)}</td>
          <td
            ><Badge tone={statusTone(invoice.status)}
              >{freightStatus[invoice.status]?.label ?? invoice.status}</Badge
            ></td
          >
          <td class="text-right"
            >{invoice.varianceGross === null
              ? '—'
              : money(invoice.varianceGross, invoice.currency)}</td
          >
          {#each listCustomDefs as def (def.key)}
            <td>{fmtCustomValue(invoice.customData?.[def.key], def.type)}</td>
          {/each}
        </tr>
      {:else}
        <tr
          ><td colspan={5 + listCustomDefs.length}
            ><EmptyState
              title={invoices.length ? 'Aucun dossier correspondant' : 'Aucune facture à auditer'}
              message={invoices.length
                ? 'Modifiez la recherche ou le statut. Les filtres portent sur les 50 derniers dossiers.'
                : 'Saisissez une facture et ses références de chargement pour comparer les montants.'}
            >
              {#snippet children()}{#if canManage}<Button
                    disabled={!definitionsReady}
                    onclick={() => {
                      modalOpen = true;
                    }}>Saisir une facture</Button
                  >{/if}{/snippet}
            </EmptyState></td
          ></tr
        >
      {/each}
    {/snippet}
  </Table>
{/if}

<Drawer
  bind:open={modalOpen}
  title="Saisir une facture transporteur"
  width="lg"
  dismissible={!saving}
  onbeforeclose={closeForm}
>
  {#snippet children()}
    <form id="freight-intake" onsubmit={create}>
      <ErrorNotice message={formError} />
      <fieldset class="min-w-0" disabled={saving}>
        <EntityPicker
          endpoint="/billing/freight-audit/data/carriers"
          label="Transporteur"
          bind:value={carrierId}
          disabled={saving}
        />
        <div class="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Numéro de facture transporteur">
            <Input bind:value={carrierInvoiceNumber} required placeholder="ex. INV-12345" />
          </Field>
          <Field label="Devise">
            <ReferenceSelect
              options={CURRENCIES.map((c) => ({ value: c.code, label: c.name }))}
              bind:value={currency}
              clearable
              placeholder="Défaut de facturation"
            />
          </Field>
        </div>

        <div class="mt-4">
          <span class="mb-1.5 block text-xs font-semibold tracking-wide text-ink-muted uppercase">
            Lignes
          </span>
          <p class="mb-3 text-sm text-ink-muted">
            La référence doit correspondre au numéro exact d’un chargement de ce transporteur. Une
            référence inconnue restera à examiner.
          </p>
          <div class="space-y-3">
            {#each lines as line, i (i)}
              <div class="grid items-end gap-2 sm:grid-cols-[1fr_9rem_auto]">
                <div class="flex-1">
                  <Field label={`Chargement · ligne ${i + 1}`}>
                    <Input bind:value={line.lineRef} required placeholder="Numéro du chargement" />
                  </Field>
                </div>
                <div>
                  <Field label={`Montant facturé · ligne ${i + 1}`}>
                    <Input
                      type="number"
                      step="0.01"
                      required
                      bind:value={line.chargedAmount}
                      placeholder="0.00"
                    />
                  </Field>
                </div>
                <Button variant="ghost" onclick={() => removeLine(i)} disabled={lines.length === 1}
                  >Retirer</Button
                >
              </div>
            {/each}
          </div>
          <div class="mt-2">
            <Button variant="secondary" onclick={addLine}>Ajouter une ligne</Button>
          </div>
        </div>

        {#if customFieldDefs.length > 0}
          <div class="mt-4">
            <span class="mb-1.5 block text-xs font-semibold tracking-wide text-ink-muted uppercase">
              Champs personnalisés
            </span>
            <CustomFieldInputs definitions={customFieldDefs} bind:data={customData} />
          </div>
        {/if}
      </fieldset>
    </form>
  {/snippet}
  {#snippet footer()}
    <Button
      variant="secondary"
      disabled={saving}
      onclick={() => {
        if (closeForm()) modalOpen = false;
      }}>Fermer</Button
    >
    <Button
      variant="primary"
      loading={saving}
      disabled={!canSubmit || saving}
      onclick={() => {
        document.querySelector<HTMLFormElement>('#freight-intake')?.requestSubmit();
      }}>Enregistrer la facture</Button
    >
  {/snippet}
</Drawer>
