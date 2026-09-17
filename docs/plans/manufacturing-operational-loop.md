# Fabrication — boucle achats, matières, capacité et atelier

15 septembre 2026 · branche `codex/manufacturing-visual-workspace`.

## Résultat de ce lot

Trois tranches utilisables de M3c, M4 et M5, sans présenter le MRP industriel
complet comme terminé. Les panneaux, boutons, navigation et animations restent
ceux de Pulsar. Le guide de refonte de l’existant a orienté les confirmations,
états de lecture seule, récupération après erreur et panneaux sans déplacement
du contenu; aucun nouveau thème ni remplacement du bureau des applications.

### 1. Achats opérationnels

`/manufacturing/purchasing` propose les vues **Demandes et achats** et
**Arrivages**. Les arrivages montrent date promise, fournisseur/site, quantité
réellement reçue, reste attendu, retard et lien vers les impacts fabrication.
Il n’existe pas de total mélangeant des articles ou unités différents.

Une commande CONFIRMED, encore ouverte, peut recevoir un avenant humain :

- **RESCHEDULE** : nouvelle date promise, motif, confirmation et version attendue.
  La date précédente et la nouvelle restent dans l’historique append-only.
- **CLOSE_REMAINDER** : clôture irréversible de tout le reste non reçu. Les
  réceptions DRAFT doivent d’abord être annulées ou traitées. Les quantités
  commandée et reçue ne sont pas réécrites; aucun mouvement de stock n’est créé.

Le statut commercial reste CONFIRMED. `fulfillment=CLOSED` est un état dérivé
de clôture, distinct de FULL : abandonner le solde ne signifie jamais le recevoir.
`remaining = max(0, ordered - receivedPosted - closedQuantity)`. Les endpoints
de réception et leur posting refusent également une commande clôturée.
Versions, verrou tenant partagé avec WMS, audit et historique sont obligatoires.
Une réponse incertaine à un avenant impose une inspection, pas un renvoi aveugle.

Le prochain calcul MRP capture la nouvelle promesse ou la clôture. Son hash
change; le calcul antérieur reste intact et devient périmé. L’assouplissement
du garde BUY inter-calcul exige toujours un achat capturé dans le calcul courant.

### 2. Impacts matières et APS

`/manufacturing/materials` analyse un entrepôt explicite. Les OF RELEASED et
IN_PROGRESS sont présentés comme **matières disponibles**, **en attente
d’arrivage** ou **manque non couvert**. Chaque détail relie le besoin restant,
le stock, les promesses fournisseurs et l’OF/atelier. Le début de référence
provient de la baseline publiée, sinon de la date de libération de l’OF.

Le helper pur `deriveMaterialImpact` utilise une arithmétique exacte à neuf
décimales et alloue une seule fois les ressources partagées, par échéance puis
identifiant stable. Les consommations déjà déclarées réduisent le besoin
théorique restant; lorsque toutes les unités sont déclarées, le besoin restant
est nul même si la consommation réelle était inférieure au théorique.
**Il s’agit d’une simulation, jamais d’une réservation**.
Les OF sans instantané compatible, ou dont un article est inactif/incompatible,
sont signalés comme non évalués; leurs besoins ne sont pas déduits et aucune
conclusion globale de disponibilité ne peut alors être garantie.

Dans **Planification → Calculer**, l’option matières capture :

- stock WMS du seul site concerné;
- quantités des définitions figées des OF, jamais une BOM courante reconstruite;
- achats CONFIRMED ouverts, moins les réceptions POSTED et les reliquats clôturés;
- arrivées datées à minuit UTC et date de libération matières minimale par OF.

Une promesse dont la date est passée est exclue de l’APS et de l’allocation
consultative jusqu’à réception physique ou nouvelle promesse. Elle n’est pas
du stock. Le MRP conserve par ailleurs ses propres exceptions sur les promesses
en retard : ne pas confondre netting MRP et faisabilité opérationnelle APS.

L’adaptateur repousse uniquement `snapshot.work_orders[].release_date` à la
date matière minimale capturée; il ne modifie pas l’OF. Ceci respecte le gate
de faisabilité pré-solve existant de PlaniAdvance. Le moteur garde le dernier
mot sur capacité, séquencement et publication; aucune autorisation forcée.

`material_revision` couvre les matières chargées. Revue en RepeatableRead et
publication sous le verrou tenant recontrôlent stock/arrivages et révision des
dossiers. Un changement depuis le calcul bloque la publication. Les anciens
scénarios matières sans cette preuve restent consultables/rejouables mais ne
sont plus publiables. Le replay utilise exactement la requête d’origine et
reste historique. Aucun mouvement WMS n’est déclenché par l’APS.

La lecture, revue, publication et le replay d’un artefact matières recontrôlent
`wms.read` et l’activation WMS. Les scénarios sans matières conservent leurs droits
Fabrication habituels. Aucun prix, contact fournisseur ou détail CRM n’est ajouté
au snapshot APS ni à l’analyse d’impacts.

### 3. Atelier et quantités réelles

Depuis un OF capturé : **Atelier et stock réel** ouvre un panneau Pulsar.
L’opérateur démarre l’OF par son workflow existant, puis déclare explicitement :

- quantité bonne et rebutée (entiers, somme positive, dans le reste de l’OF);
- consommation réelle de chaque composant capturé, avec bin source du même site;
- destination des bons produits et note d’atelier/écart/rebut;
- confirmation de l’écriture réelle du stock.

Il n’existe pas de consommation implicite de la nomenclature. Un composant peut
avoir une consommation nulle explicitement saisie (ex. consommé auparavant);
aucun composant absent de la version n’est admis. L’API accepte plusieurs bins
par composant; le formulaire v1 en expose un. Précision consommation : trois
décimales, comme WMS. Les articles, unités, SKU et bins actifs sont revalidés.

`ManufacturingDeclaration` et ses preuves sont persistées dans la même
transaction que les mouvements CONSUMPTION et PRODUCTION, via le writer unique
`InventoryService.postMovement`. Stock insuffisant ⇒ rollback intégral.
Seule la quantité bonne crée du stock de produit fini; le rebut n’en crée pas.
Les preuves capturent article/unité/bin/quantité et identifiants des mouvements.
Le panneau reste ouvert après validation et lie le journal WMS filtré.

L’intention est conservée avant POST dans le navigateur, isolée tenant/utilisateur/OF.
La clé UUID et le fingerprint lient acteur/corps/OF. Sous verrou, le replay exact
précède la vérification de version : après coupure, reprendre la même déclaration,
même après rechargement. Un autre corps avec cette clé donne 409. Les erreurs
métier conservent la saisie et demandent une actualisation avant nouvelle intention.

Pour les OF capturés, COMPLETED exige `good + scrap = quantité de l’OF`.
CANCELLED est interdit après déclaration; ni suppression ni inversion automatique
de stock. Les transitions existantes restent obligatoires. Le calcul MRP capture
les preuves atelier et le WMS contient déjà les quantités réellement produites :
aucun double comptage. Le blocage MAKE inter-calcul ne se lève que pour un OF
COMPLETED avec déclarations capturées dans le calcul courant.

## Analyste et worker IA

`get_mrp_run` expose maintenant les preuves atelier figées et un bloc séparé
`currentMaterialImpact`. Le contexte distingue historique, présent, stock,
arrivages et clôtures. Les impacts sont bornés à 50 OF, 50 composants par OF et
20 sources par composant, avec totaux et OF non évalués.

Les synthèses/recalculs restent dans les outils existants, via tâches,
AgentWorkerService, registre MCP et ProposedAction/caps. **Aucun nouvel outil
de mutation achats, atelier ou stock**. Aucun appel à un vrai LLM ni qualification
provider/budget n’est revendiqué. Les tests utilisent le runtime worker contrôlé.

## API et droits

Préfixe `/api/v1`. Tenant exclusivement issu de l’identité authentifiée.

| Endpoint                                                      | Droits supplémentaires au module Fabrication                        |
| ------------------------------------------------------------- | ------------------------------------------------------------------- |
| GET `manufacturing/material-purchases/workspace/arrivals`     | manufacturing.read + wms.read, WMS activé; provenance CRM gardée    |
| POST `manufacturing/material-purchases/:id/amendments`        | manufacturing.read/manage + wms.read; version, motif et kind        |
| GET `manufacturing/scheduling/material-impact?locationId=...` | manufacturing.read + wms.read; Fabrication/WMS activés              |
| GET `manufacturing/shop-floor/orders/:id`                     | manufacturing.read + wms.read; Fabrication/WMS activés              |
| POST `manufacturing/shop-floor/orders/:id/declarations`       | manufacturing.read/manage + wms.read/manage; version + operationKey |

## Limites et suite

M3c/M4/M5 restent partiels. Prochains lots explicites :

1. **WIP par opération et replanification partielle** : temps réels/restants,
   gel de l’exécuté et baseline en entrée. Aujourd’hui, tout OF actif avec une
   déclaration atelier bloque un nouveau scénario APS global. Il faut terminer
   l’OF ou consulter les impacts; aucune durée restante n’est inventée.
2. **Achats industriels** : regroupement/multi-lignes, intake personnalisé WMS,
   retours, taxes/factures, conversions unités achat/stock et correction tracée.
3. **Réservations, qualité et traçabilité** : lots/généalogie, scans, annulation
   compensatoire gouvernée, coût de revient. Pas d’édition destructive du journal.
4. **Qualification IA réelle** sur tenant de test, provider et budgets explicites.

Autres limites : APS matières global sur un seul site actif, quantités de sortie
entières, pas de recettes/procédés/coproducts ni réservation machine dans ce lot.
Maximum 2 000 OF actifs analysés/site, 10 000 achats attendus/site et 10 000
déclarations capturées par calcul MRP; dépassement refusé explicitement. Les
historiques complets de commandes/OF ne sont pas encore paginés. Le journal WMS
montre les mouvements liés, sans lien inverse enrichi vers l’OF pour le moment.

## Livraison et preuves

Migration additive `20260916003000_manufacturing_operational_loop` : colonnes de
clôture, historique des avenants, déclarations et deux types de mouvements.
Contraintes SQL de quantités, relations restrictives et unicité d’idempotence.
Pas de backfill d’un historique supposé ni changement de `.env`.

Les tests couvrent réception partielle/clôture, version périmée, isolement,
permissions, vraie simulation PlaniAdvance sur arrivage futur, blocage après
report, replay immuable, consommation/production/rebut atomiques, double envoi,
stock insuffisant, liens UI, lecture seule et mobile. Les tests navigateur sont
à API contrôlée; les parcours WMS utilisent en plus une connexion locale réelle.
L’ancien test d’édition d’unité WMS après usage a été aligné sur la protection M2 :
le writer refuse bien 409; la dérive historique est simulée seulement en fixture.

Résultats vérifiés et état de reprise : [état du projet](../etat-du-projet.md).
Aucune fixture métier dans Acme, aucun envoi fournisseur ni déploiement OVH.
