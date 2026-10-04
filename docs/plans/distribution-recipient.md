# Distribution D2c — suivi destinataire par colis

## Portée

Le lien public `/track/:token` et le détail d’expédition du portail client lisent
la même projection `buildShipmentTrackingView`. Le destinataire voit uniquement
les colis de cette expédition, pas le manifeste du camion. La lecture ne change
aucun statut, stock, coût ou document et ne contacte aucun fournisseur télématique.

## Projection et confidentialité

Le champ additionnel `packageTracking` contient :

- `enabled` : marqueur historique de l’activation du suivi colis ;
- `counts` : `total`, `active`, `prepared`, `loaded`, `delivered`, `cancelled` ;
- `packages` : `code`, `status`, `loadedAt`, `deliveredAt` seulement.

Aucun identifiant interne de colis, chargement ou chauffeur, libellé libre,
contenu, quantité, destinataire de remise, commentaire ni note d’incident n’est
ajouté. Les colis annulés sont visibles comme annulés et exclus du dénominateur
des colis actifs. Un colis livré est compté uniquement selon son propre état
confirmé, jamais selon le statut du camion, une position GPS ou la présence d’un POD.

Une expédition historique non activée retourne `enabled:false`, `counts:null`
et une liste vide : il ne s’agit pas de zéro colis livré. Une expédition activée
sans colis retourne des compteurs nuls avec un message distinct, sans annoncer une
livraison complète. Les dates physiques restent les dates enregistrées, sans
backfill ni extrapolation.

La chronologie partagée expose le type, la date et un texte fixe par type. Les
anciens messages libres et identifiants d’événements ne sortent plus ; un identifiant
de présentation local remplace ces derniers. Les événements GPS sont exclus de la
chronologie. La position courante conserve la règle existante : un seul point,
tenant/chargement-scopé, masqué lorsque l’expédition est livrée ou clôturée.
Les arrêts d’autres expéditions ne sont jamais exposés.

Le POD conserve sa projection historique limitée au signataire et à la date de
signature. Aucun fichier, signature graphique, photo ou note n’est ajouté. Sa
présence n’affirme pas la remise de tous les colis.

## Autorisation et limites

Le lien d’expédition résout le tenant côté serveur. Chaque lecture contrôle
directement le statut du tenant et l’activation Transportation en base, sans
nécessiter de JWT et sans dépendre d’un cache de module. Une révocation du lien
invalide la lecture suivante. Le portail conserve ses contrôles d’accès et
d’appartenance au client, recontrôle Customer Portal directement, et inclut le
filtre client/tenant dans la lecture finale partagée.

La projection refuse explicitement plus de 200 colis par expédition ou plus de
500 événements non GPS : aucun compteur ni historique partiel n’est présenté.
Un marqueur legacy avec des colis existants est refusé comme incohérent. Ces
limites ne modifient ni ne suppriment les données sources.

## Interface et vérification

`RecipientPackagesPanel` est partagé entre le suivi public et le tiroir portail :
compteurs physiques, livraison partielle, dates, états legacy/vide/annulé. Le lien
public propose une actualisation manuelle, retire les données précédentes pendant
le chargement et affiche une erreur avec reprise explicite. Aucune écriture ni
confirmation opérationnelle n’est proposée au destinataire.

Les tests unitaires couvrent la projection fermée, les compteurs, le tenant,
le filtrage client, les limites et les messages privés. La suite HTTP dédiée
`recipient-tracking.e2e-spec.ts` utilise des tenants de recette isolés, des workflows
TMS HTTP et des doubles mémoire pour le stockage et le routage. Les parcours
Chromium mockés couvrent les deux surfaces, mobile/bureau, les états et les reprises.
Ils ne qualifient ni un déploiement réel ni du matériel de scan.

## Compatibilité EDI 214

L’export 214 réutilise les données d’expédition et les contrôles de tenant/Transport
de la projection, mais lit séparément ses faits internes AT7 : type d’événement,
date et type d’arrêt seulement. Il ne joint jamais les identifiants de présentation
publics. Le 214 conserve ainsi X1/CD aux arrêts de livraison et X6 pour les événements
GPS, en ordre chronologique, sans publier de commentaire libre ni de coordonnées.

Le budget EDI est de 500 événements sources, GPS compris, avec refus explicite
au-delà avant toute mise en outbox. L’état courant peut ajouter un dernier segment
AT7 non dupliqué : au plus 501 segments de statut. Cette règle est distincte des
500 événements **non GPS** du suivi destinataire. Le traitement entrant 210 et
ses règles de rapprochement de facture transporteur restent inchangés.
