# IA A2c.1 — qualification Linux et préparation serveur

Suite du 30 septembre : le [runner de production A2c.2](../../deploy/agent-runner/README.md)
est distinct de ce banc et branché sur l’API. Qualification Docker locale sans
fournisseur réel; déploiement OVH/OAuth/missions métier restent à valider.

Date : 28 septembre 2026. Suite de [A2b/A3a](ai-turn-outcomes.md).
Demande : préparer la suite puis une PR unique avant un déploiement par l'utilisateur.
Pas d'accès VPS, de clé réelle, d'envoi réel ou de promotion automatique de Hermes.

## Livré

1. Banc Docker Linux indépendant, non-root, sans réseau externe ni montage hôte,
   racine en lecture seule, ressources bornées. Versions de base figées, Python
   3.12.13 et lock du fork actif. Contrôle des sources avant/après.
2. Contrat réel ACP/moteur sous Linux avec fournisseur/MCP synthétiques. Même
   gouvernance Pulsar; aucun outil métier supplémentaire, aucun effet opérationnel.
3. API du profil OVH non-root, racine en lecture seule, sans capabilities ni
   élévation. `PULSAR_REPO_ROOT=/app` explicite. Volume documents inscriptible,
   compatibilité des anciens fichiers root préparée par une commande ponctuelle.
4. Guide de mise à jour/rollback : sauvegarde cohérente base + documents + clés,
   contrôle du volume, permissions, étapes séparées, arrêt au premier échec.

## Preuves locales

- Builds Docker API/Web réussis; aucune dépendance installée dans le runtime actif.
- Linux : **9 contrôles ACP**, plus utilisateur non-root, réseau externe absent,
  racine non inscriptible, `NoNewPrivs=1`, `CapEff=0`.
- Hermes 0.16.0 / ACP 0.9.0 / MCP 1.26.0 / Python 3.12.13; 8 requêtes LLM
  synthétiques, **0 appel fournisseur réel**. Sources/dépendances inchangées.
- Manifeste : 4 tests (altération, référence/format, traversée, fichier manquant).
- API : 768 tests / 105 suites; Shared : 1 127 / 132; Web : 237 / 37.
  Typecheck : réussi, Svelte 0 erreur et 12 avertissements antérieurs.
- Profil OVH jetable : migrations, bootstrap sans tenant démo, identifiants
  préservés, proxy/readiness, MFA obligatoire, redémarrage, sauvegarde binaire puis
  restauration dans des volumes distincts; empreintes et fichier témoin comparés.
  Ce contrôle de stockage ne remplace pas la recette métier upload/téléchargement.
- Migration d'un dossier et fichier root privés (0700/0600) vers UID/GID 1000,
  lecture et nouvelle écriture non-root, puis restauration : réussies sur fixtures.

La passe HTTP élargie est distincte : l'ancien test `aps-runtime.e2e-spec.ts`
exige une base APS autonome opérationnelle. Son contrôle `dbReady` et ses calculs
legacy ont échoué avec HTTP 500 sur l'environnement local; la planification Pulsar
et ses outils agent passent. Ce point ne doit pas être masqué ni assimilé à une
qualification APS complète. Le profil OVH n'embarque pas ce runtime.

La première exécution s'est interrompue avec Docker Desktop indisponible et un
worker Jest arrêté. La relance API en série puis les contrôles Docker séparés
passent; aucune erreur métier de cette exécution n'a été masquée.

## Restant — A2c n'est pas entièrement clos

- Runner réellement intégré à l'API, frontière OS par tenant/session, secrets et
  trafic sortant contrôlés, persistance et rotation des homes.
- Compatibilité du runtime complet en déploiement; l'image de test n'est pas un
  service IA et ne contient pas un moteur Prisma Debian utilisable par l'API.
- Répéter la qualification pour un candidat avant toute promotion, avec rollback
  de homes testés sur copies; fork actif et wrapper strict restent inchangés.
- Recette métier autorisée, plafonds de dépense, qualité/coût/latence sur missions.
- File durable et reprise après crash; pas de retry après résultat incertain.

Le VPS réel, sa topologie Nginx, DNS/TLS, sauvegarde hors site et livraison des
communications restent à qualifier. Une réussite Docker locale ne les certifie pas.

## Exploitation

[Instructions du banc](../../deploy/agents/README.md) ·
[Mise à jour OVH et volumes existants](../../deploy/ovh/README.md).
Ne jamais exécuter le seed démo sur le serveur ni régénérer `ENCRYPTION_KEY` lors
d'une mise à jour. `EMAIL_DRIVER=log` ne neutralise pas un SMTP tenant configuré.
