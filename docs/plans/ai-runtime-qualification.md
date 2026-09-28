# IA A2a — qualification isolée de Hermes 0.21.5

Date : 28 septembre 2026. Branche : `codex/pilot-business-depth`.

## Verdict

**Mise à jour A2b / A3a :** [le contrat de résultats](./ai-turn-outcomes.md) corrige
l’écart fournisseur décrit historiquement ci-dessous. Neuf contrôles passent
désormais sur l’actif et le candidat. Promotion toujours bloquée sur la qualification
serveur et métier; les constats initiaux A2a restent conservés ci-dessous.

Le contrat local ACP passe avec le profil de qualification décrit ci-dessous.
**La promotion du candidat dans Pulsar reste bloquée** : un refus HTTP 400 du
fournisseur devient un texte d’assistant suivi d’une fin normale, sans événement
d’erreur typé. Ce signal ne doit pas servir à déclarer une mission worker réussie.
Les prochaines étapes sont la normalisation des résultats/erreurs et un packaging
Linux isolé, puis une recette métier autorisée. Ce n’est pas un benchmark de modèles.

Le runtime actif reste le fork Hermes **0.16.0**, commit `740ea2ff502e`.
Ni le sous-module, ni son venv, ni les homes OAuth/tenants ne sont remplacés.

## Provenance du candidat

- [Release officielle v2026.9.24 / 0.21.5](https://github.com/NousResearch/hermes-agent/releases/tag/v2026.9.24), revérifiée le 28 septembre.
- Commit exact : `f97608f178d1ffeca59860195ab7da295f7c8e5f`.
- Installation distincte dans un checkout temporaire avec `uv sync --frozen
--no-dev --extra acp --extra mcp`, Python 3.12.13.
- SHA-256 du `uv.lock` : `ab53c5f53cc354fe35d6bd4bd0e1322ffdcba17e895fc3bc3f471e4b1e8027f7`.
- Inventaire final testé : Python 3.12.13, ACP 0.9.0, MCP **2.0.0**, SQLite 3.50.4.
  SHA-256 de l’inventaire Python/SQLite/paquets triés du rapport :
  `4adf55babddd4c28199db588c1af3148aaffde1a83195e3efec86cf4729bdf53`.
  Ce dernier est propre à cette installation Windows, pas une signature universelle.

## Écarts constatés et profil nécessaire

1. **Changement de modèle.** Le candidat transporte explicitement les toolsets de
   l’agent vivant vers sa reconstruction; le défaut corrigé dans notre fork ne
   justifie plus à lui seul de conserver l’ancien code. Recette MCP réelle réussie.
2. **Découpage ACP.** L’alias de sélection d’outils existe aussi dans `commands.py`.
   Le banc vérifie son identité avec la frontière Pulsar, ainsi que `session`/`server`.
3. **Recherche d’outils.** La configuration par défaut remplace les outils MCP par
   un intermédiaire `tool_search`/`tool_describe`/`tool_call`. Le profil testé fixe
   `tools.tool_search.enabled: "off"` pour conserver une surface directe vérifiable.
   Ce constat ne prouve pas une fuite de permissions dans l’intermédiaire upstream.
4. **Installations dynamiques.** Une première exploration a installé des dépendances
   optionnelles Bedrock/Vertex dans le venv candidat au démarrage. Ce venv a été
   resynchronisé hors ligne au lock; le scénario final impose
   `security.allow_lazy_installs: false` et `HERMES_DISABLE_LAZY_INSTALLS=1`.
   L’inventaire avant/après est identique. Aucun venv actif Pulsar n’a été touché.
5. **Appels auxiliaires.** La génération automatique de titre peut appeler un modèle
   même après la fin du tour. Le profil teste `auxiliary.title_generation.enabled:
false`, désactive compression/mémoire, et n’utilise que des réponses synthétiques.
   Une future activation exige une comptabilisation des appels auxiliaires.
6. **Contexte local.** Le candidat refuse un modèle annoncé sous 64 000 tokens.
   La fixture annonce 128 000 uniquement pour le test; ne jamais gonfler la capacité
   d’un modèle réel pour contourner ce contrôle.
7. **SQLite.** Le candidat signale la version embarquée et choisit le journal DELETE
   plutôt que WAL. Aucune réparation de l’interpréteur actif n’a été faite; qualifier
   explicitement la version SQLite du futur conteneur et ses reprises.

Sources techniques : checkout exact, notamment
[sessions ACP](https://github.com/NousResearch/hermes-agent/blob/f97608f178d1ffeca59860195ab7da295f7c8e5f/acp_adapter/session.py),
[serveur ACP](https://github.com/NousResearch/hermes-agent/blob/f97608f178d1ffeca59860195ab7da295f7c8e5f/acp_adapter/server.py),
[dépendances dynamiques](https://github.com/NousResearch/hermes-agent/blob/f97608f178d1ffeca59860195ab7da295f7c8e5f/tools/lazy_deps.py).

## Corrections livrées côté Pulsar

- La reprise utilise maintenant **`session/load`**, pas `session/resume` : ce dernier
  crée une session inconnue sans renvoyer son nouvel identifiant dans ACP 0.9.0.
- Le wrapper Pulsar transforme un retour `None` de `load_session` en erreur RPC.
  Sans lui, le routeur sérialise ce retour en `{}`, fausse apparence de réussite.
  Aucun historique fictif ni remplacement silencieux d’une conversation/persona.
- Une fin normale du transport mémorise l’erreur de fermeture : les appels suivants
  échouent immédiatement. Un échec d’écriture synchrone libère la requête en attente.
- `cancel()` émet la notification ACP correcte. Elle ne garantit pas un arrêt dur;
  le propriétaire conserve la responsabilité de tuer le processus au timeout.
  Aucun nouveau bouton, endpoint, pouvoir métier ou changement d’autonomie.

## Recette réellement exécutée

`scripts/qualify-agent-runtime.mjs` emploie le **vrai client TypeScript Pulsar**, le
**vrai candidat Hermes et son AIAgent**, et deux services localhost simulant LLM/MCP.
Deux homes temporaires, credentials factices et processus distincts. Le point
d’entrée Python de fixture bloque DNS/connexions externes au niveau Python : défense
de test, **pas un sandbox OS**. Aucun appel à un fournisseur réel ou dossier existant.

Huit contrôles réussis : initialize/protocole, new + set_model, aller-retour outil,
reprise avec historique après redémarrage, historique étranger refusé + outil du bon
home, annulation en plein flux, transport fermé, dépendances/sources inchangées.
Le test du refus fournisseur révèle séparément la limite d’erreur typée ci-dessus.
Le rapport affiche donc `scope=OFFLINE_CONTRACT_ONLY`, `productionPromotion=BLOCKED`.
Un code de sortie 0 signifie que ce contrat connu est reproduit, **pas** une promotion.

Le endpoint MCP de fixture ne teste pas les gates HTTP/permissions/approbations
de l’API Pulsar. Les tests métier existants restent nécessaires; aucune preuve
d’isolation OS hostile, de qualité LLM, de performance ou de déploiement OVH.

Vérifications complémentaires : **748 tests API / 104 suites**, **8 tests Python**
de frontière sur le fork actif, **33 tests Web aide/tutoriels**, build et typecheck
API réussis. Handshake du runtime actif via son wrapper réussi sans clé ni prompt.
Aucun changement UI fonctionnel dans ce lot; la documentation intégrée explique
la reprise stricte.

## Reproduire

Depuis Pulsar, après création d’un checkout candidat neuf au commit ci-dessus et
de son venv séparé (ne jamais cibler `hermes-agent/.venv`) :

```powershell
$Candidate = Join-Path $env:TEMP 'pulsar-hermes-qualification-20260928'
$env:UV_PROJECT_ENVIRONMENT = Join-Path $Candidate '.venv'
uv sync --project $Candidate --frozen --no-dev --extra acp --extra mcp --python 3.12.13
pnpm --filter @pulsar/api build
pnpm agents:qualify $Candidate
```

Le script refuse un autre commit ou des sources suivies modifiées; il conserve les
diagnostics dans un nouveau répertoire temporaire annoncé en sortie. La fixture
contourne **uniquement dans ce test** le refus de version du wrapper de production.
Elle n’est référencée par aucun chemin API. Le wrapper de production refuse toujours
une distribution différente de 0.16.0. Aucun `hermes update` automatique.

## Suite prioritaire

1. **A2b/A3a livré** : résultats typés jusqu’au worker/chat et timeout de tour;
   [contrat et preuves](./ai-turn-outcomes.md). Adaptateur interchangeable complet restant.
2. Profil runtime serveur figé, plugins/appels auxiliaires explicitement choisis,
   image Linux non privilégiée, réseau/filesystem restreints et rollback qualifié.
3. Recette métier autorisée et budgétée sur dossier, MRP et intervention avant de
   comparer les modèles ou de promouvoir l’autonomie. C3b reste dans la roadmap.
