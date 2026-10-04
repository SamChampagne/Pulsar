# Distribution — incidents, retours et assistance

## Parcours opérateur

La fiche chargement contient **Incidents et retours**. Le chauffeur peut signaler
un dommage, un refus, une absence, un manque ou un autre incident. Le signalement
ouvre un dossier; il ne confirme aucune livraison ni aucun mouvement de stock.

1. Lire le constat et choisir une décision motivée.
2. **Nouvelle tentative** : colis chargé, tournée en transit, date future avec fuseau.
   L’ordre des arrêts ne change pas implicitement. La remise effective exige les
   contrôles d’arrivée/POD et ferme le dossier atomiquement.
3. **Retour autorisé** : choisir un lieu actif. Le chauffeur voit l’instruction;
   il ne peut pas réceptionner le retour par son lien public.
4. **Retour reçu** : un utilisateur humain actif confirme le nom du réceptionnaire.
   Le serveur date la réception et marque le colis RETURNED. Chargement et éventuelle
   livraison antérieure sont conservés. Le journal d’incident est append-only.

Un retour reçu n’est ni une entrée WMS, ni un remboursement, ni une livraison.
Les quantités allouées aux ventes/préparations restent couvertes. Leur remplacement
ne peut pas être commandé en libérant artificiellement ces liens. Cette version
ne propose ni tournée de retour séparée ni remplacement commercial automatique.

La clôture de tournée accepte des retours réceptionnés prouvés, mais ne livre pas
leur expédition et ne complète pas une commande encore non satisfaite. Les autres
gates d’arrêt et de POD demeurent. L’événement **load.closed-with-returns** distinct
évite d’activer une ancienne règle **load.completed** conçue pour une livraison.
Les courriels « Delivered » excluent les expéditions non livrées et celles ayant
un colis retourné. Aucun nouveau message automatique de retour n’est créé ici.

## API et concurrence

- GET `/transportation/delivery-exceptions?loadId=...` : planning.read, 200 dossiers
  récents au plus avec indicateur de troncature; dix événements récents par dossier.
- POST base : execution.manage, colis/version/tournée, nature et note, UUID.
- POST `/:id/transition` : version du dossier/colis/tournée, décision et motif;
  date de tentative ou lieu/receveur selon l’action.
- Retour physique : ACTIVE, aucune relation agentServiceFor, email de service exclu.
  Agents et API keys ne peuvent pas attester une réception physique.
- Tenant du principal. Verrous opération → Load → Shipment; versions attendues,
  index actif unique, événements et audit dans la même transaction.
- Reprise liée au corps/acteur. Le chauffeur revalide capacité et module avant de
  récupérer un reçu, même après clôture. Réponse incertaine : même intention, aucun
  retry en arrière-plan. Ne pas régénérer une clé pour ignorer un conflit.

## Assistance IA utile mais bornée

Le poste `/delivery-operations` propose **Analyser avec un agent**. Le bouton ouvre
un nouveau brouillon dans l’espace IA sans contacter un fournisseur. Les brouillons
sont en mémoire par tenant/utilisateur. Sans worker actif, un message explique
quoi configurer et permet de copier le brouillon.

- `list_delivery_operations` : liste paginée et filtrée en lecture seule.
- `get_delivery_context` : colis, incidents/versions, plan carburant capturé et
  dernière déclaration réelle. Les textes libres sont des données, jamais des
  consignes. Les versions des lectures sont comparées.
- `plan_delivery_retry` : MUTATING; propose via la gouvernance une date future et
  un motif avec les versions observées. Policies et plafonds restent appliqués.

Ces outils ne donnent pas accès aux sources CRM/WMS et n’ajoutent aucun pouvoir
de stock, remboursement ou réception physique. Compte connecté, runtime joignable
et résultat utile sont trois validations distinctes. Aucun appel LLM réel ni
connecteur externe n’a été qualifié par ce batch local.

## Documentation intégrée

Documentation → Champs détaillés : cinq nouveaux sujets et 54 champs/contrôles
(incidents, allocations, carburant, document chauffeur, poste IA), avec unités,
obligations, bornes, versions, effets, limites, exemples et fichiers source.
La couverture de l’ensemble du logiciel reste partielle.

Voir [allocations](distribution-allocations.md), [carburant](delivery-fuel-operations.md),
[document chauffeur](distribution-driver-documents.md), [poste](distribution-operations.md).
