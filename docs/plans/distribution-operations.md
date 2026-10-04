# Exploitation livraison — poste de lecture

`/delivery-operations` rassemble les chargements, leur suivi physique déclaré,
leurs incidents et un lien vers la prochaine vérification utile. Transport activé
et `transportation.planning.read` sont requis. CRM, WMS, Finance et IA ne sont pas
des dépendances de cette lecture. Aucun envoi, transition, coût ou stock ne change.

## Vues et interprétation

- **Tous les chargements** inclut actifs et historiques.
- **Contenu à vérifier** sélectionne OPEN/PLANNED avec au moins une expédition
  non annulée sans colis actif. Le suivi colis reste facultatif : ce n’est ni un
  blocage systématique, ni un état de préparation WMS.
- **Colis à charger** sélectionne les tournées PLANNED/TENDERED/DISPATCHED/IN_TRANSIT
  contenant un colis PREPARED. Un ramassage pendant une tournée reste possible.
- **En livraison** signifie le statut du chargement IN_TRANSIT, pas une heure
  d’arrivée garantie ou une remise confirmée.
- **Incidents ouverts** signifie précisément une DeliveryException OPEN, pas un
  diagnostic exhaustif de tous les blocages techniques ou métier.
- **Nouvelles tentatives** signifie RETRY_PLANNED.
- **Retours** réunit RETURN_AUTHORIZED et RETURN_RECEIVED, y compris pour un
  chargement clôturé. Autorisé et reçu restent deux compteurs distincts.

Les compteurs sont des nombres de dossiers/colis, jamais une somme d’articles de
références ou unités différentes. Un retour reçu atteste la garde physique;
il ne crée ni entrée WMS, ni avoir, ni remboursement. L’historique n’est pas effacé.

La prochaine action est un conseil déterministe en lecture : incidents ouverts,
réception de retour, tentative, retours reçus, historique fermé, contenu manquant,
chargement des colis, remises en transit, puis vérification générale de la tournée.
Le lien ouvre le dossier; ses writers revérifient les permissions, versions et états.
Le conseil ne constitue ni un ordre automatique ni une autorisation d’agent.

Avec `core.agents.chat`, **Analyser avec un agent** ouvre uniquement un brouillon
dans l’espace IA, scoped à l’utilisateur et au tenant. L’utilisateur choisit son
worker puis envoie volontairement. Le brouillon demande les outils de lecture
`list_delivery_operations` et `get_delivery_context`; une éventuelle nouvelle
tentative passe séparément par `plan_delivery_retry` gouverné, après demande
explicite. Ce bouton ne contacte aucun fournisseur et n’accorde aucune permission.

## Lecture et pagination

GET `/api/v1/transportation/delivery-operations` accepte page (≥1), pageSize (1..100),
filter (all/to_prepare/to_load/in_delivery/blocked/retry/returns) et search (numéro,
120 caractères maximum). Les filtres sont appliqués dans PostgreSQL AVANT le
count et la pagination. Le total décrit le périmètre filtré complet, jamais les
100 premières lignes. Les agrégats de colis, incidents et expéditions sans colis
ne lisent que les IDs de la page retournée, avec tenantId sur chaque jointure.

Une transaction RepeatableRead garde un instantané cohérent entre le total, la
page et les compteurs. `observedAt` horodate cette lecture; l’UI l’affiche dans le
fuseau utilisateur. Le poste se rafraîchit explicitement ou à changement de filtre;
il ne prétend pas constituer un flux temps réel. Aucun store de rollup ni migration.

## Vérification

Tests Shared sur les priorités et l’absence de mutation; unités API sur chaque
filtre, isolation de requêtes, pagination hors plage, vrais totaux et retours;
Chromium simulé sur filtres, recherche, pagination, lecture limitée et affichage
mobile. Les tests de contrat ne qualifient ni GPS, ni télématique, ni fournisseur.
