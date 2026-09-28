# I2l.3 — Dossier fournisseur documentaire

2026-09-27 · branche locale `codex/pilot-business-depth`.

## Parcours livré

Finance → Dossiers fournisseur → choisir un fournisseur → Factures et avoirs ou
Pièces justificatives. Le registre reste le lieu de saisie, qualification et annulation.
Les liens ouvrent la facture source et, si demandé, son avoir précis dans les panneaux
Pulsar existants. Un avoir d’une autre facture est refusé, sans remplir le formulaire.

Recherche du fournisseur par nom/code et filtre actif/désactivé. Le dossier rassemble
les factures générales et avoirs reçus uniquement : ni relevés transporteur, ni factures
clients, ni commandes Achats, ni mouvements WMS. Les factures historiques rendent le
fournisseur accessible même après retrait de son rôle fournisseur ou désactivation.
Un autre partenaire sans rôle fournisseur et sans historique ne devient pas un dossier.
L’identité courante est distinguée du nom figé sur les documents.

## Contrat monétaire

La synthèse est recalculée à la lecture depuis les documents, sans nouveau stockage.
Seuls les statuts QUALIFIED alimentent les montants; brouillons et annulés sont comptés
séparément. Agrégation par devise, calcul exact en cents BigInt dans Shared et affichage
sans conversion Number. Les sommes peuvent dépasser la borne d’un document Decimal(12,2).
Le reste documentaire est factures qualifiées moins avoirs qualifiés. Un cumul incohérent
est signalé, jamais masqué par un zéro. Un dossier vide n’invente pas de devise ou de dette.

**Ce reste n’est pas un montant payable, un échéancier ni une balance comptable.** Il ne
tient compte d’aucun paiement. Aucun taux fiscal, change ou état de lettrage n’est inféré.
La synthèse porte sur tout l’historique, indépendamment des filtres/pagination du registre.
Elle affiche son instant de lecture. Synthèse et liste ont chacune leur snapshot de lecture;
Actualiser relit les deux, sans prétendre en faire une clôture ou un export comptable figé.

## API et droits

GET `/billing/supplier-dossiers`, `/:id`, `/:id/documents`, `/:id/evidence` :
module Billing + `billing.supplier-invoices.read`. Aucun nouveau droit ou pouvoir IA.
Finance seul suffit. Fournisseur, documents, fichiers et jointures filtrés par tenant JWT;
fournisseur inaccessible → 404. Aucun tenant venant de l’URL/body ne change cette portée.

UNION ALL et pagination en base, tri déterministe date/création/type/id; count et lignes
sous RepeatableRead. Pas de chargement de tout l’historique pour paginer en mémoire.
Filtres type/statut/devise, dates civiles réelles inclusives 1900–2199, début ≤ fin.
Recherche littérale de numéro interne/externe/facture source et nom capturé; sur les
pièces, nom de fichier/description remplacent la recherche de nom capturé. SQL paramétré,
caractères % et _ non interprétés comme jokers. Pagination plafonnée à 100 par page,
numéro de page entier borné de 1 à 1 000 000 (pas de dépassement d’offset).

La projection documentaire ne lit aucun snapshot Achats/WMS, ID de retour ou de ligne
commerciale. Les contextes restent consultables dans les documents sources selon leurs
propres droits et modules. Aucun contournement via dossier ou deep link.

## Pièces et interface

Index des preuves propres aux factures/avoirs, avec parent, nom, type, taille, description,
instant de dépôt et distinction original sélectionné/pièce complémentaire. Jointure
Document vérifiant tenant, type protégé et parent. Aucun storageKey, documentId, hash ou
URL publique exposé. Les téléchargements réutilisent les endpoints protégés existants
et revérifient l’accès. Aucune copie du fichier ni nouveau chemin générique.

Panneaux, champs, tableaux de bureau et onglets Pulsar, clavier conservé. Sur mobile,
synthèses, documents et pièces deviennent des fiches complètes sans défilement horizontal.
Dates de documents
civiles fixes; instants de dépôt/lecture dans le fuseau utilisateur. Filtres appliqués
explicitement; chargement, absence d’historique, aucun résultat et erreur distingués.
Échec de liste = anciennes lignes retirées, bouton de reprise. Réponses tardives ignorées
après changement de page/onglet/tenant. La synthèse en échec est retirée, pas présentée
comme courante. Lecture seule sans afficher de mutations au rôle lecteur.

Aide de page, documentation Finance intégrée et étape métier dédiée du premier tutoriel;
aucune remise à zéro des tutoriels déjà vus et aucun bouton de tutoriel supplémentaire.

## Vérification et suite

Tests Shared (précision, devises, incohérences), HTTP (gates, tenants, filtres, pagination,
preuves protégées, identité historique, absence d’effet), UI (lecture, liens, fichiers,
mobile, erreurs, droit lecteur). Résultats exécutés dans `docs/etat-du-projet.md`.
Pas de migration, changement de schéma, seed, effet stock, achat ou envoi.

Prochain lot : qualifier d’abord le contrat dette fournisseur/échéancier et posting
comptable (comptes, taxes explicites, dates d’effet/périodes, annulations/contrepassations,
lettrage et droits), puis implémenter avec écritures idempotentes et preuves métier.
Ne pas raccorder le reste documentaire au moteur de paiements existant par simple ID.
