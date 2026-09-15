# CRM — pipelines configurables et connexions

Lot du 14 septembre 2026, branche `codex/crm-communications`. Complète
[les communications CRM](./crm-communications.md), sans remplacer leur moteur gouverné.
Les changements sont locaux ; aucun déploiement OVH ni envoi fournisseur réel dans ce lot.

## Parcours livré

1. **Connexions** (`/connect`) centralise les accès aux réglages courriel SMTP/IMAP,
   fournisseur IA, clés API, imports et studio d'intégration. Les états distinguent
   configuration, simulation, résultat de test et connecteurs à développer.
2. **CRM → Pipeline** permet de créer plusieurs pipelines par entreprise, renommer et
   ordonner leurs colonnes, ajouter des étapes et retirer les colonnes vides.
3. **Configurer les actions de cette étape** ouvre un éditeur directement dans le
   pipeline : courriel, délai, relance, simulation ou agent gouverné. Une automatisation
   par colonne, de 1 à 5 étapes. Une activation concerne les prochaines entrées seulement.
4. La fiche opportunité permet de choisir explicitement le contact principal, déplacer
   l'opportunité et consulter ses suivis, étapes et motifs d'arrêt. Aucun envoi à tous les
   contacts d'une société par défaut.

Exemple : entrer dans « Proposition envoyée » → courriel immédiat → deux jours après sa
réussite, relance si l'opportunité est toujours dans cette colonne. Sortir de la colonne,
changer le contact principal, recevoir une réponse connue ou retirer le consentement
arrête les actions restantes. Un message déjà remis au fournisseur ne peut être rappelé.

## Architecture et invariants

- `CrmPipeline` / `CrmPipelineStage` sont tenant-scopés. La configuration est protégée par
  une révision optimiste. Noms de colonnes uniques, entre 3 et 30 colonnes, au moins une
  ouverte, une gagnée et une perdue. Retirer une colonne l'archive ; une colonne occupée
  ne peut être retirée. Son automatisation est désactivée à l'archivage.
- Chaque colonne conserve une phase métier `LEAD/QUALIFIED/PROPOSAL/WON/LOST`. Son nom et
  sa position sont configurables, sa phase existante reste immuable. Le helper pur
  `canMoveCrmStage` réutilise `canTransitionDeal` ; deux colonnes d'une même phase ouverte
  peuvent se succéder. WON/LOST restent terminaux ; les liens ventes/facturation et les
  événements existants continuent à utiliser ces phases.
- Le pipeline « Ventes » est provisionné à la première lecture/utilisation, avec
  protection des créations concurrentes. Les anciennes opportunités sans pipeline sont
  affichées dans ce pipeline selon leur phase. Elles reçoivent une colonne persistée au
  prochain déplacement ; aucun déplacement ni envoi historique n'est inventé.
- Création/déplacement d'opportunité et `CrmStageEntry` sont écrits dans la même
  transaction. L'entrée fige contact, colonne, révision et configuration de suivi.
  Les changements de colonnes et les déplacements se sérialisent sur le pipeline.
- Le worker minute traite jusqu'à 50 entrées en attente par passage. Verrou PostgreSQL
  par entrée + clé unique `(tenantId, dealId, revision)` + inscription unique utilisant
  l'identifiant d'entrée assurent la reprise sans nouvelle inscription en double.
- Une nouvelle visite d'une colonne crée une nouvelle inscription. Le destinataire et
  le contenu de chaque suivi restent figés. Changer le scénario ne réécrit pas les suivis
  existants ; un scénario désactivé bloque son exécution.
- `stageRevision` invalide aussi le contexte lors d'un changement de contact principal
  ou de société, même si l'ancien contact est ensuite rétabli. Cela ne crée pas une
  nouvelle entrée. Nettoyage immédiat best-effort, balayage minute et garde juste avant
  envoi vérifient colonne, révision et destinataire.
- Le mode gouverné garde `send_crm_sequence_email` → registre → `handleMutatingTool`
  → policies/caps/proposition → outbox. Consentement, module et droits de l'agent sont
  revérifiés. La simulation ne crée ni courriel outbox ni proposition. Aucun LLM requis.
- `crm_get_deal` expose les colonnes réellement configurées ; `crm_advance_deal` accepte
  soit une phase historique, soit `pipelineStageId`, avec `expectedRevision` optionnelle.
  Cet outil reste MUTATING et suit exactement la gouvernance existante.

## Connexions : ce qui est réel

Le catalogue partagé `CONNECTION_CATALOG` est de la donnée pure, sans secrets. La page
réutilise les configurations existantes, elle ne crée pas un deuxième stockage de clés.
`/connect/email` et `/connect/agents` sont les nouveaux accès ; `/emails/config` et
`/settings/agent-runtime` restent compatibles via les mêmes composants.

`GET /email-config/connection` fournit les modes effectifs et une projection sans secret,
sans déclencher de test. Un test de transport réussi ne prouve pas la réception. Modifier
la connexion réinitialise ses anciens résultats de test. En driver log, la simulation
est indiquée explicitement ; une configuration SMTP tenant peut remplacer le transport
sortant global, mais ne transforme pas le driver entrant log en vraie réception IMAP.

Twilio SMS, Microsoft Graph et Meta Lead Ads sont **à développer**, sans collecte de clés
ni bouton d'activation fictif. Les fiches avancées ERP/API ne sont pas assimilées à des
adaptateurs exécutables. Les webhooks existants restent dans le studio avancé.

## Qualification locale

- Tests unitaires du lot : 826 réussis (shared 580, API 221, web 25).
- 118 tests API ciblés réussis (8 suites) : pipelines, séquences, CRM, email, contexte agent, commandes de vente,
  liens intermodules et gouvernance. La suite pipelines couvre également les révisions,
  l'isolation, les permissions, le snapshot, les traitements concurrents, les sorties et
  changements de destinataire, les contacts absents et les phases terminales.
- Typecheck de tous les workspaces réussi : 0 erreur, 41 avertissements web préexistants
  répartis dans 8 fichiers hors du nouveau parcours.
- Build complet shared → database → API → SPA réussi ; API relancée sur la base dev
  avec le driver courriel log. Aucun fichier d'environnement modifié.
- Quatre tests Playwright passent : pipeline/colonnes/actions, vraie exécution du worker
  en simulation, arrêt en sortie, connexions, parcours de séquences existant et
  désabonnement. Captures desktop et mobile 390 px inspectées, sans erreur JavaScript
  sur ces parcours et sans débordement horizontal du document.
- Migration additive `20260914210000_crm_pipelines` appliquée aux bases locales dev/test
  de relance. Les inscriptions historiques conservent leur clé `manual`. `.env` inchangé.
- Deux défauts rencontrés et corrigés : fiche opportunité lisant à tort ses lignes de
  produits comme une réponse paginée ; configuration courriel vierge renvoyant `null`.
- La suite API complète n'est pas certifiée par ce lot. Un lancement involontaire trop
  large a été interrompu après des échecs APS hors de ce périmètre. Les captures et les
  données préfixées « Pipeline UI » sont des données de test, pas des données métier.

Commandes ciblées (DB de test migrée et seedée, `EMAIL_DRIVER=log`) :

```sh
pnpm build
pnpm typecheck
pnpm --filter @pulsar/api exec jest --config test/jest-e2e.json --runInBand --forceExit --testPathPattern='crm-pipelines|crm-sequences|crm-module|email-core|crm-get-deal|crm-sales-orders|crm-cross-module|phase14-autonomy'
pnpm --filter @pulsar/web exec playwright test e2e/crm-pipelines.spec.ts e2e/crm-sequences.spec.ts --project=desktop-chromium --workers=1
```

## Limites et prochaine tranche

- Une configuration SMTP et un fournisseur IA par tenant ; pas encore de comptes nommés
  multiples ni d'affectation d'un compte distinct par pipeline/module.
- Pas de SMS natif, réception STOP, Microsoft OAuth/Graph ou Meta Lead Ads dans ce lot.
  La prochaine tranche doit intégrer un vrai adaptateur au stockage sécurisé existant,
  une outbox SMS gouvernée, les retours fournisseur, le consentement et les tests de
  désabonnement avant toute activation réelle.
- Qualifier SMTP et IMAP sur une boîte contrôlée avant une utilisation métier. En mode
  log, aucune boîte réelle n'est relevée et aucune livraison n'est prouvée.
- Pas de transfert entre pipelines ni de suppression de pipeline ; pas de réouverture
  des phases terminales. Pas de déclenchement rétroactif en ajoutant un contact ou en
  activant une colonne déjà occupée.
- Pas d'embranchements graphiques, d'horaires locaux ni de calendrier d'envoi. Le tableau
  charge actuellement toutes les opportunités du pipeline ; pagination/virtualisation à
  prévoir pour les gros volumes. Le sélecteur contact propose une recherche limitée à
  100 résultats ; les suivis restent paginés.
- Les délais sont exécutés au passage du worker, pas à la seconde. Une file bornée,
  les gardes et l'idempotence ne constituent pas une qualification multi-instance ni un
  test de charge global. L'outbox SMTP conserve son traitement d'état ambigu SENDING.

La refonte ciblée conserve Svelte 5, Geist, Tailwind 4 et les composants maison : édition
inline, vocabulaire métier, alternative clavier au drag-and-drop, modes explicites,
états vides et erreurs locales. Aucun ajout de bibliothèque graphique.
