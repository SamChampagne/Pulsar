# WMS I2j — retours liés aux achats et justificatifs

2026-09-25 · Extension de [I2i](wms-stock-exits.md), sans nouveau cycle financier.

## Parcours métier

1. WMS → Sorties documentées → Préparer une sortie → Retour fournisseur.
2. Choisir article suivi, lot, emplacement, quantité, motif, fournisseur partagé,
   autorisation et destination confirmée. Ce parcours reste autonome avec WMS seul.
3. Facultativement, avec Achats activé et `purchasing.read`, cocher **Rattacher à une
   réception d’achat**. Seules les réceptions fournisseur enregistrées, du même
   fournisseur/article/lot/site/unité, sont proposées. Le rangement peut avoir déplacé
   le lot dans un autre bac du même entrepôt.
4. La préparation capture une copie de la ligne d’achat et de sa réception. Le cumul
   inclut tous ses retours DRAFT/POSTED; il ne dépasse pas la quantité reçue de la ligne.
   Cela limite les rapprochements documentaires, sans réserver de stock physique.
5. Examiner les effets, puis confirmer la remise physique avec le droit distinct.
   Les gardes, la quarantaine du reste et le mouvement atomique I2i restent inchangés.
6. Conserver des photos, un bon de retour ou un compte rendu en PDF/PNG/JPEG. Les ajouts
   après sortie sont identifiés séparément. Ils ne changent ni la preuve initiale
   ni le mouvement ni l’heure de sortie. Un dossier annulé n’accepte plus de nouvel ajout.
7. Depuis une réception Achats, **Retours liés à cette commande** ouvre le registre
   filtré. Depuis le retour, **Voir la réception d’achat** retrouve le document d’origine.

## Contrats et autorisations

`WmsStockExit.purchaseSourceId` référence une `SupplierReceiptLine` composite tenant/id.
Une contrainte SQL impose que source et copie soient présentes ensemble, seulement sur
SUPPLIER_RETURN. Les anciens retours restent sans source : aucun backfill ni correspondance
automatique par nom, SKU ou fournisseur. Un lien n’est ni remplaçable ni ajouté après
préparation; annuler le brouillon et recréer avec une sélection revue.

La copie garde commande/numéro/ligne, libellé, réception/ligne/date, fournisseur, article,
lot, site, quantité reçue, unité, prix unitaire et devise. Elle ne constitue pas une facture
ni un calcul d’avoir. Comparaison structurelle du JSON, indépendante de l’ordre des clés
JSONB. Le journal RECEIPT doit couvrir exactement les lignes répétées article/lot/bac de
la réception; aucune preuve reconstruite depuis le solde actuel.
Les lignes dont le journal est ancien/incomplet restent signalées sans jeton de sélection,
sans empêcher la consultation des autres lignes valides. Choisir une autre preuve ou un
retour explicitement autonome; jamais inventer l’unité historique manquante.

Sélection et revue sont calculées à la lecture. À l’écriture : verrou business puis verrou
tenant WMS, fraîcheur de la sélection, correspondance, cumul Decimal, état et journal
revérifiés. Une annulation libère le cumul documentaire uniquement. Un retour POSTED ne
réduit pas les quantités reçues historiques, ne recrée pas de reliquat et ne rouvre pas
la commande. Les retours autonomes ne sont pas attribués implicitement à un achat.

La lecture commerciale utilise un endpoint distinct. Ni liste, ni dossier WMS, ni preuve
physique ne renvoient la copie commerciale aux utilisateurs WMS seuls. Sélection, filtre
par commande, préparation liée, revue et validation/replay liés exigent Achats activé et
`purchasing.read`. Après désactivation, lecture WMS et annulation du brouillon restent
possibles; un retour lié ne peut être validé sans rétablir cet accès. Les gardes utilisent
les mécanismes JWT/cache usuels Pulsar, avec leurs limites de révocation existantes.

## Justificatifs immuables

`WmsStockExitEvidence` est un registre append-only, FK composites vers le dossier et le
Document. La date, le statut lors de l’ajout, l’auteur du Document, une description et
l’empreinte SHA-256 sont conservés. Aucune mise à jour/suppression exposée. Maximum 30 pièces,
10 Mo par fichier, nom 180 caractères, PDF/PNG/JPEG avec signature de format valide.
Ce contrôle n’est pas un antivirus, une signature électronique ou un certificat légal.

Écriture humaine active avec `wms.read/manage`, module WMS, jamais via un outil agent.
Précontrôle sous verrou, upload par `DocumentsService`, nouveau contrôle sous verrou,
puis lien atomique. Un doublon concurrent retourne la même pièce; son upload excédentaire
est supprimé s’il est encore non lié. Annulation pendant transfert : aucun lien, fichier
non lié nettoyé; nettoyage impossible ⇒ audit `cleanupRequired`. Stock et dossier initial
restent intacts. L’upload générique conserve ses limites de stockage existantes : ce lot
n’introduit pas de transaction distribuée entre stockage et PostgreSQL.

Type réservé `wms-stock-exit-evidence` : pas de liste, upload, presign, confirmation,
téléchargement ni suppression via les routes génériques. Le téléchargement métier vérifie
tenant, dossier, pièce et Document, puis sert un attachment `application/octet-stream`.
Le gestionnaire de stockage reste celui configuré dans Pulsar. Les lecteurs WMS peuvent
lire ces pièces : les documents financiers confidentiels ne doivent pas y être placés.

## Réponse réseau incertaine

Création/validation/annulation reprennent les contrats I2i. Une sélection achat, si présente,
fait partie du corps/fingerprint. Les anciens corps de requête restent compatibles.

Pour une pièce, unicité tenant/operationKey; fingerprint acteur/dossier/description/nom/
MIME/contenu. Le navigateur conserve les métadonnées sous une clé tenant/utilisateur/dossier,
pas les octets. Après rechargement, vérifier le résultat par la même clé ou resélectionner
le même fichier (nom, MIME, taille et SHA-256). Un refus pendant une reprise ne réinitialise
pas la demande. Une session expirée impose une reconnexion, pas une nouvelle clé. Ce n’est
pas une file hors ligne multi-appareils. Un replay exact reste possible sur dossier annulé
ou arrivé à sa limite de pièces, mais les droits restent vérifiés.

## Déploiement, documentation et limites

Migration additive `20260925070000_wms_exit_purchase_evidence` (128e), sans nouvelle permission
ni seed requis pour cet incrément. Migration appliquée uniquement à la base locale de test.
Rebuild Database/API, déployer Web, utiliser le stockage Documents déjà configuré.

Guide de page, documentation WMS/Achats et leçons spécifiques mis à jour. Le tutoriel WMS
reste à huit étapes; le premier lancement reste par utilisateur, sans reset ni bouton ajouté.
Le guide de retouche UI a conduit à conserver les panneaux Pulsar, dévoiler le rapprochement
sur demande et intégrer chargement, erreurs, reprise et état vide au dossier existant.

Non inclus : accusé de réception/acceptation par le fournisseur, retours multi-lignes,
articles non suivis par lot, allocations par série/pièce, rapprochement des achats matières
MRP (`MaterialPurchaseOrder` distinct), avoir fournisseur, comptabilisation, taxes, paiement,
email, transport ou automatisation IA. Aucune acceptation fournisseur déduite d’une photo.

Extension suivante : [I2k](wms-supplier-return-followup.md) ajoute le suivi déclaratif et versionné
de réception/acceptation/refus côté fournisseur, avec preuve et quantités partielles. Le dossier
d’avoir fournisseur reste séparé : qualifier le lien à la facture avant toute écriture financière.

## Vérification

Tests HTTP : liens exacts et privés, cumul concurrent, annulation, bac différent même site,
préservation des reçus, modules désactivés/replays, fichiers invalides/volumineux, limite 30,
replay concurrent, téléchargement gardé, ajout après sortie et annulation pendant upload.
Tests Web : métadonnées de reprise, blocage d’un fichier différent, corps d’origine conservé,
parcours réel réception → retour → sortie → justificatif, téléchargement et vues 390 px.
Résultats de la passe complète consignés dans `docs/etat-du-projet.md` après exécution.
