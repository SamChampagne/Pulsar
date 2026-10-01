# Espace IA global et workers parallèles — A2d

## Usage

L’icône **Assistant IA** dans la barre du haut ouvre l’**Espace IA**. Ce n’est pas
un module du catalogue : l’accès dépend de `core.agents.chat`, sans activation
Transport, Finance ou autre. Le bureau d’apps et le thème Pulsar sont conservés.

1. Choisir un worker actif. Son modèle configuré (ou le modèle par défaut de
   l’entreprise) est affiché. Ce libellé n’est pas une preuve de modèle utilisé
   dans un ancien message ni une estimation de coût.
2. Saisir un objectif, Entrée pour envoyer, Maj+Entrée pour une nouvelle ligne.
3. Choisir un autre worker ouvre une nouvelle conversation, sans changer le
   destinataire d’une conversation existante. Les réponses peuvent progresser
   simultanément; l’historique indique lesquelles travaillent.
4. Fermer le panneau permet de continuer à utiliser les apps; le badge de la
   barre conserve le nombre de conversations actives **dans cet onglet**.
5. Revenir à une conversation depuis l’historique privé. Les titres proviennent
   du premier message, sans appel IA auxiliaire. Les erreurs restent explicites;
   aucune réponse partielle n’est présentée comme une réussite.

Le panneau reste monté pendant la navigation dans le shell. Un rechargement,
une déconnexion ou la fermeture de l’onglet n’est **pas** un transfert automatique
à un worker durable. Les messages déjà enregistrés restent en base. Après une
interruption, inspecter l’historique et le journal avant de relancer un objectif.
La fermeture du navigateur ne garantit pas l’annulation d’un effet métier déjà
effectué. Les tâches automatiques durables restent dans `AgentWorkerService` /
`AgentRun`, distinctes des conversations interactives.

## Contrat serveur

- `GET /agent-conversations/workers` : permission chat, projection fermée du
  roster et du modèle effectif configuré; jamais clé, persona, service-user ni caps.
- Historique : tenant JWT ET utilisateur propriétaire. Les autres conversations
  de l’entreprise ne deviennent pas visibles dans le nouveau panneau.
- Un tour à la fois par conversation sur l’instance API. Un second envoi est
  refusé avant append. Agent ACTIVE revérifié avant tout tour; pause/révocation
  et permissions MCP continuent à s’appliquer. Texte non vide, maximum 32 000 caractères.
- Déconnexion HTTP : arrêt du processus associé; pas de retry/replay de prompt.
- Le verrou interactif est en mémoire : **cette livraison reste mono-instance API**.
  Avant plusieurs réplicas API, ajouter un bail distribué des tours et la
  coordination des annulations. Ne pas présenter cette protection comme distribuée.
- Un worker ne dispose d’aucun droit supplémentaire. Les écritures passent
  toujours par registre MCP → policies/plafonds → ProposedAction → services métier.
  Un appel d’outil affiché n’est pas forcément une proposition à approuver.

## Concurrence du runner de production

Un conteneur/identité/volume/réseau/secret par tenant, un processus ACP par
conversation. Quatre places par défaut, plafond opérateur `RUNNER_MAX_CONCURRENT`
entre 1 et 8 (`PULSAR_AGENT_MAX_CONCURRENT` dans Compose). Ce plafond protège les
ressources du VPS; augmenter exige une recette CPU/RAM/PID correspondante.
Les workers automatiques conservent aussi leurs limites globales/tenant/agent.

Les places sont partagées par chat, vérification de runtime et tâches automatiques.
Une place n’est libérée qu’à la sortie effective de l’enfant; dépassement → 409
interservices, erreur explicite côté API, jamais débordement vers une autre entreprise.

La configuration du groupe de processus est figée : même fournisseur, auth,
URL, modèle par défaut et empreinte de clé tant que des processus vivent. Le
fichier de configuration n’est écrit que pour le premier. Un changement attend
le repos; pas d’écrasement concurrent. Les modèles propres aux workers sont
appliqués dans leur session ACP, pas dans le fichier partagé.

Le login OAuth est exclusif dans les deux sens. Le runtime **verrouillé 0.16.0**
utilise ses verrous interprocessus d’auth et SQLite WAL pour l’historique partagé
du même tenant/provider. Ce contrat doit être requalifié avant un changement
de runtime. OAuth/refresh réels restent à recetter avec le fournisseur choisi.

## CI et preuves

Run GitHub `36798588507` : processus API e2e tué par heap OOM autour de 2 Go,
pas une assertion métier. `--runInBand` retenait toutes les applications Nest et
graphes TypeScript. La suite reste séquentielle (`maxWorkers=1`), mais utilise
maintenant un enfant recyclable à 768 Mo entre suites; plafond V8 CI 3 Go.
Ce n’est ni une exclusion de tests ni un masquage d’échec.

Le double `AgentRuntimeService` des tests de connexion expose désormais
`installedForTenant`, comme le service réel. Les contrôles de chiffrement et
d’isolation sont conservés. La passe HTTP complète locale termine sans OOM;
la suite APS autonome locale reste en échec (`dbReady=false`, erreurs 500 des
solveurs). Ne pas la confondre avec les tests verts du bridge privé de fabrication.

Recette locale : tests runner de capacité/configuration/OAuth; vrais quatre
processus ACP avec sessions/modèles distincts et reprise historique dans
`parallel-smoke.mjs`, conteneur read-only, UID1000, réseau none, 2 Go/2 CPU.
Tests Chromium synthétiques : sélection modèle/worker, concurrence, fermeture,
historique, erreur chargement, mobile et clavier. Aucun fournisseur payant, aucune
clé réelle ni écriture sur VPS. Les nombres finaux sont dans `docs/etat-du-projet.md`.
