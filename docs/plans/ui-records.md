# Pulsar — fiches de travail, lot 2

Date : 2026-09-14. Branche : `codex/ui-records`, depuis `1bd2989`.

## Périmètre livré

Suite de [la refonte des écrans](./ui-screens.md). Le bureau d’applications reste
inchangé. La revue de refonte privilégie les interactions et le contexte de travail :
pas de nouveau framework, pas de données fictives dans l’interface, pas de réécriture métier.

- Opportunité, commande de vente, ordre de transport, chargement : en-tête commun
  avec retour à la liste, statut, contexte et actions. Navigation de sections fixe,
  focus clavier sur la section choisie, défilement limité à la zone de travail et
  respect de la réduction des animations. Les formulaires restent montés.
- CRM : un éditeur de lignes commun remplace les deux implémentations dupliquées.
  Quantité, prix et remise se modifient au clavier : Entrée / coche pour enregistrer,
  Échap / croix pour annuler. Pas de sauvegarde au blur. Un PATCH échoué conserve
  la saisie ; les contrôles sont bloqués pendant l’appel. Suppression confirmée.
- Ajout de ligne dans un Drawer : catalogue recherchable par nom (produits actifs,
  20 résultats, invitation à affiner) ou ligne libre. Champs conservés après erreur,
  fermeture d’une saisie non enregistrée confirmée, retour du focus et footer visible.
  Quantités décimales et prix nul autorisés conformément aux DTO existants ; remise
  bornée entre 0 et 100. Les totaux utilisent le helper partagé et la devise du dossier.
- Opportunité : pipeline personnalisable conservé ; suppression de la seconde
  représentation à étapes fixes et des actions de navigation répétées.
- Commande : lignes en lecture seule hors brouillon ou sans `crm.manage`, actions de
  statut contextualisées, préparation d’expédition dans un panneau latéral. Les liens
  commande → transport et transport → commande existants restent opérationnels.
- Transport : planification / ajout d’expéditions hors du flux de la page. Une erreur
  conserve les lignes restantes ; les créations déjà confirmées par le serveur sont
  retirées du formulaire. Une indisponibilité des définitions de champs personnalisés
  empêche la soumission et expose un bouton pour réessayer. Les champs personnalisés
  sont transmis même lorsqu’aucune quantité n’est saisie dans la planification initiale.
- Chargement : sections itinéraire, expéditions, documents, ressources, frais et suivi.
  Les erreurs de données secondaires sont affichées à leur emplacement, pas comme une
  liste vide normale. Le rechargement après une erreur principale efface bien l’erreur.
  Les actions d’en-tête ont une garde pendant l’appel ; annuler un dossier demande confirmation.

## Défauts constatés et corrigés pendant la qualification

1. `GET /crm/sales-orders/:id/line-items` renvoie un tableau, comme le service API,
   alors que la page utilisait `response.items`. Correction du consommateur et du
   mock ; le parcours réel a permis de détecter ce décalage que le test isolé ne voyait pas.
2. `scrollIntoView` déplaçait aussi le document derrière le cadre fixe. Le raccourci
   ne fait maintenant défiler que `[data-workspace-scroll]`.
3. Le libellé masqué de la colonne Actions pouvait déborder hors du tableau sur mobile.
   Son conteneur de référence est maintenant la zone de défilement du tableau.
4. Une erreur de chargement du contexte d’expédition n’est plus assimilée à un manque
   de permission : seul le 403 masque cette section ; les autres échecs sont réessayables.

## Qualification

- Svelte : 0 erreur, 19 avertissements dans 6 fichiers, contre 41 avant ce lot.
  Aucun avertissement restant dans les quatre pages ou les composants ajoutés.
- `record-screens.spec.ts` : erreurs d’édition et d’ajout, nouvelle tentative, recherche
  de produits actifs, fermeture et focus, lecture seule, suppression annulée sans appel,
  échec partiel transport, erreurs de chargement, navigation clavier et téléphone 390 px.
  Ces erreurs et mutations sont interceptées : ce sont des tests UI, pas des tests backend.
- `fulfillment.spec.ts` : vrai parcours HTTP/UI sur la base locale de relance isolée,
  création de deux expéditions distinctes depuis une commande et navigation réciproque.
  Les données de test ont des codes uniques ; les dossiers de workflow restent dans cette base.
- Build SPA de production réussi ; 31 tests unitaires web passent.
- Passe consolidée : **86 tests UI passent** (environ 1 min, 2 workers), dont les 9 nouveaux
  scénarios, le parcours fulfillment réel et les tests du socle et du lot précédent.
  Une assertion de largeur du lot précédent tolère désormais 0,01 px d’arrondi pendant
  l’animation Chromium ; le contrôle du débordement du document reste séparé.
- Captures inspectées : fiche commande sur bureau, préparation sur tablette et ajout
  de ligne sur téléphone. Aucun courriel, SMS, lien chauffeur ou offre transporteur envoyé.

## Limites et suite

- Ce lot couvre quatre fiches, pas les 138 pages. Les fiches de facturation et de
  paiement sont le prochain morceau de la chaîne ; il n’existe pas de lookup simple
  commande → facture dans le contrat actuel. Aucun lien de facture inventé ici.
- La navigation de sections reste fixe, pas l’en-tête complet du dossier. Les fiches
  ne deviennent pas des espaces multi-onglets ; pas de persistance universelle des brouillons.
- La protection de fermeture concerne les panneaux décrits ; une navigation/recharge
  du navigateur peut perdre une saisie. Prévoir une stratégie commune avant généralisation.
- Une rupture réseau après un POST peut laisser un résultat incertain : le retrait des
  lignes confirmées ne remplace pas une clé d’idempotence serveur. Inspecter les expéditions
  avant de relancer une requête ambiguë ; aucune transaction backend nouvelle dans ce lot.
- Les sous-panneaux de chargement gardent leurs traitements existants et certains libellés
  anglais. Les sélecteurs de ressources restent limités aux 100 premières entrées ; prévoir
  une recherche serveur dédiée et approfondir leurs éditeurs dans un lot ultérieur.
- Aucun changement d’API, migration, permission serveur, cap d’agent, automatisation ou
  runtime IA. Aucun déploiement OVH ni push GitHub dans ce lot.

```sh
pnpm --filter @pulsar/web typecheck
pnpm --filter @pulsar/web build
pnpm --filter @pulsar/web test
pnpm --filter @pulsar/web test:e2e record-screens.spec.ts fulfillment.spec.ts screen-redesign.spec.ts screen-surfaces.spec.ts workspace.spec.ts crm-pipelines.spec.ts crm-sequences.spec.ts journeys.spec.ts responsive.spec.ts loads-list.spec.ts control-center.spec.ts --workers=2 --reporter=line
```
