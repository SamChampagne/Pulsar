# Connexion IA — fiabilité du flux OAuth sur VPS

## Diagnostic et périmètre

Le runtime qualifié reste Hermes 0.16.0. La connexion `openai-codex` existante
appelle `auth add openai-codex` via le wrapper Pulsar, puis le flux device-code
du runtime. Aucun Codex CLI supplémentaire n'est installé au moment du login.

Défaut identifié dans le lanceur : Python est démarré avec `-I` (mode isolé),
qui ignore les variables `PYTHONUNBUFFERED` et `PYTHONUTF8`. Comme stdout est
un pipe, les `print()` du code de connexion peuvent rester bufferisés pendant
que le fournisseur attend l'autorisation. L'interface ne reçoit alors pas le
code dont l'utilisateur a besoin pour terminer le login.

Correctif : flags explicites `-I -u -X utf8` pour le processus de connexion,
local comme distant. Le mode isolé reste actif. Le chemin local utilise aussi
le wrapper verrouillé et le répertoire de travail de l'entreprise; aucune
recherche du fichier `.env` du dépôt par la CLI. Ni runtime vendored, ni
protocole OAuth, ni restrictions MCP/egress ne sont modifiés.

Observation locale hors réseau, avec le Python déjà provisionné : `-I` donne
`ignore_environment=1`, `stdout.write_through=False`, encodage `cp1252` sur ce
poste Windows; `-I -u -X utf8` donne `1`, `True`, `utf-8`. Cela prouve le
défaut de transport, pas la disponibilité du fournisseur sur le VPS déployé.

## Contrat partagé entreprise / plateforme

Les autorisations sont inchangées : `core.agents.manage` côté entreprise;
opérateur plateforme actif et `authorizeRuntimeAction` avant de commencer
le flux côté plateforme. La configuration et le runner restent tenant-scopés.

Le helper `login-sse.ts` sert les deux contrôleurs :

- `status` : `STARTING`, `WAITING_AUTHORIZATION`, `VERIFYING`, avec texte sûr;
- `text` : sortie de login UTF-8, sans attendre un retour à la ligne;
- `error` : code classifié et message; terminal, aucun succès après erreur;
- `end` : seulement après sortie réussie et CAS de la version de configuration;
- commentaire heartbeat toutes les 15 secondes, pas une preuve de progression;
- en-têtes `no-store, no-transform` et `X-Accel-Buffering: no`;
- fin de flux sans terminal explicite : erreur, jamais connexion supposée réussie.

`WAITING_AUTHORIZATION` indique des instructions reçues, pas une validation
du code. `VERIFYING` signifie vérification/enregistrement de la configuration,
pas un appel au modèle. `end` ne prouve ni quota disponible, ni accès au modèle,
ni réussite d'inférence. Les sorties ne sont pas écrites dans les logs/audits.

## Bornes et reprise

L'API limite la session complète à 9 minutes; le lecteur de processus a aussi
sa propre borne de 9 minutes. Le runner conserve son arrêt de sécurité à
10 minutes. Le navigateur impose 15 secondes avant en-têtes, 45 secondes sans
activité et 10 minutes au total. Les deux proxy Nginx fournis désactivent déjà
le buffering; aucune modification du proxy installé sur le VPS n'a été faite.

Sortie bornée à 64 KiB en octets; UTF-8 fragmenté préservé; erreurs de protocole,
arrêt, dépassement, timeout et processus distinguées. Un login par entreprise
dans l'API; le runner conserve son exclusivité OAuth et sa limite de sessions.
Pas de retry automatique, ni réutilisation transparente d'un code expiré.

Fermer/annuler la connexion interrompt le transport et le processus; SIGKILL
est prévu après le délai de grâce SIGTERM. L'arrêt de l'API interrompt aussi
ses logins en cours. L'annulation ne supprime pas de jeton déjà enregistré par
le fournisseur. Si elle coïncide avec l'enregistrement final en BD, actualiser
l'état avant de recommencer : absence de réponse ne signifie pas absence
d'effet. Une configuration changée pendant le login refuse le CAS et n'émet
pas `end`.

Une déconnexion pendant l’autorisation plateforme préalable ne lance aucun
processus en arrière-plan : le helper vérifie aussi la réponse déjà fermée.
L’interface assemble exactement les fragments texte, sans ajouter de retours
à la ligne susceptibles de casser le code ou l’URL. Après confirmation, elle
recontrôle fournisseur, URL et modèle par rapport au contexte de départ :
une configuration modifiée ailleurs demande une actualisation, pas un succès
attribué au mauvais compte.

## Validation et prochaine recette

Tests offline : processus doublés et serveurs HTTP locaux uniquement. Couvrir
prompt partiel et UTF-8, flags Python, refus/EOF/protocole, bornes, annulation
avant les en-têtes et pendant l'attente, version devenue obsolète, exclusivité,
arrêt API, JWT plateforme et parité des deux flux SSE. Aucun OAuth réel, jeton,
appel LLM, déploiement ou modification de paramètres serveur pendant ces tests.

Après publication, il faut reconstruire et déployer **API + web + runner** :
mettre à jour seulement le frontend ne corrige pas stdout bufferisé du runner.
La recette réelle reste à faire par l'utilisateur sur l'entreprise de test :
diagnostic runner, apparition immédiate du code, autorisation dans son propre
navigateur, état connecté, puis test runtime distinct d'une inférence explicite.

Pour un environnement distant/headless, OpenAI documente la connexion par
code, avec activation éventuelle dans les paramètres de sécurité ChatGPT ou
par l'administrateur du workspace : [authentification Codex officielle](https://learn.chatgpt.com/docs/auth).
Cette option doit être vérifiée par le titulaire du compte; Pulsar ne contourne
pas les politiques du compte ni la liste des domaines egress autorisés.
