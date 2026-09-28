# IA A2b / A3a — résultats fiables jusqu’au chat et au worker

28 septembre 2026 · branche `codex/pilot-business-depth`.

## Livré et décision

L’écart A2a « erreur fournisseur rendue comme réponse réussie » est corrigé dans
la passerelle Pulsar. Aucun changement du sous-module actif **Hermes 0.16.0**
(`740ea2ff502e`) ou de son venv. Le candidat **0.21.5** (`f97608f178d1`) reste
dans un environnement temporaire; aucune promotion automatique.

Le contrat est testé avec les vrais moteurs et le client ACP Pulsar, mais des
fournisseurs et outils **synthétiques localhost**. Ce n’est ni un benchmark de
qualité, ni une preuve d’isolation OS, ni une recette OVH.

## Contrat et parcours

`AIAgent.run_conversation` → wrapper Pulsar → `_meta.pulsarTurn` → client ACP →
`AgentRuntimeService` → chat SSE / `AgentWorkerService`.

- Le contrat partagé v1 définit `succeeded`, `failed`, `cancelled` et des codes
  fermés. Aucun diagnostic brut, clé, URL fournisseur ou prix supposé dans ce contrat.
- La classification Python utilise `completed`, `failed`, `partial`, `error` et
  `interrupted` du moteur. Jamais de détection d’erreur dans le texte généré.
  « HTTP 400 » dans une explication normale ne transforme donc pas la réponse en échec.
- Métadonnées absentes/inconnues, résultat incomplet, arrêt inattendu ou transport
  fermé ⇒ échec explicite. Une fin RPC ou un événement `end` seul ne vaut pas succès.
- Une annulation ACP reste distincte d’un échec. Un tour bloqué est arrêté après
  **120 secondes** : notification d’annulation best-effort, retrait de la session et
  arrêt de son enfant. Ce plafond technique n’est pas encore configurable dans l’UI.
- Un second prompt simultané sur la même session est refusé par le client ACP.
  Cela n’est pas un verrou durable de conversation entre plusieurs instances API.

## Worker et effets métier

Le worker exige exactement un résultat réussi et aucun événement d’erreur avant
de terminer un run `SUCCEEDED`. Un échec devient `FAILED`, une annulation `KILLED`.
Les erreurs après le début d’un tour sont terminales : les outils ont pu agir avant
la coupure. La reprise immédiate des erreurs de connectivité **avant** le tour reste
bornée. Le cron et les événements ne relancent plus un couple agent/tâche dont le
dernier run est FAILED/KILLED. `Lancer maintenant` reste une décision humaine explicite.

Une tâche réellement claimée ne revient à OPEN que si elle est encore IN_PROGRESS,
via `releaseWorkerClaim`, state machine, CAS tenant-scopé et audit du service-user.
Une tâche résolue entre-temps ne se rouvre pas. La règle d’ownership du claim reste
dans le dispatcher; la file et les sémaphores restent en mémoire, pas distribués.

**Succès du moteur ≠ réussite de chaque opération métier.** Un outil peut refuser
une action et l’agent fournir une explication valide. Les approbations, caps, droits,
modules, transitions et traces métier restent dans les services Pulsar existants.
Aucun nouvel outil, permission, envoi réel ou pouvoir d’autonomie.

## Chat et compteurs

Le chat affiche un badge pour les réponses interrompues/non validées, conserve
la partie déjà reçue et invite à vérifier le journal avant de relancer. L’API
enregistre un marqueur explicite dans le message historique d’une réponse non
validée avant de signaler la fin. Un échec de persistance n’est pas annoncé réussi.
Il n’y a pas de migration ni d’invention d’états pour les anciens messages.

Les tokens reçus sont les **compteurs cumulatifs du processus moteur courant**,
pas la consommation du seul message, ni celle du tenant. Valeurs manquantes :
inconnues; pas zéro. Pas de prix, budget, delta par tour ou registre financier
ajouté. Les compteurs typés ne sont pas encore conservés dans un registre durable.
La génération auxiliaire de titres par modèle est désactivée dans le wrapper :
Pulsar possède déjà ses titres. Cela ne qualifie pas tous les autres appels auxiliaires.

## Recette reproductible

Après build Shared puis API :

```powershell
pnpm agents:qualify --installed-reference
pnpm agents:qualify "$env:TEMP\pulsar-hermes-qualification-20260928"
```

Le premier mode utilise l’interpréteur existant **en lecture**, des homes temporaires
et des credentials factices. Il n’installe rien. Le second exige le checkout exact
qualifié en [A2a](./ai-runtime-qualification.md). Ne jamais synchroniser les
dépendances candidates dans le venv actif.

Neuf contrôles réussis pour chacun : protocole, création/changement de modèle,
aller-retour outil après reconstruction, historique après redémarrage, homes/processus
séparés, HTTP 400 typé sans diagnostic brut, annulation, EOF, source/inventaire inchangés.
Huit requêtes LLM **locales factices** par scénario; zéro appel fournisseur réel.
Les endpoints MCP de fixture ne remplacent pas les tests de gouvernance de l’API.

Tests unitaires des résultats fermés, du bridge Python, du worker, du contrôleur de
chat, des délais et du lecteur SSE. Recette Chromium avec session et toutes API
simulées : réussite, erreur, annulation et rendu mobile. Résultats chiffrés et santé
locale dans [l’état du projet](../etat-du-projet.md).

## Ce qui reste avant promotion / A3 complet

1. **A2c serveur** : image Linux reproductible/non privilégiée, restrictions réseau
   et fichiers, séparation tenant, arrêt/reprise et rollback qualifiés.
2. **A3b adaptateur** : interface de moteur interchangeable complète; délais des
   phases new/load/set_model, annulation exposée au chat et verrou durable de tour.
   Les commandes internes CLI sans résultat AIAgent ne sont pas des missions validées.
3. **A4 métier** : jeux attendus dossier/MRP/intervention, accès interdits/injections,
   puis appels réels uniquement avec fournisseur, budget et données autorisés.
4. **A5 exploitation** : coûts et tokens par appel y compris auxiliaires, budgets,
   file durable, récupération des runs après crash API et alertes.

Ne pas annoncer « meilleur modèle », « prêt production » ou sandbox OS sur la base
de cette recette. Le bridge reste un adaptateur lié à des versions exactes, non une
API upstream universelle; tout upgrade doit repasser ces contrôles.
