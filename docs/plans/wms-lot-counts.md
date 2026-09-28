# WMS — comptages par lot et ajustements durables I2b

Date : 2026-09-25. Branche : `codex/pilot-business-depth`.

## Parcours opérateur

1. Démarrer un comptage sur un emplacement calme. Le serveur capture les soldes connus,
   y compris à zéro : une ligne par article non suivi, une par article/lot suivi.
2. Compter physiquement toutes les lignes, dans leur unité capturée. Une case vide ne
   signifie pas zéro. Aucun total ne mélange unités ou articles.
3. Un scan sélectionne l’article. Plusieurs lots ⇒ choix explicite du lot en main.
   Le mode +1 ajoute seulement un EA au brouillon après ce choix; aucune allocation automatique.
4. Enregistrer ferme la saisie, sans mouvement. Réconcilier après confirmation inscrit
   les seuls écarts non nuls et leur provenance dans le journal, dans une transaction unique.
5. Si un mouvement touche l’emplacement entre démarrage et réconciliation, annuler et
   recompter. Les entrées et sorties qui s’annulent mathématiquement invalident aussi la copie.
6. Si la réponse d’une réconciliation est perdue, actualiser le dossier : son statut
   indique le résultat. Ne pas recréer ni relancer aveuglément une correction.

Un article/lot inattendu absent des lignes doit être identifié et ajusté explicitement,
puis un nouveau comptage démarré. Un emplacement sans solde connu est refusé avec cette
explication. Aucun ajout automatique de ligne, gel physique d’entrepôt, comptage aveugle,
réservation, quarantaine ou règle FEFO dans ce palier.

## Invariants et concurrence

`CycleCount.stockMovementCount` capture le nombre de mouvements append-only qui touchent
le bin, sous le même verrou tenant que `InventoryService.postMovement`. Tous les writers
de comptage (création/saisie/réconciliation/annulation) prennent ce verrou avant relecture.
La revalidation compare ce compteur ET l’unité/suivi des lignes. Un mouvement d’un autre
bin ne bloque pas le dossier. Un nouveau lot arrivé dans le bin invalide tout le comptage.
Ce compteur est un témoin de lecture, pas un solde ni un nouveau writer de stock.

Les lignes capturent `lotId` et `unitSnapshot`; FK composite tenant/article/lot et index
partiels d’unicité des nouvelles lignes. Les totaux suivis sont contrôlés contre leurs
soldes par lot avant capture. Pas de copie fictive des historiques : watermark/unité NULL
signifie ancien dossier non réconciliable. Consultation et annulation restent possibles;
les dossiers déjà terminés ne sont jamais revalidés contre le stock présent.

Les transitions conservent `canTransitionCycleCount`, CAS et version monotone. Le client
transmet `expectedUpdatedAt` pour saisie/réconciliation/annulation; anciennes requêtes sans
version toujours acceptées, mais contrôles stock/statut obligatoires. Toutes les lignes
doivent être comptées exactement une fois; quantités >= 0, trois décimales maximum.
`postMovement` écrit lots + total + journal, jamais une affectation directe de solde.
Les audits et événements de variance gardent leur traitement best-effort après commit.
Les écarts peuvent alimenter le Workbench; aucun nouveau pouvoir agent ni exécution IA.

GET détail expose `freshness: { valid, reason }` pour OPEN/COUNTED, sinon NULL. Lecture
RepeatableRead et informative; le writer revérifie toujours sous verrou. Droits WMS
existants conservés : module activé, tenant JWT, `wms.read`/`wms.manage` selon l’action.

## Ajustement manuel durable

POST `/wms/inventory/adjust` accepte désormais `operationKey` UUID v4 optionnel, et retourne
`movementId`, `createdAt`, `replayed`. Le fingerprint lie type d’opération, acteur, article,
bin, lot, quantité signée normalisée Decimal et note. Le registre partage l’unicité
`(tenantId, operationKey)` avec MOVE : aucune réutilisation croisée d’une clé.

Replay sous verrou AVANT disponibilité; un lot vidé par l’ajustement initial n’empêche
pas de retrouver sa preuve. Autre acteur ou autre corps ⇒ 409. Échec avant commit ⇒ clé
et solde annulés ensemble. Audit seulement pour le premier succès. Les clients sans clé
gardent l’ancien comportement non dédoublonné; une nouvelle clé ne représente pas un retry.

Le navigateur conserve le corps avant POST sous `pulsar.wms.adjust.v1:<tenant>:<user>`,
sans token ni secret. Échec de stockage ⇒ aucun envoi. Après coupure/rechargement, la
bannière WMS propose une confirmation humaine et reprend exactement cette demande.
Aucun retry automatique. Une erreur métier certaine au premier envoi rend la saisie
modifiable; un échec pendant une reprise conserve l’intention. Stockage corrompu ⇒
vérification du journal, aucun bouton d’effacement aveugle.

Limites : stockage local au navigateur, pas une file offline multi-appareils. Deux
opérations distinctes avec des clés différentes ne sont pas fusionnées. Aucun verrou
multi-onglets pour deux créations simultanées de clés distinctes. Pas de test matériel
Zebra physique ni test de charge revendiqué. Le scan utilise le mode clavier existant.

## Interface et documentation

Composants Pulsar conservés; quantité/unité/lot, écarts du brouillon, progression en nombre
de lignes, erreurs de fraîcheur, lecture seule et actions explicites. Le guide de retouche
`redesign-existing-projects` a guidé cette continuité sans changement de framework.
Documentation embarquée, aide de page et six étapes métier WMS mis à jour. Premier
passage par utilisateur seulement : aucun reset des tutoriels vus ni nouveau bouton.

Migration additive `20260925010000_wms_lot_counts` (122), uniquement dans la base locale
isolée `pulsar_enduser_20260921`. Aucun backfill. `.env` inchangé, pas de push/PR/déploiement.
Tests et résultats : voir le point de reprise dans `docs/etat-du-projet.md`.

## Vérification

- API : 686 unitaires et 185 HTTP sur douze suites WMS/scans/Achats/Services/MRP.
- Shared : 964 tests; Web : 140 unitaires, dont quatre nouveaux tests d’intention durable.
- Chromium : 56 scénarios distincts sur six fichiers, incluant les reruns ciblés finaux.
  Les parcours lots/comptages/ajustements et achats utilisent l’API réelle et des tenants
  de test dédiés; les autres régressions UI emploient leurs fixtures réseau contrôlées.
- Cas : toutes les lignes/zéro, lots mixtes, invalidation avant/après saisie et après net zéro,
  concurrence de réconciliation, six reprises d’ajustement, autre acteur/corps/tenant/module,
  clés partagées avec MOVE, rollback, lot vide, réponse perdue après commit, reload exact,
  lecture seule, scanner ambigu, tutoriel une fois par utilisateur, actions bloquées pendant
  ouverture d’un autre dossier et fiches mobile 390 px.
- Les anciennes assertions de tutoriel ont été actualisées (six étapes et route Articles).
  Une sélection ambiguë du test entre la fiche mobile cachée et le tableau a été précisée;
  aucune assertion métier de stock n’a été assouplie. Un timeout isolé de sélecteur Destination
  dans la première passe ne s’est pas reproduit à la passe complète suivante.
- Typecheck Svelte : zéro erreur, douze warnings préexistants dans cinq fichiers hors lot.
  Builds Database/API/Web réussis, SPA adapter-static générée. `git diff --check` propre;
  aucune modification `.env`. API de test locale sur 3100, Vite existant sur 5173.

## Suite opérationnelle

Choix/capture explicite des lots Services livré dans [I2c](services-part-lots.md),
atelier/généalogie directe dans [I2d](manufacturing-lots.md). Suite : corrections compensatoires
avant extension qualité/quarantaine. Préserver les liens d’origine,
quantités exactes et annulations partielles; ne pas étendre les pouvoirs IA en même temps.
Les numéros de série, FEFO/quarantaine et reste du programme I1/I3–I5 sont encore ouverts.
