# I2f — Quarantaine des lots et libération documentée

## Portée

WMS est propriétaire du blocage. WMS seul suffit; désactiver Qualité ne peut lever une
quarantaine. Une décision concerne un lot entier (article + entreprise), dans tous ses
emplacements et sites, pas une quantité partielle. Les identités et dates restent immuables.
Les anciens lots sont `UNRESTRICTED` : absence de blocage connu, **pas certification qualité**.

## Décisions

`UNRESTRICTED → QUARANTINED` : wms.read + wms.manage, motif 3–1000 caractères,
confirmation de portée dans l’interface. `QUARANTINED → UNRESTRICTED` : mêmes droits
et **wms.lots.release**, motif et compte rendu du contrôle de 10–2000 caractères.
Le catalogue est synchronisé au démarrage et le rôle système admin reçoit ce droit selon
la politique existante. Les autres rôles doivent le recevoir explicitement (puis JWT rafraîchi).
Aucun nouveau pouvoir ni outil mutating agent. Aucun changement de stock par la décision.

`POST /wms/items/:itemId/lots/:id/{quarantine,release}` exige operationKey UUID v4 et
expectedRevision entier. Verrou tenant WMS avant replay, lecture, state machine et version.
Lot et décision append-only sont atomiques. Rejouer la même clé/acteur/corps rend la
décision initiale, même si le lot a depuis changé; ce replay ne réapplique jamais son état.
Autre corps/acteur ou révision périmée : 409. Audit après commit; preuve durable en transaction.
Historique paginé via GET `.../decisions`, sans fingerprint ni clé de reprise exposés.
FK composites acteur/lot, checks SQL transition/motif/contrôle. Migration additive 125.

## Effets transversaux

| Parcours | Lot en quarantaine |
| --- | --- |
| Réception WMS/Achats, retour positif Services, production entrante | Permis; les nouvelles quantités restent bloquées |
| MOVE pour isolation physique | Permis, même lot obligatoire, aucun changement de disposition |
| Préparation WMS, pièce Services, consommation atelier | Refus 409, transaction entière annulée |
| Ajustement négatif, écart négatif de comptage | Refus; pas de contournement par correction |
| Contrepassation atelier retirant le produit | Refus et explication dans la revue |
| Inventaire | Physique conservé; quantités quarantaine et utilisables distinguées |
| MRP et impacts matières | Disponible site/actif diminué des lots bloqués, sans autre unité/site |
| APS matières | Même exclusion; revue/publication revalident la révision matières |

L’autorité finale reste InventoryService.postMovement sous le même verrou que la décision.
Les sélecteurs expliquent le blocage, les préparations affichent une readiness négative;
ce ne sont ni des réservations ni un remplacement du contrôle serveur. Les preuves historiques
ne sont jamais réécrites. Les nouveaux snapshots MRP capturent les quantités exclues par article;
les snapshots déjà calculés restent historiques. Les tableaux de stock physique ne deviennent
pas des promesses de stock libre. Pas d’addition entre articles/unités.

## UX et reprise

Articles → Lots : statut textuel, motif, révision, historique auteur/instant au fuseau utilisateur,
formulaire progressif pour blocage/libération. Lecture seule sans droits de gestion, droit de
libération expliqué sans bouton trompeur. Navigation interdite seulement durant envoi.
Intention liée au navigateur/tenant/utilisateur/article/lot, conservée avant POST; stockage
indisponible ⇒ aucun envoi. Réponse perdue ⇒ reprendre la même demande. Un refus intermédiaire
à la reprise ne supprime pas l’intention. Ne pas vider manuellement une demande incertaine sans
vérifier l’historique. Le tutoriel WMS ajoute une septième étape sans reset des préférences.

## Limites explicites

Contrôle manuel documenté : ni signature réglementaire, ni séparation obligatoire de deux
personnes, ni preuve que le contrôle a réellement eu lieu. Qualité continue de gérer inspections,
preuves et non-conformités indépendamment. Extension [I2g](quality-lot-controls.md) : référence FK
facultative d’un contrôle du même lot préparé avant exécution, preuve figée et fraîcheur vérifiée.
Le parcours manuel reste autonome. Aucun blocage/libération automatique
depuis Qualité, ni propagation aux descendants déjà fabriqués/livrés, ni rappel de marchandise.
Péremption/FEFO, quarantaine partielle, destruction/rebut d’un lot bloqué et retour fournisseur
exigent leurs workflows propres; il ne faut pas libérer artificiellement un lot pour les simuler.
Les suggestions historiques de réapprovisionnement restent basées sur le physique (à qualifier
séparément); ce palier adapte MRP/APS/impacts et les sorties, pas tous les KPI historiques.

## Recette

Deux gestionnaires concurrents : une décision; retry exact sans doublon; autre acteur/corps refusé.
Lecteur et gestionnaire sans droit release interdits. Autre tenant 404. Panne après création de
preuve ⇒ rollback état/historique. WMS seul fonctionne. Entrée/MOVE gardent le blocage, sortie
refusée dans picking/atelier/ajustement; aucune écriture partielle. MRP exclut le lot sans changer
l’ancien snapshot; APS revoit sa révision. UI : bureau/mobile, motif/contrôle, réponse perdue,
rechargement/reprise, lecture seule, première visite tutoriel et non-réapparition.

## Vérification locale — 2026-09-25

- 235 tests HTTP sur 13 suites, dont 35 dans le registre des lots (WMS/Services/Fabrication).
- 687 tests unitaires API, 966 Shared et 150 Web réussis.
- 37 scénarios Chromium réussis; captures bureau/mobile inspectées, aucun débordement à 390 px.
- Svelte : zéro erreur, 12 warnings préexistants. Builds Shared/Database/API/Web réussis.
- Migration 125 uniquement sur `pulsar_enduser_20260921`; `.env` intact. Aucun push/PR/déploiement.

Ces vérifications ne qualifient pas le serveur OVH, le matériel réel ni une conformité réglementaire.
