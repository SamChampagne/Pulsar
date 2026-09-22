# Réceptions fournisseurs, SAV et programme des modules spécialisés

Lot des 21–22 septembre 2026 — branche locale `codex/end-user-workflows`.
Suite de [Services ↔ WMS et documentation](./services-parts-and-connected-documentation.md).

## Livré et encore prévu

Deux parcours fonctionnels sont ajoutés : les arrivages fournisseurs liés aux commandes,
et le premier module SAV. Les six autres propositions sont cadrées dans le manuel intégré;
elles ne sont ni des apps activables ni des tutoriels exécutables pour le moment.

| Parcours                                                           | État                 | Point d’entrée                                          |
| ------------------------------------------------------------------ | -------------------- | ------------------------------------------------------- |
| Achats → réception physique WMS → reliquat                         | Implémenté           | `/purchasing`, puis « Réceptions et reliquats »         |
| Demande SAV → qualification → intervention liée → résolution       | Implémenté           | `/support`                                              |
| Guides, règles, limites, connexions et tutoriels des deux parcours | Implémenté           | `/documentation?module=purchasing` et `?module=support` |
| Qualité, Location, RH, Commerce/POS, Restauration, e-commerce      | Cadrés, à développer | `/documentation?view=roadmap`                           |

Les composants, tiroirs, confirmations et styles restent ceux de Pulsar. Aucune seconde
interface sectorielle ni copie de référentiel n’est introduite. Le bureau d’applications
conserve son fonctionnement actuel.

## Propriété des données et connexions

| Propriétaire | Source de vérité                                            | Relation ajoutée                                           |
| ------------ | ----------------------------------------------------------- | ---------------------------------------------------------- |
| Catalogue    | `BusinessPartner`, `CatalogItem`, `CatalogStockLink`        | Fournisseur/client et identité produit ↔ article WMS       |
| Achats       | `SupplierOrder`, `SupplierOrderLine`                        | Prix, quantité commandée et unités figés à la confirmation |
| Achats       | `SupplierReceipt`, `SupplierReceiptLine`                    | Preuve de rapprochement entre commande et réception WMS    |
| WMS          | `Receipt`, `ReceiptLine`, `StockMovement`, `InventoryLevel` | Quantité physiquement reçue et solde de stock              |
| SAV          | `SupportCase`, `SupportCaseEvent`                           | Qualification, décisions et historique client              |
| Services     | `ServiceProject`, `ServiceJob`                              | Travail réellement exécuté, temps et pièces                |

La quantité « reçue » d’un PO est calculée depuis ses lignes de réception liées. Ce n’est
pas le stock actuel : une pièce reçue puis consommée reste reçue sur le bon fournisseur.
Le restant = commandé − reçu, en Decimal, par ligne et unité; aucun total mélangeant les
produits/unités. Les prestations ne sont pas des articles physiques réceptionnables.

Le lien SAV → Services donne du contexte, pas un ordre d’exécution. Résoudre un SAV
n’achève pas l’intervention; terminer celle-ci ne résout pas la demande. Les temps et
pièces restent traités dans Services par leurs parcours existants. La création de la
demande ne déclenche ni courriel, ni facture, ni mouvement de stock.

## Réceptions fournisseurs : utilisation

1. Dans Catalogue, créer le fournisseur, le produit physique et sa correspondance WMS.
   L’article WMS doit être actif, de la même unité que celle figée sur la commande.
2. Préparer et confirmer le PO. Ses lignes ne sont alors plus modifiables.
3. À l’arrivée réelle, ouvrir « Réceptions et reliquats ». Choisir l’entrepôt, la référence
   du bon de livraison, les éventuels champs personnalisés WMS, les quantités et les bins.
4. Cocher la confirmation physique et valider. La page crée ET valide un document WMS
   pour cet arrivage. La commande reste ouverte pour les suivants.
5. Lire le journal paginé et le restant par ligne. « Ouvrir la réception WMS » mène à la
   pièce justificative, sous réserve des accès Entrepôt.
6. Clôturer explicitement. Si du produit commandé manque encore, fournir un motif.
   Clôturer ce reliquat ne réceptionne jamais le stock manquant.

Exemple : 10 joints commandés, un arrivage de 4 EA, puis un de 6 EA. Deux réceptions
distinctes, reçu 10, restant 0, puis clôture administrative. Si le fournisseur ne livre
que 4, le restant 6 reste visible avec le motif de clôture; aucune quantité inventée.

## Réceptions : contrats techniques

- API : `GET/POST /api/v1/purchasing/orders/:id/receipts`. Lecture paginée avec
  `purchasing.read`; écriture avec `purchasing.read/manage` ET `wms.read/manage`,
  modules Achats et WMS activés. La preuve d’achat historique reste lisible dans Achats
  lorsque WMS est désactivé; elle n’expose pas les soldes actuels de l’entrepôt.
- `SupplierReceiptsService.create` prend le verrou `business:<tenantId>`, puis le verrou
  de ligne tenant WMS, toujours dans cet ordre. Création, allocations, validation du
  document et mouvements de stock partagent la même transaction.
- Le service réutilise `ReceivingService.postInTransaction`, donc la state machine
  Receipt, ses validations et `InventoryService.postMovement`. Aucun writer de solde
  alternatif. `afterPost` émet les audit/événement WMS existants après commit.
- Site/bin/article du tenant, actifs et compatibles; unité identique; cumul des lignes
  d’une même demande contrôlé avant écriture. Quantités positives à trois décimales
  maximum. La demande accepte plusieurs bins par ligne via API; l’UI propose un bin
  par ligne et par arrivage. Aucun dépassement de la quantité commandée.
- Les champs personnalisés RECEIPT passent par `CustomFieldsService.validateValues`
  (`partial: false`) avant persistance. Une définition obligatoire manquante rejette
  l’ensemble de l’arrivage sans stock partiel. Leur lecture UI échouée bloque le formulaire.
- Les FK de rapprochement sont composites `(tenantId, id)`. L’appartenance des lignes
  au PO et à la réception est vérifiée par le service dans la transaction.
- Chaque nouvel arrivage avance la version du PO. Après un arrivage, annuler ce PO
  est interdit. Sur-réception, annulation de réception validée et retour fournisseur
  ne font pas partie de ce lot.
- Une ligne déjà reçue conserve son article WMS historique : changer la correspondance
  ne permet pas de recevoir le solde sur un autre article. Une unité WMS historiquement
  utilisée par ces réceptions ne peut plus être modifiée, même après retrait du lien Catalogue.
- La numérotation vient de `SequencesService`. Une transaction annulée peut laisser un
  trou dans les numéros, jamais un reçu ni du stock à moitié validés.

### Reprise après coupure

L’UI conserve avant POST une intention dans le navigateur, par tenant/utilisateur/PO :
UUID, version, référence, champs personnalisés et lignes. Si cette conservation échoue,
aucun envoi. Après réponse incertaine, le bouton « Reprendre la réception conservée »
envoie exactement la même demande, y compris après rechargement.

Le serveur vérifie `(tenantId, operationKey)` sous verrou avant les conditions actuelles
de version/statut. Même acteur + même contenu : même réception, sans nouveau stock ni
audit de création. Autre contenu : 409. Un replay réussi reste possible après clôture
du PO; les droits/modules actuels sont néanmoins toujours exigés. Après un rejet métier,
contrôler l’erreur et actualiser la commande, ne pas réessayer aveuglément.

## SAV : utilisation et règles

1. Activer SAV et attribuer `support.read/manage`. Préparer les clients dans Catalogue.
   L’édition Catalogue requiert ses propres droits; le sélecteur SAV expose uniquement
   les références client minimales utiles.
2. Créer une demande avec client, objet, description et priorité. Le numéro `SAV-…`
   est automatique. Le client ne peut pas être remplacé après création.
3. Qualifier puis passer « En traitement » avec un motif. Au besoin, relier une
   intervention existante du même client. Le lien exige Services activé et `services.read`.
4. Effectuer le travail dans Services, puis résoudre la demande avec son compte rendu.
5. Si nécessaire, rouvrir une demande résolue avec un motif. La résolution précédente
   reste lisible. Clôturer seulement après vérification : cette clôture est définitive.

```text
À qualifier → En traitement → Résolu → Clôturé
                    ↑__________|
                     Rouvrir
```

- Transitions exclusivement via `canTransitionSupportCase` de `@pulsar/shared`.
  L’édition est réservée aux états OPEN/IN_PROGRESS; transitions et éditions exigent
  la version lue. Chaque transition exige un compte rendu ou motif non vide.
- Le journal `SupportCaseEvent` garde acteur, date, action et instantané dans la même
  transaction. Les audits généraux suivent. Aucun endpoint de réécriture de l’historique.
- Créer est idempotent sur une clé UUID et une empreinte liée à l’acteur. La reprise
  UI persiste la demande avant envoi. Les modifications et décisions n’ont pas de replay
  automatique : en cas d’incertitude, consulter dossier/historique avant de poursuivre.
- `SupportCase.jobId` utilise une FK tenant composite. Le client de son projet est
  revérifié sous le même verrou métier. Changer le client du projet est refusé tant
  qu’un SAV incompatible référence une de ses interventions, y compris un SAV clôturé.
  Les liens d’un dossier clôturé sont immuables; il ne faut pas contourner ce verrou
  pour réaffecter un historique à un autre client.
- Les états SAV sont distincts de ceux de Services. Une priorité humaine n’est pas
  une promesse SLA. Pas d’attribution d’équipe, boîte mail SAV, portail externe,
  pièce jointe, garantie, avoir ou action AI dans cette première version.

## Documentation et vrais tutoriels

Les deux guides décrivent prérequis, parcours, règles, exemple, effets intermodules,
limites et reprise. Le manuel contient une fiche de connexion SAV → Services et une
fiche Achats → WMS désormais classée « opération », plus des parcours transversaux.

SAV rejoint les visites automatiques à la première ouverture par utilisateur :
5 étapes, surlignage de l’interface, navigation réelle, progression serveur, reprise et
relance depuis l’aide ou Documentation. Une visite ne crée ni ne résout de vraie demande.
Les exercices métier complets sur données jetables restent un lot distinct des visites.

La régression a révélé une course lors de la création initiale de `UserPreferences`
par plusieurs tutoriels simultanés (upsert Prisma émulé si patch vide). Tous les writers
de préférences prennent maintenant un verrou transactionnel par utilisateur; la création
et la mise à jour JSON d’un seul module sont atomiques. Les autres progressions et
réglages d’apparence ne sont pas écrasés. Test HTTP de quatre modules + apparence concurrents.

## Programme des autres modules

Le manuel `/documentation?view=roadmap` cadre six propositions. Pour chacune : données
propres, références communes, premier workflow, tutoriel attendu et limites actuelles.
Pas de clés activables tant que l’implémentation correspondante n’existe pas.

Ordre technique proposé, à ajuster au choix métier :

1. **Qualité** : plans de contrôle, inspections et non-conformités reliées à SAV,
   réceptions et fabrication. Définir lots/quarantaine et verrous WMS dans un lot
   dédié avant toute promesse de stock libéré ou bloqué.
2. **Location** : équipements, réservation sans chevauchement, départ, retour et
   inspection; liens explicites Flotte/Services, disponibilité garantie côté serveur.
3. **RH** : dossiers distincts des comptes d’accès, absences, approbation et compétences;
   confidentialité dédiée. Pas de paie ni décision RH automatique.
4. **Commerce/POS** : session caisse, panier, scan, vente, retour; fiscalité, paiement
   idempotent et stock conçus avant encaissement réel.
5. **Restauration** : salles/tables, carte, commandes, tickets cuisine, addition;
   s’appuie sur la caisse sans confondre recette cuisine et nomenclature industrielle.
6. **E-commerce** : publication produits, commande, paiement, préparation et suivi;
   Sites existant n’est pas un checkout. Prévoir réservations et doubles notifications.

Critère de livraison de CHAQUE module : migration et données propres, permissions
tenant, workflow de bout en bout, liens métier explicites, contrôles de concurrence,
test UI/HTTP, aide, guide détaillé et visite première utilisation réellement navigable.
Les paiements, règles fiscales ou obligations réglementaires demandent une validation
spécifique au moment de leur réalisation; ce cadrage ne prétend pas les satisfaire.

## Mise en service et validation

Migrations additives `20260922020000_supplier_receipts` et
`20260922021000_support_cases`. Appliquées uniquement sur
`pulsar_enduser_20260921` (92 migrations), pas sur la base habituelle. `.env` inchangé.
API locale sur 3100, web sur 5173. Aucun push, PR ou déploiement externe dans ce lot.

Pour une autre base : sauvegarder, appliquer toutes les migrations de la branche,
générer Prisma/reconstruire shared + database + API + web, puis synchroniser le
catalogue de modules depuis `MODULE_CATALOG` avec le mécanisme de déploiement approuvé.
Ne pas lancer aveuglément le seed de démonstration sur une base client. L’activation
SAV et l’attribution des droits restent explicites. Une session ancienne doit être
rafraîchie/reconnectée pour obtenir ses nouvelles permissions.

La recette couvre concurrence, droits/module désactivé, FK étrangère, version périmée,
unités historiques, quantités cumulées, champs personnalisés obligatoires, replay après
clôture, cycle SAV et cohérence du client parent. Les tests navigateur exercent aussi
les réponses perdues, la reprise après rechargement, les visites initiales et le mobile.
Résultat final : 1 484 tests unitaires (847 shared, 526 API, 111 web), 128 tests
HTTP/PostgreSQL sur 9 suites, 37 scénarios navigateur. Typecheck sans erreur (12
avertissements préexistants), compilation complète réussie, Prisma sans différence
avec la base isolée. Recette visuelle du SAV, de sa visite et du manuel effectuée.
Synthèse également dans [l’état du projet](../etat-du-projet.md).

Ne pas lancer `svelte-kit sync`/la compilation en parallèle de la recette navigateur
sur le serveur Vite de développement : un rechargement à chaud peut vider le formulaire
de connexion en cours. Compiler d’abord, puis lancer la recette sur un serveur stable.

Limites de ce lot : pas de navigation inverse WMS → PO, lien Achats → projet/MRP,
retour fournisseur, facture Services ou nouvel outil agent. Les six modules sectoriels
restants et leurs tutoriels sont à implémenter, pas réputés livrés par ce document.

Actualisation ultérieure : le premier module de cette liste, **Qualité**, est maintenant
implémenté avec son tutoriel et ses contrats dans [quality-workflows.md](quality-workflows.md).
Son périmètre ne comprend pas la quarantaine physique ni la certification.
