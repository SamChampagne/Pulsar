# Services — retours partiels et quantités facturables

> Complément du 25 septembre : [lots des pièces I2c](services-part-lots.md).
> Les retours partiels conservent aussi le lot d’origine quand il a été capturé à la sortie.

Lot du programme `pilot-business-depth`, 22 septembre 2026. Complète les pièces
Services existantes, sans modifier les factures approuvées ni ajouter d’avoirs.

**Complément du 23 septembre :** le [lot avoirs clients](customer-credit-notes.md)
autorise désormais les retours après facturation via une ligne d’avoir validée.
Les mentions ci-dessous décrivent la livraison initiale sans ce complément.

## Parcours opérateur

1. Consommer les pièces sur une intervention en cours d’un projet actif.
2. Dans **Pièces et stock**, choisir **Retourner une quantité**, préciser la quantité
   réellement revenue et le motif, confirmer le mouvement physique.
3. Lire **Sorties / Retournées / Conservées**, dans l’unité capturée à la sortie.
   Les cinq derniers retours sont affichés; tous les mouvements restent dans le
   journal WMS accessible depuis l’intervention.
4. Dans les travaux à facturer du projet, sélectionner les quantités nettes et
   confirmer les tarifs. Un retour postérieur à la lecture impose une actualisation.
5. Si un brouillon existe déjà, l’ouvrir depuis l’historique de facturation du
   projet, le supprimer dans Facturation, faire le retour puis recréer le brouillon.
   Toutes ses sources sont libérées, pas seulement la pièce corrigée : revérifier
   également les heures, les prix et les taxes lors de la recréation.

Exemple : 4 joints sortis, 1,25 rendu → 2,75 facturables. Après un autre retour de
0,75 avant facturation, le solde est 2. Le prix du produit n’est jamais inventé.

## Contrat serveur

- `POST /services/jobs/:id/parts/:partId/return` accepte `quantity` positive,
  au plus trois décimales, `reason`, `operationKey` UUID et `expectedUpdatedAt` du job.
- Pour un ancien client sans quantité, la demande signifie la **quantité initiale
  entière**, jamais un restant implicite. Si un retour partiel a déjà eu lieu,
  cette ancienne demande est refusée, sauf rejeu exact d’une opération déjà connue.
- Verrou métier tenant puis verrou WMS tenant, dans cet ordre. Relecture du job,
  du projet, de la facture et du restant sous verrou. Projet actif et WMS activé;
  droits `services.read/manage`, `wms.read/manage`; tenant depuis le principal.
- `ServicePartReturn` est un journal sans endpoint d’édition/suppression. Quantité,
  auteur, date, motif, clé/fingerprint et mouvement sont immuables. Les FK composites
  tenant/consommation, tenant/auteur et tenant/mouvement empêchent les liens croisés.
- Chaque retour passe par `InventoryService.postMovement(RECEIPT)` au bin d’origine,
  dans la même transaction que le journal, le cumul `returnedQuantity` et les versions
  consommation/job. Aucune modification des soldes ni des mouvements passés.
- Le cumul transactionnel est borné en SQL à `[0, quantity]`. Le restant facturable
  est `quantity - returnedQuantity`; les quantités initiales et snapshots restent figés.
- Un retour avance `ServicePartUsage.updatedAt` d’au moins 1 ms. Facturation compare
  cette version et relit le net sous le même verrou métier. La contrainte unique de
  source de facture reste en place. Une pièce déjà facturée bloque tout nouveau retour.
- Une clé de retour connue et son fingerprint exact sont rejoués avant validation
  de l’état actuel, sans doubler le stock. Une clé réutilisée avec un autre corps,
  acteur, job ou pièce donne 409. Reprise navigateur conservée avant l’envoi.
- Annulation d’intervention interdite tant qu’une quantité reste consommée.
- Projection Services : aucun numéro, montant ou identifiant de facture. Seulement
  `billingLocked` pour expliquer le blocage opérationnel; pas de fingerprint exposé.

## Migration et compatibilité

`20260922020000_service_partial_returns` ajoute le journal et le cumul/version.
Chaque ancien retour intégral est repris depuis son mouvement, quantité, auteur,
date et fingerprint réels. Aucun nouveau mouvement de stock. Les anciennes colonnes
de retour sont conservées en lecture historique, mais ne pilotent plus les décisions.
Les versions des consommations non retournées reprennent `createdAt`, conservant
la validité des demandes de facturation en attente avant mise à jour.

Déployer l’API et l’interface ensemble après la migration, anciens writers arrêtés :
un ancien serveur ne sait pas entretenir le nouveau cumul. Une restauration exige
le couple sauvegarde DB/version applicative, pas seulement un rollback du binaire.

## Limites explicites

- Pas encore d’avoirs clients : une facture approuvée reste figée et le retour
  intégré est bloqué. Ne pas détourner un ajustement WMS pour prétendre corriger
  la facturation. Le futur circuit doit relier quantité créditée, taxe figée,
  règlement et écriture comptable compensatoire.
- Projet fermé, bin inactif ou unité changée : retour refusé. La désactivation du
  produit n’efface pas sa consommation et n’empêche pas à elle seule son retour. Pas de retour
  dans un bin arbitraire, de lots/séries, ni de conversion d’unité implicite.
- Pas de mutation IA ajoutée, d’envoi client, ni de mode hors ligne complet.
- Tutoriel Services enrichi via son contenu métier existant; progression utilisateur
  conservée, sans bouton permanent ajouté et sans relance forcée après mise à jour.

## Recette

Migration sur la base isolée : 17 retours historiques comparés, auteur/date/fingerprint/
quantité/mouvement conservés; nombre de mouvements inchangé. Tests HTTP couvrent
retours concurrents, rejeu exact, versions périmées, sur-retour, droits, quantités
décimales, annulation après retour complet, facturation nette et correction de brouillon.
Les résultats finaux sont consignés dans le programme pilote après exécution.
