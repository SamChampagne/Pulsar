# WMS I2k — suivi déclaratif des retours fournisseur

2026-09-26. Extension de [I2j](wms-return-purchase-evidence.md), autonome avec WMS.

## Parcours

WMS → Sorties documentées → ouvrir un retour physiquement enregistré → conserver un
justificatif → **Consigner le constat fournisseur**. Le panneau distingue quantité sortie,
quantité reçue chez le fournisseur, acceptée, refusée, réception attendue et décision attendue.
Il ne prétend pas que le fournisseur s’est connecté ni qu’il a signé électroniquement.

La saisie contient les **cumuls depuis le début du retour**, jamais un delta à additionner.
Exemple : 10 EA sortis, 6 reçus, 4 acceptés, 1 refusé donnent 4 EA à recevoir et 1 EA à décider.
L’acceptation concerne le retour physique, pas un montant d’avoir ou une compensation.
Un refus ne produit aucune remise en stock. Une nouvelle entrée physique future aura besoin
de son propre document et de ses contrôles, hors de ce lot.

Référence, compte rendu et justificatif existant du même dossier sont obligatoires.
La date du constat est saisie en UTC explicite, avec aperçu dans le fuseau utilisateur;
elle est comprise entre la sortie physique et maintenant. La date d’enregistrement serveur
est distincte. Aucun horaire local ambigu n’est converti implicitement.

**Actualiser le suivi fournisseur** prépare les totaux courants. Une baisse d’un cumul ou
une date de constat antérieure au dernier constat exige un motif de correction. La nouvelle
version devient la vue courante sans modifier les anciennes. L’historique est paginé par cinq
versions dans le panneau; auteur, dates, motif et nom du justificatif restent visibles.
Pas de suppression, d’édition d’une ancienne version ni de clôture financière automatique.

## Contrat technique

`SupplierReturnReport` est append-only. Chaque ligne porte tenant/dossier, révision monotone,
trois Decimal(14,3), référence, note, date constatée, motif éventuel, auteur, pièce et demande.
FK composites tenant/dossier vers WmsStockExit; tenant/dossier/pièce vers WmsStockExitEvidence;
tenant/auteur vers User. Unicités tenant/dossier/révision et tenant/operationKey.
Les contraintes SQL empêchent les cumuls négatifs et accepté + refusé > reçu.

Le writer valide `reçu ≤ quantité sortie` et la précision à trois décimales, sans conversion
d’unité. Les calculs purs `deriveSupplierReturnBalance` / `supplierReturnDecreased` utilisent
des milli-unités BigInt dans Shared, aucune addition binaire flottante. L’API conserve Decimal.
Les états affichés sont dérivés, aucun statut métier du retour n’est modifié.

Ordre de verrouillage : business tenant, puis ligne tenant WMS; relecture du retour et de la
dernière révision avant append. `expectedRevision = 0` pour le premier constat, puis révision
courante exacte. Deux écritures distinctes de même version : une seule gagne, l’autre 409.
Parent SUPPLIER_RETURN/POSTED obligatoire. DRAFT, CANCELLED et DISPOSAL refusés. Ni le parent
ni son updatedAt, son evidence JSON, ses mouvements ou ses soldes ne sont mis à jour.
Lecture actuelle + historique dans une transaction RepeatableRead.

Routes `wms/stock-exits/:id/supplier-reports` : GET historique/current; POST déclaration;
GET `requests/:key` pour réconciliation acteur-bound. Module WMS toujours requis; lecture
wms.read, écritures/reprise wms.read + wms.manage + wms.stock.return. Le writer revérifie
l’utilisateur interne actif sous verrou, excluant comptes techniques et agents.
Audit CREATE après commit, sans nouveau pouvoir d’outil IA. Aucune dépendance à Achats pour
ce suivi physique; la projection commerciale I2j reste séparée et gardée.

Le justificatif est référencé sans copie ni modification : les fichiers I2j sont immuables.
Ils restent téléchargeables depuis la section Pièces justificatives. Réutiliser un document
ne certifie pas son contenu : le compte rendu engage une déclaration humaine, pas une preuve
de conformité légale. Aucun envoi, email, connecteur fournisseur ou appel externe.

## Réponse incertaine

Le navigateur conserve avant envoi le corps complet sous une clé tenant/utilisateur/dossier.
Fingerprint serveur acteur/dossier/version/cumuls/pièce/date/référence/note/motif; un replay
exact retrouve sa version même si des versions suivantes existent. Un autre acteur ou un
corps différent avec la même clé est refusé. Les droits actuels restent vérifiés.

Après 5xx, coupure ou expiration de session : vérifier l’enregistrement ou reprendre la même
déclaration, sans nouvelle clé. Un 403/409 pendant cette reprise ne détruit pas la demande
conservée. Le stockage local défaillant bloque l’envoi. Une première requête explicitement
refusée permet de corriger le formulaire, mais une réponse incertaine n’est jamais effacée
automatiquement. Ce n’est pas une file hors ligne partagée entre appareils.

## Déploiement et limites

Migration additive `20260926010000_supplier_return_reports` (129e), sans backfill, nouvelle
permission ni seed. Appliquée seulement à `pulsar_enduser_20260921` pour les tests locaux.
Générer/recompiler Database, Shared, API et Web. Stockage Documents I2j inchangé.

Guides de page, documentation intégrée WMS et leçons WMS/Achats adaptés, sans bouton de
tutoriel ni reset des parcours déjà vus. Le guide de retouche UI a conduit à garder le
panneau Pulsar, afficher les soldes en lecture et ouvrir le formulaire seulement sur demande;
chargement, vide, erreur, lecture seule et reprise sont explicites.

Non inclus : portail de réponse fournisseur, engagement légal, avoir, facture fournisseur,
taxe, comptabilisation, paiement, transport inverse, retour multi-lignes ou articles sans lot.
La prochaine étape est la **qualification de la facture fournisseur source** avant un avoir
séparé, explicitement rapproché. Ne pas multiplier quantité acceptée × prix d’achat pour
inventer un crédit. Les 271 exigences de l’audit ne sont pas clôturées par ce lot.

### Point de départ du prochain lot I2l

Mise à jour : [I2l.1](billing-supplier-invoices.md) livre le registre documentaire
autonome dans Finance, l’original protégé et des liens explicites aux lignes d’achat.
Le [lot I2l.2](billing-supplier-credits.md) livre maintenant l’avoir fournisseur reçu,
avec plafonds de facture et copie d’une révision de ce suivi en contexte facultatif.
Rapprochement réception/facture, paiement et comptabilisation restent ouverts.
L’inspection ci-dessous conserve le contexte ayant conduit à ce contrat.

Inspection du schéma au 2026-09-26 : `Invoice` et `IncomingCarrierInvoice` ciblent un
`Carrier` et des loads; `CustomerInvoice` / `CustomerCreditNote` sont côté client. Aucun
de ces dossiers n’est une facture générale d’achat de marchandises. Ne pas détourner
ces tables pour un fournisseur partagé `BusinessPartner`, ni assimiler `SupplierOrder`
ou une réception à une facture. Les achats matières MRP restent un autre consommateur.

Le prochain lot doit commencer par qualifier un registre de factures fournisseur distinct :
identité/numéro externe/devise/date/pièce d’origine, lignes rapprochées explicitement des
achats/réceptions, ou facture autonome sans activation WMS. Les liens au retour doivent
capturer la révision de constat utilisée, rester facultatifs et privés selon les droits.
La fiscalité, les écritures et le paiement exigent leur propre validation métier; aucun
calcul financier n’est activé par I2k. Un futur avoir ne devra jamais réécrire un constat.

## Vérification

Tests HTTP : cumuls exacts/partiels, correction conservant les preuves et stocks, versions
concurrentes, replay acteur/corps, modules/droits/tenant/pièces étrangères, dates/quantités
invalides, dossiers non éligibles, historique paginé et absence de writer d’édition/suppression.
Tests navigateur : saisie réelle, garde de cumuls, correction motivée, réponse perdue après
commit et renvoi du corps original, historique, lecture seule et écran 390 px.
Résultats d’exécution consignés dans `docs/etat-du-projet.md` une fois vérifiés.
