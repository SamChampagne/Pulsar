# Qualification Linux du runtime IA — A2c.1

Ce dossier est un **banc de test hors ligne**, pas un service de production ni
un runtime que le profil OVH lance automatiquement. Il n'appelle aucun fournisseur
réel et n'utilise ni clé réelle, ni base Pulsar, ni dossier tenant de l'hôte.

## Exécuter depuis la racine du dépôt

Prérequis : Docker Linux, Node 22, checkout Hermes initialisé au commit
`740ea2ff502ebce5365f565b4b9973ae958c6541`, sources suivies propres.
L'image API doit être construite depuis la même révision Pulsar :

```bash
docker build -f apps/api/Dockerfile -t pulsar-api:control-center-test .
node --test scripts/runtime-source-manifest.test.mjs
node scripts/runtime-source-manifest.mjs
docker compose -f deploy/agents/compose.qualification.yml build
docker compose -f deploy/agents/compose.qualification.yml run --rm qualification
```

Exécuter séparément et arrêter au premier échec. Le build a besoin du réseau pour
les images et dépendances; **l'exécution n'a que la boucle locale** (`network_mode:
none`). Ne monter aucun fichier `.env`, secret, socket Docker ou volume de l'hôte.
La suppression du conteneur supprime ses diagnostics et homes temporaires.
Les logs ne contiennent que des fixtures synthétiques; conserver le rapport JSON.

## Contenu et contrôles

- Node Debian et uv épinglés par digest; Python 3.12.13 installé par uv.
- Dépendances Hermes synchronisées avec `uv sync --locked --no-dev --extra acp
  --extra mcp`. Aucune installation au démarrage; runtime actif Windows inchangé.
- Manifeste SHA-256 des 4 948 fichiers suivis du fork de référence, vérifié avant
  et après. Généré localement, ignoré par Git : il lie les octets du checkout au
  build, mais n'est **pas une attestation signée** de chaîne d'approvisionnement.
- Sources en lecture seule, utilisateur 1000, capabilities retirées,
  `no-new-privileges`, `/tmp` temporaire, limites mémoire/CPU/processus.
- Vrai moteur Hermes, vrai client ACP Pulsar; faux fournisseur et MCP uniquement
  en localhost. Initialisation, modèle, aller-retour outil, reprise, homes séparés,
  refus fournisseur typé, annulation, fermeture et inventaire inchangé.

La couche API compilée sert seulement à importer le client ACP JavaScript et le
filtre d'environnement. **Ne pas lancer l'API depuis cette image Debian** : elle
ne remplace pas son image Alpine ni son moteur Prisma généré pour musl.
Les wrappers de qualification ne sont jamais des points d'entrée du service API.

## Ce que cela ne valide pas

Pas de runner de production, de sandbox distincte par tenant, de secrets délégués
à durée courte, de filtrage sortant vers de vrais providers, de worker durable,
de budget/coût réel ou de qualité métier. Les deux homes du test restent dans un
même conteneur sans aucune donnée réelle; ce n'est pas une preuve d'isolation
entre clients hostiles. Le candidat Hermes 0.21.5 reste non promu.

Le [plan A2c](../../docs/plans/ai-linux-qualification.md) distingue ces travaux
restants de la qualification locale. Pour le cœur Pulsar et son rollback, suivre
le [guide OVH](../ovh/README.md); ne jamais remplacer un déploiement par ce banc.

Références : [uv dans Docker](https://docs.astral.sh/uv/guides/integration/docker/),
[synchronisation verrouillée](https://docs.astral.sh/uv/concepts/projects/sync/),
[services Docker Compose](https://docs.docker.com/reference/compose-file/services/).

## Runner de production

Pour déployer l’IA, utiliser [le profil dédié](../agent-runner/README.md).
Le présent répertoire reste un banc **hors ligne**, pas le service de production.
