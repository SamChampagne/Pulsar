# Finance I2m.2d.2e.1 — dotations historiques d’une immobilisation

## Périmètre et décision

Qualifier sur preuve les écritures **déjà comptabilisées**, ensemble par actif,
dans Finance → Reprise du journal. Ce lot ne reprend pas le plan futur.

L’ancien writer conservait montant et mois de chaque dotation, mais ni devise,
ni plan figé, ni ordinal, ni lien GL typé. Il postait au premier jour UTC du mois
et permettait des mois non consécutifs. Les paramètres de l’actif étaient modifiables.
Recalculer un plan ancien depuis ces paramètres fabriquerait donc une provenance.

Le registre demeure en lecture seule : `FixedAsset.currency = NULL`, version 0,
aucun plan/start/hash inventé, et aucune modification des `DepreciationEntry`.
Seules les annotations GL existantes de qualification sont utilisées. Aucune migration.

## Contrat déterministe

- Actif du tenant, historique sans plan qualifié, ACTIVE ou DISPOSED; 1 à 1200
  dotations historiques positives, distinctes, non futures, dans ou après le mois
  d’acquisition. Les dates historiques restent au premier jour UTC, sans déplacement
  vers la fin de mois employée par le nouveau writer.
- Chaque dotation a exactement un GL historique NULL à cette date, deux lignes
  appartenant au tenant : débit EXPENSE et crédit ASSET distincts, égaux au montant.
  On vérifie les comptes réellement postés, pas les codes actuellement sur l’actif.
  Des comptes différents selon les mois sont possibles; aucun remplacement implicite.
- `reconcileAssetHistory` (Shared, cents BigInt) valide coût/résiduel/cumul et somme
  exacte des dotations, cumul ≤ coût − résiduel. Aucune formule mensuelle ni arrondi
  rétrospectif. Mois absents entre première et dernière période signalés seulement.
- Un dossier incomplet, mixte, ambigu, lié à un autre tenant ou hors limites est
  bloqué; la qualification manuelle ne permet aucun contournement.
- Le groupe est ancré sur la première période. Depuis une autre dotation, l’UI
  ramène au dossier commun. Toutes les annotations portent le même `sourceEntryId`,
  état, devise et version. Aucune qualification ni correction individuelle.
- La source n’a **aucune devise attestée** : choix explicite sur justificatif
  couvrant le groupe. Aucun défaut tenant, code de compte ou pays ne la détermine.
- Revue snapshot v6 : périodes, montants, portée `RECORDED_DEPRECIATIONS_ONLY`,
  `futurePlanBlocked`, total groupé et empreinte de toutes les sources. Une modification
  après revue invalide la confirmation. Les anciens snapshots restent inchangés au replay.
- Confirmation sous verrous business tenant → actif → GL. Annotation parent/enfants,
  révision append-only et audit atomiques. UUID/acteur/corps liés, replay exact.
  Échec d’audit : aucune annotation partielle. Retrait groupé sans contrepassation,
  puis nouvelle revue obligatoire pour changer de devise.

## Droits, modularité et liens

Finance seul suffit. Le parcours existant conserve son module gating et ses droits
`billing.ledger.read` et `billing.ledger.qualify`; `billing.assets.read` est exigé
sur détails, preuves, téléchargements, recherches de demande et replays de cette source.
Aucun endpoint ni outil IA supplémentaire; aucune activation Flotte, Transport ou WMS.

Immobilisations → dossier historique → **Reprendre les dotations historiques**.
Reprise → **Ouvrir l’immobilisation** retrouve le dossier exact. L’ID d’ancrage dans
le plan n’est exposé qu’avec lecture GL. En l’absence d’ancrage unique, l’UI l’explique.
Journal, balance, rapports et budgets lisent l’annotation effective existante :
qualification = inclusion dans cette devise, retrait = exclusion commune. Les
anciennes périodes reflètent la décision actuellement confirmée, pas une clôture passée.
Les montants sans devise du registre d’actifs ne deviennent pas des soldes qualifiés.

UI Pulsar existante conservée, cumul et nombre de périodes visibles, détail des
mois repliable, avertissement permanent sur le plan futur. Aide contextuelle,
Documentation et vingtième leçon Finance mises à jour, sans reset des tours utilisateurs.

## Limites et suite I2m.2d.2e.2

Aucune acquisition, dotation manquante, cession, réévaluation, conversion ou
contrepassation créée. Aucun plan fiscal, prorata ni certification de complétude.
Les writers des anciens actifs restent bloqués après qualification de leurs GL.

La suite est un contrat prospectif distinct : date de reprise, valeur de départ,
résiduel, durée restante, devise attestée, comptes et preuve; règles pour les
périodes déjà enregistrées, revue figée et garde contre le double posting. Ne jamais
reconstruire ni écraser les périodes passées pour activer ce plan.

## Vérification

- Shared : montants exacts et variables, tri, mois absents, bornes, doublons,
  dates, comptes et équilibre.
- HTTP : qualification/retrait/requalification groupés, originaux inchangés,
  inclusion/exclusion commune des rapports dans la devise attestée,
  plan toujours bloqué, sources malformées/multitenant, concurrence, revue périmée,
  rollback audit, replay et droits sur preuves après changement de rôle.
- Navigateur : dotation enfant → dossier commun → registre → reprise; devise
  sans défaut, preuve, revue du cumul, qualification et retrait, droits source;
  vérification bureau et 390 px. Résultats datés dans `docs/etat-du-projet.md`.
