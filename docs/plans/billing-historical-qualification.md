# Finance I2m.2d.1 — qualification documentée du journal historique manuel

> Extension suivante : [I2m.2d.2a — paiements](billing-payment-qualification.md)
> ajoute un rapprochement métier distinct dans le même écran, avec qualification
> groupée original/contrepassation. Les limites ci-dessous décrivent le lot manuel
> initial. Les [factures](billing-invoice-qualification.md) et les
> [dotations historiques groupées](billing-asset-history-qualification.md) ont
> désormais leurs rapprochements spécialisés; aucun contournement manuel.

## Contrat

- Finance autonome. Ce lot traite uniquement les écritures sans devise, manuelles
  explicites ou sans aucune référence source. Paiements, factures et amortissements
  attendent leurs reprises métier dédiées : aucun contournement par cet écran.
- Aucune modification des écritures originales, dates, comptes ou montants. La devise
  déclarée est une annotation séparée, versionnée et révocable, pas une conversion.
- Justificatif PDF/PNG/JPEG protégé, hash SHA-256 et description obligatoires;
  fichier rattaché à cette écriture seulement, append-only via DocumentsService.
  La signature du fichier n’est pas une certification du contenu ou un antivirus.
- Revue explicite montrant les lignes et la portée; confirmation humaine distincte
  avec droit `billing.ledger.qualify`, UUID/acteur/corps, version et hash de revue.
  Source changée, incohérente, déséquilibrée ou fractionnaire : blocage sans arrondi.
- Annotations QUALIFIED/WITHDRAWN via machine partagée. Retrait motivé conserve
  toutes les versions et remet l’écriture dans les exclusions. Une nouvelle devise
  exige d’abord un retrait, puis un choix de preuve et une nouvelle revue/confirmation.
- Verrou business puis GL; annotation courante, révision immuable et audit atomiques.
  Replay avant revalidation du nouvel état, aucune suppression de demande incertaine.
- Grand livre, balance, résultats, bilan, flux et budgets lisent la devise effective
  (devise originale sinon annotation QUALIFIED), dans le même snapshot que les
  exclusions. Les rapports signalent séparément l’historique ainsi qualifié.
- Les vues historiques de rapport utilisent la qualification actuellement confirmée;
  elles ne prétendent pas reconstruire l’état de connaissance à une ancienne date.
  Aucun nouveau journal, paiement, lettrage, conversion, solde d’actif ou clôture.
- Premier tutoriel Finance enrichi sans reset, aide contextuelle et documentation
  intégrée. Interface native Pulsar avec étapes preuve → revue → confirmation.

## API et compatibilité

Préfixe `/api/v1/billing/ledger-qualification`, Finance activé et
`billing.ledger.read`. Liste paginée des écritures à devise originale NULL,
détail avec lignes et 30 dernières décisions, preuves et téléchargements protégés.
Revue et confirmation exigent en plus `billing.ledger.qualify`; ce droit n’est
pas ajouté aux modèles de rôles de saisie. Confirmation humaine active seulement.

- `GET /`, `GET /:id`, `GET /requests/:key` (reprise liée à l’acteur).
- `POST /:id/review` : `action`, `currency` explicite (vide au retrait), `reason`,
  `evidenceId`, `expectedVersion` (0 avant toute décision).
- `POST /:id/confirm` : même corps + `confirmed: true`, UUID v4 `operationKey`,
  `reviewToken` obtenu à la revue, lié à l’acteur et au snapshot exact.
- `GET/POST /:id/evidence`, `GET /:id/evidence/requests/:key`,
  `GET /:id/evidence/:evidenceId/download`. Dépôt multipart : fichier, description,
  UUID. Reprise identique nom/MIME/contenu/acteur/corps; aucun DELETE métier.

Le journal expose désormais `originalCurrency` et `currencyQualification` en plus
de sa `currency` effective; filtre de devise et filtre `unqualified` suivent cette
même lecture. `coverage.qualifiedHistoricalEntries` identifie les annotations
incluses dans la devise sélectionnée. Les écritures sources liées restent exclues
de ce nouveau parcours : banque, avoirs et contrepassations ne changent pas de devise.
Les comptes historiques inactifs restent lisibles; les lignes doivent appartenir
au tenant, être équilibrées et représentables exactement en cents.

UI : Finance → Reprise du journal; lien contextuel depuis chaque ancien journal.
Liste/dossier sur bureau; dossier prioritaire sur mobile. Demandes de preuve et
confirmation conservées par utilisateur/entreprise dans le navigateur avant envoi.
403 ou réponse incertaine ne les effacent pas. Historique/projections sont lus dans
un snapshot cohérent; pas de changement implicite de rôle comptable cible.

## Validation locale (2026-09-27)

- Migration 136 et Prisma : base isolée `pulsar_enduser_20260921` uniquement.
- 1 991 tests unitaires (Shared 1 080, API 691, Web 220).
- 147 tests HTTP dans 12 suites Finance; 58 recontrôlés après les gardes de lecture.
  Les 7 tests du lot repassent après vérification de l’unicité de l’audit de preuve.
- 12 scénarios UI Finance validés, dont 3 pour ce lot : lecteur/mobile,
  preuve + revue + reprise après réponse perdue/403 + retrait, et droits/source liée.
  Course du helper de connexion corrigée en attendant sa première réponse de
  préférences avant la navigation suivante; scénario concerné revérifié.
- Aucune donnée métier réelle migrée, aucun seed global, aucune modification du
  `.env`, aucun commit/push/déploiement. Nouveau droit à attribuer explicitement.
- Builds Shared/Database/API/Web réussis; API locale sur 3100, santé vérifiée.
  Svelte : 0 erreur, 12 avertissements préexistants; format et whitespace ciblés vérifiés.

## Suite

Reprise des sources liées et plans historiques d’actifs avec rapprochement de leurs
preuves; contrepassations métier contrôlées, devise fonctionnelle/taux et périodes.
Le retrait d’une qualification n’est pas une contrepassation comptable.

## Référence de conception

Le code officiel [Odoo 19 — journaux](https://github.com/odoo/odoo/blob/19.0/addons/account/models/account_journal.py)
sert de point de comparaison sur la protection des écritures. Pulsar utilise ici
une annotation auditée séparée, sans prétendre fournir une chaîne d’inaltérabilité
certifiée ni une conformité fiscale.
