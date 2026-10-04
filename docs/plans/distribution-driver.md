# Distribution D2b — mission chauffeur et colis

Livraison locale du 2 octobre 2026, après [D1](distribution-packages.md) et
[D2a](distribution-manifests.md). Même univers Pulsar : les dossiers Transport
restent la référence, sans stock WMS, facturation ni connecteur implicites.

## Utilisation

1. L’exploitation prépare les expéditions, leurs colis et la tournée dans Transport.
   Les étiquettes Code 128 D2a portent uniquement le code PKG. Le lien chauffeur
   du chargement est un accès confidentiel à cette mission : ne pas le publier.
2. Après dispatch, ouvrir le lien sur téléphone. Le poste présente les arrêts et
   les colis regroupés par destination, avec références, quantités et unités.
3. Scanner dans le champ prévu avec une douchette clavier USB/Bluetooth ou Zebra
   Android configuré en saisie clavier. Enter sélectionne le code exact de la
   mission; il ne charge ni ne livre rien. La saisie manuelle reste disponible.
4. Confirmer explicitement le chargement physique. En transit, respecter les
   arrivées de la tournée gérée, puis confirmer chaque remise avec le nom du
   destinataire. Deux colis remis sur trois ne livrent pas toute l’expédition.
5. Capturer le POD si la politique entreprise l’exige avant le dernier colis.
   Signature/photo restent des opérations distinctes de la remise. Aucun scan,
   point GPS ou départ d’arrêt ne constitue un POD.
6. Signaler un dommage, refus, colis manquant ou autre problème avec un commentaire.
   Le journal du colis et le suivi de l’expédition enregistrent le signalement.
   L’exploitation décide ensuite du traitement : ce n’est pas un retour, une
   annulation ou une livraison automatique. Aucun message externe n’est envoyé.

Le partage de position est **désactivé initialement**; le chauffeur l’active
explicitement et peut l’arrêter. Un changement de lien réinitialise ce choix.
Il s’agit du GPS du téléphone, pas d’un capteur embarqué ni d’un historique public.

## Sécurité et contrats

Le jeton résout le tenant côté serveur. Chaque lecture/écriture/replay revérifie
le tenant ACTIVE/TRIAL et Transport activé directement en base. Les mutations
verrouillent le Load puis revalident le jeton et l’affectation, dans la même
transaction que leurs effets; elles sont réservées à DISPATCHED/IN_TRANSIT.
Une modification de chauffeur révoque le lien existant atomiquement avec
l’affectation. Révoquer/régénérer manuellement le lien invalide aussi les refs.

Les références publiques d’expédition, arrêt et colis sont des HMAC-SHA256
séparés par type et liés au jeton, pas des IDs internes. Aucun coût, note interne,
identifiant tenant/utilisateur/véhicule, chemin de stockage ou document brut
n’est renvoyé. Les lieux sont relus dans le tenant; bornes explicites de
200 expéditions, 2 000 colis et 500 arrêts, sans troncature silencieuse.
Les colis ne sont plus exposés dans les missions inactives; le résumé reste lisible.

API `/api/v1/public/driver/:token/packages` :

- `GET /` : résumé, expéditions/ref, présence de POD et colis/ref.
- `POST /:ref/transition` (200) : UUIDv4 `operationKey`, `expectedVersion`,
  `expectedLoadUpdatedAt`, `target=LOADED|DELIVERED`, `recipientName` à la remise,
  `notes` facultatif. Aucun loadId/tenantId client accepté.
- `POST /:ref/exception` (200) : mêmes versions/clé, `kind` fermé et `note` obligatoire.

Les confirmations réutilisent DeliveryPackagesService : machines d’état,
version Load/colis, arrivée, chargement, POD et livraison partielle identiques au
poste interne. Registre, effets et audit sont atomiques. Les actions de colis
sont attribuées au vrai compte de service caché DISABLED et portent la provenance
DRIVER_LINK avec empreinte SHA-256 du lien (jamais le jeton) et chargement capturé.

Le verrou d’opération précède le verrou Load puis Shipment. Le replay vérifie
la capacité courante **avant de rendre le reçu**, même si les anciennes versions
ne sont plus actuelles. Un reçu déjà acquis reste récupérable après clôture
si le jeton et l’affectation sont encore valides; aucune nouvelle opération n’y
est permise. Autre acteur/corps/provenance avec la même clé : 409.
Depuis le batch connecté, un incident ajoute un événement et ouvre un dossier
DeliveryException actif. Les versions colis/expédition/tournée avancent pour
invalider les décisions périmées, sans changer le statut physique, le stock ou
les horodatages de chargement/remise. Il reste idempotent dans le même registre.
Un second incident actif est refusé; le bureau traite ou rouvre le dossier existant.
Le chauffeur voit l’instruction active, sans notes internes.
Voir [incidents et retours](distribution-exceptions-ai.md).

Les anciennes routes chauffeur sont harmonisées : références opaques pour POD
et arrêts, activation revérifiée, écritures sous verrou (callback dans le writer
d’arrêt), projections fermées, limites fichiers et réponses sans IDs de documents.
Les appels internes authentifiés et les BOL internes conservent leurs contrats.

## Réponses incertaines et limites terrain

L’intention minimale est conservée **avant envoi** dans sessionStorage, sous
une portée SHA-256 du lien. Aucun jeton ou copie complète de mission n’est stocké.
Une réponse perdue n’entraîne aucun renvoi automatique : vérifier la mission ou
reprendre exactement la même demande. Une révocation ne prouve pas qu’une ancienne
demande n’a pas abouti; contacter l’exploitation pour trancher.
Oublier une intention locale n’annule aucun effet serveur.

Ce n’est **pas une application hors ligne** : réseau requis pour une nouvelle
action, pas de file durable inter-appareils, pas de synchronisation après fermeture
du navigateur. Le scan caméra et les API natives Zebra ne sont pas implémentés.
Qualifier Code 128, layout clavier et suffixe Enter sur chaque appareil réel.

Les BOL historiques peuvent contenir des notes privées ou provenir d’un import
générique. Leur téléchargement par lien chauffeur est donc bloqué (409) tant
qu’un document explicitement qualifié pour diffusion externe n’existe pas.
Ne pas reconstruire ou exposer silencieusement les anciennes éditions. Les
manifestes D2a restent des documents internes privés, non publiés ici.

Pas de nouvelle migration. Déployer API et Web ensemble : les anciens clients
utilisant des IDs internes publics doivent recharger la page. Aucun nouvel outil
agent ni appel fournisseur réel. Tests locaux et navigateur simulé ne valent
pas qualification de matériel ni validation du VPS.

## Suite

Suivi destinataire limité à ses colis, document chauffeur publiable sans notes
privées, puis traitement contrôlé des refus/retours et allocation aux lignes de
commande/WMS. Le hors-ligne durable, les capteurs camion, les transporteurs externes
et le routage poids lourds multi-véhicules restent des lots distincts.
