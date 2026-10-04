# Distribution — colis physiques et livraisons indépendantes

Premier incrément D1, 2 octobre 2026, branche `codex/delivery-route-fuel`.
Complète le [poste tournées/carburant](delivery-route-fuel.md), sans remplacer
Transport ni activer Entrepôt. Validation locale seulement; aucun déploiement.
Suite livrée : [D2a — manifestes et étiquettes](distribution-manifests.md).

## Vision et ordre approuvés

1. **D1 — Identités et contenu des colis** : déclaration, chargement physique,
   journal, suivi de livraison indépendant et protection de la clôture. Présent
   dans ce lot. L’allocation de commande commerciale reste à construire; les
   manifestes figés et étiquettes sont désormais ajoutés par D2a.
2. **D2 — Documents, terrain et destinataire** : D2a capture des manifestes,
   remanifestes et étiquettes. Suite D2b : scans dans le parcours chauffeur existant,
   reprise hors ligne, suivi public limité aux colis autorisés, notifications
   consenties. Réserves, refus, retours et corrections append-only à construire.
3. **D3 — Routage qualifié** : connexions configurables dans l'application,
   contraintes véhicule, optimisation multi-camions et comparaison prévu/réalisé.
4. **D4 — Fournisseurs** : un transporteur externe et un fournisseur télématique
   choisis selon le pilote. Comptes propres à chaque entreprise, identifiants
   externes, signature/dédoublonnage des observations et rapprochement après panne.
5. **D5 — Coûts et assistance** : rapprochement des coûts, exceptions et propositions
   IA gouvernées. Les calculs restent déterministes; GPS et IA ne livrent rien seuls.

La recherche fournisseur précédente propose HERE/TomTom pour qualification routière,
EasyPost ou connecteur direct pour transporteurs, ISAAC/Samsara/Geotab selon matériel.
Aucun de ces connecteurs n'est livré ni commercialement qualifié dans D1.

## Utilisation de D1

1. Ouvrir Transport → Chargements → un dossier → **Colis et contenu**.
2. Avant engagement (chargement Ouvert/Planifié), ajouter les colis par expédition.
   Chaque colis reçoit un code `PKG-...` unique dans l'entreprise. Décrire chaque
   ligne : référence, description, quantité positive exacte et unité explicite.
   Plusieurs références/unités peuvent cohabiter; aucune somme trompeuse entre unités.
3. Corriger un colis préparé, ou l'annuler avant engagement. Le code reste réservé
   et chaque révision est conservée. Le premier colis active définitivement le
   suivi physique de l'expédition; tout annuler ne rétablit pas une clôture globale.
4. Sélectionner le colis par son code (saisie ou douchette en mode clavier), puis
   confirmer son **chargement réel**. Le scan seul sélectionne, il ne modifie rien.
   Le camion doit être Planifié, Soumissionné, Dispatché ou En transit. Après départ,
   une tournée gérée exige l'arrivée à son arrêt de ramassage.
5. Un retrait physique avant transit remet le colis Préparé. Il conserve la trace
   de l'ancien chargement. Décharger avant de changer véhicule/remorque ou de retirer
   l'expédition. Le parcours retour après transit est un lot futur, pas cette action.
6. En transit, confirmer chaque colis réellement remis et le nom du destinataire.
   Sur une tournée gérée, déclarer d'abord l'arrivée à l'arrêt de livraison. Si le
   tenant exige un POD, le capturer avec l'action existante avant le dernier colis.
7. Une expédition est livrée lorsque tous ses colis non annulés sont livrés. Le
   chargement reste en transit pour ses autres destinations. Sa clôture contrôle
   les arrêts, les expéditions suivies et les POD, sans réécrire les heures antérieures.

Exemple : deux colis de 40 supports et un colis de 20 supports. Livrer les deux
premiers laisse l'expédition en transit, avec 2/3 colis livrés; les 20 supports du
troisième ne sont pas supposés reçus. Il faut déclarer tous les colis attendus
avant engagement : ce lot ne prouve pas que la déclaration couvre toute la commande.

## Sources de vérité et autonomie des modules

| Élément              | Rôle et limite                                                       |
| -------------------- | -------------------------------------------------------------------- |
| Shipment             | Destination, affectation et statut de l'expédition                   |
| DeliveryPackage      | Identité physique interne, contenu déclaré et état courant           |
| DeliveryPackageEvent | Révisions append-only, code/quantités/état et contexte capturés      |
| Load/Route/Stop      | Camion, tournée et événements d'arrêt; distincts du contenu          |
| POD                  | Document existant par expédition; pas créé par le scan ni par le GPS |
| WMS                  | Stock et préparation, uniquement via ses writers; aucun effet de D1  |
| Connecteurs          | Futurs événements externes; aucun appel transporteur/capteur en D1   |

Le contenu n'est pas une FK de stock, une réservation, une nomenclature ou un
calcul de poids/capacité. Une référence déclarée n'est pas rapprochée par nom/SKU
avec le catalogue. Des liens source explicites et permissionnés viendront ensuite.
`PKG-...` n'est ni un SSCC GS1 certifié, ni un numéro UPS, ni un jeton public.
Les étiquettes Code 128 sont ajoutées par D2a, sans intégration native DataWedge.

## Contrat technique et sécurité

- Tables distinctes tenant-scopées, FK composites tenant/expédition/chargement.
  Aucun nouveau module requis ni endpoint public/outil IA ajouté.
- États Shared : PREPARED→LOADED/CANCELLED; LOADED→PREPARED/DELIVERED.
  DELIVERED/CANCELLED terminaux. Annulation ne supprime pas de ligne.
- Mutations sous verrou d'opération puis chargement puis expédition, appartenance
  relue sous verrou. Les affectations/dispatch/clôtures utilisent la même ligne Load.
  Création exige la version de Shipment; édition/transition celle du colis.
  Une transition capture aussi l'ID et la version du chargement : une ancienne
  confirmation ne peut pas agir après réaffectation ou remplacement du camion.
  Toutes les mutations avancent les versions des parents pour invalider les anciens aperçus.
- Création du numéro, données, révision et audit dans la même transaction.
  UUID canonique minuscule, clé unique par tenant, empreinte liée acteur/corps/cible.
  Le rejeu rend le reçu d'origine, jamais une nouvelle exécution ni restauration d'état.
- L'interface conserve l'intention en sessionStorage par tenant/utilisateur/chargement
  avant envoi. Après réponse incertaine, inspecter puis reprendre la même demande; pas de retry
  automatique ni changement de clé aveugle. Ce mécanisme n'est pas une file hors ligne
  de chauffeur; fermeture de session navigateur peut perdre cette intention locale.
- Quantités décimales en chaînes : jusqu'à 12 chiffres entiers et 3 décimales,
  positives, sans conversion implicite. Contenu fermé de 1 à 50 lignes, référence80,
  description200, unité20, libellé120. Au plus200 colis historiques par expédition.
  Poste limité explicitement à200 expéditions et2000 colis; aucune troncature silencieuse.
- Chargement capturé avec véhicule/remorque/chauffeur à cet instant. Les changements
  de véhicule/remorque sont bloqués tant que des colis sont engagés. Les observations
  ne sont pas reconstruites depuis les affectations futures.
- Horodatages serveur UTC, affichage via le format/fuseau utilisateur existant.
  Ramassage confirmé seulement lorsque tous les colis actifs sont chargés/livrés;
  retrait avant transit efface le champ courant, jamais l'événement historique.
- Aucun total financier, recalcul de coût ou mouvement WMS. Les snapshots tarifaires
  COMPLETED restent figés. Le workflow parent de commande existant est réutilisé
  après livraison complète, sans notification supplémentaire propre à D1.

### API

Base `/api/v1/transportation/delivery-packages`, Transport activé :

- `GET ?loadId=...` : poste courant, `transportation.planning.read`.
- `GET /:id/events` : 50 derniers événements internes, même droit.
- `POST /shipment/:id` : operationKey, expectedUpdatedAt, label, contents;
  `transportation.planning.manage`.
- `PATCH /:id` : operationKey, expectedVersion, label, contents; même droit.
- `POST /:id/transition` : operationKey, expectedVersion, expectedLoadId,
  expectedLoadUpdatedAt, target, recipientName,
  notes; `transportation.execution.manage`, plus planning.manage pour annuler.

## Compatibilité, recette et déploiement

Migration additive `20261002130000_delivery_packages` : deux tables, un marqueur
nullable et des index/FK/contraintes. Aucun colis ni marqueur inventé dans l'historique.
Appliquer après la migration de tournée, avant l'image API/Web. Ne pas supprimer
ces tables pour revenir à une ancienne image : les anciennes clôtures ne connaissent
pas le suivi colis. Après utilisation, rollback applicatif exige une version gardant
les gates colis, ou mise en lecture seule des dossiers concernés.

Les anciens dossiers jamais suivis conservent leur confirmation globale à la clôture.
Les expéditions déjà livrées ne changent plus d'heure lors de la clôture du camion.
Le portail/chauffeur public existant n'expose pas encore les colis; ses contrôles de
module/projection doivent être harmonisés avant l'extension D2. Retours, pertes,
refus partiels internes au colis et corrections après livraison restent à construire.

Recette : Shared (décimaux/états), unités API (droits/concurrence/rejeu/gates),
PostgreSQL jetable (migrations, contraintes, scénario partiel, POD/rollback,
isolation), Chromium simulé (saisie, scanner, reprise incertaine, lecture/mobile).
Résultats réellement exécutés dans `docs/etat-du-projet.md`. Aucune recette matériel
Zebra, camion GPS, client final, transporteur externe ou VPS n'est impliquée.
