# Documentation, Catalogue, Achats fournisseurs et Services

Lot du 21 septembre 2026, branche locale `codex/end-user-workflows`.

Évolutions : [pièces Services ↔ WMS](./services-parts-and-connected-documentation.md),
puis [réceptions fournisseurs, SAV et programme sectoriel](./supplier-receipts-and-support.md).
Le périmètre initial ci-dessous reste historique : la réception physique fournisseur et SAV
sont désormais implémentés, contrairement aux limites du premier lot.

## Périmètre livré

- `/documentation` : application cœur gratuite d’accès interne, distincte de Documents.
  Guides des 22 espaces internes, recherche insensible aux accents, prérequis,
  règles, parcours, connexions, limites, liens filtrés et relance des tutoriels.
- `/catalog` et `/catalog/partners` : produits/prestations, unités, partenaires avec
  rôles client/fournisseur, création, édition versionnée, activation/désactivation,
  recherche paginée. Code/type/unité immuables après création.
- `/purchasing` : commande fournisseur multiligne, prix/quantités décimaux, devise,
  date attendue, notes, édition du brouillon, confirmation et clôture administrative.
- `/services` : projets client, échéance, description, activation et clôture.
  `/services/projects/:id` regroupe ses interventions; `/services/interventions`
  présente la file ordonnée par date avec responsable, prestation facultative,
  consignes, démarrage et compte rendu obligatoire à la complétion.
- Les quatre applications sont enregistrées dans le bureau, la navigation, l’aide
  contextuelle et les tutoriels automatiques par utilisateur (version 1, 5 étapes).
  Leur progression utilise le mécanisme serveur existant, pas le stockage local.

## Décision d’architecture

Référentiels communs, tables métier distinctes. Pas de « table universelle » dont
le sens change selon l’application.

| Propriétaire        | Tables                               | Autorité                              |
| ------------------- | ------------------------------------ | ------------------------------------- |
| Catalogue           | `BusinessPartner`, `CatalogItem`     | Identité, rôles, désignation et unité |
| Services            | `ServiceProject`, `ServiceJob`       | Projet, intervention, état et rapport |
| Achats fournisseurs | `SupplierOrder`, `SupplierOrderLine` | Engagement d’achat, lignes figées     |
| WMS existant        | `StockMovement`, `InventoryLevel`    | Seule autorité du stock physique      |

Les six nouvelles tables sont tenant-scopées. Les relations métier utilisent des
FK composites `(tenantId, id)` en plus des contrôles `OwnershipService`. Les trois
contrôleurs possèdent chacun leur garde de module et leurs permissions `read/manage`.
Les consommateurs Services/Achats exposent leurs propres sélecteurs minimaux du
Catalogue (id/code/nom/unité) sans divulguer les coordonnées d’un partenaire.
Consulter une référence existante reste possible même si l’app d’édition Catalogue
est désactivée; l’accès aux références dépend du module consommateur et de ses droits.

Les anciens `Customer`, `CrmCompany`, `CrmProduct`, `WmsItem` restent inchangés.
Ils ne sont pas dupliqués/importés/fusionnés automatiquement. Le Catalogue est
commun **aux nouvelles apps de ce lot**, pas encore à tous les anciens modules.
La future convergence doit passer par une correspondance explicite, contrôlée et
réversible, avec vérification des unités et dédoublonnage. Un code identique dans
deux référentiels n’est pas un lien.

## Invariants d’écriture

- Toutes les écritures de ce lot prennent le même verrou transactionnel par tenant
  `business:<tenantId>`. Relecture, validation et mutation sont atomiques.
- Les éditions et transitions exigent `expectedUpdatedAt`; un client périmé reçoit 409. La version progresse même si deux modifications se suivent à la milliseconde.
- Numéros PRJ/INT/PO via `SequencesService`; aucune numérotation par count.
- Statuts et transitions distincts dans `@pulsar/shared/business` et enums Prisma.
- Interventions seulement sur projet ACTIVE. Projet terminé/annulé interdit tant
  qu’une intervention PLANNED/IN_PROGRESS existe. Pas de cascade silencieuse.
- Compte rendu non vide exigé pour COMPLETED; états terminaux non réouvrables.
- Lignes fournisseur et commande créées dans la même transaction. Confirmation
  revérifie les référentiels actifs; snapshots nom/unité conservés. Édition ensuite
  interdite. Calcul Decimal serveur, total HT arrondi à deux décimales à l’affichage.
- CREATE/UPDATE audités par décorateur; transitions par `AuditLogsService` après commit.
- Pas de retry automatique de création après réponse incertaine. Le panneau bloque
  une nouvelle soumission et demande de vérifier la liste. L’idempotence durable de
  création reste à ajouter avant un client terrain hors ligne.
- Le correctif du registre des modules remplace un upsert Prisma concurrent par
  `createMany(skipDuplicates)` puis `update` dans une transaction. Deux activations
  simultanées d’une app auparavant absente ne provoquent plus un P2002.

## Migration et activation

`20260921190000_business_foundations` est additive : six tables, quatre enums,
contraintes positives sur les lignes et rôle obligatoire sur les partenaires.
Les trois apps sont enregistrées disponibles, **sans activation automatique pour
les tenants existants**. La synchronisation des permissions au démarrage accorde
les six nouvelles clés aux rôles administrateur système. Les autres rôles restent
à configurer. Une reconnexion/actualisation du jeton est nécessaire pour les nouveaux droits.

Application locale : migration appliquée seulement à `pulsar_enduser_20260921`,
environnement isolé utilisé pour les tests. Catalogue, Achats fournisseurs et
Services activés sur son tenant démo `acme`. `.env` et base utilisateur inchangés.

## Limites explicites et prochaine tranche

Cette tranche est une fondation utilisable, pas un ERP métier terminé :

1. Référentiel : assistant de correspondance avec CRM/TMS/WMS, sans fusion destructive.
2. Services : l'affectation de personnes et les feuilles de temps manuelles sont désormais
   livrées dans [services-assignment-time.md](services-assignment-time.md). L'ancien
   responsable textuel reste une note de coordination, pas une réservation. Restent les
   équipes/planning de capacité, approbation des temps, devis/facturation, consommation de
   pièces via le writer WMS, preuve/signature et liens aux projets depuis les achats.
3. Achats : approbations, envoi fournisseur, réceptions partielles idempotentes WMS,
   rapprochement facture et engagements par projet/MRP. Une clôture actuelle ne
   crée **aucun stock, courriel, paiement ou écriture comptable**.
4. Documentation : procédures privées tenant, rédacteurs/validation/versionnement;
   enrichir les exercices métier au-delà des visites d’orientation.
5. Agents : outils READ puis mutations gouvernées (registre, ProposedAction, caps),
   événements métier et liens Control Tower. Aucun nouvel outil AI dans ce lot.
6. Lots sectoriels suivants : SAV, RH/temps, qualité/lots, locations, commerce/POS,
   restauration et ecommerce. Non livrés/activables par ce changement.

## Vérification

Couverture automatisée dans `business.spec.ts`, `navigation.test.ts`,
`business-foundations.e2e-spec.ts`, `business-foundations.spec.ts` : règles de
transition, articles/tutoriels de chaque app, permissions, tenant/FK, éditions
concurrentes, fermeture projet contre création d’intervention, calcul et snapshots
d’achat, activation concurrente, parcours UI réels et premières visites.

Résultats locaux du 21 septembre 2026 :

- Tests unitaires : shared **843**, API **526**, web **98**, soit **1 467** réussis.
- HTTP/PostgreSQL : **26** tests réussis dans les suites business-foundations,
  scanning-tours et end-user-workflows. Les dates impossibles et horaires sans
  fuseau sont refusés à l’entrée.
- Chromium : **28** scénarios réussis dans les trois suites correspondantes,
  dont les quatre premières visites, la reprise des tutoriels, les parcours
  Services/Achats complets et un contrôle à 390 px en thème sombre.
- `pnpm typecheck` : aucune erreur; 12 avertissements préexistants sur les écrans
  CRM/Sites et CustomFieldInputs, hors périmètre.
- `pnpm build` : compilation shared/database/API/web réussie.
- Vérification visuelle du centre Documentation et de sa visite guidée en local.

Le contrôle mobile a corrigé deux débordements : la cellule de titre accessible
du tableau Catalogue possède désormais un contenant positionné; les commandes
du bandeau restent dans l’écran en réduisant le libellé du sélecteur d’app.
Les tableaux gardent leur défilement horizontal interne, sans élargir la page.

Ces validations utilisent la base isolée décrite plus haut. Elles ne constituent
pas une recette de production, une intégration matérielle de scanners ou une
validation de tous les modules historiques.
