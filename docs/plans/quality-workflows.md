# Qualité — contrôles et actions correctives

Lot du 22 septembre 2026, sur `codex/end-user-workflows`. Il poursuit le programme
[Achats, SAV et modules spécialisés](supplier-receipts-and-support.md), sans dupliquer
les inspections Flotte ni modifier le langage visuel de Pulsar.

## Parcours livré

1. Activer **Qualité** et attribuer `quality.read` et, aux opérateurs, `quality.manage`.
2. Dans **Plans de contrôle**, définir code stable, nom, instructions et 1 à 30 critères.
   Un critère est une vérification Conforme/Non conforme ou une mesure numérique avec
   unité, minimum et maximum inclus. Le code est unique par entreprise et immuable.
3. Dans **Contrôles**, créer un dossier indépendant ou sélectionner une source autorisée.
   Le numéro QC vient de `SequencesService`. La version, les consignes et les critères
   sont copiés **dès la création**, pas au démarrage. Modifier/désactiver le plan ne
   réinterprète aucun contrôle existant.
4. Démarrer avec un motif, saisir les résultats et les observations, puis enregistrer.
   Une valeur vide reste manquante; zéro est une vraie valeur. Les mesures sont finies,
   limitées à ±1 milliard, sans conversion d’unité ni arrondi implicite.
5. Terminer explicitement avec un compte rendu, lorsque tous les critères sont renseignés.
   Le serveur calcule le résultat : un seul échec suffit. Une terminaison échouée crée
   **une seule non-conformité NC dans la même transaction**.
6. Prendre la NC en traitement. Enregistrer la cause et l’action corrective; déclarer
   l’action réalisée avec un compte rendu. Vérifier puis clôturer avec une note expliquant
   la vérification. La clôture n’efface pas l’échec du contrôle d’origine.

Exemple : pièce de diamètre attendu entre 9,8 et 10,2 mm; mesure réelle 10,4 mm.
La terminaison ouvre une NC. Après réglage de l’outil, une nouvelle inspection peut
documenter la contre-mesure; le contrôle initial garde sa valeur historique.

## Propriété des données et liens

| Source        | Prérequis supplémentaires                | Ce que Qualité référence                     | Ce qui ne change pas                                        |
| ------------- | ---------------------------------------- | -------------------------------------------- | ----------------------------------------------------------- |
| Réception WMS | WMS actif, `wms.read`, réception POSTED  | Dossier de réception validé                  | Stock, emplacements, mouvements, reçu/commandé              |
| Fabrication   | Fabrication active, `manufacturing.read` | Ordre de fabrication, quel que soit son état | Planification, opérations, consommations, statut de l’ordre |
| SAV           | SAV actif, `support.read`                | Demande client, quel que soit son état       | Priorité, résolution, intervention Services et facturation  |

Le lien est choisi **depuis Qualité**, immuable, limité à une source du même tenant.
Le détail propose un lien vers le vrai dossier source (SAV accepte `?caseId=`).
La source n’est ni copiée ni fusionnée. Il n’y a pas de déclenchement automatique
ni de compteur qualité sur les écrans sources dans ce lot.

Les droits et l’activation de la source sont revérifiés pour les sélecteurs, la
création et la lecture détaillée. Sans droit, seul le type de source est visible,
sans identifiant, libellé ou URL. Le titre libre saisi **dans Qualité** reste visible
aux lecteurs Qualité : ne pas y copier d’informations que ces lecteurs ne devraient
pas connaître. Le journal exclut les références étrangères et les clés d’opération.

## Modèle et intégrité

Tables distinctes : `quality_plans`, `quality_inspections`,
`quality_nonconformities`, `quality_events`. Résultats et critères sont des snapshots
JSON bornés et validés, appartenant au contrôle. Pas de table générique partagée
avec les interventions, les demandes SAV ou les inspections de véhicules.

- FK composites `(tenantId, id)` pour plan, réception, ordre, SAV, contrôle et auteur.
- Index d’accès tenant/statut, tenant/code, tenant/source, et journal tenant/contrôle/date.
- Contrainte SQL : au plus une source. Une inspection terminée possède obligatoirement
  un résultat et une date de fin; les autres états n’en possèdent pas.
- Numéros QC/NC via les compteurs existants. Des trous de numérotation après rollback
  sont possibles; ils ne constituent pas une preuve de suppression.
- Écritures sérialisées par verrou transactionnel de tenant `lockBusinessTenant`.
  Chaque mise à jour exige `expectedUpdatedAt`, monotonique via `nextBusinessVersion`.
- Transitions uniquement via les deux machines d’état pures de `@pulsar/shared`,
  avec claim conditionnel statut/version. Pas de mutation depuis une lecture ou l’UI.
- Historique avant/après, auteur et motif dans la même transaction que l’opération.
  Audit plateforme best-effort supplémentaire. Plans : décorateur `@Audit`.
- Idempotence de création sur `(tenantId, operationKey)`, fingerprint canonique lié
  à l’auteur et au contenu. Replay exact avant vérification de l’activité du plan,
  mais après vérification des accès courants à la source.
- Une seule NC par contrôle, garantie par contrainte unique. Pas de création manuelle
  de NC indépendante dans cette version.

États contrôle : `DRAFT → IN_PROGRESS → COMPLETED`; DRAFT et IN_PROGRESS peuvent
devenir CANCELLED. COMPLETED et CANCELLED sont terminaux.

États NC : `OPEN → IN_PROGRESS → RESOLVED → CLOSED`; RESOLVED peut revenir
IN_PROGRESS avec un motif. La cause et l’action ne sont modifiables qu’en OPEN ou
IN_PROGRESS. La réalisation exige les deux champs non vides; CLOSED est terminal.

## API et expérience utilisateur

Racine `/api/v1/quality`, garde module sur le contrôleur et permissions sur chaque
endpoint. Listes paginées et recherches serveur. Références minimales, sans données
de contact complètes ni `tenantId`, `operationKey` ou fingerprint dans les réponses.

- Plans : GET/POST `plans`, GET/PATCH `plans/:id`.
- Références : GET `references?kind=RECEIPT|MANUFACTURING|SUPPORT`.
- File : GET `summary`, GET/POST `inspections`.
- Exécution : GET `inspections/:id`, PATCH `:id/results`, POST `:id/transition`.
- Journal : GET `inspections/:id/history`, paginé.
- Actions : GET `nonconformities`, GET/PATCH `nonconformities/:id`, POST `:id/transition`.

Le bureau conserve ses applications; navigation Qualité à trois entrées, fiches de
contrôle/NC dédiées, plans dans le Drawer animé existant, confirmations accessibles.
Les résultats montrent progression, critères manquants et écarts, pas un faux taux
de conformité. Le compteur des contrôles échoués est cumulatif, non un KPI de période.

Une création de contrôle est conservée localement **avant** l’envoi, par tenant et
utilisateur. Après réponse incertaine/rechargement, reprendre la même demande. Ne
retirer la demande qu’après inspection des contrôles existants. Après une édition
ou décision incertaine, l’UI bloque les nouvelles écritures jusqu’au rechargement.
Les brouillons de résultats ne sont pas un mode hors ligne : navigation interne
gardée, mais fermeture/rechargement du navigateur peut perdre les changements locaux.
Une création de plan utilise son code unique : vérifier ce code avant un nouvel envoi.

## Documentation et tutoriel dans Pulsar

`/documentation?module=quality` : prérequis, règles, machines d’état, reprise réseau,
limites et exemple complet. Trois fiches de connexions explicitent propriétaire,
déclencheur, données, effets, absence d’effet et procédure de reprise.

Le tutoriel commun se lance à la première ouverture par utilisateur/tenant, respecte
la navigation permise, conserve sa progression et se relance depuis l’aide ou le
manuel. Cinq étapes : présentation, plans, contrôles, NC, aide/connexions. Les boutons
Explorer ouvrent les vrais écrans; aucun dossier ni mouvement fictif n’est créé.
Les exercices guidant la saisie de données métier restent une amélioration future.

## Limites explicites

- Aucun blocage/libération de stock, quarantaine physique, lots/séries, réservation,
  retour fournisseur ou rapprochement facture. Contrôler une réception POSTED
  **ne constitue pas** une quarantaine avant mise en stock.
- Aucun produit Catalogue lié directement au plan, héritage de gamme, SPC/AQL,
  calibration d’instrument, règle HACCP ou certification réglementaire.
- Signature, notification et coût de non-qualité hors périmètre. Affectation, échéance
  et justificatifs sont ajoutés par le suivi opérationnel v2 décrit ci-dessous.
- Même opérateur autorisé à traiter et vérifier; pas de séparation à quatre yeux forcée.
- Aucun outil agent ou événement de réaction Qualité : l’IA ne libère rien et ne
  contourne pas la gouvernance. L’exposition d’outils doit faire l’objet d’un lot dédié.

## Déploiement et vérification

Migration `20260922050000_quality_workflows` après les lots précédents. Régénérer Prisma,
reconstruire shared/database/API/web, synchroniser le catalogue et les permissions,
puis activer le module sur les tenants choisis. Les nouvelles permissions peuvent
nécessiter un refresh/relogin. Les autres modules restent indépendants.

Recette sur la base isolée `pulsar_enduser_20260921`, jamais sur la base utilisateur.
`.env` inchangé. Les tests HTTP utilisent leurs propres tenants; les tests UI créent
des dossiers préfixés `Q-UI-` dans le tenant de démonstration de cette base.

Commandes de référence (DATABASE_URL doit explicitement pointer vers une base de test) :

```powershell
pnpm --filter @pulsar/shared test
pnpm --filter @pulsar/web test
pnpm --filter @pulsar/api test --runInBand
pnpm --filter @pulsar/api test:e2e --testPathPattern='quality|business-foundations|wms|end-user-workflows|scanning-tours' --forceExit
pnpm --filter @pulsar/web exec playwright test e2e/quality.spec.ts e2e/business-foundations.spec.ts e2e/end-user-workflows.spec.ts e2e/scanning-tours.spec.ts --project=desktop-chromium --workers=1 --reporter=line
```

Ne pas exécuter `svelte-kit sync`/typecheck/build pendant les tests du serveur Vite :
le rechargement HMR peut réinitialiser le formulaire de connexion. L’API locale utilise
le port 3100 et le web 5173; les tests HTTP démarrent leur serveur sur un port aléatoire.

Résultat : **1 492 tests unitaires** (853 shared, 526 API, 113 web), **136 tests HTTP**
sur 10 suites et **43 scénarios navigateur uniques** (37 régressions + 6 Qualité).
Compilation complète et dernier build web réussis; typecheck sans erreur, 12 avertissements
préexistants; 93 migrations appliquées, schéma aligné. Recette visuelle desktop/mobile
effectuée, avec correction de la barre de progression pour ne pas afficher un faux signal
de conformité et mise en évidence des critères en échec.

Les suites HTTP ont été terminées avec `--forceExit` : sans ce drapeau, Jest conserve
des handles après la réussite des assertions. Ce lot ne revendique pas une validation
de l’arrêt propre de tous les runtimes. APS n’est pas installé localement : aucune
recette du moteur de planification externe ni de tous les services tiers n’est revendiquée.

## Suivi opérationnel v2 — 22 septembre 2026

La non-conformité possède un responsable interne actif et une échéance facultatifs.
L’affectation est versionnée, tenant-scopée, auditée et interdite après clôture.
Les filtres « Mes dossiers », « Sans responsable » et « Échéance dépassée » sont
des lectures serveur; le dernier exclut les clôtures et compare au jour UTC.
Aucune notification automatique ni dépendance RH n’est créée.

`QualityEvidence` lie les justificatifs à la NC et aux fichiers de `DocumentsService`.
PDF/PNG/JPEG seulement, signature de format vérifiée, 10 Mo/fichier et 30 preuves
par NC. Ce contrôle de format n’est pas un antivirus. Téléchargement en pièce
jointe, pas de rendu actif. Aucun nouvel ajout après clôture; pas de suppression
de preuve par l’interface.

Le namespace `quality-evidence` est réservé aux endpoints Qualité. Le centre
Documents, ses facettes, les listes génériques, URLs signées, uploads, confirmations,
téléchargements et suppressions génériques ne donnent pas accès à ces fichiers,
même avec `core.documents.read/manage`. Les confirmations ne peuvent pas créer
un alias générique vers la clé de stockage d’une preuve.

L’upload conserve une clé idempotente liée à l’acteur, la NC, la description, le
nom/type et le SHA-256 du contenu. Le client conserve l’intention avant envoi;
après reload, il faut rechoisir exactement le fichier. Le replay ne crée pas de
preuve supplémentaire, même après clôture. Les preuves, la version NC et le
journal sont atomiques en base. Le stockage binaire précède cette transaction :
les fichiers préparés mais inutilisés sont nettoyés best-effort; un échec de
nettoyage est signalé dans l’audit (`cleanupRequired`). Ce n’est pas une transaction
distribuée entre PostgreSQL et le stockage; une panne stockage/DB peut nécessiter
une réconciliation administrative.

Migration : `20260922060000_quality_followup`. Tests HTTP couvrant affectation,
dates réelles, permissions, répétition de l’upload, intégrité du téléchargement et
interdiction des contournements Documents; test UI de reprise après réponse perdue.

## Suite conseillée

1. Qualité : liens retour depuis les dossiers sources et contre-contrôle explicitement
   relié à la NC, après le suivi opérationnel v2 désormais livré.
2. Quarantaine WMS : concevoir un vrai registre de disposition avec disponibilité,
   droits de libération et verrou commun à tous les writers de stock avant de l’exposer.
3. Location : disponibilités et réservations concurrentes, départ/retour, tables dédiées,
   docs et tutoriel; aucun paiement avant la conception du contrat d’encaissement.

Le premier lot RH est décrit dans `hr-foundations.md`. Location, Caisse, Restauration
et e-commerce restent documentés comme **à développer**.
