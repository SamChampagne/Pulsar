# Fabrication — sites, validité et préparation MRP (M2.2b2 partiel / M3a)

15 septembre 2026 · branche `codex/manufacturing-visual-workspace`.

## Parcours livré

Dans **Fabrication → Calendriers**, choisir explicitement un entrepôt pour chaque
calendrier. Les postes héritent de ce site : une seule source de vérité, pas deux
champs à maintenir. Une affectation déjà faite ne change plus de site; créer un
autre calendrier/poste si nécessaire. Les calendriers historiques restent sans
site jusqu’à leur affectation humaine, avec contrôle `expectedUpdatedAt`.

La publication d’une nomenclature accepte des dates facultatives de début/fin
inclusives. Elles sont capturées dans la version et son hash, jamais modifiées
après publication. MRP exige que la version MAKE sélectionnée couvre **tout
l’horizon**; il ne bascule pas automatiquement vers une autre révision. La
libération d’un OF revérifie sa période de fabrication. Les anciennes révisions
sans dates restent sans restriction : aucune validité historique inventée.

Dans **Besoins matières → Expliquer un article → Préparer / voir le document** :

1. Lire quantité/unité de stock, site, dates et version, issus du calcul immuable.
2. Le serveur vérifie fraîcheur et documents déjà préparés.
3. Confirmer explicitement pour créer le brouillon, sans changer les quantités.
4. BUY : demande d’achat **interne** numérotée MR, conservée dans ce calcul;
   annulation confirmée/versionnée depuis le même panneau.
5. MAKE : OF DRAFT numéroté MO, avec site/version/quantité exacts. Ouvrir l’OF,
   importer une gamme ou ajouter les opérations, puis utiliser son workflow
   normal de libération. L’OF renvoie au calcul d’origine.

Le guide de refonte de l’existant a conduit à réutiliser le Drawer Pulsar,
les états bloqués/chargement et la confirmation progressive. Ni nouveau thème,
ni changement du bureau d’apps. Les panneaux sont testés au clavier et à 390 px.

## Contrats d’intégrité

- `MrpPreparation` conserve provenance, proposition et unité capturées. BUY est
  une demande interne; MAKE référence un véritable `ManufacturingOrder`.
  La contrainte SQL impose le bon type de cible, quantité positive et dates
  ordonnées. Pas de suppression de l’OF lié : annulation et traçabilité conservées.
- Création sous verrou de ligne tenant commun au stock, aux règles et aux
  demandes CRM. Fraîcheur recomposée **dans cette transaction**, puis comparaison
  avec le hash du calcul et le jeton de prévisualisation. Séquence, OF et lien MRP
  sont écrits atomiquement; audits métier après commit via le service existant.
- Idempotence durable `(tenantId, operationKey)`, fingerprint lié à l’acteur,
  au calcul, à la proposition et au jeton. Le replay exact précède la fraîcheur.
  Contenu différent sous la même clé : 409. Une contrainte unique supplémentaire
  `(tenantId, runId, proposalId)` refuse un deuxième document avec une autre clé.
- Le navigateur conserve la confirmation dans localStorage **avant** l’envoi,
  isolée par tenant/utilisateur/calcul/proposition. Après réponse incertaine :
  relire le document ou reprendre le corps/la clé identiques, jamais régénérer
  une clé pour réessayer. Stockage local indisponible : aucun envoi.
- Protection inter-calcul conservatrice par article/site : une préparation non
  annulée d’un autre calcul bloque une nouvelle préparation de cet article.
  Les différentes propositions d’un même calcul restent préparables. Un OF
  COMPLETED bloque encore : sans rapprochement à sa production WMS, il ne peut
  pas être supposé avoir fourni du stock. Les annulations rendent un nouveau
  calcul préparables, jamais la même proposition historique à nouveau.
- OF issus du MRP : quantité/produit/site/version non réaffectables, aucune
  libération sans opérations. Les mutations d’opérations prennent le verrou
  tenant, avancent la version parent et refusent les ordres démarrés/terminés.
  Import de gamme relit le brouillon et l’absence d’opérations sous le verrou.
- Les nouveaux endpoints exigent Fabrication et WMS, `manufacturing.read` et
  `wms.read`; mutations : `manufacturing.manage` en plus. Les droits CRM et
  l’activation CRM sont revérifiés si l’historique contient des sources CRM.
  Les réponses n’exposent pas le fingerprint ou la clé d’idempotence.

## APS et IA

Les candidats APS sont restreints au site de l’OF via les calendriers. Un
ensemble vide est un refus, jamais « utiliser tous les sites ». Le mode historique
entièrement sans sites conserve sa validation existante. Dès que des sites sont
présents, un OF sans site ne peut utiliser que des postes eux aussi sans site.
Site inactif : ses calendriers sont exclus. La révision des données capture
l’affectation et la publication partage le verrou avec leurs writers.

Cela **ne livre pas** des fuseaux par usine ni le MRP/APS matières multisite :
le fuseau commun reste explicite et le contrôle matières refuse toujours les
calculs regroupant plusieurs sites. Rejeu historique inchangé.

Les anciens OF sans contexte matières restent sans site. Leur migration n’est
pas implicite : avant d’affecter tous leurs calendriers à un site, requalifier
les dossiers (site/version sur un brouillon compatible, ou remplacement explicite
d’un ancien ordre libéré). L’affectation d’un OF sans BOM à un site indépendant
du contexte matières reste à compléter; conserver ses ressources historiques
sans site jusque-là.

`get_mrp_run` expose les préparations du calcul à l’analyste, bornées à 100 pour
la page d’articles, avec total et statut actuel de l’OF. La consigne distingue
brouillon, stock et arrivage. Aucun outil achat/OF n’est ajouté au worker : cette
tranche reste une action humaine explicite; les outils IA existants gardent leur
gouvernance. Aucun appel LLM réel ni changement de provider dans ce lot.

## API

- `GET /manufacturing/calendars/sites`
- Calendrier : `locationId` sur création; affectation historique avec version.
- Publication BOM : `validFrom?`, `validUntil?` au format date UTC `YYYY-MM-DD`.
- `GET /manufacturing/mrp/runs/:id/preparation?proposalId=...`
- `POST /manufacturing/mrp/runs/:id/prepare` : `proposalId`, `reviewToken`,
  `operationKey` UUID; jamais quantité/site/tenant dans ce corps.
- `GET /manufacturing/mrp/runs/:id/preparations` : documents paginés de ce calcul.
- `POST /manufacturing/mrp/preparations/:id/cancel` : `expectedUpdatedAt`, BUY
  uniquement. Les OF utilisent `/manufacturing/orders/:id/cancel`.

## Limites et prochain lot

**M3a n’est pas encore un achat matières complet.** Aucun fournisseur, prix,
envoi, engagement, approvisionnement ferme, réception partielle ou facture
fournisseur créé. Le module Procurement actuel concerne les RFP transport : il
n’est pas réutilisé abusivement comme commande de matières. Aucun stock réservé,
décrémenté ou produit. Un nouveau calcul n’absorbe pas ces brouillons en SUPPLY.

Unités d’achat distinctes et conversions achat/stock restent ouvertes. Les
quantités sont exactes en unité WMS, max 1 milliard/3 décimales. MAKE fractionnaire
est bloqué : les OF sont encore entiers, aucune conversion ou arrondi caché.
Recettes, rendements, coproduits, lots et rebuts restent M6.

Suite recommandée : **M3b achats matières** (fournisseurs/conditions, demande →
commande approuvée, dates et quantités fermes), puis réceptions WMS partielles et
rapprochement des préparations, avant d’assouplir le verrou inter-calcul. Ensuite
boucle matières–capacité M4 et qualification d’un vrai worker M7b sur environnement
de test avec budget/provider configurés par l’utilisateur.

## Migration et vérification

Migration additive `20260915230000_mrp_preparation_sites_validity`, aucun backfill
ni seed de la base Acme. Appliquée aux bases locales dev et test.

La suite HTTP MRP inclut des propositions contrôlées pour tester le contrat de
préparation; la voie PlaniAdvance réelle est aussi rejouée pour le calcul et APS.
Tests : concurrence/replay, permissions/tenant/CRM, péremption, aucune écriture
stock, refus fractionnaire, OF lié, validité, site immuable et annulation.
Tests navigateur à réponses API contrôlées : confirmation, lecture seule,
réponse perdue avant/après création, rechargement et même clé, mobile.
Les résultats finaux sont consignés dans `docs/etat-du-projet.md`.
