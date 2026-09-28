# Traçabilité des lots — I2h

## Usage et accès

Articles WMS → Lots → **Traçabilité du lot**. Choisir aval (produits issus du lot)
ou amont (matières d’origine), puis une profondeur de 1 à 4. Chaque carte permet
de consulter les dossiers directs de ce lot. « Repartir de ce lot » ouvre un
nouveau parcours. Les instants sont affichés dans le fuseau de l’utilisateur.

WMS et `wms.read` suffisent pour les dossiers WMS. Les liens atelier exigent aussi
Fabrication et `manufacturing.read`; les pièces Services exigent Services et
`services.read`; le lien explicite préparation → shipment exige Transport et
`transportation.planning.read`. Sans ces accès, ni métadonnée ni compteur caché
n’est exposé. Toutes les lectures filtrent le tenant de la session, jamais un
tenant transmis par l’appelant. Une identité lot/article étrangère retourne 404.

## Ce qui constitue un lien

Une consommation positive et une production positive de la même déclaration
atelier non contrepassée, avec preuve v2 correspondant exactement au journal :
identifiants, type, article, lot, quantité, unité et emplacement. La preuve et le
journal doivent couvrir le même ensemble de mouvements, dans le site de l’OF.
Les noms d’emplacements des liens viennent de la preuve, pas du référentiel courant.

Les parcours suivent les instants physiques du journal. En aval, une consommation
ne précède pas la production précédente du chemin; en amont, une production ne
suit pas la consommation suivante. Une égalité est valide dans une transaction.
Les déclarations contrepassées sont signalées et exclues des liens actifs. Une
preuve v1, absente ou incohérente interrompt sa branche; aucun ancien lien n’est
reconstruit depuis la nomenclature. Un composant ou une sortie non suivi par lot
est signalé comme chaîne incomplète.

La relation est au niveau **lot/déclaration**, pas pièce. La production totale
peut apparaître sur plusieurs liens matières d’une même déclaration : ne jamais
additionner ces répétitions. Un lot peut regrouper plusieurs productions; cette
vue ne répartit pas les matières entre ses unités. Noms/SKU, disposition du lot,
statuts de dossiers et client du projet sont des données actuelles, non des copies
historiques. Les quantités et unités des liens atelier restent celles capturées.

## Dossiers directs et limites

- Réceptions et préparations : une ligne par ligne de document portant ce lot;
  statut visible, y compris brouillons/annulations. L’unité est explicitement
  marquée comme unité actuelle de l’article, non une preuve historique.
- Services : quantités initiale, retournée et nette par utilisation; unité
  capturée. Un retour complet ne fait pas disparaître l’utilisation historique.
- Transport : seul le shipment effectivement lié à une préparation est proposé.
  Ce lien ne prouve ni livraison, ni contenu unitaire du camion, ni client servi.
- Les dossiers couvrent toutes les dates du lot sélectionné; ils ne sont pas
  automatiquement attribués à une branche temporelle du graphe.

Résultats bornés : 50 lots, 80 déclarations, 160 liens, 80 états d’exploration et
4 niveaux au maximum. Toute borne atteinte est indiquée. Une répétition de lot
est affichée comme lien mais jamais développée en boucle. Les états visités
conservent la profondeur et la borne temporelle pour ne pas perdre un chemin
chronologique valide lors d’une convergence. Aucun résultat vide ou partiel ne
signifie « aucun risque ». Les dossiers sont paginés en base (10 dans l’interface,
100 maximum API), indépendamment du parcours.

## Contrats techniques

`GET /wms/items/:itemId/lots/:id/trace?direction=downstream&depth=3`
et `GET …/trace-dossiers?kind=picks|receipts|services&page=1&pageSize=10`.
Lecture transactionnelle RepeatableRead par requête; l’heure de lecture est
retournée, sans stocker un snapshot de rappel. Une actualisation relit l’état
courant. Erreur réseau : ancien graphe retiré, bouton de nouvelle lecture; aucun
retry d’écriture puisqu’il n’y a aucune mutation dans ce parcours.

Pas de migration ni backfill. Aucun effet sur stock, quarantine, OF, Services,
shipment, comptabilité, calcul MRP ou agent IA. Pas de réservation, certification,
rappel réglementaire complet, allocation par pièce ou propagation automatique du
blocage. Un workflow de rappel/destruction/retour reste un incrément distinct.

## Recette

Tests purs : exactitude des preuves, versions, unités, lots, doublons, dates et
chronologie. HTTP isolé : deux niveaux réels amont/aval, profondeur bornée,
contrepassation réelle, preuve legacy, cycle de lots, dossiers paginés, retours
Services, droits/modules/tenant et absence de nouveaux mouvements à la lecture.
Chromium : entrée depuis Lots, sélection, amont/aval, avertissement de profondeur,
lecture sans droits Fabrication, panne et reprise de lecture, bureau et 390 px.
Les tutoriels WMS/Fabrication et la documentation intégrée sont spécifiques à ces
parcours; pas de bouton tutoriel ajouté ni de reset de progression utilisateur.

Vérification locale du 2026-09-25 : 253 HTTP (14 suites), 977 tests Shared,
691 unitaires API, 153 Web et 41 Chromium réussis. Les unités API couvrent aussi
les plafonds de lots/déclarations, une convergence temporelle et le masquage des
shipments sans droit/module. Captures bureau et mobile inspectées, aucun débordement
à 390 px. Builds Shared/API/Web réussis; Svelte zéro erreur, douze warnings déjà
présents. Base isolée `pulsar_enduser_20260921` uniquement, `.env` inchangé.
Aucun push/PR/déploiement. Pas de qualification de charge enterprise ou d’OVH.
