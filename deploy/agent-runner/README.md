# Runner IA de production — première entreprise

Ce profil remplace l’installation manuelle de Hermes **dans l’API**. L’API reste
sans Python/Hermes, non-root et en lecture seule. Le runner est une image séparée,
liée à **un ID d’entreprise**, avec son volume OAuth/historique. Aucun socket Docker.
`deploy/agents` reste exclusivement le banc de qualification hors ligne.

## Ce qui se configure où

| Une fois, administrateur du déploiement                                                         | Ensuite, dans Pulsar → Réglages → Connexion IA                            |
| ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Image, ID tenant, routage privé, secret interservices, volume et destinations réseau autorisées | Fournisseur, clé chiffrée ou connexion OAuth, modèle, contrôle du runtime |

Une entreprise sans runner ne peut pas utiliser celui d’une autre. Aucun repli
vers un moteur local en mode `remote`. Les autres modules restent disponibles si
le runner tombe. La création automatique de runners lors de l’onboarding n’est
**pas** incluse : ce profil sert un premier tenant/pilote, puis doit être dupliqué
avec noms, réseaux, volumes et secrets **distincts** pour les suivants.

## Préparer l’artefact (poste de build / CI autorisée)

Depuis un checkout du commit Pulsar testé, avec le sous-module privé accessible :

```sh
git submodule update --init --recursive
pnpm install --frozen-lockfile
pnpm agents:prepare-image
docker build -f deploy/agent-runner/Dockerfile --target runner -t pulsar-agent-runner:COMMIT .
docker build -f deploy/agent-runner/Dockerfile --target proxy -t pulsar-agent-egress:COMMIT .
```

Le précontrôle refuse un fork sale ou autre que `740ea2ff502e…`; seuls les fichiers
suivis/hashés sont copiés, jamais `.venv`, homes ou fichiers locaux non suivis.
Le Dockerfile vérifie ces hashes après installation. Python 3.12.13, uv et images
Node sont fixés; `uv sync --locked` refuse un lock périmé. Le candidat 0.21.5 n’est
pas promu. Le venv est construit dans l’image, jamais installé au démarrage.

Publier/transférer ces images par votre procédure existante, avec leurs digests.
L’API et le Web doivent aussi être reconstruits depuis **le même commit Pulsar**.
Ne pas lancer `pnpm agents:setup` dans le conteneur API.

## Provisionnement OVH — une fois

Ne pas coller de secrets dans une conversation. Conserver les fichiers hors dépôt.
Exemple Linux, répertoire `/etc/pulsar/agent-routing`, fichiers lisibles par UID 1000
(API et runner), non lisibles par les autres utilisateurs. Un opérateur autorisé
crée le dossier, copie `runners.example.json` en `runners.json`, remplace l’ID par
l’**ID de base de données** du tenant de test, pas son slug, et génère un secret
aléatoire de 32 octets encodé base64url dans `runner-token` (43 caractères minimum).
Permissions conseillées : dossier `0750`, fichiers `0640`, propriétaire/groupe
adaptés à UID/GID 1000. Ne jamais réutiliser JWT_SECRET ou une clé fournisseur.

Ajouter au fichier d’environnement protégé du déploiement :

```dotenv
PULSAR_AGENT_CONFIG_DIR=/etc/pulsar/agent-routing
PULSAR_AGENT_TENANT_ID=ID_REEL_DU_TENANT_TEST
# Exemple minimal OpenRouter; hostname exact, pas de wildcard ni IP/port.
PULSAR_AGENT_ALLOWED_HOSTS=openrouter.ai
```

Pour un autre fournisseur, autoriser seulement les hôtes HTTPS nécessaires au
runtime et à son authentification. Les destinations du catalogue actuel sont
lisibles dans le fork et doivent être qualifiées avec le fournisseur choisi;
un changement de domaine reste une décision d’infrastructure, pas une permission
accordée par un prompt. Les URL personnalisées privées/HTTP ne sont pas prises en
charge par ce profil. Garder le pare-feu et l’isolation Docker : les variables
proxy seules ne sont pas une frontière réseau.

Vérifier la fusion **sans afficher la configuration résolue contenant les secrets** :

```sh
docker compose --env-file /CHEMIN/ENV_PROTEGE -f deploy/ovh/compose.yml -f deploy/agent-runner/compose.yml config --quiet
```

Suivre d’abord les étapes sauvegarde/migration du [runbook OVH](../ovh/README.md).
Ne pas régénérer ENCRYPTION_KEY, ne pas appliquer le seed démo. Puis, avec le bon
PULSAR_BUILD_VERSION et les images disponibles :

```sh
docker compose --env-file /CHEMIN/ENV_PROTEGE -f deploy/ovh/compose.yml -f deploy/agent-runner/compose.yml up -d agent-egress agent-runner api web
```

Ne jamais publier les ports 3001/3128 ni les router dans Nginx. HTTP interservices
est réservé au réseau Docker privé **sur le même hôte**; utiliser un transport TLS
authentifié avant toute séparation sur plusieurs serveurs. Le montage du routage
dans l’API est read-only et ne contient aucune clé fournisseur.

## Parcours utilisateur et recette

1. Connecter l’entreprise de test, ouvrir **Connexion IA** : service joignable,
   Hermes 0.16.0 et référence reconnue. Non rattaché → fichier/ID/token; injoignable
   → conteneur, secret, DNS privé. Aucun endpoint ni secret n’est exposé dans l’UI.
2. Choisir fournisseur et modèle, enregistrer clé ou démarrer OAuth. Les textes
   du device-code restent dans le flux du navigateur; pas de journal serveur brut.
   Fermer la connexion annule le login; plafond 10 minutes. Ne pas partager le code.
3. **Vérifier le runtime** ouvre ACP sans prompt : cela ne certifie pas la clé ou
   les droits du compte fournisseur. Un service occupé doit être retesté après sa
   session; ne pas confondre disponibilité du runner et validation d’inférence.
4. Après autorisation de budget et de données seulement : une mission en lecture,
   puis une proposition gouvernée, contrôle de l’audit, pause/kill et reprise.
   Aucun appel fournisseur réel n’a été fait lors de la livraison de ce code.
5. Recréer le runner sans supprimer son volume; vérifier OAuth/historique. Tester
   aussi sa panne : cœur/API disponible, IA en échec explicite, pas de double action.

## Frontières et limites du premier palier

- Quatre processus par runner/tenant par défaut, un par conversation; login OAuth
  exclusif. `PULSAR_AGENT_MAX_CONCURRENT` règle le plafond opérateur de 1 à 8,
  à dimensionner avec la RAM/CPU/PID. Même génération de configuration tant que
  des enfants vivent; modification incompatible refusée jusqu’au repos. Concurrence
  supplémentaire refusée, jamais envoyée à un autre tenant. L’API ferme le processus
  distant après chaque tour; le suivant recharge strictement le même historique.
  Un processus abandonné expire après 5 min, durée absolue 1 h, tour Pulsar 120 s.
- Image UID 1000, racine read-only, capabilities supprimées, no-new-privileges,
  mémoire/CPU/PID bornés. Le volume est writable seulement pour cette entreprise.
  L’API garde permissions, caps, approbations et jetons MCP courts; aucun outil ajouté.
- Le réseau interne contient le runner, son proxy et l’API. Pas de réseau DB ni
  sortie directe. Le runner peut joindre l’API privée; le wrapper n’expose que son
  endpoint MCP gouverné. Ce n’est pas une VM ni une isolation face au noyau compromis.
- Proxy CONNECT : hôtes exacts, port 443, adresses IPv4 publiques uniquement,
  résolution vérifiée puis IP figée à la connexion. Aucun HTTP libre ni wildcard.
  Les destinations approuvées peuvent recevoir les données autorisées au modèle;
  ceci n’est pas un dispositif de prévention de fuite de contenu.
- Secrets de fournisseur en environnement du seul enfant, jamais dans argv/config.
  Jetons OAuth persistants dans un home distinct par identité fournisseur/URL.
  Changer cette identité invalide la connexion dans Pulsar. Les anciens homes ne
  sont pas effacés automatiquement; une rétention/révocation doit être décidée.
- Pas de provisioning automatique multi-tenant, file durable, migration de homes
  existants ou qualification d’OAuth réel. Pas de promesse de qualité/coût IA.

## Sauvegarde, rotation, rollback

Suspendre les agents et arrêter le runner avant une copie cohérente du volume.
Sauvegarder séparément volume, base, ENCRYPTION_KEY et routage/secret, chiffrés,
accès opérateur seulement. Les tokens OAuth sont des secrets. Tester restauration
sur un volume distinct avant toute mise à jour moteur. Ne jamais `down -v` en prod.
Pour tourner le secret interservices : arrêter le runner, remplacer le fichier
protégé partagé, redémarrer et contrôler le diagnostic. Ne pas afficher le secret.

Rollback : suspendre agents, conserver/sauvegarder volume et clés, redéployer les
digests API/Web/runner/proxy précédemment validés. Pas de migration BD dans ce lot.
En cas de résultat incertain, inspecter les actions proposées/exécutées avant toute
relance : une coupure ne défait pas les mutations déjà validées.

## Vérification hors ligne reproductible

`pnpm agents:test-runner` teste HTTP/auth/tenant/arrêt/OAuth synthétique et proxy.
`services/agent-runner/container-smoke.mjs` est monté en lecture seule **pour le test**
dans l’image, avec volume jetable, réseau `none` puis réseau Docker `--internal`.
Il ouvre le vrai ACP sans prompt et vérifie UID, read-only, absence de socket Docker,
absence de sortie directe, refus autre tenant, reprise inconnue et arrêt.
Un second conteneur en mode `--verify-persistence` vérifie le volume; ce test ne
prouve pas encore la validité d’un OAuth réel ni une reprise métier avec outils.

Références d’infrastructure : [réseau interne Compose](https://docs.docker.com/reference/compose-file/networks/#internal),
[synchronisation uv verrouillée](https://docs.astral.sh/uv/concepts/projects/sync/).
