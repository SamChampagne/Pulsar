<script lang="ts">
  let {
    currency,
    coverage,
  }: {
    currency: string;
    coverage?: {
      unknownEntries: number;
      selectedEntries: number;
      qualifiedHistoricalEntries?: number;
      otherCurrencies: { currency: string; count: number }[];
    };
  } = $props();
</script>

<section aria-label="Portée du rapport" class="mb-4 rounded-md border border-edge p-3 text-sm">
  <p class="font-medium">Devise de transaction : {currency} · aucune conversion</p>
  {#if coverage}
    <p class="mt-1 text-ink-muted">
      {coverage.selectedEntries} écriture(s) incluses. {coverage.otherCurrencies.length
        ? 'Autres devises exclues : ' +
          coverage.otherCurrencies.map((c) => `${c.count} en ${c.currency}`).join(' · ')
        : 'Aucune autre devise sur cette période.'}
    </p>
    {#if coverage.qualifiedHistoricalEntries}<p class="mt-2 text-ink-muted">
        Dont {coverage.qualifiedHistoricalEntries} écriture(s) historique(s) qualifiée(s) sur preuve.
        La qualification actuellement confirmée s’applique même aux périodes anciennes.
        <a class="underline" href="/billing/ledger-qualification">Consulter les qualifications</a>
      </p>{/if}
    {#if coverage.unknownEntries}<p class="mt-2 text-warn">
        {coverage.unknownEntries} écriture(s) sans devise exclue(s). Ce rapport est partiel; un équilibre
        arithmétique ne prouve pas sa complétude.
        <a class="underline" href="/billing/ledger?unqualified=true"
          >Consulter les écritures à qualifier</a
        >
      </p>{/if}
  {/if}
  <p class="mt-1 text-xs text-ink-muted">
    Vue de contrôle non consolidée : pas encore de devise fonctionnelle, taux de change ou clôture
    de période.
  </p>
</section>
