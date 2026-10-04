# Carburant déclaré — opérations locales et historiques

Contrat du 3 octobre 2026. Complète `delivery-route-fuel.md`; aucune intégration réseau,
mesure GPS, télématique, achat, tarif transporteur ou écriture financière.

## Données

- Profil par véhicule : consommations chargé/à vide (L/100 km), ralenti (L/h),
  capacité et réserve (L). Chaque modification publie une révision immuable.
  Chargé/à vide strictement positifs, au plus 200; ralenti 0–100; capacité au plus
  10 000 L, réserve inférieure à la capacité. Trois décimales maximum.
- Prix par tenant : date civile d'effet, décimal exact positif par litre (4 décimales,
  au plus 100), devise du catalogue et source déclarée (3–200 caractères).
  Le prix est choisi explicitement, y compris une révision historique. Aucun « dernier
  prix applicable » implicite, fournisseur contacté ou conversion de devise.
- Réel par tournée : totaux cumulés explicitement déclarés (km et litres, chaînes
  décimales, 3 décimales, au plus 1 000 000), coût facultatif (2 décimales), devise,
  instant ISO avec fuseau et méthode/portée du relevé (3–1 000 caractères).
  Coût absent et devise absente restent `null`, distincts d'un zéro déclaré.
  Le réel peut être provisoire en transit; ce n'est pas un ajout aux totaux précédents.

## API et autorisations

Base `/transportation/delivery-fuel`. Chaque endpoint exige Transportation activé.
Le tenant et l'acteur viennent exclusivement du JWT.

| Ressource                     | Lecture            | Écriture               |
| ----------------------------- | ------------------ | ---------------------- |
| `vehicles/:vehicleId/profile` | GET, planning.read | POST, planning.manage  |
| `prices`                      | GET, planning.read | POST, planning.manage  |
| `loads/:loadId`               | GET, planning.read | aucune                 |
| `loads/:loadId/actuals`       | GET, planning.read | POST, execution.manage |

Les permissions complètes portent le préfixe `transportation.`. Historiques de
20 révisions par page, ordre décroissant; page 1–100 000. Aucun hash, acteur ou clé
de reprise dans les projections de lecture.

Chaque POST fournit `operationKey` UUIDv4, `expectedRevision` (0 si aucune révision),
puis `profile`, `price` ou `actual`. Le réel exige aussi `expectedLoadUpdatedAt` et
`expectedRouteUpdatedAt`. Les objets de données sont fermés aux champs inconnus.
HTTP 201 renvoie la clé, l'identifiant, la révision, la date et le snapshot.

L'acteur, le type, la portée et le corps exact sont liés à la clé. Rejeu identique :
reçu original, sans écriture/audit supplémentaire. Corps ou acteur différent : 409.
Les guards de module et permission restent contrôlés sur chaque rejeu.

## Capture dans une tournée

Le panneau prépare un callback `DeliveryFuelApplied` : cinq options existantes
(consommations/prix/devise) et une source explicite véhicule/révisions/devise/date.
Le clic ne sauvegarde pas la tournée. Toute édition manuelle d'une option carburant
retire cette source du brouillon; il faut prévisualiser puis enregistrer le plan.

Le serveur résout de nouveau les valeurs sous verrou : véhicule encore affecté,
profil toujours courant, révision de prix appartenant au tenant, devise identique,
date d'effet au plus égale à `asOf`. `asOf` doit égaler le jour UTC de `planning.startAt`;
sans départ, une date de référence future est refusée. Les valeurs client ne font
pas autorité. La source persistée capture IDs, révisions et valeurs explicites.
La mise à jour ultérieure d'un profil ou prix ne réécrit jamais le plan historique.

L'autonomie affichée est seulement théorique : réservoir plein moins réserve,
consommation constante, hors ralenti. Aucun niveau de départ ni ravitaillement
n'est connu; une alerte de volume n'est pas une garantie d'autonomie réelle.

## Déclarations et comparaison

Nouvelles déclarations seulement IN_TRANSIT/COMPLETED, avec plan enregistré et
versions à jour. Date de relevé future refusée. La première déclaration capture
une base serveur `{routeId, routeUpdatedAt, deliveryPlan}`, au plus 1 Mio encodé UTF-8.
Toutes les révisions suivantes conservent cette base, même si la tournée change.
La lecture calcule les écarts à cette base uniquement; données absentes restent
inconnues, devises différentes restent non comparables. Aucun recalcul de
`Load.estimatedCost` ou `Load.costDetail`, notamment après COMPLETED.

Les tables sont append-only avec FK composites tenant/véhicule ou load/acteur et
unicité des révisions/clés. Verrou partagé `delivery-fuel:<tenantId>`; lorsqu'un
load est concerné, verrou de sa ligne AVANT celui du carburant, jamais l'inverse.
Révision et audit sont atomiques dans la même transaction. Les conflits de
sérialisation sont explicitement 409, sans retry caché.

## Reprise et vérification

L'interface conserve l'intention exacte en sessionStorage tenant/acteur/load avant
envoi; les versions attendues sont capturées à l'ouverture du formulaire, jamais
remplacées silencieusement par un rafraîchissement en arrière-plan. Réponse incertaine : aucune nouvelle clé automatique; inspection des
historiques, reprise exacte ou retrait explicite de la demande locale après contrôle.
Le retrait local ne supprime jamais une révision serveur. Stockage indisponible :
aucune nouvelle écriture envoyée.
Même un refus ultérieur (par exemple module désactivé avant la reprise) conserve
la clé : il ne prouve pas que le premier envoi incertain n'a pas été enregistré.

Preuves locales dédiées : `fuel-profile.spec.ts`, `delivery-fuel.service.spec.ts`,
`fuel-operation.test.ts`, `delivery-fuel.e2e-spec.ts` et `delivery-fuel.spec.ts`.
Le HTTP exige une base QA jetable dédiée; routage synthétique uniquement.
Les tests navigateur interceptent toute l'API et bloquent les tuiles OSM.
