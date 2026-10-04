# Distribution D2a — manifestes versionnés et étiquettes

2 octobre 2026, branche `codex/delivery-route-fuel`. Complète les
[colis D1](distribution-packages.md) et le [poste tournées](delivery-route-fuel.md).
Livraison locale; aucun déploiement ni connexion transporteur activée.

## Ce que l’opérateur peut faire

Dans Transport → Chargements → un dossier → **Manifestes et étiquettes** :

1. Préparer les expéditions, leur tournée et leurs colis dans les panneaux existants.
2. Ouvrir **Préparer un manifeste**. Relire les adresses, l’ordre des arrêts,
   les ressources affectées, les états et les contenus exacts de chaque colis.
   L’aperçu ne crée rien. Les expéditions sans suivi colis restent identifiées.
3. Indiquer un motif puis confirmer l’édition. Pulsar attribue un numéro MF et
   une révision du chargement; le contenu devient une copie historique immuable.
4. Préparer/télécharger le **PDF manifeste** ou les **PDF étiquettes**. Une étiquette
   4 × 6 pouces par colis non annulé, avec code PKG, expédition, chargement,
   édition et destination capturée. Les descriptions du contenu et le motif
   interne ne sont pas imprimés sur l’extérieur du colis.
5. Après un changement réel du dossier, ouvrir **Nouvelle édition**, relire et
   justifier le remanifeste. Les anciennes éditions restent consultables. Un contenu
   inchangé ne produit pas une nouvelle révision : utiliser la réimpression.
6. En cas de réponse incertaine, vérifier les archives ou reprendre exactement
   la demande conservée. Pour un échec PDF, reprendre la préparation de **la même
   édition**, jamais créer un autre manifeste pour réessayer le téléchargement.

Le PDF est une copie des **déclarations à cet instant**, pas une certification
que tous les colis sont présents. Il n’est ni un BOL réglementaire, ni un document
douanier, ni un POD. Un état « chargé » imprimé reste l’état capturé à l’émission,
pas une observation temps réel. Une ancienne étiquette ne change jamais de code;
son adresse peut être périmée : remplacer les étiquettes quand l’édition change.

## Relations entre modules et registres

| Source                             | Ce qui est capturé ou réutilisé                               | Ce que l’édition ne fait pas                              |
| ---------------------------------- | ------------------------------------------------------------- | --------------------------------------------------------- |
| Transport / Load                   | Numéro, état, camion, remorque, chauffeur, transporteur       | Ni dispatch, ni changement d’affectation                  |
| Route / Stop                       | Ordre, type et adresse opérationnelle des arrêts              | Ni calcul d’itinéraire, ni arrivée/départ                 |
| Shipment                           | Origine, destination, numéro, état, activation du suivi colis | Ni création d’expédition, ni livraison implicite          |
| DeliveryPackage                    | Code, état/version, contenu exact, heures confirmées          | Ni nouveau colis, ni transition physique                  |
| Documents core                     | Stockage privé des PDF, empreinte et téléchargement contrôlé  | Pas d’accès par le centre générique des documents         |
| WMS / Catalogue / Fabrication      | Aucun module supplémentaire nécessaire                        | Aucun stock, allocation de commande ou conversion d’unité |
| Facturation / Agents / Connecteurs | Aucun effet dans D2a                                          | Aucun coût, facture, outil IA, SMS ou appel transporteur  |

## Contrat de données

`DeliveryManifest` est une table distincte tenant-scopée. Chaque édition contient
`snapshot`, `sourceHash`, `snapshotHash`, `reason`, numéro MF, révision, date UTC,
acteur et reçu d’opération. Les contraintes uniques portent sur tenant/numéro,
tenant/chargement/révision et tenant/clé UUIDv4. FK composites pour chargement,
acteur et documents. Aucun backfill depuis les dossiers historiques.

- `sourceHash` couvre tout le JSON métier affiché, pas seulement Load.updatedAt.
  Une adresse, un chauffeur ou un colis modifié invalide l’aperçu même quand le
  writer historique n’avance pas Load.updatedAt. Les objets JSON sont canonisés
  par clé, les listes gardent leur ordre : PostgreSQL JSONB ne change pas le hash.
- `snapshotHash` couvre aussi numéro, révision, date d’émission et motif.
  Lecture et rendu vérifient l’intégrité avant utilisation. Ni lecture des
  coordonnées actuelles ni reconstruction d’un ancien snapshot au téléchargement.
- Aperçu cohérent RepeatableRead. Émission sous verrou d’opération puis Load;
  relecture tenant-scopée et comparaison hash/version avant numérotation.
  Snapshot, numéro, révision et audit sont atomiques. Aucun `Load.updatedAt`
  artificiel pour une opération purement documentaire.
- La clé est canonisée en minuscules et liée tenant/acteur/corps/chargement.
  Rejeu avant validation des versions courantes; une clé réutilisée pour un autre
  corps ou acteur est refusée. Conflit SQL concurrent → 409 explicite, sans
  réexécution automatique. Inspecter puis reprendre la même demande.
- Le trigger SQL empêche de modifier les données déjà émises et de remplacer
  un PDF déjà lié. Les deux références/hashes de fichiers peuvent uniquement
  passer de NULL à leur première valeur, indépendamment l’une de l’autre.

Un chargement COMPLETED/CANCELLED ne peut plus émettre une première édition ni
un remanifeste : seules ses copies déjà capturées sont consultables/réimprimables.
Au moins une expédition; une expédition ayant activé D1 exige un colis actif.
Une expédition legacy sans suivi peut figurer comme telle, sans colis inventé.

## Fichiers et sécurité

L’édition et la préparation PDF sont séparées. La génération utilise exclusivement
le snapshot, sous verrou de fichier distinct du verrou opérationnel Load.
`DocumentsService.upload` enregistre Document dans la transaction métier fournie;
Document, référence canonique/hash et audit sont donc atomiques sans deuxième
connexion Prisma. Les autres appelants conservent le fonctionnement historique.
L’écriture du binaire dans le stockage n’est pas transactionnelle : une panne
après upload mais avant commit peut laisser un objet non référencé, inaccessible
aux routes documentaires. Sa récupération est un sujet d’exploitation, pas une
suppression automatique d’une preuve métier.

La préparation est idempotente par édition/type. Un fichier présent n’est pas
remplacé. La vérification de ses octets se fait après libération de la transaction,
y compris avant d’annoncer « prêt »; un pool PostgreSQL d’une connexion reste viable.
Le téléchargement vérifie le tenant, le chargement, l’édition, le type protégé,
l’entityId, le MIME, la taille et le SHA-256 du binaire. Réponse privée/no-store.

`delivery-manifest-pdf` et `delivery-labels-pdf` sont exclus de tous les chemins
génériques : upload, lecture, URL présignée, confirmation, suppression et centre
documentaire. Les PDF restent conservés, y compris avec le contexte privilégié.
Les documents ne sont pas publiés par un jeton chauffeur ou destinataire dans D2a.
Il n’existe aucun nouvel outil agent ni droit qui contourne la validation humaine.

## API

Base `/api/v1/transportation/loads/:loadId/manifests`, Transport activé :

- `GET /preview` : snapshot courant, hash, blockers et canIssue.
- `GET /` : historique paginé; `GET /:id` : édition figée.
- `POST /` : `operationKey`, `expectedLoadUpdatedAt`, `sourceHash`, `reason`.
- `POST /:id/files/manifest|labels` : préparer/vérifier le fichier, `{ ready: true }`.
- `GET /:id/files/manifest|labels` : lecture du PDF déjà prêt, aucun rendu implicite.

Lecture : `transportation.planning.read`. Émission/préparation : lecture **et**
`transportation.planning.manage`. Les lecteurs limités téléchargent les fichiers
déjà préparés. Aucun tenantId ou snapshot métier fourni par le client n’est accepté.

## Impression et limites explicites

- Manifeste Lettre multipage; étiquettes **4 × 6 pouces**, une par colis non annulé.
  Imprimer à taille réelle. Police embarquée standard PDF : caractères latins
  Windows-1252 dont le français; emoji/CJK et autres caractères non représentables
  sont refusés avant émission. Pas de remplacement silencieux de caractères.
- Code 128 B vectoriel, checksum, zones calmes de 10 modules. Le contenu du code
  est exactement le code PKG, sans URL, identifiant tenant ni accès public.
  Ce n’est pas un SSCC/GS1-128 ni une étiquette UPS. Les douchettes doivent être
  configurées pour Code 128 et la saisie clavier; qualifier Enter et la disposition
  clavier sur le matériel réel avant usage. Aucun SDK Zebra natif ajouté.
- Adresse complète sans troncature; si elle ne tient pas à 9 points sur 4 × 6,
  l’édition est refusée explicitement. Code trop long pour 10 mil également refusé.
- Bornes : 200 expéditions, 2 000 colis, 500 arrêts, 5 000 lignes de contenu,
  snapshot métier 5 Mio, PDF 10 Mio. Pas de total entre références/unités différentes.
  Aucun contenu au-delà des bornes n’est supprimé implicitement.
- Reprise UI en sessionStorage par tenant/utilisateur/chargement. Ce n’est pas
  une file chauffeur hors ligne; fermer définitivement la session peut perdre
  une intention non confirmée. L’historique serveur reste la référence.

## Migration, recette et suite

Migration additive `20261002160000_delivery_manifests`, après les deux migrations
de tournée/colis. Préserver la table, les PDF et le trigger lors d’un rollback.
Une ancienne image ignorera cette surface; ne pas détruire ses preuves pour revenir
en arrière. Les règles de rollback D1 (clôtures colis) restent obligatoires.

La recette couvre les unités de rendu/hash/rejeu, PostgreSQL réel jetable (droits,
tenant, concurrence, trigger, panne stockage, fichier corrompu), navigateur simulé
et inspection des PDF rasterisés. Les preuves locales ne remplacent pas le pilote
sur imprimante/lecteur ni le déploiement VPS. Résultats dans
[État du projet](../etat-du-projet.md).

[D2b](distribution-driver.md) ajoute le parcours chauffeur avec scans dans sa
mission autorisée, incidents motivés et reprise exacte; les anciennes routes
publiques chauffeur sont harmonisées. Le suivi destinataire limité à ses colis
et la vraie synchronisation hors ligne restent à développer.
L’allocation WMS/commande, import détaillé de cargaison, refus/retours, notifications
consenties et intégrations transporteurs restent des incréments séparés.
