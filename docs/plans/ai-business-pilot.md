# Pilote métier IA — Transport et revue MRP

## Livrable et frontière

Deux parcours documentaires, pas deux nouvelles fonctions d’agent. Le catalogue
`apps/web/src/lib/help/ai-pilot.ts` expose `AI_PILOTS`, les types `AiPilot`,
`AiPilotTool`, `AiPilotAccess` et le filtre pur `visibleAiPilots(access)`.
Chaque parcours décrit prérequis, étapes, prompt à préparer, preuves attendues,
blocages, outils existants et prochaine page de préparation.

Les cases du guide sont une checklist déclarative de l’utilisateur, pas des
preuves serveur. Copier le prompt n’envoie rien. Une exécution réelle exige
ensuite un choix volontaire sur une entreprise de test, le fournisseur et le
modèle configurés, un budget/consentement et des rôles vérifiés. Ce lot ne lance
aucune connexion OAuth, aucun appel LLM, aucune requête métier et aucun worker.

## Utilisation dans Pulsar

Documentation → **Mettre l’IA au travail**, ou `/documentation?view=ai-pilot`.
Le lien apparaît seulement lorsqu’au moins un parcours est accessible; un lien
direct vers un parcours refusé n’affiche ni prompt ni checklist. Chaque parcours
propose une consigne en texte brut à copier, sans envoi, et des liens vers ses
dossiers, les agents et les propositions déjà accessibles. Le parcours MRP
donne aussi accès aux tâches. La connexion IA n’est liée qu’avec son droit de gestion.

Les coches ne sont pas persistées. Un changement de parcours, d’utilisateur,
d’entreprise ou de visibilité des parcours les efface, notamment après perte
puis restauration d’accès. Elles ne deviennent jamais un indicateur « prêt ».
Une copie refusée par le navigateur laisse le texte sélectionnable, sans retry
ni opération réseau. Aucune donnée d’entreprise n’est insérée dans le prompt
par cette page : l’opérateur remplace volontairement les repères et le relit.

## Identités et visibilité

`permissions` documente les droits de l’agent nécessaires aux outils du pilote.
`operatorPermissions` documente les droits humains permettant d’inspecter le
parcours. `visibleAiPilots` exige tous les modules et toutes ces permissions
humaines; il ne simule ni readiness ni autorisation backend. Les droits pour
configurer un agent, demander une revue et approuver restent distincts et sont
expliqués dans les étapes. Aucun droit n’est accordé par la documentation.

Le niveau PROPOSE doit être complété par une vérification des policies
effectives et de `caps.autoApprove` : aucune mutation directe pour le pilote.
Les outils LOW peuvent s’exécuter directement; ils sont exclus des deux
allowlists proposées, notamment `resolve_task` du worker MRP. Les plafonds,
la vérification des modules et l’approbation existants restent intacts.

## Transport : lecture puis affectation proposée

Module Transport seul; pas de dépendance WMS ou CRM ajoutée. Preset `dispatcher`
déjà PROPOSE, allowlist limitée à `get_load`, `check_load_capacity`,
`list_shipments` (READ) et `assign_shipment` (MUTATING). Droits métier :
`transportation.planning.read` et `transportation.planning.manage`.

Préparer un load PLANNED, une expédition non affectée et leurs IDs explicites.
La capacité retournée par `check_load_capacity` décrit le chargement actuel :
ce n’est pas une simulation de l’ajout. Le prompt inclut donc un placeholder
de confirmation humaine du cumul projeté. Limites inconnues ou contexte non
confirmé : arrêt du scénario, sans inventer une capacité ou une compatibilité.

Le résultat attendu avant décision est une ProposedAction PENDING contenant
les IDs exacts. Un texte disant « je propose » n’est pas cette preuve. Un
approbateur autorisé rejette ou approuve une seule fois puis relit le résultat.
L’affectation peut recalculer route/coût estimé via le service existant; aucune
nouvelle sauvegarde optimisée, géométrie de facturation, livraison, déclaration
carburant, sortie de stock ou sollicitation transporteur n’est proposée.

Mesurer les références correctement citées, les anomalies utiles, les données
inventées et le temps de revue. Ne pas revendiquer une inspection des colis ou
une qualification routière poids lourds via ces seuls outils.

## MRP : revue via la tâche réellement affectée

Modules Fabrication et WMS; CRM et `crm.read` s’ajoutent lorsque les sources du
calcul l’exigent. Preset `mrp-analyst`, ACTIVE/alwaysOn/MRP_REVIEW, PROPOSE,
avec `list_my_tasks`, `get_task`, `get_mrp_workspace`, `get_mrp_run` (READ)
et `submit_mrp_review` (MUTATING). Les droits minimum sont
`manufacturing.read`, `wms.read`, `core.operating.tasks.read|manage`.

Utiliser Assistance IA du calcul pour demander volontairement une revue.
La demande peut déclencher un vrai worker : elle ne doit pas être effectuée
pour simplement parcourir la documentation. Vérifier la tâche MRP_REVIEW et
l’AgentRun du calcul choisi. Une tâche sans agent admissible n’est pas une
analyse; affecter la tâche existante après configuration. « Exécuter maintenant »
choisit la plus ancienne tâche OPEN, pas nécessairement celle du pilote.

La soumission exige le contexte signé `triggeredByRef=task:<id>`, une tâche
OPEN/IN_PROGRESS du calcul affectée à cet agent actif et son service-user
valide. Un ID collé dans une conversation ne produit pas cette autorité. Le
prompt est un cadre explicatif en chat ordinaire; il ne prétend jamais y rendre
`submit_mrp_review` directement utilisable.

Attendre la ProposedAction puis une décision humaine, et enfin l’ID MrpReview
si l’enregistrement a réellement réussi. La revue reste append-only et liée
au calcul, avec articles cités et fraîcheur; elle ne clôture pas la tâche et
ne résout pas une pénurie. Le pilote ne demande aucun recalcul, achat, OF ou
mouvement de stock. `recalculate_mrp` est présent dans le preset existant mais
n’est pas demandé par ce scénario. Garder la revue automatique désactivée pour
contrôler le moment et le nombre des essais.

Les briefs sont bornés et paginés : aucune promesse d’exhaustivité sur une vue
tronquée. Quantités, conversions et dates proviennent du moteur déterministe,
pas d’une estimation LLM. Les contenus et références métier sont des données
non fiables, jamais des instructions de changement de règles.

## Tests et recette restante

Les tests du catalogue comparent les outils documentés à leurs définitions
existantes (tier, permission, modules supplémentaires), vérifient les presets,
les références, les routes, la visibilité complète et les limites des deux
parcours. Importer ces tableaux dans les tests n’appelle aucun handler métier.

La recette fournisseur, la qualité d’une vraie synthèse, le coût et l’utilité
opérationnelle restent **non testés** par ce lot documentaire. Lors d’un essai
autorisé, conserver les IDs conversation/tâche/run/proposition/artefact et les
constats de l’opérateur, jamais un code OAuth ou une clé. Une réponse incertaine
impose une inspection du suivi, pas une double demande ni un renvoi automatique.

Références : `apps/api/src/core/agents/tools/{tms,dispatch,core,mrp}.tools.ts`,
`packages/shared/src/agents/role-presets.ts`,
`apps/api/src/modules/manufacturing/mrp/mrp-assistance.service.ts`,
`docs/plans/manufacturing-mrp-units-ai.md` et
`docs/plans/ai-connection-reliability.md`.
