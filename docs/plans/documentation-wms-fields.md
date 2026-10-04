# Documentation WMS — référence des champs

Date : 2 octobre 2026. Référence éditoriale de l’implémentation, pas schéma dynamique
ni autorisation d’effectuer une opération.

## Couverture

`apps/web/src/lib/help/wms-field-reference.ts` exporte `WMS_FIELD_GUIDES` :
**8 sujets et 76 champs/contrôles**, chacun avec les neuf explications du dictionnaire
existant (clé, libellé, rôle, type/unité, obligation, validation, exemple, effet, limite),
plus une valeur par défaut uniquement quand elle est vérifiée.

- Articles : identité, unité, code-barres, suivi par lot, activité, seuil et cible,
  stock physique cumulé.
- Emplacements : site, code, zone, type, activité et version.
- Réceptions : site, référence, consignes, champs personnalisés, lignes et version.
- Préparations : mêmes repères, source du prélèvement, disponibilité et finalisation.
- Mouvements : rangement même-site guidé, ajustement signé, reprise exacte et unité historique.
- Comptages : lignes/lot/unité capturés, zéro explicite, fraîcheur et réconciliation.
- Lots : identité/dates fixes, disposition du lot entier, motif, contrôle, révision et reprise.
- Sorties documentées : destruction/retour, quantité exacte, fournisseur/destination,
  revue, version, confirmation humaine et compte rendu.

Chaque sujet cite ses vrais DTO/services/helpers/UI et ouvre une route existante.
Lots renvoie à Articles, puis au lot choisi; aucun identifiant de démonstration n’est
incorporé dans le lien. Les exemples sont fictifs et n’ont créé aucune donnée.

## Accès et limites

Les huit fiches demandent le domaine `wms`, le module `wms` activé et `wms.read`.
La documentation des actions n’accorde pas leurs droits : `wms.manage` reste requis
pour les écritures; libération avec `wms.lots.release`, confirmation de sortie avec
`wms.stock.dispose` ou `wms.stock.return` et utilisateur interne actif.

Le WMS autonome est conservé. Qualité, Achats et Transport ne sont évoqués que pour
expliquer leurs limites ou droits distincts : pas de détail de contrôle Qualité,
copie commerciale ou donnée de transport dans ces fiches. Le raccordement et le
filtrage de l’agrégateur sont traités séparément; aucun pouvoir d’outil IA ajouté.

Points explicités : zone descriptive sans mouvement; seuils sur physique global
(pas le disponible après quarantaine); suivi lot immuable sans backfill; readiness
sans réservation; validation du document entier; comptage invalide après mouvement
même net zéro; ajustement = variation signée; sortie ne libérant pas le reste du lot
et ne créant aucun avoir. Après résultat incertain, inspection ou reprise exacte du
contrat concerné, jamais une nouvelle clé pour simuler un retry.

Couverture volontairement partielle : configuration WMS exhaustive, champs du poste
de préparation TMS, traçabilité transitive bornée, pièces justificatives, rattachement
d’achat et suivi fournisseur détaillés restent dans leurs guides et contrats existants.
Pas de promesse de FEFO, réservation, série unitaire, signature réglementaire, pilote
matériel ou file hors ligne multi-appareils.

## Vérification

`wms-field-reference.test.ts` contrôle les 8 sujets/76 entrées, neuf explications,
droits catalogués, domaine/modules, chemins sources et routes, plus les distinctions
métier ci-dessus. **10 tests réussis**; compilation TypeScript ciblée des deux nouveaux
fichiers réussie. Tests locaux de données uniquement; aucun appel métier, DB, OAuth,
fournisseur, scan matériel, commit, push ou déploiement effectué dans ce lot.
