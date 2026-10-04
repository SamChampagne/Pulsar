# Transport — tournées, livraisons et carburant

Premier palier livré localement le 1er octobre 2026, branche
`codex/delivery-route-fuel`. Ce poste prépare **un chargement à la fois** : il
ne répartit pas encore automatiquement des composants entre plusieurs camions.

## Utilisation

1. Dans Transport → Chargements, affecter les expéditions et les ressources.
2. Ouvrir **Tournée et carburant → Préparer la tournée**. Chaque expédition
   apporte son ramassage, sa livraison et ses fenêtres horaires existantes.
3. Saisir le début au premier arrêt, les minutes de manutention, la consommation
   chargé/à vide en L/100 km et le prix par litre avec sa devise. Les valeurs de
   consommation et de prix restent vides tant que l'opérateur ne les renseigne pas.
4. Ajuster les fenêtres et le service par arrêt, déclarer éventuellement les minutes
   de ralenti et sa consommation en L/h. L'attente n'est pas assimilée au ralenti.
   Cocher le retour au premier arrêt si le camion doit y revenir.
5. **Calculer cet ordre** conserve l'ordre saisi; **Proposer un meilleur ordre**
   compare les destinations. Examiner les segments, la carte, le budget et les
   heures de chaque arrêt. Les flèches permettent de modifier l'ordre manuellement.
6. Confirmer et enregistrer. Toute édition invalide l'aperçu et impose un nouveau
   calcul. La sauvegarde recalcule les métriques réseau : ce n'est pas un devis
   routier verrouillé ni un engagement sur l'heure d'arrivée.
7. Dispatcher par l'action existante, puis utiliser **Arrivée / Départ** dans
   Exécution des livraisons. La preuve de livraison reste un acte séparé.

Les horaires saisis utilisent le fuseau du navigateur, nommé à côté du formulaire;
les résultats affichent le fuseau choisi par l'utilisateur et son décalage UTC.
Le premier instant désigne l'arrivée au premier arrêt, pas la sortie d'un dépôt
implicite. Le trajet d'approche avant ce point n'est donc pas compté.

## Calcul et limites

- Distance et conduite par segment depuis `RoutingService`, appels OSRM bornés
  à 3 secondes chacun. La matrice est dirigée : A→B peut différer de B→A.
- Recherche locale bornée à trois passes, premier arrêt fixe, chaque ramassage
  avant sa livraison. Objectif : réduire les minutes de retard, puis les kilomètres.
  Aucun optimum global, coût minimal ou respect de toutes les contraintes garanti.
- Comparaison limitée à 50 arrêts; ordre saisi limité à 100. Une matrice
  indisponible conserve l'ordre et affiche un avertissement. Un trajet inaccessible
  n'est jamais supprimé pour obtenir un meilleur résultat.
- ETA = début + conduite + attente jusqu'à la fenêtre + manutention. Un départ
  planifié existant agit comme borne minimale. Pas de trafic temps réel, horaires
  légaux de conduite, rendez-vous de quai ni calendrier de fermeture intégrés.
- Charge estimée à partir des expéditions ramassées et non encore livrées :
  consommation « chargé » dès qu'il en reste une, sinon « à vide ». Pas de modèle
  dynamique selon le poids, la pente, la météo ou le type de remorque.
- Litres = somme(km × L/100 km / 100) + minutes de ralenti × L/h / 60.
  Coût = litres × prix par litre dans la devise saisie. Aucun taux de change implicite.
- Coordonnées manquantes : segment inconnu et total incomplet **non calculé**.
  Routage indisponible : distance à vol d'oiseau explicitement signalée, conduite
  et ETA en aval inconnues. Ce carburant peut être sous-estimé.
- Les arrêts historiques non liés à une expédition restent compatibles, mais leur
  charge et leur carburant ne sont pas déduits. Pas de prix ni consommation inventés.
- Les fournisseurs routiers existants ne sont pas qualifiés poids lourds. Un profil
  OSRM dépend des données préparées sur le serveur : l'URL `driving` ne garantit
  ni gabarit camion ni restrictions de poids/hauteur. Vérification humaine nécessaire.

Référence technique : [OSRM HTTP API — Route et Table](https://project-osrm.org/docs/v5.24.0/api/).
Les tests de ce lot utilisent des réponses synthétiques; aucun fournisseur public
n'a été sollicité pour simuler des distances réelles.

## Liens métier et invariants

| Donnée                | Rôle                                                                    |
| --------------------- | ----------------------------------------------------------------------- |
| Expédition            | Ramassage/livraison, lieux et fenêtres; composition du chargement       |
| Route.deliveryPlan    | Hypothèses, segments, ETA, carburant et avertissements capturés         |
| Route.totalDistanceKm | Distance de tarification existante, indépendante de la géométrie        |
| Tables de carburant   | Surcharge contractuelle du tarif, jamais litres consommés               |
| Stop + TrackingEvent  | Arrivée/départ réels et trace d'exécution                               |
| POD                   | Preuve distincte par expédition, selon la politique existante du tenant |

Une distance `MANUAL` existante n'est jamais remplacée par le routage. Le carburant
utilise les segments, pas une proratisation de ce total manuel. Sans valeur manuelle,
le retour optionnel fait partie de la distance calculée et peut donc affecter un
tarif au kilomètre avant clôture. Le budget carburant n'est ni une dépense réelle,
ni une écriture Finance, ni un supplément ajouté automatiquement à la facture.
`Load.costDetail`/`estimatedCost` restent figés après COMPLETED; la géométrie reste
uniquement destinée à l'affichage.

Prévisualisation en lecture seule, sans dispatch/envoi/POD/stock. Sauvegarde avant
dispatch (OPEN/PLANNED), version attendue pour les plans gérés, contrôle de couverture
de toutes les expéditions et lieux exacts. Sous transaction : verrou conditionnel
du chargement, nouvelle vérification de composition/version, remplacement atomique
des arrêts PENDING et audit. Affectation/retrait d'expédition avancent la version
du chargement. Une ancienne prévision ne peut pas écraser une édition concurrente.

Transitions d'arrêt via `canTransitionStop`, sous verrou du chargement :
PENDING→ARRIVED/SKIPPED; ARRIVED→DEPARTED/COMPLETED; DEPARTED→COMPLETED.
Les états terminaux ne se rouvrent pas. Une arrivée exige les arrêts précédents
terminés; une livraison exige son ramassage terminé. Rejouer le même statut actif
ne duplique ni horodatage, ni événement, ni audit. L'arrêt ne livre pas implicitement
l'expédition et ne crée pas de POD. Pour un nouveau plan géré, compléter le chargement
exige tous les arrêts DEPARTED/COMPLETED : un SKIPPED ne prouve pas une livraison.
La reprise d'un arrêt ignoré nécessite un prochain workflow d'exception; ne pas
l'utiliser pour une simple erreur de saisie ou un report.

Les endpoints sont tenant-scopés et gated Transport : `planning.read` pour lire,
`planning.manage` pour préparer/confirmer, `execution.manage` pour les arrêts.
Le lien chauffeur conserve son contrôle d'accès et ne renvoie que le statut et les
horodatages de l'arrêt modifié. Le suivi public client n'expose pas les autres arrêts,
la matrice ni le budget carburant. Aucun nouvel outil IA n'est exposé.

## Compatibilité et déploiement

Migration additive `20261001170000_delivery_route_plan` : colonne JSONB nullable
sur `routes`, sans réécriture historique. Appliquer les migrations avant les images
API/Web. Les anciens appels de création sans `planning` restent sans snapshot et
conservent leur règle historique de clôture. Un plan géré existant reste géré lors
de ses éditions; sa version et sa couverture ne deviennent pas facultatives.

Après une réponse de sauvegarde incertaine, relire le chargement et sa tournée;
ne pas renvoyer aveuglément avec une nouvelle version. L'interface signale l'erreur
et invalide l'aperçu. Les données d'itinéraire restent des prévisions tant qu'aucun
événement réel n'est enregistré. Aucun déploiement, secret ou `.env` modifié par ce lot.

## Recette

- Tests Shared : unités, chargé/vide, ralenti/attente, fenêtres, données inconnues,
  aller-retour, ordre dirigé, précédence et transitions.
- Tests API unitaires : propriété tenant, versions, couverture, distance manuelle,
  fallback routier, audit transactionnel et replay de statut.
- Parcours HTTP sur PostgreSQL jetable : migrations + seed, préparation sans effet,
  sauvegarde, isolation entre entreprises, concurrence, dispatch, séquence réelle,
  refus de clôture anticipée et conservation du snapshot après clôture.
- Chromium simulé : calcul avant sauvegarde, invalidation après édition, conflit,
  rôle lecteur et viewport mobile. Tuiles réseau désactivées; ce n'est pas une
  qualification du service cartographique de production.

Les résultats exécutés sont consignés dans `docs/etat-du-projet.md`. La recette
de production reste à faire sur une entreprise de test autorisée : coordonnées,
fournisseur routier disponible, camion/réservoir réels, comparaison kilomètres et
litres estimés/réels, droits dispatch/chauffeur et règles POD.

## Suite recommandée

1. Profils de consommation par véhicule, autonomie/réserve et prix datés configurables
   dans l'application; conservation des hypothèses propres à chaque tournée.
2. Plan de transport multi-camions : disponibilité, poids/volume/palettes, durées,
   fenêtres et affectation explicite des composants. Réutiliser les contrôles de
   capacité existants, sans transformer un simple ordre de stops en solveur VRP.
3. Fournisseur routier poids lourds configurable, trafic/contraintes qualifiés;
   comparer plusieurs scénarios avec confirmation et preuve du choix.
4. Livraison partielle, refus/retour, exceptions d'arrêt et POD quantitatif; suivi
   estimé/réel par télématique, sans confondre position et preuve de contenu.
5. Vue globale des tournées et alertes, puis assistance IA explicative sous gouvernance.
   Les calculs de distance/carburant restent déterministes, pas effectués par un LLM.
