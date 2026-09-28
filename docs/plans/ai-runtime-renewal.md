# IA — diagnostic et durcissement A1

Suites du 28 septembre : [qualification isolée A2a](./ai-runtime-qualification.md),
puis [résultats fiables A2b / A3a](./ai-turn-outcomes.md). L’écart d’erreur fournisseur
est corrigé; qualification serveur/métier et adaptateur complet restent à faire.
Le moteur actif reste 0.16.0; le candidat n’est pas promu.

Date : 27–28 septembre 2026. Branche : `codex/pilot-business-depth`.

## Décision

Conserver provisoirement Hermes comme moteur d’exécution, sans lui confier les
droits, les statuts métier, les approbations ou les calculs déterministes. Ne pas
confondre fournisseur/modèle, moteur de conversation et gouvernance Pulsar.
Un changement de moteur sera décidé sur des missions mesurées, pas sur sa popularité.

## État réellement constaté

- Sous-module : fork `SamChampagne/hermes-agent`, commit
  `740ea2ff502ebce5365f565b4b9973ae958c6541`, daté du 22 juin 2026.
- Source et distribution installée : Hermes **0.16.0**; Python **3.12.13**,
  `agent-client-protocol` **0.9.0**, MCP **1.26.0** sur ce poste.
- Le fork contient un correctif de reconstruction de la surface MCP après changement
  de modèle. Un simple remplacement par upstream pourrait casser ce contrat.
- Version officielle repérée le 27 septembre : **0.21.5**, publication stable du
  24 septembre. [Publication officielle](https://github.com/NousResearch/hermes-agent/releases/tag/v2026.9.24).
  C’est une observation datée, pas un contrôle en direct ni une qualification Pulsar.
- La commande d’installation installe un editable avec dépendances; elle n’est pas
  à elle seule la preuve d’un déploiement reproductible ou d’un runtime sain.

## Choix de moteurs — analyse, pas nouvelles dépendances

| Option                                     | Intérêt pour Pulsar                                                                                        | Décision à ce stade                                                                           |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Hermes actuel / version stable à qualifier | Intégration ACP, reprise de conversation et fournisseurs déjà branchés                                     | Garder temporairement; qualifier une version stable séparément                                |
| OpenAI Agents SDK                          | Boucle/outils/sessions contrôlés dans notre application; rapprochement possible avec le backend TypeScript | Candidat pour un adaptateur, pas remplacement automatique de la gouvernance                   |
| Claude Agent SDK                           | Harness agent et outillage existant, utile pour les tâches complexes                                       | Candidat; restreindre strictement les outils de code/système et mesurer son adéquation métier |
| LangGraph                                  | Checkpoints, reprise et workflows humains durables                                                         | Pertinent si l’orchestration longue le nécessite; risque de doubler notre worker et ses états |

Sources primaires consultées : [OpenAI SDK](https://developers.openai.com/api/docs/guides/agents/sdk),
[Claude SDK](https://code.claude.com/docs/en/agent-sdk/overview),
[LangGraph persistence](https://docs.langchain.com/oss/python/langgraph/persistence).
Les appréciations ci-dessus sont des choix d’architecture Pulsar, pas un benchmark.
Aucun de ces nouveaux moteurs n’est installé ou exécuté par ce lot.

## Correctifs A1

1. **Frontière d’outils.** L’API lance `scripts/pulsar-hermes-acp.py` en mode Python
   isolé. Le wrapper détenu par Pulsar limite la sélection à un groupe vide explicite
   et au serveur `pulsar`. Même sélection après reconstruction / changement de modèle.
   Les outils Hermes terminal, fichiers, navigateur, mémoire et délégation ne sont
   pas proposés. Les outils métier existants restent ceux du registre MCP et passent
   par `ProposedActionsService` selon leurs tiers; aucun nouveau pouvoir métier.
   Une version Hermes différente de 0.16.0 exige la requalification de ce wrapper.
2. **Permissions ACP.** Toute demande de privilège hôte est refusée (`reject_once`),
   ou annulée si aucune option de refus n’existe. Une approbation métier Pulsar ne
   vaut jamais permission terminal/fichiers. Protocole ACP autre que 1 : refus.
3. **Environnement.** Liste fermée de variables OS, seulement la clé du fournisseur
   du tenant. Aucun héritage DB/JWT/SMTP/autres clés fournisseur. HOME/USERPROFILE et
   dossiers de configuration pointent dans le home tenant. Le workspace ACP n’est
   plus celui du dépôt/API. Le wrapper empêche le chargement implicite des `.env`
   par l’entrée ACP et `run_agent`.
4. **Configuration.** Changer fournisseur, mode d’authentification ou URL efface
   ancienne clé, login et contrôle/cache modèles; une clé explicitement remplacée
   est chiffrée. Une modification de modèle ou de clé invalide le contrôle.
   Lecture/préservation/écriture sérialisées par verrou tenant. URL HTTP(S) seulement,
   sans identifiants, query ni fragment, pour les providers compatibles explicites.
5. **Exactitude du contrôle.** `POST /agent-runtime/test` renvoie
   `scope=RUNTIME_ONLY`. Ouverture ACP et catalogue proposé, aucun prompt. Ce n’est
   PAS une validation de clé, de disponibilité facturable ou de réponse métier.
   Le résultat tardif d’un test/login ne valide pas une autre version de config.
   Erreur du modèle choisi : arrêt, jamais repli silencieux. Un enfant mort est
   retiré du registre des sessions vivantes pour permettre la reprise.
6. **Diagnostic.** `GET /agent-runtime/health`, `core.agents.manage`, métadonnées
   locales uniquement. Versions source/installée/Python/ACP/MCP, commit et état des
   sources suivies; inconnus explicites si Python/Git échoue. Commandes sans shell,
   timeout 5 s, sortie 32 KiB, cache/coalescence 30 s. Aucun home tenant, secret,
   chemin local, stderr, réseau GitHub ou LLM dans la projection.

## Interface, documentation et limites

Réglages → Runtime agents ouvre désormais **Connexion IA** : inventaire, fournisseur,
authentification, modèle puis contrôle. Le bouton de contrôle/login est désactivé
tant que le formulaire diffère de la configuration enregistrée. Les modèles sont
des objets value/label correctement rendus. Le statut d’installation reste conservé
après sauvegarde. Rendu adaptatif dans les composants existants Pulsar.
Documentation intégrée et parcours Agents expliquent ces distinctions; aucune
réinitialisation des tutoriels et aucun bouton de tutoriel ajouté.

Le wrapper est un adaptateur de compatibilité utilisant les points d’intégration du
fork, **pas un sandbox OS**. La bibliothèque reste du code de confiance exécuté sous
l’utilisateur serveur. Un déploiement entreprise exige un processus/conteneur non
privilégié, réseau limité, filesystem restreint et isolation adaptée entre tenants.
Les sessions déjà en cours conservent leur configuration; suspendre les agents puis
redémarrer l’API pour appliquer ce lot à toutes les sessions. Les homes OAuth ne sont
ni supprimés ni migrés. Le contrôle d’URL ne constitue pas un pare-feu anti-SSRF.

Le runtime n’est pas mis à jour ici. Aucune nouvelle installation, migration BD,
clé fournisseur, mission payante, autonomie, permission métier ou envoi sortant.
Ce lot améliore la fiabilité et la visibilité; il ne prouve pas une amélioration
quantifiée des réponses IA. Le worker conserve ses limites de file en mémoire.

## Suite ordonnée

1. **A2 — qualification de version stable** dans un environnement isolé : comparer
   le fork à la release choisie, préserver le correctif MCP, figer dépendances,
   tester initialize/new/set_model/resume/prompt/cancel, erreurs et sessions tenant.
   Aucun `hermes update` automatique depuis un compte entreprise.
2. **A3 — adaptateur de moteur** derrière une interface Pulsar (open/resume/turn/cancel,
   outils gouvernés, usage normalisé). Ne déplacer ni permissions ni approbations
   dans un fournisseur; Hermes reste un premier adaptateur, pas le cœur métier.
3. **A4 — recette IA métier**, autorisation/budget avant appels réels : résumé de
   dossier en lecture; revue MRP avec preuves; proposition de prochaine intervention.
   Jeux attendus incluant accès interdit, module inactif, données incomplètes et
   injection dans un document. Mesurer exactitude, outils autorisés, coût, latence,
   interruptions/reprise et validations humaines. Le 100 % des tests simulés ne
   remplace pas cette recette.
4. **A5 — exploitation** : tokens/coûts LLM distincts des plafonds métier, budgets
   tenant/agent/mission, contexte sourcé, worker durable, alertes et kill switch.
   Promotion de l’autonomie uniquement après preuves et confirmation humaine.
5. Reprendre **C3b** : réponses SMS/courriel explicitement rattachées aux dossiers,
   sans modifier consentement/STOP, ni état métier, ni automatisation implicite.

## Vérifications

Tests API de frontière d’environnement, protocole/refus ACP, versions, config et
modèle explicite; tests Python contre le registre du fork installé; recette HTTP
sur tenants isolés et UI Chromium bureau/mobile. Résultats effectivement exécutés
consignés dans `docs/etat-du-projet.md` à la fin du lot. Aucun résultat LLM réel revendiqué.
