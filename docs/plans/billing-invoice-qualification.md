# Finance I2m.2d.2b — factures historiques et avoirs

## Usage

Finance → Reprise du journal accepte les écritures de factures clients et de
transporteurs à devise originale NULL. Le journal doit déjà exister : cette reprise
n’est pas une commande de comptabilisation. Finance seul suffit, sans Transport,
Services ou Achats activés. La cible Pulsar/externe du tenant reste inchangée.

1. Ouvrir l’original de la facture. Relire le hors taxes, les taxes figées, le total,
   la devise source et le nombre d’avoirs émis rapprochés.
2. Conserver une preuve PDF/PNG/JPEG, décrire l’original et motiver la décision.
3. Préparer la revue : facture et avoirs historiques sans devise forment un groupe.
   Confirmer humainement avec `billing.ledger.qualify`.
4. Depuis un avoir historique, revenir à la facture originale; aucun choix séparé.
5. Le retrait exige preuve et motif et exclut tout le groupe NULL ensemble.
   **Un avoir à devise connue bloque le retrait isolé de la qualification.**
   Une correction comptable coordonnée sera nécessaire; elle n’est pas automatisée.

## Contrôles et conservation

- Lecture du journal + `billing.customer-invoices.read` ou `billing.invoices.read`
  selon la source, y compris preuves, téléchargement, historique et replay.
  Qualification = droit dédié + personne active; aucun nouvel outil agent.
- Facture client APPROVED/SENT/PAID, transporteur APPROVED/PAID; tiers dans le tenant.
  Lignes et comptes du journal vérifiés, pas de lecture partielle d’une propriété
  incohérente. Les lignes transporteur doivent référencer un load du même tenant;
  ses informations opérationnelles ne sont pas exposées.
- Net des lignes + taxes capturées = total du document, cents exacts Shared/BigInt.
  Aucune limite arbitraire de trois taxes; plusieurs lignes par compte peuvent
  s’additionner exactement. Aucun recalcul de taux, gabarit ou arrondi correcteur.
- Structure conservatrice : compte client ASSET / revenu REVENUE / taxes LIABILITY;
  transporteur : charge EXPENSE / fournisseur LIABILITY / taxes ASSET. Comptes
  originaux, jamais les réglages actuels. Comptes historiques inactifs lisibles;
  un nouveau posting exige toujours des comptes actifs via LedgerService.
- Un original unique; un journal par avoir ISSUED, aucun pour DRAFT/CANCELLED.
  Devise identique, lignes d’avoir liées à cette facture, quantités et nets cumulés
  bornés, taxes/lignes/totaux exacts, cumul égal au crédit enregistré sur la facture.
  Les avoirs compensent les mêmes comptes, dans la limite des montants figés.
- NULL d’origine conservé, aucune réécriture de date, ligne, compte, montant ou
  solde. Annotations QUALIFIED/WITHDRAWN séparées, versions alignées, sourceEntryId
  vers l’original. Révision append-only sur l’original, audit atomique avec le groupe.
  Aucun nouveau schéma ni migration : réutilisation de la migration 137.
- Verrou business tenant → ligne facture → verrou GL. Le writer d’avoir prend
  également le verrou facture avant GL. Source et groupe recontrôlés à confirmation,
  empreinte de revue liée aux faits et à l’acteur; changement après revue ⇒ 409.
- Avoirs à devise déjà connue : contrôlés, jamais annotés ni réécrits. Un nouvel
  avoir après qualification utilise la devise connue et les comptes de l’original.
  Il bloque une confirmation de retrait préparée avant son émission.
- Reprise exacte UUID/acteur/corps après réponse incertaine, avant contrôle du
  nouvel état mais après contrôle des droits. Documents protégés non supprimables.
- Rapports et budgets réutilisent la devise effective existante. La qualification
  actuelle vaut aussi sur les anciennes périodes : pas une balance de connaissance
  historique. Les dates de posting existantes restent affichées sans être inventées
  à partir de la date d’approbation.

## Interface, documentation et tutoriel

Le poste Pulsar existant accueille une synthèse spécifique facture : net, taxes,
total, avoirs, portée de décision et devise source en lecture seule. Le blocage du
retrait est visible; historique et preuves restent consultables. Layout bureau et
390 px, aucune nouvelle bibliothèque ni nouveau menu. Dix-septième leçon Finance,
aide de page et Documentation enrichies sans réinitialiser les tours utilisateur.

## Limites explicites

La reprise distincte des [paiements partiellement affectés](billing-partial-payment-qualification.md)
est désormais livrée en I2m.2d.2c; elle n'élargit pas le contrat des factures ci-dessous.

Pas de reprise de facture sans journal, de sous-livre fournisseur documentaire,
de paiements partiellement affectés, de change, clôture, actif historique ou
certification fiscale. Pièce jointe et hash ne prouvent pas sa véracité.

Une facture transporteur ajustée par acceptation du montant reçu peut conserver
des lignes attendues différentes du payable du header. Initialement bloquée ici,
elle dispose désormais de l'extension [I2m.2d.2d](billing-accepted-carrier-qualification.md)
si son acceptation est tracée et son journal exact. Jamais de reconstitution du
payable à partir des lignes attendues ni de correction implicite.
Les formes comptables non standard, nets nuls/négatifs, au-delà de 500 lignes de
facture, 200 avoirs, 100 lignes d’avoir ou 200 lignes de journal demandent une reprise
spécialisée. Ces limites sont refusées explicitement, pas tronquées silencieusement.

## Recette

Tests Shared de montants/taxes/structure et compensation; HTTP de qualification
groupée, retrait, droits/perte de rôle, tenant, incohérences, revue périmée, avoir
connu et nouvel avoir, rollback audit; UI preuve/revue/confirmation/retrait,
source en lecture seule, blocage et formats bureau/mobile.
Résultats datés dans [le point de reprise](../etat-du-projet.md).

Suite : reprise spécialisée des sources encore bloquées, puis périodes/clôtures
et change explicites avant d’étendre le sous-livre et le lettrage.
