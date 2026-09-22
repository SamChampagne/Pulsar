<script lang="ts">
  import { auth } from '$lib/stores/auth';
  import { PageHeader, Button } from '$lib/components/ui';
  const read = $derived($auth?.user.permissions.includes('hr.read')),
    self = $derived($auth?.user.permissions.includes('hr.self'));
</script>

<PageHeader
  title="Ressources humaines"
  subtitle="Les personnes, leurs équipes et les absences validées. Un premier socle professionnel, sans paie."
/>
<div class="grid gap-4 lg:grid-cols-3">
  {#if read}<section class="space-y-3 rounded-lg border border-edge bg-surface p-5">
      <p class="text-xs font-medium uppercase tracking-wide text-ink-muted">01 · Référentiel</p>
      <h2 class="text-lg font-semibold">Vos employés</h2>
      <p class="text-sm text-ink-muted">
        Un matricule stable, un poste et une équipe. Le dossier RH n’est pas un compte de connexion.
      </p>
      <div class="flex flex-wrap gap-2">
        <Button href="/hr/employees">Employés</Button><Button href="/hr/teams" variant="secondary"
          >Équipes</Button
        >
      </div>
    </section>
    <section class="space-y-3 rounded-lg border border-edge bg-surface p-5">
      <p class="text-xs font-medium uppercase tracking-wide text-ink-muted">02 · Décisions</p>
      <h2 class="text-lg font-semibold">Absences d’équipe</h2>
      <p class="text-sm text-ink-muted">
        Préparer, soumettre et faire approuver les dates par une autre personne habilitée. Chaque
        décision reste au dossier.
      </p>
      <Button href="/hr/leaves">Suivre les absences</Button>
    </section>{/if}
  {#if read}<section class="space-y-3 rounded-lg border border-edge bg-surface p-5">
      <p class="text-xs font-medium uppercase tracking-wide text-ink-muted">04 · Savoir-faire</p>
      <h2 class="text-lg font-semibold">Compétences et habilitations</h2>
      <p class="text-sm text-ink-muted">
        Définir les savoir-faire attendus, attester leur validité et conserver l’historique des
        renouvellements et révocations.
      </p>
      <div class="flex flex-wrap gap-2">
        <Button href="/hr/qualifications">Habilitations</Button><Button
          href="/hr/skills"
          variant="secondary">Référentiel</Button
        >
      </div>
    </section>{/if}
  {#if self}<section class="space-y-3 rounded-lg border border-edge bg-surface p-5">
      <p class="text-xs font-medium uppercase tracking-wide text-ink-muted">
        03 · Espace personnel
      </p>
      <h2 class="text-lg font-semibold">Mes absences</h2>
      <p class="text-sm text-ink-muted">
        Retrouver uniquement les demandes de votre dossier employé et soumettre une nouvelle
        période.
      </p>
      <Button href="/hr/self">Mon espace</Button>
    </section>{/if}
</div>
<div class="mt-6 border-t border-edge pt-5 text-sm text-ink-muted">
  <p>
    Une absence approuvée ne bloque pas encore les affectations Services ni le planning Fabrication.
    Aucun solde légal, bulletin de paie ou remplacement automatique n’est calculé.
  </p>
  <a class="mt-2 inline-block text-accent hover:underline" href="/documentation?module=hr"
    >Comprendre les règles et les connexions RH</a
  >
</div>
