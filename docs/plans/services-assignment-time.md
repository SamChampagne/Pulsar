# Services — affectations et feuilles de temps

> Connexion RH livrée ensuite : [contrôle minimal des absences](hr-services-availability.md).
> Alertes à la lecture, jamais une réservation de capacité ni un blocage automatique.

Lot local du 21 septembre 2026, suite de [business-foundations.md](business-foundations.md).
Branche `codex/end-user-workflows`; aucun push ni PR dans ce lot.

> Suite livrée : [services-time-approval.md](services-time-approval.md). Le cycle de revue,
> le gel des heures soumises/approuvées et la garde de clôture y remplacent les limites initiales
> décrites ci-dessous. Les résultats de vérification de cette page restent ceux du lot initial.

## Parcours livré

- Une intervention peut être affectée à un utilisateur interne actif du tenant.
  Le sélecteur recherche les noms; les comptes agents et le compte technique sont exclus.
- Les filtres « Mes interventions », « Sans intervenant » et état sont appliqués côté serveur,
  avant pagination. L'ancien champ libre reste une note d'équipe/coordination : aucune
  conversion automatique d'un libellé en utilisateur et aucune réservation de capacité.
- Le panneau d'intervention propose les onglets Détails et workflow / Temps de travail.
  Démarrer l'intervention permet d'y déclarer une date, une durée en minutes, un compte rendu
  et l'indication « facturable ». Les champs non enregistrés protègent la fermeture/navigation.
- `/services/time` donne une lecture transversale paginée, filtrable par dates et par soi-même.
  Le détail projet affiche le même registre limité au projet. Les totaux sont calculés sur
  **tous les résultats filtrés**, pas seulement la page visible, et se rafraîchissent après mutation.
- Une correction est versionnée; une annulation exige un motif et conserve la ligne dans
  l'historique, exclue des totaux. Les temps d'un projet fermé sont en lecture seule.
- Aide contextuelle, Documentation intégrée et visite guidée Services expliquent les trois
  espaces (projets, interventions, temps). Les visites déjà terminées ne sont pas réimposées;
  elles restent relançables depuis l'aide.

L'interface réutilise les composants, panneaux, typographie et thèmes Pulsar. Ce lot n'ajoute
pas une seconde identité graphique ni une nouvelle navigation parallèle.

## Tables et invariants

`ServiceJob.assigneeUserId` est optionnel. `ServiceTimeEntry` est une table métier dédiée,
distincte des tâches, mouvements WMS et écritures financières. Ses références intervention,
personne et auteur utilisent des FK composites tenant/id. Les références historiques vers
une personne désactivée sont conservées; une nouvelle affectation/saisie exige une personne active.
Les noms affichés sont les noms courants du compte, pas un dossier RH ou un snapshot contractuel.

Chaque entrée porte date civile, minutes entières (1 à 1 440), note non vide, indicateur
facturable, auteur, personne concernée, statut `RECORDED|VOIDED`, version et clé d'opération.
Les contraintes SQL protègent la durée, la note et la cohérence statut/motif d'annulation.
Les enums et `canTransitionServiceTime` vivent dans `@pulsar/shared`.

Toutes les écritures Services (projets, interventions, affectations, temps) utilisent le même
verrou transactionnel par tenant. Le writer relit projet/intervention sous ce verrou; un
projet ne peut pas être fermé en parallèle tout en recevant une nouvelle écriture après fermeture.
La personne est vérifiée via `OwnershipService`, puis relue sous verrou de ligne `FOR SHARE`
pour synchroniser aussi une désactivation concurrente. La somme des temps non annulés d'une
personne/date ne dépasse pas 24 heures, tous projets Services confondus. Ce contrôle n'inclut
pas d'autres modules et ne détecte pas les chevauchements horaires : seules des durées sont saisies.

Les corrections et annulations exigent `expectedUpdatedAt`; la version progresse strictement.
La personne, l'auteur et l'intervention d'une entrée ne sont pas modifiables. Une réaffectation
ne réattribue donc jamais les heures déjà saisies. La correction de son propre historique reste
possible après réaffectation, tant que le projet est actif et les droits présents.

## Permissions et API

Toutes les routes exigent le module `services` activé et `services.read` :

| Route relative à `/api/v1`            | Rôle                                                              |
| ------------------------------------- | ----------------------------------------------------------------- |
| `GET services/references/people`      | Recherche paginée de personnes actives, projection minimale       |
| `GET services/time-entries`           | Registre et totaux filtrés par projet/intervention/personne/dates |
| `POST services/time-entries`          | Saisie manuelle idempotente                                       |
| `PATCH services/time-entries/:id`     | Correction versionnée                                             |
| `POST services/time-entries/:id/void` | Annulation motivée et versionnée                                  |

La lecture `services.read` donne accès au registre d'équipe du tenant; ce n'est pas un périmètre
de confidentialité individuel RH. Pour écrire, le service impose **soit** `services.manage`,
**soit** `services.time.write` pour ses propres temps. Un collaborateur ne peut créer un temps
que sur une intervention qui lui est affectée. Un gestionnaire peut saisir pour un autre
utilisateur actif; l'auteur réel reste enregistré. Une création exige une intervention
`IN_PROGRESS` ou `COMPLETED` dans un projet `ACTIVE`.

Les projections de personnes n'exposent ni courriel, ni rôles, ni secrets d'authentification.
Tous les reads/writes sont filtrés par le tenant du JWT. Les créations, corrections et
annulations sont auditées, avec avant/après pour les changements. Le replay ne recrée pas d'audit.

## Réponse réseau incertaine

La création utilise une clé UUID unique `(tenantId, operationKey)` et une empreinte comprenant
l'acteur et le contenu métier. Sous le verrou tenant, le serveur cherche un replay **avant**
de revalider l'état métier : une demande déjà appliquée reste retrouvable même après fermeture
du projet. Une même clé avec un contenu différent produit `409 IDEMPOTENCY_CONFLICT`.

Le navigateur sauvegarde l'intention complète avant POST dans un emplacement local séparé par
tenant/utilisateur. Après une coupure ou un rechargement, « Vérifier et reprendre la saisie »
renvoie exactement la même demande, jamais une nouvelle clé. L'impossibilité de sauvegarder
l'intention empêche l'envoi. Une erreur connue de validation permet de corriger la demande;
un conflit de clé garde la reprise bloquée pour inspection. Une correction/annulation incertaine
demande de vérifier le registre avant une nouvelle action.

Il s'agit d'une reprise de saisie, **pas** d'un mode hors ligne complet ni d'une file partagée
entre appareils. Effacer le stockage du navigateur supprime cette possibilité de reprise.

## Migration et validation locale

Migration additive `20260921210000_services_assignment_time` : colonne d'affectation, enum,
table temps, indexes et contraintes composites. Aucune migration des anciens libellés.
Appliquée uniquement à la base isolée `pulsar_enduser_20260921` (87 migrations au total).
`.env` et la base utilisateur restent inchangés. La synchronisation de permissions ajoute
`services.time.write`; les rôles non administrateurs doivent être configurés explicitement
et le jeton actualisé pour prendre en compte un nouveau droit.

Résultats locaux :

- Unitaires shared **845**, web **102**, API **526** : **1 473** réussis.
- HTTP/PostgreSQL : **32** tests ciblés (Services/Catalogue/Achats, scanners, utilisabilité).
- Chromium : **30** scénarios ciblés, dont déclaration/correction/annulation, totaux projet,
  coupure simulée après commit puis reprise sans doublon, tutoriels et vue 390 px en thème sombre.
- `pnpm typecheck` : zéro erreur; 12 avertissements préexistants hors périmètre.
- `pnpm build` : compilation shared/database/API/web réussie.
- Contrôle visuel du registre et du panneau Temps de travail dans l'application locale.

Les tests couvrent notamment l'isolation tenant, la projection minimale, les personnes inactives,
les droits gestionnaire/collaborateur/lecteur, le replay concurrent, les versions concurrentes,
le plafond quotidien et la fermeture projet en concurrence avec une dernière saisie.
Ce périmètre n'est pas une recette de tous les modules historiques ou d'un environnement production.

## Limites et ordre de suite

1. Ajouter une validation des temps avant de les utiliser pour facturation : approbateur,
   refus motivé, gel et corrections tracées. « Déclaré facturable » n'est pas « approuvé ».
2. Relier explicitement les articles Catalogue aux articles WMS, puis consommer les pièces
   via `InventoryService.postMovement` (registre + solde dans la même transaction), sans
   dupliquer le stock dans Services.
3. Construire devis et facturation Services depuis les temps/pièces validés, avec snapshots,
   versions et reprise idempotente, puis les liens Achats/projets.
4. Ajouter équipes, planning de capacité, conflits horaires, signatures et collecte terrain.
5. Exposer ensuite événements et outils AI via le registre/gouvernance existants.

Ce lot ne produit aucune paie, facture, sortie de stock ou notification automatique; il ne
contient ni chronomètre, ni validation d'heures, ni nouveaux outils agents.
