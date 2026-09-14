# Pulsar — refonte des écrans, lot 1

Date : 2026-09-14. Branche : `codex/ui-screens`, depuis `b83e96b`.

## Intention et périmètre réel

Suite du [socle UI](./ui-workspace.md). Le bureau façon iPhone est conservé.
La compétence de refonte a guidé une revue des interactions existantes : ne pas
changer le framework, retirer les bannières superflues, préserver le contexte de
travail, rendre les fenêtres cohérentes et traiter les erreurs dans le formulaire.

L’inventaire contient **138 fichiers de page**, y compris pages dynamiques,
redirections et accès publics. Ce lot ne prétend pas refondre individuellement
les 138 écrans : le tableau ci-dessous distingue adaptations, harmonisation et reste à faire.

## Livré

- CRM : sociétés et contacts en panneaux animés sans réduction de la liste,
  retour du focus, fermeture au clavier, garde contre une réponse tardive qui
  rouvrirait une fiche fermée. Recherche de sociétés par nom, filtrée côté serveur,
  avec 20 résultats et invitation à affiner. Identifiant conservé dans le payload.
- Réglages de modules : lignes label/aide/contrôle, indicateur de modification,
  barre de sauvegarde, annulation confirmée et conservation des saisies après erreur.
  Les champs sont désactivés pendant l’enregistrement. Même service et validation API.
- Finance : sept fenêtres spécifiques migrées vers Modal (comptes, budgets/écarts,
  abonnements, immobilisations/amortissement/calendrier), footer visible, taille
  bornée, focus/Échap/défilement communs. Les actions comptables ne sont pas modifiées.
- Agents, Flotte, Entrepôt, Intégrations : information opérationnelle en premier,
  suppression des doublons de titre et des panneaux promotionnels. Les rôles
  d’agents fictivement présentés comme assignés ne sont plus affichés dans Flotte.
  Catalogue et éditeur de connecteur séparés ; l’éditeur s’ouvre dans un Drawer.
- CRM : les agrégats monétaires sans devise n’apparaissent plus comme un total CAD.
  Les montants des dossiers conservent leur devise. Flotte : la limite de lecture
  des 100 premiers éléments par catégorie est signalée si elle est atteinte.
- 25 appels natifs à confirm remplacés par une décision asynchrone dans Pulsar.
  Une nouvelle demande ou navigation annule la précédente ; une réponse obsolète
  est ignorée. Aucun appel métier n’est déclenché si l’utilisateur annule.
- Onglets accessibles (flèches, Home/End, focus et panneau associé), filtres communs
  adaptés au mobile, libellés principaux harmonisés en français. Ce n’est pas une
  traduction exhaustive des pages.

Aucune dépendance, migration, modification d’API, de droit ou de gouvernance IA.
Pas de push ni de déploiement distant dans ce lot. Les courriels des tests restent
simulés ; aucun SMS ni envoi externe déclenché.

## Vérification

- Svelte : 0 erreur ; les 41 avertissements préexistants dans 8 fichiers restent ouverts.
- Build SPA de production réussi ; 31 tests unitaires web passent.
- `screen-redesign.spec.ts` : interactions et erreurs, mobile, focus, fenêtres
  imbriquées, réponses lentes, onglets et confirmations sans appel externe.
- `screen-surfaces.spec.ts` : 39 routes modifiées montent sans exception JavaScript,
  sans écran Vite d’erreur et à la bonne URL. C’est une vérification de surface,
  pas une validation exhaustive des traitements et droits de chaque module.
- Exécution finale consolidée : **75 tests UI passent** (50,2 s, 2 workers),
  dont 11 scénarios de refonte, 39 vérifications de surface, workspace,
  CRM pipelines/séquences en simulation, journeys, responsive, loads-list et control-center.
  Deux essais intermédiaires ont été perturbés pendant la régénération du serveur
  de développement (connexion réinitialisée avant navigation) ; la passe finale a
  été exécutée sans modification/reconstruction simultanée et passe intégralement.

Commandes :

```sh
pnpm --filter @pulsar/web typecheck
pnpm --filter @pulsar/web build
pnpm --filter @pulsar/web test
pnpm --filter @pulsar/web test:e2e screen-redesign.spec.ts screen-surfaces.spec.ts workspace.spec.ts crm-pipelines.spec.ts crm-sequences.spec.ts journeys.spec.ts responsive.spec.ts loads-list.spec.ts control-center.spec.ts --workers=2 --reporter=line
node scripts/ui-screen-audit.mjs
```

## Prochains lots : de vraies fiches de travail

Mise à jour : [le lot 2 — fiches de travail](./ui-records.md) traite maintenant
l’opportunité, la commande de vente, l’ordre de transport et le chargement.
Les fiches de facturation/paiement et les autres lots ci-dessous restent à poursuivre.

1. **Fiches longues et formulaires** : opportunité → commande de vente → ordre de
   transport → chargement → facture. Résumé persistant, sections utiles, édition
   clavier des lignes, erreurs locales et liens réciproques. Corriger les labels
   et contrôles cliquables non accessibles déjà signalés dans ces pages.
2. **Listes spécialisées** : WMS, Yard, Fabrication et achats ; recherche/filtres
   cohérents, colonnes et vues sauvegardées là où les API les supportent. Préserver
   Gantt, carte, plan de cour et règles métier. Pas de contrôle décoratif sans effet.
3. **Courriels et suivi** : ouvrir le dossier depuis un message, afficher connecteur,
   destinataire/consentement et historique d’automatisation sans navigation dispersée.
4. **Agents et exploitation** : activité liée au dossier et à l’action proposée ;
   santé/runtime/raison de blocage explicites. Ne pas confondre absence de données,
   runtime non configuré, droit manquant et bonne santé.
5. **Public / portails / console SaaS** : qualifier leurs parcours sur téléphone
   séparément. Le cadre entreprise n’est pas imposé aux utilisateurs externes.

Limites connues : ce lot ne fournit ni sauvegarde universelle des brouillons,
ni protection de navigation/rechargement pour tous les formulaires, ni calculs
financiers multidevises complets. Les compteurs doivent progressivement exposer
période, devise et périmètre. Les droits côté API demeurent la source d’autorité.

## Inventaire écran par écran

« Adaptation directe » ne signifie pas « module entièrement terminé ».

| Page | État dans ce lot | Portée / suite |
| --- | --- | --- |
| `/accessorials` | À reprendre | Socle partagé conservé ; revue spécifique nécessaire |
| `/agent-actions` | Harmonisation | En-tête/libellés ; pas une refonte métier complète |
| `/agents/[id]` | Interaction ciblée | Confirmation intégrée ; la page complète reste à revoir |
| `/agents` | Adaptation directe | Vue opérationnelle, bandeau retiré, aide repliée |
| `/analytics/carriers` | À reprendre | Socle partagé conservé ; revue spécifique nécessaire |
| `/analytics/control-tower` | À reprendre | Socle partagé conservé ; revue spécifique nécessaire |
| `/analytics/flow` | À reprendre | Socle partagé conservé ; revue spécifique nécessaire |
| `/analytics/scorecards` | Harmonisation | En-tête/libellés ; pas une refonte métier complète |
| `/analytics` | Harmonisation | En-tête/libellés ; pas une refonte métier complète |
| `/apps` | Conservé | Bureau iPhone, dossiers et préférences inchangés |
| `/assets` | Adaptation directe | Vue flotte, liens de fiches, périmètre des compteurs explicite |
| `/automation` | Interaction ciblée | Confirmation intégrée ; la page complète reste à revoir |
| `/billing/banking` | Lots 5–6 | Contexte du paiement, rapprochement confirmé et import CSV en panneau avec prévisualisation/dédoublonnage |
| `/billing/budgets` | Adaptation directe | Fenêtres budget et écarts accessibles |
| `/billing/config` | Réglages communs | Lignes, état modifié, sauvegarde, erreur conservant la saisie |
| `/billing/fixed-assets` | Adaptation directe | Fenêtres édition, amortissement et calendrier accessibles |
| `/billing/freight-audit/[id]` | Lots 4–5 | Sections, litiges en panneaux, dossier financier et association explicite à la facture comptable |
| `/billing/freight-audit` | Lot 4 | Français, filtres, économies par devise, saisie en panneau avec recherche transporteur |
| `/billing/ledger` | Lot 4 | Onglets, filtres de source/compte/date, liens métier et panneau de comptabilisation |
| `/billing/payments/[id]` | Lots 3–5 | Dossier, liens factures/journal/banque, édition en panneau, annulation protégée si rapproché |
| `/billing/payments/new` | Refonte lot 3 | Partie recherchable, allocations explicites par devise, création en brouillon |
| `/billing/payments` | Refonte lot 3 | Noms lisibles, liens, filtres et totaux comptabilisés par devise/type |
| `/billing/reports` | À reprendre | Socle partagé conservé ; revue spécifique nécessaire |
| `/billing/subscriptions` | Adaptation directe | Fenêtre abonnement accessible |
| `/carriers/[id]` | À reprendre | Socle partagé conservé ; revue spécifique nécessaire |
| `/carriers` | À reprendre | Socle partagé conservé ; revue spécifique nécessaire |
| `/connect/agents` | Composition / redirection | Réutilise une autre page ou un composant |
| `/connect/config` | Réglages communs | Lignes, état modifié, sauvegarde, erreur conservant la saisie |
| `/connect/email` | Composition / redirection | Réutilise une autre page ou un composant |
| `/connect/imports` | À reprendre | Socle partagé conservé ; revue spécifique nécessaire |
| `/connect/inbox` | Harmonisation | En-tête/libellés ; pas une refonte métier complète |
| `/connect` | À reprendre | Socle partagé conservé ; revue spécifique nécessaire |
| `/control-tower` | Harmonisation | En-tête/libellés ; pas une refonte métier complète |
| `/crm/activities` | À reprendre | Socle partagé conservé ; revue spécifique nécessaire |
| `/crm/campaigns` | À reprendre | Socle partagé conservé ; revue spécifique nécessaire |
| `/crm/coach` | À reprendre | Socle partagé conservé ; revue spécifique nécessaire |
| `/crm/companies/[id]` | À reprendre | Socle partagé conservé ; revue spécifique nécessaire |
| `/crm/companies` | Adaptation directe | Fiche latérale, accès clavier, réponses tardives protégées |
| `/crm/config` | Réglages communs | Lignes, état modifié, sauvegarde, erreur conservant la saisie |
| `/crm/contacts` | Adaptation directe | Fiche latérale et société recherchée par nom |
| `/crm/deals/[id]` | Lot 2 — fiche de travail | Navigation de sections, éditeur partagé, pipeline configurable ; voir ui-records.md |
| `/crm/deals` | À reprendre | Socle partagé conservé ; revue spécifique nécessaire |
| `/crm/inbox` | À reprendre | Socle partagé conservé ; revue spécifique nécessaire |
| `/crm/lists` | À reprendre | Socle partagé conservé ; revue spécifique nécessaire |
| `/crm/pipeline` | À reprendre | Socle partagé conservé ; revue spécifique nécessaire |
| `/crm/products` | À reprendre | Socle partagé conservé ; revue spécifique nécessaire |
| `/crm/sales-orders/[id]` | Lot 2 — fiche de travail | Lignes, préparation transport et dossiers liés ; voir ui-records.md |
| `/crm/sales-orders` | À reprendre | Socle partagé conservé ; revue spécifique nécessaire |
| `/crm/sequences` | À reprendre | Socle partagé conservé ; revue spécifique nécessaire |
| `/crm` | Adaptation directe | Priorités, liens vers dossiers, suppression du faux total CAD |
| `/customers/[id]` | À reprendre | Socle partagé conservé ; revue spécifique nécessaire |
| `/customers` | À reprendre | Socle partagé conservé ; revue spécifique nécessaire |
| `/dashboard` | À reprendre | Socle partagé conservé ; revue spécifique nécessaire |
| `/dispatch` | À reprendre | Socle partagé conservé ; revue spécifique nécessaire |
| `/documents` | Harmonisation | En-tête/libellés ; pas une refonte métier complète |
| `/emails/config` | Composition / redirection | Réutilise une autre page ou un composant |
| `/emails/templates` | À reprendre | Socle partagé conservé ; revue spécifique nécessaire |
| `/emails` | À reprendre | Socle partagé conservé ; revue spécifique nécessaire |
| `/finance` | À reprendre | Socle partagé conservé ; revue spécifique nécessaire |
| `/fleet/config` | Réglages communs | Lignes, état modifié, sauvegarde, erreur conservant la saisie |
| `/fleet/drivers/[id]` | Composition / redirection | Réutilise une autre page ou un composant |
| `/fleet/maintenance` | Interaction ciblée | Confirmation intégrée ; la page complète reste à revoir |
| `/fleet/trailers/[id]` | Composition / redirection | Réutilise une autre page ou un composant |
| `/fleet/vehicles/[id]` | Composition / redirection | Réutilise une autre page ou un composant |
| `/fleet` | Interaction ciblée | Confirmation intégrée ; la page complète reste à revoir |
| `/framework` | À reprendre | Socle partagé conservé ; revue spécifique nécessaire |
| `/fuel-tables` | À reprendre | Socle partagé conservé ; revue spécifique nécessaire |
| `/integrations` | Adaptation directe | Catalogue allégé et éditeur en panneau latéral |
| `/invoices` | Dossiers lot 3 | Panneaux facture/relevé, liens sources et paiement ; génération en masse encore à reprendre |
| `/lanes` | À reprendre | Socle partagé conservé ; revue spécifique nécessaire |
| `/loads/[id]` | Lot 2 — structure et erreurs | Navigation de sections et erreurs localisées ; sous-éditeurs à approfondir |
| `/loads` | Harmonisation | En-tête/libellés ; pas une refonte métier complète |
| `/locations` | À reprendre | Socle partagé conservé ; revue spécifique nécessaire |
| `/manufacturing/boms` | À reprendre | Socle partagé conservé ; revue spécifique nécessaire |
| `/manufacturing/calendars` | À reprendre | Socle partagé conservé ; revue spécifique nécessaire |
| `/manufacturing/orders/[id]` | À reprendre | Socle partagé conservé ; revue spécifique nécessaire |
| `/manufacturing/orders` | À reprendre | Socle partagé conservé ; revue spécifique nécessaire |
| `/manufacturing/routings` | À reprendre | Socle partagé conservé ; revue spécifique nécessaire |
| `/manufacturing/scheduling` | À reprendre | Socle partagé conservé ; revue spécifique nécessaire |
| `/manufacturing/work-centers` | À reprendre | Socle partagé conservé ; revue spécifique nécessaire |
| `/manufacturing` | À reprendre | Socle partagé conservé ; revue spécifique nécessaire |
| `/onboarding` | À reprendre | Socle partagé conservé ; revue spécifique nécessaire |
| `/personalize` | Interaction ciblée | Confirmation intégrée ; la page complète reste à revoir |
| `/planning` | Interaction ciblée | Confirmation intégrée ; la page complète reste à revoir |
| `/procurement/config` | Réglages communs | Lignes, état modifié, sauvegarde, erreur conservant la saisie |
| `/procurement/rfps/[id]` | À reprendre | Socle partagé conservé ; revue spécifique nécessaire |
| `/procurement/rfps` | À reprendre | Socle partagé conservé ; revue spécifique nécessaire |
| `/procurement/routing-guide` | À reprendre | Socle partagé conservé ; revue spécifique nécessaire |
| `/rate-studio` | Harmonisation | En-tête/libellés ; pas une refonte métier complète |
| `/rates` | À reprendre | Socle partagé conservé ; revue spécifique nécessaire |
| `/settings/agent-runtime` | Composition / redirection | Réutilise une autre page ou un composant |
| `/settings/agents` | Interaction ciblée | Confirmation intégrée ; la page complète reste à revoir |
| `/settings/api-keys` | À reprendre | Socle partagé conservé ; revue spécifique nécessaire |
| `/settings/appearance` | À reprendre | Socle partagé conservé ; revue spécifique nécessaire |
| `/settings/audit` | À reprendre | Socle partagé conservé ; revue spécifique nécessaire |
| `/settings/modules/[key]` | Réglages communs | Lignes, état modifié, sauvegarde, erreur conservant la saisie |
| `/settings/modules` | À reprendre | Socle partagé conservé ; revue spécifique nécessaire |
| `/settings/sso` | À reprendre | Socle partagé conservé ; revue spécifique nécessaire |
| `/settings/users` | À reprendre | Socle partagé conservé ; revue spécifique nécessaire |
| `/shipments` | Harmonisation | En-tête/libellés ; pas une refonte métier complète |
| `/sites/[id]` | À reprendre | Socle partagé conservé ; revue spécifique nécessaire |
| `/sites` | Harmonisation | En-tête/libellés ; pas une refonte métier complète |
| `/transport-orders/[id]` | Lot 2 — fiche de travail | Préparation en panneau, suivi et liens source ; voir ui-records.md |
| `/transport-orders` | Harmonisation | En-tête/libellés ; pas une refonte métier complète |
| `/transportation/config` | Réglages communs | Lignes, état modifié, sauvegarde, erreur conservant la saisie |
| `/wms/bins` | À reprendre | Socle partagé conservé ; revue spécifique nécessaire |
| `/wms/config` | Réglages communs | Lignes, état modifié, sauvegarde, erreur conservant la saisie |
| `/wms/cycle-counts` | Interaction ciblée | Confirmation intégrée ; la page complète reste à revoir |
| `/wms/fulfillment` | À reprendre | Socle partagé conservé ; revue spécifique nécessaire |
| `/wms/inventory` | À reprendre | Socle partagé conservé ; revue spécifique nécessaire |
| `/wms/items` | À reprendre | Socle partagé conservé ; revue spécifique nécessaire |
| `/wms/picking/[id]` | Interaction ciblée | Confirmation intégrée ; la page complète reste à revoir |
| `/wms/picking` | À reprendre | Socle partagé conservé ; revue spécifique nécessaire |
| `/wms/receiving/[id]` | Interaction ciblée | Confirmation intégrée ; la page complète reste à revoir |
| `/wms/receiving` | À reprendre | Socle partagé conservé ; revue spécifique nécessaire |
| `/wms` | Adaptation directe | Accueil recentré sur réceptions, stock et préparations |
| `/workbench` | À reprendre | Socle partagé conservé ; revue spécifique nécessaire |
| `/workflows` | À reprendre | Socle partagé conservé ; revue spécifique nécessaire |
| `/yard/appointments` | À reprendre | Socle partagé conservé ; revue spécifique nécessaire |
| `/yard/config` | Réglages communs | Lignes, état modifié, sauvegarde, erreur conservant la saisie |
| `/yard/gate` | Harmonisation | En-tête/libellés ; pas une refonte métier complète |
| `/yard/spots` | Harmonisation | En-tête/libellés ; pas une refonte métier complète |
| `/yard` | À reprendre | Socle partagé conservé ; revue spécifique nécessaire |
| `carrier-portal/[token]` | À reprendre | Parcours public ou console à qualifier séparément |
| `driver/[token]` | À reprendre | Parcours public ou console à qualifier séparément |
| `forgot-password` | À reprendre | Parcours public ou console à qualifier séparément |
| `login` | À reprendre | Parcours public ou console à qualifier séparément |
| `oidc/complete` | À reprendre | Parcours public ou console à qualifier séparément |
| `p/[slug]` | À reprendre | Parcours public ou console à qualifier séparément |
| `platform/login` | À reprendre | Parcours public ou console à qualifier séparément |
| `platform/modules` | À reprendre | Parcours public ou console à qualifier séparément |
| `platform/operations` | À reprendre | Parcours public ou console à qualifier séparément |
| `platform/tenants` | À reprendre | Parcours public ou console à qualifier séparément |
| `portal/[token]` | Interaction ciblée | Confirmation intégrée ; la page complète reste à revoir |
| `reset-password/[token]` | À reprendre | Parcours public ou console à qualifier séparément |
| `tender/[token]` | À reprendre | Parcours public ou console à qualifier séparément |
| `track/[token]` | À reprendre | Parcours public ou console à qualifier séparément |
| `unsubscribe` | À reprendre | Parcours public ou console à qualifier séparément |
