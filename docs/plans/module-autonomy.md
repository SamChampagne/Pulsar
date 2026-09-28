# Autonomie des modules et référentiels partagés — 2026-09-23

## Décision

Une application ne doit pas exiger l’activation d’une autre pour créer ses données de base.
Pas de nouveau module obligatoire : chaque application concernée possède une entrée **Données**.
Les mêmes writers, tables et identifiants restent utilisés. Catalogue devient un éditeur central
facultatif pour les partenaires et articles des applications Services/SAV/Achats.

## Parcours livrés

| Application | Données accessibles avec ses propres droits | Activation qui n’est plus nécessaire |
| --- | --- | --- |
| Flotte | Véhicules, remorques, chauffeurs, transporteurs; vue d’ensemble et registre | Transport |
| Cour | Transporteurs, remorques et chauffeurs, y compris dans les formulaires d’arrivée | Transport / Flotte |
| Achats transport | Transporteurs et sélection pour les appels d’offres | Transport |
| Facturation | Clients et transporteurs; sélecteurs paiements, abonnements, audit transport | Transport |
| Portail client | Clients et copie du lien portail dans son propre espace | Transport |
| Services | Clients, produits/prestations, création directement dans un formulaire | Catalogue |
| SAV | Clients et création depuis la demande | Catalogue / Services |
| Achats fournisseurs | Fournisseurs, produits/prestations, création depuis le bon | Catalogue |

Depuis Services → Données → Clients → Connexions, le rapprochement explicite avec Facturation
ou CRM reste possible sans Catalogue. Depuis Services ou Achats fournisseurs → Données →
Articles → Stock WMS, la correspondance de même unité ne nécessite plus Catalogue.
Le sélecteur de prestation d’intervention conserve son filtre SERVICE.

## Architecture et sécurité

- `REFERENCE_ACCESS` est une liste fermée de routes par module consommateur; aucune ressource
  arbitraire ou permission n’est déduite d’un paramètre fourni par le navigateur.
- Les façades HTTP statiques portent `RequireModule`, `RequirePermissions` et `Audit`.
  Les factories imposent explicitement le DTO runtime dans `ValidationPipe`; les génériques
  TypeScript seuls ne valident pas un corps HTTP.
- Lecture = droit de lecture du consommateur. Écriture = lecture + gestion de ce même
  consommateur. Facturation garde les droits distincts de chaque workflow; paiements seuls
  ne donnent pas accès aux routes de gestion de factures clients.
- Le rôle Portail limité aux liens peut consulter ses clients pour produire un lien;
  il ne peut pas les modifier sans `customer-portal.users.manage`.
- `OperationalRecordsModule` fournit les writers d’identité existants, indépendamment des
  contrôleurs et workflows TMS. Aucun nouveau CRUD dupliqué ou synchronisation asynchrone.
- Tenant issu du JWT uniquement, FK vérifiées, projections sans dossiers liés, configuration
  portail, notes privées ou identifiant de tenant. Les partenaires Services/SAV sont filtrés
  par rôle client, ceux d’Achats par rôle fournisseur, y compris sous verrou à l’édition.
- Les partenaires/articles gardent `expectedUpdatedAt` et les verrous existants.
  Les fiches historiques TMS/Flotte conservent leur contrat d’édition sans version obligatoire;
  une généralisation de l’optimistic locking reste un travail distinct.
- Les façades d’identité véhicule/remorque refusent `status` : aucune sortie de maintenance,
  réactivation d’actif retiré ou transition métier par l’éditeur de données.
- La création intégrée conserve le formulaire parent et sélectionne la fiche créée. Après
  une réponse incertaine, aucune nouvelle écriture automatique : fermer et inspecter la fiche.
- Modifier une fiche partagée ne recalcule ni stock, ni facture, ni instantané historique.
  Aucun nouveau pouvoir IA ni action externe n’est ajouté.

## Ce qui reste une vraie connexion

Le stock exige WMS et ses droits; facturer depuis Services exige Facturation et ses droits;
le MRP matière exige Fabrication + WMS. Les sites restent des `Location` du socle, avec les
droits `core.locations.*`, pas une activation Transport. Les RH et contrôles Qualité autonomes
gardent leurs tables propres; leurs liens vers d’autres dossiers restent optionnels.

Les entités ne sont pas fusionnées par leur nom : `BusinessPartner`, `Customer`, `CrmCompany`,
`CatalogItem`, produits CRM et articles WMS gardent leurs contrats et correspondances explicites.
Un transporteur n’est pas transformé en fournisseur général. Un module Portail ne produit pas
de données métier transport tout seul; seul son accès aux identités clients a été découplé.

## Vérification et suites

Recette locale réussie : 911 tests partagés, 657 tests unitaires API, 124 tests web,
77 scénarios HTTP (dont 26 dédiés à l’autonomie), 3 parcours Chromium avec contrôle
visuel et largeur mobile. Builds API/web réussis; Svelte : 0 erreur, 12 avertissements
préexistants hors de ce lot. Effacement des coordonnées, statuts traduits et rôles
Flotte/Cour sans droits Transport supplémentaires également vérifiés.

`module-autonomy.e2e-spec.ts` crée une entreprise par module avec seulement ses propres droits
(sans Catalogue/TMS), et vérifie chaque façade, l’audit, le lecteur seul, les corps invalides,
les références étrangères, rôles, versions, statuts protégés et désactivation du module.
Des scénarios démarrent réellement projet, achat et SAV; d’autres relient Services/Achats au
stock et à la facturation sans Catalogue.

`module-autonomy.spec.ts` couvre dans le navigateur la création d’un client dans un projet,
le parc Flotte autonome et le rôle Services en lecture seule. Il exige les fixtures isolées
HTTP et `PULSAR_AUTONOMY_TENANT_PREFIX`; il ne désactive jamais de module sur le tenant démo.

Suites à qualifier séparément : rationalisation des identités historiques avec revue des
doublons, accès détaillés par champ, activation/désactivation de toutes les combinaisons de
modules, création des données de base avec champs personnalisés obligatoires, navigation
administrative complète du portail et scénarios métier transport/portails de bout en bout.

Aucune migration, activation massive, fusion des données, modification de `.env`, PR ou
déploiement dans ce lot. Tests et API de développement sur `pulsar_enduser_20260921` uniquement.
