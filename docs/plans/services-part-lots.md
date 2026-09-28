# Services — lots des pièces I2c

2026-09-25. Complément aux [retours partiels](services-partial-returns.md),
aux [lots WMS](wms-lots.md) et aux [avoirs](customer-credit-notes.md).

## Parcours livré

Dans une intervention IN_PROGRESS d’un projet ACTIVE : Pièces et stock → consommer.
Choisir le produit, l’emplacement puis le lot si l’article WMS le suit. Afficher son unité,
son stock par emplacement et sa péremption déclarée; saisir quantité et utilisation,
puis confirmer le mouvement physique. Aucun premier lot sélectionné automatiquement.
Le total de l’emplacement n’est pas le disponible du lot. Aucun stock n’est réservé.

La carte conserve numéro de lot, référence fournisseur et dates civiles figés, en plus
des preuves produit/unité/emplacement. Une modification de correspondance produit n’altère
pas cette histoire. Retourner une quantité conserve obligatoirement le lot, l’article,
l’unité et le bin d’origine. Pas de sélecteur de lot au retour. Les retours partiels et
leurs motifs demeurent append-only, dans la limite exacte de la quantité sortie.

Une pièce liée à une facture brouillon reste bloquée; supprimer le brouillon avant
correction physique, puis le recréer. Une facture validée nécessite une ligne d’avoir
validée et une quantité créditée encore disponible. Valider l’avoir ne déplace aucun stock.

## Contrat et isolation

- POST `services/jobs/:id/parts` accepte `lotId?`, fermé/validé. Article suivi ⇒ obligatoire;
  article sans suivi ⇒ interdit. Lot d’un autre article/tenant ⇒ refus.
- Retour : aucun `lotId` accepté du navigateur; la preuve du PICK original est vérifiée
  (tenant, article, lot, bin, quantité et unité) avant écriture. Incohérence ⇒ 409.
- Verrou business puis tenant WMS, relecture de l’intervention/version/projet et du lien.
  `InventoryService.postMovement` écrit registre, solde total et solde lot dans la même
  transaction que la consommation ou le retour. Aucun emprunt de quantité à un autre lot.
- Empreinte de consommation étendue seulement si un lot est fourni. Les empreintes
  historiques sans lot et celles des retours restent inchangées. Même clé + autre lot,
  contenu ou acteur ⇒ 409. Replay connu avant contrôles métier mutables, après les droits.
- Migration additive 123 : `ServicePartUsage.lotId`, `lotSnapshot`, FK composite
  tenant/article/lot et CHECK de paire lot/snapshot. Aucun backfill, aucune mutation de
  stock ou d’historique. Les anciennes consommations restent explicitement sans lot capturé.
- Services + WMS et `services.read/manage`, `wms.read/manage` pour consommer/retourner.
  Ni Catalogue ni Achats requis. Référentiels accessibles depuis Services → Données.
  `services.read` suffit pour l’histoire figée, même après désactivation WMS; aucune
  lecture de stock actuel ni détail financier privé ajouté à cette projection.
- Pas de nouvel outil ou pouvoir d’agent.

## Reprise et interface

L’intention est conservée avant l’envoi, par tenant/utilisateur/intervention, avec lot,
quantité, version et clé. Après réponse incertaine, recharger puis Vérifier / reprendre
renvoie exactement la demande originale. Un refus lors de la reprise conserve l’intention :
ne pas fabriquer une nouvelle clé. Une nouvelle demande définitivement refusée peut être
corrigée après relecture. Droits, double clic et formulaire concurrent restent gardés.
Changer produit, emplacement, lot ou quantité retire la confirmation physique.

Sélecteur WMS réutilisé, cartes et panneau Pulsar conservés; pieds de carte adaptatifs.
Documentation Services/WMS, relation Services ↔ WMS et étape métier spécifique enrichies.
Le mécanisme de premier passage par utilisateur est inchangé, sans nouveau bouton tutoriel.

## Limites et suite

Dates informatives : pas de FEFO, blocage de péremption, quarantaine, rappel réglementaire,
numéro de série ou conversion implicite. Pas de changement d’emplacement au retour, pas
de mode hors ligne complet ni de garantie d’intégrité face à une écriture SQL hors services.
Atelier/généalogie matière → produit fini constitue le prochain lot distinct I2d.

Migration appliquée uniquement à `pulsar_enduser_20260921`; `.env` intact. Déployer schema,
API et UI ensemble après recette serveur. Aucun push, PR ni déploiement dans ce lot.
Résultats de tests et point de reprise : [état du projet](../etat-du-projet.md).

## Recette du 25 septembre

- 224 tests HTTP sur treize suites : refus sans lot/invalide/autre article/tenant,
  manque malgré un autre lot disponible, rollback complet, concurrence/replay,
  autre acteur/corps/droits, retour après retrait du lien, WMS désactivé, facturation
  nette et retour après avoir. Les scénarios historiques sans lot restent valides.
- 686 tests unitaires API, 964 Shared et 142 Web réussis. Nouvelles assertions sur
  la conservation du lot dans l’intention et sur le contenu du tutoriel Services.
- 22 scénarios Chromium distincts : deux nouveaux parcours Services réels,
  huit lots WMS, trois conditionnements/Achats, sept scans/tutoriels et deux
  régressions pièces/avoirs historiques. Réponses perdues simulées après commit;
  reprise exacte après reload et refus intermédiaire, droits lecture seule,
  premier passage du tutoriel par utilisateur et cartes à 390 px vérifiés.
- Captures desktop/mobile des lots Services inspectées. Aucun débordement horizontal.
- Builds Database/API/Web réussis, SPA statique générée. Svelte : zéro erreur et douze
  avertissements préexistants dans cinq fichiers hors lot. `git diff --check` propre;
  `.env` inchangé. API locale de test sur 3100, Vite existant sur 5173.
- Les premières passes ont signalé des erreurs de fixture (helper Promise et client
  obligatoire du projet), corrigées sans assouplir les validations de l’application.

La recette n’est ni un test matériel Zebra ni une qualification de production/charge.
