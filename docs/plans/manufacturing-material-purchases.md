# Fabrication — achats matières et réceptions WMS (M3b v1)

15 septembre 2026 · branche `codex/manufacturing-visual-workspace`.

## Parcours livré

**Fabrication → Achats matières** (`/manufacturing/purchasing`) présente les
demandes BUY préparées dans le MRP. Aucun regroupement de quantités d’articles
ou d’unités différents. Le Drawer et les composants Pulsar sont conservés;
le guide de refonte de l’existant a orienté les panneaux, confirmations,
états de lecture seule et erreurs récupérables, sans nouveau thème.

1. Préparer une proposition BUY depuis un calcul MRP frais (M3a).
2. Depuis la demande ou le poste Achats, choisir/créer un fournisseur tenant-scopé.
   Enregistrer un bon d’achat **DRAFT** MP : quantité/site/article/unité immuables,
   prix exact à six décimales, CAD/USD/EUR, date attendue et conditions.
3. Confirmer explicitement qu’une commande a été passée **hors de Pulsar**,
   avec sa référence fournisseur. `CONFIRMED` signifie un arrivage ferme pris
   en compte dans les prochains calculs. Ce bouton n’envoie aucun courriel,
   SMS, webhook fournisseur, paiement ou commande externe.
4. Préparer une réception, éventuellement partielle, dans un bin du même site.
   Elle est créée atomiquement en DRAFT dans le WMS, avec son lien à l’achat.
5. Ouvrir la réception WMS, vérifier/corriger les lignes, puis la valider via
   le workflow WMS existant. C’est seulement ici que le stock change.
6. Le dossier achat affiche reçu/restant et les liens vers toutes ses réceptions.
   Le dossier WMS affiche le contexte opérationnel de l’achat, sans prix ni
   coordonnées fournisseur; son lien de retour exige la lecture Fabrication.

Le référentiel fournisseurs permet recherche paginée, création, modification
versionnée et désactivation. Les coordonnées sont capturées sur le bon; une
édition ultérieure de la fiche ne réécrit pas les commandes. Enregistrer à
nouveau les conditions d’un brouillon recapture son fournisseur explicitement.

## Intégrité

- Une commande pour une demande BUY dans cette première tranche. FK restrictives
  et unicité `preparationId`; aucune suppression/reconversion d’un historique.
  Après annulation de l’achat, annuler aussi la demande interne si l’on souhaite
  préparer un nouveau calcul. Annuler l’achat seul ne libère pas la demande.
- `MaterialPurchaseStatus` et `canTransitionMaterialPurchase` vivent dans shared,
  enum miroir Prisma : DRAFT → CONFIRMED/CANCELLED; CONFIRMED → CANCELLED sous
  garde métier; CANCELLED terminal. Annulation interdite s’il existe une réception
  non annulée; après la première réception POSTED, jamais d’annulation complète.
- Un même verrou transactionnel tenant est partagé par les achats, préparations,
  documents WMS et stock. Version du bon obligatoire pour édition, confirmation,
  annulation et création de réception. Création/posting d’une réception avance
  aussi la version du bon. Le posting garde sa machine d’état et son claim WMS.
- Création achat et réception : UUID durable + fingerprint de l’acteur et du
  corps. Replay exact avant vérification de version; corps différent ⇒ 409.
  Clé/lien/document/numéro écrits dans la même transaction. Le navigateur conserve
  l’intention avant POST, isolée tenant/utilisateur/demande. Réponse incertaine :
  inspection ou reprise du corps et de la clé identiques, pas de nouveau document.
- Les autres mutations ne sont pas rejouées aveuglément. Après conflit/réponse
  incertaine, saisie conservée et actualisation exigée. Le code fournisseur unique
  empêche un doublon logique après réponse perdue de sa création.
- Au posting de toute réception liée, y compris par l’ancien endpoint WMS :
  même article, unité capturée, site actif, commande CONFIRMED/demande active,
  Fabrication encore activée, et quantité cumulée ≤ quantité commandée.
  Le contrôle additionne les lignes et les réceptions POSTED en Decimal sous
  le verrou. Deux brouillons peuvent être valides séparément; le second posting
  est refusé atomiquement si leur somme dépasse la commande. Rien n’est réservé.
- `InventoryService.postMovement` reste l’unique writer du registre et des soldes,
  dans la transaction de réception. Pas de nouveau compteur `receivedQty` mutable.
  Reçu/restant/progression sont dérivés. Les brouillons ne comptent pas comme reçus.
- Les FK entrantes sont contrôlées via OwnershipService et revalidées sous verrou.
  Les audits de création/statut/conditions sont émis après commit. Les événements
  WMS existants continuent à partir de la validation réelle, pas du brouillon achat.

## MRP et analyste IA

Le snapshot calcule l’arrivage d’une commande CONFIRMED comme :

`quantité commandée − somme des réceptions POSTED liées`

Le stock WMS contient déjà les quantités reçues. Les deux sources ne sont donc
jamais ajoutées deux fois. Les réceptions gérées par un achat ne sont plus
sélectionnables dans les arrivages manuels MRP; leur rattachement manuel est
également refusé côté serveur. Aucun MrpEntry SUPPLY éditable n’est créé.

Le snapshot et son hash capturent les achats retenus (date dans l’horizon), leurs
quantités reçues/restantes et les preuves WMS. Après confirmation/réception, les
anciens calculs deviennent périmés. Les captures précédant cette évolution peuvent
aussi devenir périmées, sans modification de leurs artefacts historiques.

Le blocage BUY inter-calcul n’est levé que si **la commande figure dans le snapshot
courant** : ni un brouillon, ni une annulation de commande isolée, ni une arrivée
hors horizon ne suffisent. MAKE garde le blocage conservateur M3a jusqu’au futur
rapprochement de la production atelier avec WMS.

`get_mrp_run` expose les preuves `materialPurchases` figées, bornées à 100 par page
d’articles avec leur total, et le lien/statut actuel des achats des préparations.
La consigne distingue le stock, les arrivages déjà comptés et les brouillons.
Aucun nouvel outil mutating, aucune autonomie supplémentaire, aucun appel réel
à un fournisseur LLM. Les outils existants continuent via le registre, MCP,
ProposedAction et les plafonds. La qualification LLM M7b reste ouverte.

## Permissions et API

Préfixe `/api/v1/manufacturing/material-purchases`, Fabrication + WMS requis.
Lectures : `manufacturing.read` + `wms.read`; mutations achat/fournisseur :
`manufacturing.manage` en plus; création réception : `wms.manage` aussi.
Une commande issue d’un calcul ayant du contexte CRM revalide `crm.read` et
l’activation CRM, même en historique. La liste refuse une page inaccessible
plutôt que de divulguer des demandes CRM; pas encore de filtrage fin de ces pages.
L’opérateur WMS peut recevoir via ses droits WMS habituels, sans lire prix/CRM.

- `GET/POST suppliers`, `PUT suppliers/:id` (`expectedUpdatedAt` à l’édition).
- `GET requests` (pagination/site), `GET requests/:id` (provenance et lien achat).
- `GET :id`, `POST /` (demande/version, fournisseur, prix/devise/date/conditions,
  `operationKey`), `PUT :id` (conditions du brouillon + version).
- `POST :id/confirm` (version, `supplierReference`, engagement humain externe).
- `POST :id/cancel` (version; fournisseur annulé hors Pulsar si nécessaire).
- `POST :id/receipts` (version, bin, quantité en unité de stock, `operationKey`).
- Les actions/lignes/posting/annulation de réception restent `/wms/receipts/...`.

## Limites et suite

**Ce n’est pas encore une suite achats industrielle complète.** Une seule demande/
ligne par bon; pas de regroupement fournisseurs, multi-lignes, conversion unité
d’achat/stock, taxes, frais, factures fournisseurs, paiement, retour, sur-réception
tolérée, reliquat abandonné ni report de date après confirmation. Le montant
affiché est hors taxes/transport, Decimal arrondi HALF_UP au cent.

Les réceptions sont partielles **entre plusieurs documents WMS**; une validation
WMS reste atomique pour toutes les lignes de son document. Aucun lot/généalogie,
scan, contrôle qualité ou annulation de mouvement validé n’est ajouté. Si des
champs personnalisés WMS sont obligatoires à la création, ce raccourci refuse la
création sans ces valeurs; leur formulaire d’intake reste à compléter.

Les fournisseurs/choix UI sont recherchables; les listes sont paginées. Les
détails incluent les réceptions du bon; aucune mesure de charge/gros historique
n’est revendiquée. Le verrou reste grossier par tenant. La fraîcheur métier
ne remplace pas une revalidation commerciale humaine de la commande.

Suite : **M3c** multi-lignes/regroupement, report explicite des arrivées, clôture
des reliquats et intake personnalisé; **M4** impact des arrivages/retards sur
capacité APS; **M5** consommation/production atelier WMS; **M7b** qualification
du worker réel sur environnement de test avec provider/budget explicites.

## Livraison et vérification

Migrations additives `20260916001000_material_purchases` et
`20260916002000_material_purchase_confirmation_guard`, appliquées en local aux
bases dev/test (88 migrations, aucune dérive Prisma). Aucun seed de données de démonstration dans Acme, aucune
modification de `.env`, aucun envoi fournisseur, push ou déploiement OVH.

Les tests HTTP utilisent une base dédiée et de vraies transactions. La suite
MRP réutilise PlaniAdvance réel pour le calcul et des propositions contrôlées
pour les confirmations. Les tests navigateur utilisent des réponses métier
contrôlées (et une connexion locale réelle pour la régression WMS).
Résultats finaux consignés dans `docs/etat-du-projet.md`.

Vérification : 87 tests HTTP (53 Fabrication/CRM avec PlaniAdvance réel + 34 WMS),
54 tests navigateur, 663 tests shared et 285 tests unitaires API. Les scénarios
couvrent concurrence, replay exact, changement d’article, module désactivé,
quantités fractionnaires, sur-réception/rollback, annulation terminale, snapshots
fournisseur, permissions/CRM, mobile et récupération après rechargement.
Captures desktop et mobile inspectées; build complet et typecheck sans erreur,
12 avertissements Svelte préexistants hors du lot. Deux premiers essais UI WMS
ont échoué à la connexion pendant la recompilation du serveur; les 54 scénarios
repassent ensemble après stabilisation. Ne pas lancer build et UI en parallèle.
