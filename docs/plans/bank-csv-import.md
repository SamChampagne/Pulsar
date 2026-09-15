# Import bancaire CSV — lot 6

Date : 2026-09-14. Branche : `codex/bank-csv-import`, depuis `825d367` (dossiers financiers connectés).

## Parcours livré

Banque → Transactions → sélectionner un compte → **Importer un CSV**.
Le panneau commun permet de choisir un fichier UTF-8 ou de coller son contenu, puis de
**prévisualiser** les mouvements. Le cadre de l’application ne se déplace pas.

La prévisualisation affiche les lignes nouvelles, déjà présentes ou répétées dans le CSV,
les erreurs numérotées et les totaux entrants/sortants des nouveaux mouvements, dans la devise
du compte. Le tableau est paginé par 25 lignes dans le panneau. Le format détaillé reste
accessible sous une aide dépliable. Une confirmation nomme le compte et le maximum de lignes ajoutées.

- Toute erreur bloque le lot entier; plus d’import partiel implicite des seules lignes valides.
- Modifier le contenu ou changer de compte invalide la prévisualisation.
- Une réponse d’import perdue conserve la saisie; réessayer le même CSV ne réinsère pas les lignes.
- Le panneau affiche le résultat réel du serveur : ajoutées / ignorées. Le bouton d’import
  disparaît après succès, et la liste ainsi que le solde du compte sont actualisés.
- Fermer une préparation non importée demande confirmation. Le contenu est conservé en mémoire
  sur cette page, pas après rechargement. Aucune donnée bancaire n’est écrite en localStorage.
- Les collages trop volumineux sont conservés et refusés, jamais tronqués silencieusement.

**Import du relevé uniquement** : aucun paiement, rapprochement automatique, journal comptable,
courriel ou transfert bancaire n’est créé. Les nouveaux mouvements sont UNRECONCILED.

## Format accepté

```csv
date,description,amount,reference
2026-09-14,Transport du Fjord,-135.08,FJ-218
2026-09-15,Encaissement client,241.65,CL-32
```

- Virgule ou point-virgule, BOM UTF-8, LF/CRLF, champs entre guillemets, guillemets échappés `""`
  et retours de ligne dans un champ acceptés. Espaces de texte normalisés.
- Avec en-tête, ordre des colonnes configurable par leurs noms. `montant` est un alias
  d’`amount`, `référence` de `reference`. Casse des en-têtes ignorée. Colonnes inconnues,
  dupliquées ou obligatoires manquantes refusées.
- Compatibilité sans en-tête : ordre fixe date, description, amount, reference facultative.
- Dates réelles AAAA-MM-JJ, année ≥ 1900. Pas d’inférence MM/JJ vs JJ/MM ni de timestamps.
  Stockage à minuit UTC; la date de dédoublonnage des mouvements historiques est leur jour UTC.
- Montants signés non nuls, au plus 2 décimales, maximum absolu 9 999 999 999,99. Point ou
  virgule décimale; la virgule exige un séparateur `;` ou un champ CSV entre guillemets.
  Pas de symbole monétaire, milliers, exponentielle ni arrondi silencieux.
- Description requise; description et référence : 200 caractères maximum, sans contrôles interdits.
- Maximum 500 mouvements et 30 000 caractères par demande, également validé côté serveur.
- Pas de colonne de devise : celle du compte destinataire s’applique à toutes les lignes.
  Un relevé multi-devises doit être séparé explicitement.

Ce format est délibérément limité; ce n’est pas encore un import universel des exports de toutes
les banques. XLSX, encodages non UTF-8, mapping visuel et colonnes débit/crédit séparées ne sont pas livrés.

## Protection contre les doublons

Identité canonique : jour UTC + description + montant signé en cents + référence. Les textes
sont normalisés NFKC, espaces réduits et extrémités nettoyées; la casse est conservée. La clé
SHA-256 est stockée dans `BankTransaction.importFingerprint` et unique par tenant + compte.

Le service compare aussi les mouvements historiques/manuels sans empreinte, dans la plage de
dates du CSV. Le statut rapproché ou non ne change pas l’identité. Les doublons historiques
existants ne sont ni supprimés ni fusionnés.

L’import verrouille le compte bancaire, relit les doublons et insère les nouvelles lignes dans
une seule transaction. La saisie manuelle prend le même verrou; les changements de configuration
et suppressions de compte l’utilisent déjà. L’index unique protège aussi les imports concurrents.
Les différents comptes restent indépendants.

**Limite importante :** sans identifiant bancaire fiable, deux opérations légitimes portant
exactement les quatre mêmes valeurs sont indiscernables d’un doublon. Elles sont signalées/ignorées
par prudence. Vérifier le relevé source et utiliser une référence bancaire distincte lorsqu’elle
existe, ou une saisie manuelle explicitement vérifiée pour la seconde opération. Ne pas inventer
une référence uniquement pour contourner le contrôle.

## API et autorisations

Les deux endpoints sont gated par le module Billing et `billing.ledger.manage`, avec `tenantId`
issu du JWT et contrôle d’appartenance du compte via `OwnershipService`.

- `POST /api/v1/billing/bank-transactions/import/preview`
  reçoit `{ bankAccountId, csv }`. Aucune écriture, y compris dans l’audit.
  Retourne `rows`, `issues`, `errors`, `totals`, `currency`, `canImport`, `previewHash`.
- `POST /api/v1/billing/bank-transactions/import`
  reçoit `{ bankAccountId, csv, previewHash? }`. Retourne `{ imported, skipped, errors: [] }`.
  CSV invalide : 400 sans insertion. Empreinte de prévisualisation différente : 409, refaire l’aperçu.
- `previewHash` lie le contenu exact et la configuration devise/GL du compte au tenant.
  Il ne fige pas le nombre de doublons : un import concurrent peut réduire les insertions.
  Ce n’est pas un jeton d’autorisation; permissions et validations sont toujours revérifiées.
- L’UI envoie toujours `previewHash`. Il reste facultatif pour les clients historiques : ils
  bénéficient du dédoublonnage/atomicité mais pas de la vérification d’une prévisualisation antérieure.
- Le parseur partagé conserve la forme historique `parseBankCsv()` (`rows/errors`) et expose
  `inspectBankCsv()` pour les erreurs numérotées. Sa validation est désormais stricte.
- Les imports ajoutant au moins une ligne produisent un audit `bank-import` contenant uniquement
  compte, compteurs et hash du contenu. Aucun CSV brut ni description bancaire recopiée dans l’audit.
  Un retry sans nouvelle insertion ne crée pas un second audit. L’audit suit le mécanisme
  post-commit existant; ce n’est pas une nouvelle outbox transactionnelle.

## Migration et exploitation

Migration additive `20260914193000_bank_csv_import` : colonne nullable `importFingerprint`,
unicité tenant/compte/empreinte et index tenant/compte/date. Aucun backfill destructif.
Appliquée aux bases locales `pulsar_relaunch_20260913` et `pulsar_relaunch_test_20260913`.

Sur un autre environnement, sauvegarder puis appliquer les migrations, régénérer Prisma et
reconstruire shared/database/API/web. Sur Windows, arrêter l’API avant de régénérer Prisma.
L’API locale reste sur 3100 et le web sur 5173. `.env` inchangé; pas de push ni déploiement OVH.

## Vérification

- 51 tests shared réussis, dont 34 sur le nouveau parseur : dates réelles, bornes, guillemets,
  BOM, colonnes, caractères de contrôle, précision et identité normalisée.
- 78 tests HTTP réussis sur la base séparée, dont 11 nouveaux cas CSV : prévisualisation sans
  écriture, atomicité, répétition, chevauchement, legacy, concurrence, empreinte périmée,
  permissions/tenant et audit sans contenu bancaire brut.
- 226 tests unitaires API et 34 tests unitaires web réussis.
- 124 tests navigateur réussis, dont les 7 nouveaux scénarios CSV : fichier, erreurs,
  doublons, confirmation annulée, reprise après réponse perdue, changement de compte,
  fermeture protégée, collage surdimensionné et affichage mobile. Captures revues à
  390 × 844 et 1280 × 800; aide repliable et actions fixes sans déplacement du cadre.
- Builds API/web et typecheck web réussis; les 12 avertissements Svelte préexistants dans
  5 fichiers hors périmètre restent présents. Les handles ouverts signalés par Jest restent
  une dette de cycle de vie existante, sans échec des suites HTTP.
- Les tests navigateur interceptent toutes les écritures CSV. Aucun relevé réel n’est importé.

Total des suites exécutées : **513 tests réussis** (51 shared, 226 unitaires API,
34 unitaires web, 78 HTTP, 124 navigateur). Ce total ne prétend pas couvrir toutes les suites
HTTP ni tous les modules du dépôt.

## Suite utile

1. Mapping de colonnes guidé et gabarits par banque, après collecte d’exemples anonymisés des
   formats réellement utilisés. Privilégier un identifiant bancaire stable s’il est disponible.
2. Historique d’import durable avec traçabilité des lots et correction contrôlée des erreurs
   humaines; aucune suppression de mouvements déjà rapprochés sans workflow dédié.
3. Pagination serveur du relevé et du rapprochement pour les gros volumes.
4. Les limites du lot 5 (frais, paiements groupés, FX et atomicité historique des audits de
   factures) restent inchangées. Aucun nouvel outil agent ni connecteur bancaire réel dans ce lot.
