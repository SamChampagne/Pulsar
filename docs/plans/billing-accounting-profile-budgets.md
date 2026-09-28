# Finance I2m.2b — cible comptable et budgets qualifiés

Décision utilisateur : rôle comptable configurable par entreprise, cible Pulsar
native ou logiciel externe de référence. Ce profil exprime une cible, pas une
activation de comptabilité officielle ni une connexion à un logiciel tiers.

## Contrat

- Profil append-only par tenant, version attendue, motif, UUID lié à l'acteur et
  au corps. Droit dédié `billing.accounting.configure`, lecture `billing.ledger.read`.
  La devise fonctionnelle **cible** n'est jamais un défaut de posting ni de conversion.
- Budgets nouveaux : devise explicite et bornes civiles UTC inclusives figées;
  exercice = année de début, période au plus 366 jours. Lignes exactes, comptes
  locaux actifs et distincts. Révisions, archivage réversible, pas de suppression.
- Historique sans devise/période laissé intact et en lecture seule : créer un
  nouveau budget qualifié, aucune inférence depuis le tenant ou ses écritures.
- Comparaison par devise, période capturée et comptes sélectionnés seulement;
  montants exacts, couverture des écritures exclues visible. Les écarts sont
  budget moins mouvement net de la période au sens naturel du compte, pas un solde
  de clôture, un avis favorable/défavorable ni un bénéfice.
- Verrou business tenant, reprise avant contrôle de version/compte courant;
  écriture, révision et audit atomiques. Budget rejoué = snapshot original;
  profil rejoué = identifiant et version de la confirmation originale.
- Aucun effet GL, banque, fournisseur, stock, courriel ou pouvoir agent nouveau.

## API et compatibilité

- `GET/PUT /billing/accounting-profile` : historique des vingt dernières révisions,
  état non configuré explicite, capacités non implémentées indiquées comme telles.
  PUT exige `operationKey`, `expectedVersion` (0 initial), `target`,
  `targetCurrency`, `externalSystem` (vide pour NATIVE), `reason`.
- `POST /billing/budgets` : `operationKey`, `name`, `isActive`, `fiscalYear`,
  `currency`, `periodFrom`, `periodTo`, `lines[{accountCode,amount}]`.
  Les montants sont des chaînes décimales; aucun arrondi flottant à l’intake.
- `PATCH /billing/budgets/:id` : UUID, `expectedVersion` et contenu complet
  nom/statut/lignes. Devise/période/exercice interdits dans une modification.
- GET liste/détail conservés; `:id/history` ajoute les vingt dernières révisions;
  `:id/variance` fournit des chaînes exactes, période, version et couverture.
  Pas de total entre natures de comptes ni pourcentage fallacieux sur budget nul.
- DELETE refuse avec 409 : archiver par PATCH. Les intégrations utilisant l’ancien
  payload de budget doivent fournir les nouvelles propriétés et relire les versions.
- Les demandes ambiguës sont conservées localement par utilisateur/tenant. Reprise
  exacte même après rechargement ou refus d’accès; pas de remplacement silencieux.
- Nouveau droit à attribuer explicitement aux rôles existants :
  `billing.accounting.configure`. Aucun élargissement des outils agents.

## Vérifications — 2026-09-27

- Migration additive 134 sur `pulsar_enduser_20260921` seulement; statut à jour,
  client généré, aucun seed global ou `.env` modifié.
- Shared : 1 072, API : 691, Web : 212 tests unitaires réussis.
- 138 tests HTTP / 11 suites Finance et fournisseurs réussis. Le contrat budget
  historique a été remplacé par les tests du nouveau contrat, pas conservé comme
  une attente de recalcul implicite des périodes ou de suppression physique.
- Cas spécifiques : modules/droits/tenants, périodes réelles et inclusives,
  devise explicite, compte actif local, montants exacts, replay concurrent,
  conflit acteur/corps/version, reprise avant contrôle de compte désactivé,
  snapshot de période malgré réglages modifiés, audit en panne ⇒ rollback,
  exclusions CAD/USD/NULL et historique non qualifié préservé.
- Chromium final 6/6 : lecteur sans mutation, profil externe avec réponse perdue,
  budget créé puis 503/403/rechargement/reprise sans doublon, archivage; trois
  parcours du GL I2m.2a rejoués. Un essai initial de connexion durant le redémarrage
  API a reçu 500; la passe complète après disponibilité est verte.
- Captures ordinateur/390 px inspectées; liste mobile en cartes. Builds tous
  réussis, Svelte 0 erreur et 12 avertissements préexistants.
- Aucun commit/push/PR/déploiement. Aucun nouvel outil agent ni envoi externe.

## Suite

Qualification des immobilisations et de l'historique, devises fonctionnelles et
taux capturés, périodes/clôtures, puis sous-livre fournisseur. Le choix EXTERNAL
ne constitue pas encore un connecteur ni une preuve de synchronisation.
