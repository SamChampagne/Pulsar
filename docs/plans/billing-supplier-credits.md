# Avoirs fournisseur reçus — I2l.2

## Usage et frontières

Finance → Factures fournisseur → ouvrir une facture **qualifiée** → Avoirs fournisseur.
Enregistrer un document effectivement reçu, pas une promesse du fournisseur. Une facture
source par avoir; fournisseur et devise hérités, source immuable même au brouillon.
Finance fonctionne seul. Les droits de lecture de facture ouvrent les avoirs; les droits
`billing.supplier-credits.manage` et `.qualify` séparent préparation et qualification.
Les modèles commis/comptable reçoivent respectivement gestion/qualification. Les rôles
personnalisés existants ne sont pas réécrits; attribution puis rafraîchissement de session.

Le registre est **documentaire**, pas un sous-grand-livre fournisseurs. QUALIFIED ne
signifie ni comptabilisé, ni remboursé, ni rapproché avec une banque. Les totaux originaux,
le statut et la version de la facture ne changent jamais. Pas d’envoi, OCR, PDF généré,
automatisation ni nouveau pouvoir d’agent. Un fournisseur devenu inactif peut encore
émettre un avoir historique : sa désactivation ne supprime pas ses obligations documentaires.

## Parcours

1. Lire original, avoirs qualifiés et reste créditable. Les brouillons/annulations sont
   listés mais ne consomment pas ce reste. Ce n’est **pas un solde à payer**.
2. Saisir numéro externe, date civile (pas avant la facture), motif explicite. Le numéro
   interne AVF est séquencé. Un numéro externe normalisé est unique par fournisseur,
   y compris après annulation et entre plusieurs factures sources.
3. Saisir un montant net positif ou nul par ligne source et chaque taxe par sa position
   d’origine. Laisser zéro sur les composantes non concernées. Un avoir de taxe seule est
   possible; le total doit être strictement positif. Aucune taxe ni remise n’est calculée.
4. Facultativement choisir une révision du suivi d’un retour WMS du même fournisseur.
5. Enregistrer, joindre PDF/PNG/JPEG (10 Mo, 30 pièces maximum), puis sélectionner
   explicitement l’original et confirmer le compte rendu de qualification. Une édition
   non enregistrée bloque la confirmation. Un qualificateur peut agir en lecture seule.
6. Consulter le document figé, son original, son contexte capturé et l’historique récent.

Le guide de retouche UI a conduit à conserver le tiroir Pulsar et à ajouter une section
progressive dans la facture, avec synthèse tabulaire, lecture seule, erreurs et reprises.
Pas de nouveau thème ni écran de paramètres. Dates civiles distinctes des instants
d’historique formatés dans le fuseau utilisateur.

## Montants, cumul et concurrence

BigInt en cents côté Shared, Decimal(12,2) côté base. Devise héritée, aucune conversion.
Le cumul **QUALIFIED** est borné séparément par le net de chaque ligne et par chaque
composante de taxe originale. Deux taxes de même libellé restent distinctes grâce à leur
position dans l’array immuable de la facture. Aucun transfert de plafond entre composantes.
Le solde se calcule à la lecture sur tous les avoirs qualifiés, jamais seulement la page
visible. La liste est paginée à dix dans l’interface.

Un brouillon ne réserve pas de crédit. Il est contrôlé à l’enregistrement, puis à nouveau
à la qualification sous verrou business tenant. Deux confirmations concurrentes ne peuvent
pas dépasser le plafond : l’une doit être revue si l’autre a consommé le reste entretemps.
Pas de quantité créditée : ce premier lot couvre les montants, y compris le rabais commercial,
sans confondre réduction monétaire et quantité retournée. Les avoirs excédant la facture,
multi-factures ou en autre devise demandent un futur contrat explicite.

DRAFT → QUALIFIED/CANCELLED via state machine Shared. Ni réouverture ni suppression.
Version obligatoire en édition/clôture. Source, supplierId, devise proviennent du serveur.
Toutes les FK acceptées sont vérifiées tenant/ownership, avec FK composites en SQL;
l’appartenance des lignes à la facture est vérifiée par le calcul partagé.
Registre d’opérations durable tenant/acteur/clé/corps, atomique avec la mutation. Replay
avant contrôle de version, après contrôle de l’humain actif et des accès au retour.
Audit des créations, modifications, clôtures et fichiers. Les 30 opérations affichées
ne tronquent pas le journal en base.

## Connexions explicites

- **Facture → avoir** : les lignes et taxes figées fournissent les plafonds. La facture
  reste inchangée; les avoirs ne passent pas par le modèle d’avoir client/transporteur.
- **Achats → facture** : le contexte de commande reste gardé dans la facture. Un avoir
  monétaire n’exige pas Achats et ne réexpose pas ce contexte. Pas de matching trois pièces.
- **WMS → avoir** : choix humain du dernier `SupplierReturnReport` sur un retour POSTED
  du même fournisseur. Copie du numéro de sortie, révision, date, référence et cumuls
  reçus/acceptés/refusés/unité. Pas de prix, coordonnées, preuve commerciale Achats ou URL
  de justificatif WMS exposés par Finance. Le lien est un contexte fournisseur, pas une
  preuve d’allocation de cet article à la ligne facturée; l’utilisateur vérifie la concordance.
  Aucune quantité acceptée ne donne droit automatiquement à un montant.
- **Évolution du suivi** : une révision plus récente bloque la qualification du brouillon;
  sélectionner la nouvelle révision et enregistrer. Après qualification la copie historique
  reste figée, même si le suivi est corrigé. Aucun stock, reçu d’achat ou rapport n’est modifié.
- Sans WMS activé + `wms.read`, Finance garde les montants et indique l’existence du lien,
  mais masque ses IDs et sa copie. Édition, retrait du lien, clôture, upload et reprise liés
  sont interdits. Les documents financiers déjà conservés restent lisibles avec Finance.

## Justificatifs et reprise

Pièces append-only via DocumentsService, type protégé `supplier-credit-evidence`.
Pas de chemin générique, suppression ou substitution d’un fichier lié. Original du même
avoir requis à la qualification. Upload réservé au brouillon avec précontrôle et recontrôle
sous verrou, SHA-256, clé liée à l’acteur et contenu. Nettoyage du fichier non lié en cas
de course; anomalie de nettoyage auditée. Fichier binaire jamais dans localStorage.

Avant chaque mutation le navigateur conserve la demande exacte par tenant/utilisateur/facture.
Une réponse incertaine bloque toute nouvelle demande sur ce dossier. Après rechargement,
rouvrir la facture puis **Vérifier la demande d’avoir** (GET) ou **Reprendre le même avoir**
(même corps/clé). Un refus intermédiaire conserve la demande. Pour un fichier, resélectionner
exactement le même fichier si la lecture de reprise ne le retrouve pas.

## Limites et suite

Pas de posting comptable, paiement/remboursement, dette âgée, compensation multi-factures,
quantités créditées, allocation des retours par ligne, correction d’un avoir qualifié,
réponse fournisseur publique, fiscalité automatique ou nouvelle capacité IA. Les règles
comptables et fiscales nécessitent une qualification séparée avant leur implémentation.

Dossier fournisseur factures/avoirs/pièces livré dans [I2l.3](billing-supplier-dossiers.md).
Suite : contrat explicite de dette fournisseur/échéancier et validation comptable.
Ne jamais traiter le reste créditable comme une dette payable.

Migration additive 131. Résultats réellement exécutés : `docs/etat-du-projet.md`.
