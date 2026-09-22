# RH — dossiers professionnels et absences (lot 1)

> Suite livrée : [RH → Services](hr-services-availability.md), alertes minimales par jour,
> avec permission dédiée et sans motifs RH. Les limites et chiffres ci-dessous décrivent le lot 1.

## Objectif et frontières

Une application RH native au bureau Pulsar, avec les mêmes en-têtes, sélecteurs,
tiroirs, confirmations et aides que les autres modules. Ce lot est un socle
professionnel, pas une paie ni une suite de conformité du travail.

Tables propres : `HrTeam`, `HrEmployee`, `HrLeaveRequest`, `HrLeaveEvent`.
Le dossier employé ne remplace pas `User`. Les heures déclarées et approuvées
restent dans Services. Aucun import de données RH réelles ni transmission externe
n’est nécessaire pour la recette.

## Accès

| Permission               | Périmètre                                                                                                              |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| `hr.read`                | Tous les dossiers professionnels, équipes, absences et journaux du tenant. Droit à réserver aux personnes habilitées.  |
| `hr.read` + `hr.manage`  | Création/correction du référentiel, préparation et soumission de demandes pour les employés.                           |
| `hr.read` + `hr.approve` | Approbation/refus et annulation d’une absence approuvée, par une autre personne interne active.                        |
| `hr.self`                | Uniquement le dossier associé au compte JWT, ses demandes et son journal. Aucun annuaire RH ni décision d’approbation. |

Chaque endpoint exige le module `hr`; la navigation filtre les liens selon ces
droits. L’espace personnel impose `employee.userId = user.id` côté serveur sur
toutes les lectures et écritures, y compris le détail et l’historique. Un filtre
`employeeId` ne permet pas de contourner cette condition.

Les décisions ne peuvent être prises ni par le bénéficiaire lié au compte, ni par
la personne ayant créé la demande, même si elle possède `hr.approve`. Les comptes
de service et agents ne sont pas des approbateurs humains. Prévoir au moins deux
personnes pour le parcours gestionnaire. L’attribution des droits reste une action
administrative, jamais une conséquence de la création d’un employé ou d’une équipe.

## Référentiel

- Équipe : code unique et fixe, nom, activité, version.
- Employé : matricule unique et fixe, prénom, nom, poste, équipe facultative,
  compte interne facultatif, activité, version.
- Le compte doit être actif, humain et du même tenant à la création; un compte
  ne peut appartenir qu’à un seul dossier employé. Le lien est immuable dans ce
  lot, y compris lorsqu’il est absent. La réaffectation devra disposer d’un
  parcours audité spécifique avant d’être autorisée.
- Une équipe inactive ne reçoit pas d’employé. Désactiver une équipe contenant
  des employés actifs est refusé.
- Désactiver un employé conserve ses demandes et ne touche pas au compte de
  connexion. Le serveur refuse si une demande est soumise, ou si une absence
  approuvée se termine aujourd’hui ou plus tard (comparaison au jour UTC).
- Les brouillons historiques d’un employé inactif restent consultables et
  annulables, mais ne sont ni modifiables ni soumissibles.

Pas de salaire, date de naissance, numéro d’assurance sociale, diagnostic,
coordonnées bancaires ou documents personnels. Les notes sont professionnelles;
l’interface rappelle de ne pas y saisir de renseignements médicaux.

## Demandes d’absence

Chaque demande reçoit un numéro `ABS` via `SequencesService`, un employé
immuable, un type (`TIME_OFF`, `UNAVAILABLE`, `OTHER`), deux dates incluses et une
note. Ce sont des catégories opérationnelles, pas des droits légaux.

`Brouillon → Soumise → Approuvée / Refusée`.
Une soumission ou un refus peut revenir au brouillon. L’annulation est terminale;
l’annulation d’une approbation requiert les mêmes droits et indépendance que la
décision initiale. Toute transition impose un motif non vide.

Les dates doivent être de vraies dates civiles, au format `YYYY-MM-DD`, de 1900 à
2199, fin ≥ début, avec au plus 366 dates incluses. Aucun calcul de jours ouvrables,
weekends, jours fériés, solde, heures ou salaire. Une date unique est une demande
valide. Les dates passées ne sont pas interdites par une politique implicite.

La soumission et l’approbation revérifient que l’employé est actif et qu’aucune
autre demande `SUBMITTED`/`APPROVED` de cet employé ne chevauche la période,
bornes incluses. Les brouillons, refus et annulations ne réservent rien. Les
absences de deux employés différents peuvent naturellement se chevaucher.

Le contenu est modifiable uniquement au brouillon. Pas de modification directe
d’une absence approuvée : annulation motivée puis nouvelle demande si nécessaire.

## Cohérence et audit

- Toutes les opérations sont tenant-scopées, avec FK composites et vérification
  `OwnershipService` pour les références reçues.
- Writers sérialisés par `lockBusinessTenant`, versions optimistes et state
  machine partagée. Les transitions utilisent aussi un claim conditionnel.
- Création idempotente `(tenantId, operationKey)` avec empreinte acteur/contenu.
  Le replay retrouve la demande existante même si elle a changé d’état.
- L’interface conserve l’intention de création avant l’envoi; une reprise garde
  exactement la même clé et le même contenu. Ne pas retirer une demande incertaine
  avant d’avoir contrôlé la liste.
- Les événements RH (auteur, date, motif, avant/après) sont écrits dans la même
  transaction que le dossier. Le journal personnel reste limité au bénéficiaire.
- L’audit général ne duplique pas les motifs ni les périodes : identité de
  l’opération/statut seulement. Le référentiel utilise les décorateurs `@Audit`.
- Une modification/décision incertaine bloque de nouvelles actions dans le tiroir
  jusqu’à relecture. Aucun retry silencieux des décisions.

## Connexions actuelles et à venir

| Liaison               | Actuel                                                          | Ce que cela ne fait pas                                                       |
| --------------------- | --------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Accès → RH            | Référence optionnelle du compte, contrôle de l’espace personnel | Ni création de login, ni synchronisation des rôles ou des statuts             |
| RH → Services         | Documenté comme non connecté                                    | Ni blocage des affectations ni remplacement; les heures restent dans Services |
| RH → Fabrication      | Documenté comme non connecté                                    | Ni réduction de capacité APS/MRP ni qualification de poste                    |
| RH → AI/paie          | Aucun outil ou connecteur livré                                 | Aucune décision RH automatisée ou transmission de données personnelles        |
| Qualité → utilisateur | Responsable du compte Accès                                     | Aucun accès au dossier RH du responsable                                      |

La future intégration disponibilité doit exposer le minimum (périodes indisponibles),
sans diffuser le motif RH aux opérateurs Services/Fabrication.

## Interface, aide et recette

Routes : `/hr`, `/hr/employees`, `/hr/teams`, `/hr/leaves`, `/hr/self`.
Le module apparaît dans le bureau et la navigation. L’aide contextuelle décrit les
règles de chaque écran; Documentation fournit règles, limites, exemple et contrats
intermodules. La visite de première ouverture est enregistrée par utilisateur et
tenant, parcourt des écrans réels autorisés et peut être relancée. Elle ne crée pas
de données fictives et ne confirme aucune décision.

Migration : `20260922070000_hr_foundations`; reconstruire shared/database, appliquer
la migration et synchroniser le catalogue des permissions/modules. Activer RH
sur les tenants choisis et attribuer explicitement les rôles appropriés. Les JWT
doivent être rafraîchis après changement de rôle.

Tests : `packages/shared/src/hr.spec.ts`, `apps/api/test/hr.e2e-spec.ts`,
`apps/web/e2e/hr.spec.ts`. Recette réelle sur base isolée, jamais sur la base de
travail client. Résultats consolidés dans `docs/etat-du-projet.md` après vérification.

## Vérifications

Validation du lot sur base isolée : 1 500 tests unitaires, 185 tests HTTP
(16 suites) et 49 parcours navigateur uniques réussis, dont 5 RH et 7 Qualité.
Compilation complète et vérification TypeScript réussies (12 avertissements
préexistants). Les 95 migrations sont appliquées et le schéma Prisma ne présente
aucune différence. Aucun déploiement ou push effectué.

Commandes de reprise (base isolée déjà migrée et serveur API/web démarré) :

```powershell
pnpm --filter @pulsar/shared test
pnpm --filter @pulsar/api test --runInBand
pnpm --filter @pulsar/web exec vitest run --maxWorkers=2
pnpm --filter @pulsar/api exec jest --config test/jest-e2e.json --runInBand --forceExit --testPathPattern='hr|quality|business-foundations|wms|end-user-workflows|scanning-tours'
pnpm --filter @pulsar/api exec jest --config test/jest-e2e.json --runInBand --forceExit --testPathPattern='phase4|portal-v2|fleet-module|fleet-workspace'
pnpm --filter @pulsar/web exec playwright test e2e/hr.spec.ts e2e/quality.spec.ts e2e/business-foundations.spec.ts e2e/end-user-workflows.spec.ts e2e/scanning-tours.spec.ts --project=desktop-chromium --workers=1 --reporter=line
```

Ne pas lancer de build/typecheck pendant la recette Vite. Exécuter les tests HTTP
qui activent/désactivent les modules du tenant de démonstration séparément de la
recette navigateur. Les suites HTTP conservent des handles sans `--forceExit`;
APS est absent et aucune intégration externe n’est revendiquée.

## Suite recommandée

1. Disponibilité minimale RH → Services, affichée comme avertissement explicite
   avant toute politique de blocage; droits croisés et absence de motifs privés.
2. Compétences et habilitations avec échéances, puis capacité Fabrication; ne pas
   assimiler un intitulé de poste à une certification.
3. Modification auditée du lien compte/employé, politiques de rétention et accès
   hiérarchiques. Concevoir cela avant tout stockage sensible.
4. Paie et règles légales seulement dans un lot dédié, avec pays/juridictions,
   exigences métier vérifiées et connecteur approprié.
