# Achats fournisseurs — coordonnées et engagement (E1b.6)

## Constat et périmètre

Suite du programme enterprise, sur la branche locale `codex/pilot-business-depth`.
Le fournisseur avait déjà un carnet versionné mais sa commande n’en capturait aucune
copie. La confirmation figeait les lignes, sans preuve de l’adresse ou de l’interlocuteur
choisi pour cet accord. Cet incrément branche le service commun sur `SupplierOrder`.
Il contribue aux fondations CL01/CL03/CL07 et AF01, sans clore leur qualification complète.

Achats fournisseurs seul suffit : pas de Catalogue, Clients, Transport, CRM, Facturation
ou WMS imposé pour composer et confirmer une commande. WMS et ses droits restent requis
pour un arrivage physique, exactement comme avant.

## Deux sens d’adresse à ne pas confondre

- **Adresse du fournisseur** : entrée ADDRESS du carnet de son `BusinessPartner`.
- **Contact fournisseur de la commande** : entrée CONTACT du même carnet.
- **Destination de réception** : site/emplacement de l’acheteur, choisi dans le parcours
  Réceptions. Elle ne provient jamais du carnet du fournisseur.

La copie utilise `owner.kind = 'supplier'` et contrôle `isSupplier`, pas `isCustomer`.
Il s’agit du partenaire existant, pas d’une nouvelle table fournisseur ni d’une fusion.
Pour conserver le contrat commun, le rôle technique `entries.billingAddress` porte ici
l’adresse du fournisseur; les libellés et rôles autorisés sont explicites dans Shared
et renvoyés par la revue API. `entries.deliveryAddress` doit rester null : le serveur
refuse sa sélection et son gel. Aucun consommateur ne doit interpréter ce slot comme
l’adresse de facturation de notre entreprise.

## Contrats et invariants

- `GET /purchasing/orders/:id/coordinates` : copie, revue des écarts, date civile et
  fuseau métier. Module Achats fournisseurs et permission `purchasing.read`.
- `PATCH` sur la même route : `purchasing.read` + `purchasing.manage`, version attendue,
  motif et trois références explicites identifiant/version ou null. Pas de snapshot
  accepté du client; tenant, propriétaire, type, version, activité et validité sont
  vérifiés côté serveur sous verrou business tenant commun au carnet.
- Sélection partielle ou absente admise. Tout retirer remet la copie à null. Changer
  de fournisseur exige ce retrait explicite préalable; aucune adresse n’est transférée.
- Édition des lignes et métadonnées : DRAFT, version attendue, même verrou puis CAS.
  Remplacement des lignes et mise à jour du parent sont dans la même transaction.
- CONFIRMED passe par `canTransitionSupplierOrder`, revalide fournisseur/articles,
  identité et versions sélectionnées, puis écrit statut, version et copie figée
  atomiquement. Un changement concurrent produit 409, pas un accord partiellement figé.
  Le gel partage aussi un verrou de lecture sur la ligne partenaire.
- Après confirmation, le carnet actuel ne réécrit jamais la copie. Clôture/annulation
  conservent l’historique; le contrôle existant interdit l’annulation après réception.
  Clôturer un reliquat ne crée aucun stock manquant.
- Mutations auditées par les voies existantes; aucun endpoint ne prend de tenant fourni
  dans le corps. Aucun nouveau pouvoir agent, email, facture, taxe, paiement ou accès portail.

## Interface, reprise et tutoriel

Achats fournisseurs → ouvrir une commande → **Carnet du fournisseur**, ou Données →
Fournisseurs → Carnet. Enregistrer le brouillon, choisir explicitement les versions dans
**Coordonnées du document**, motiver puis confirmer. Le panneau conserve la liste en arrière-plan.

Les composants Pulsar existants sont conservés. Aucun formulaire imbriqué. L’édition
commerciale non enregistrée empêche l’ouverture des choix; l’édition des coordonnées
bloque les lignes et la confirmation. Les lectures en erreur et les copies à revoir
empêchent aussi l’engagement. Le serveur reste l’autorité même sans ces protections UI.

Après réponse incertaine, relire via **Vérifier le document enregistré** ou **Vérifier
la commande enregistrée** avant toute nouvelle action. Une création sans identifiant
reçu exige d’inspecter la liste : cette création n’a pas de clé d’idempotence. Ne pas
annoncer un retry automatique sûr. Les versions empêchent un second engagement périmé.

Documentation intégrée enrichie avec ces règles, connexions et limites. Tutoriel Achats
en sept étapes spécifiques, dont l’identification du fournisseur; première ouverture
par utilisateur seulement, sans réinitialiser un tutoriel déjà vu.

## Effets aval et limites

Une réception WMS sélectionne son propre site/bin et utilise les writers de stock
existants. Changer/désactiver un contact après engagement ne bloque pas la réception
de cet accord et ne modifie ni sa copie ni le choix de stock. Ce comportement est testé
avec deux arrivages partiels. Les correspondances produit ↔ article restent explicites.

Ne sont pas livrés : identité/adresse de notre entreprise acheteuse figées, destination
contractuelle distincte, PDF canonique fournisseur, transmission, avenants, conditions
et qualification réglementaire du fournisseur, taxes achat, retours ou rapprochement
de sa facture. Les `MaterialPurchaseOrder` du MRP constituent un workflow distinct et
ne reçoivent pas implicitement ce contrat de `SupplierOrder`.

Les commandes anciennes restent null : aucun backfill ni passé reconstruit.
La confirmation sans copie reste possible; cette fonctionnalité n’est pas un système
complet de conformité fournisseur. La revue transversale des documents ouverts et les
correspondances humaines entre registres sont la prochaine étape E1b.

## Déploiement et recette locale — 2026-09-24

Migration additive `20260924060000_supplier_order_coordinates`, après la chaîne E1
existante, génération Prisma puis builds Database/Shared/API/Web. Migration 117 appliquée
uniquement à `pulsar_enduser_20260921`; `.env` inchangé, aucun déploiement ni envoi réel.

- 936 tests Shared, 686 unitaires API et 129 Web réussis.
- 104 HTTP sur quatre suites : 9 nouveaux Achats autonomes, 37 fondations métier
  dont le nouveau pont coordonnées/réceptions WMS, 48 autonomie, 10 commandes CRM.
  Nettoyage des carnets de ces fixtures ajouté; résultat final sans erreur de cleanup.
- Quatre parcours Chromium finaux : deux Achats et deux régressions CRM. Carnet réel depuis la commande, édition gardée, PATCH
  puis confirmation réellement commis avec réponses interrompues, relecture sans double
  mutation, panne avant traitement puis relecture à version inchangée, histoire après renommage,
  mobile, lecture seule, tutoriel et documentation. Carnet et fermeture bloqués pendant une sélection non enregistrée.
- Captures desktop/mobile inspectées; pas de débordement à 390 px ni d’erreur JavaScript
  dans le parcours principal. Typage Svelte : zéro erreur, douze avertissements préexistants.
- Builds Shared/Database/API/Web réussis. Aucun push, PR, SMTP ni environnement distant.

Tests : `supplier-order-coordinates.e2e-spec.ts`, `business-foundations.e2e-spec.ts`,
`module-autonomy.e2e-spec.ts`, `crm-order-coordinates.e2e-spec.ts` et
`apps/web/e2e/supplier-order-coordinates.spec.ts`. Le navigateur utilise un tenant de
test via `SUPPLIER_COORDINATES_TENANT`, jamais les préférences du compte utilisateur réel.
