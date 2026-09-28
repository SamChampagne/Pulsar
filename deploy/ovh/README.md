# Pulsar — environnement de développement OVH

Cible : VPS Linux existant, Docker Compose v2, Nginx, domaine
`pulsar.intebec.ca`. Ce dossier **prépare** le déploiement ; il ne prouve ni un
déploiement distant, ni la résolution DNS, ni un certificat valide.

## Architecture et limites

Nginx hôte (TLS) → `127.0.0.1:8180` → web statique Nginx → API interne → PostgreSQL.
L'API et PostgreSQL n'ont aucun port publié. Projet Docker distinct `pulsar-dev`,
volumes séparés pour la base et les documents ; une seule instance API.

Images existantes du dépôt, sans Vite/HMR sur le VPS. Hermes et APS ne sont pas
embarqués : les agents conversationnels et le moteur de planification restent
indisponibles tant que leur runtime n'est pas provisionné et testé. Le cœur,
les dossiers et le cockpit ne doivent pas en dépendre. Courriels en mode `log`,
routage externe désactivé. Aucune donnée réelle pour cette première qualification.
Les logs du pilote email peuvent contenir des liens d'invitation : accès opérateur
uniquement, ne pas les partager ni les joindre à un ticket sans nettoyage.

L'image API utilise désormais l'utilisateur `node` (UID/GID 1000). Le profil OVH
monte sa racine en lecture seule, retire les capabilities Linux et interdit
l'élévation de privilèges; seuls le volume documents et `/tmp` sont inscriptibles.
Les outils de build restent inclus : réduction d'image encore à faire. Ce profil
de dev n'est pas une certification de production. Pour un volume déjà utilisé
par une ancienne image root, suivre la migration de permissions ci-dessous.

Le [banc IA Linux](../agents/README.md) est séparé et sans réseau externe : il
qualifie le contrat ACP, **ne fournit pas un service d'agents sur le VPS**.

Qualification locale du 2026-09-13 : images API/web construites ; script
`scripts/test-ovh-smoke.mjs` réussi (migrations, bootstrap idempotent, aucun tenant
démo, proxy/readiness, MFA imposé, redémarrage). Les tests qui exécutent réellement
APS nécessitent encore sa base et son runtime complet. Voir les résultats détaillés
dans [le plan de relance](../../docs/plans/control-center-workflows.md).

## 1. Pré-vol — à effectuer avec accès au VPS

Dans **Administration SaaS → Exploitation → Préparer le pilote**, choisir le profil
et l'option IA puis exporter le précontrôle daté. Il compare les scripts de migration
à l'historique de la base et indique les vérifications restantes, sans exécuter de
migration, envoyer de courriel ou appeler un LLM. Un précontrôle local ou un SHA
déclaré ne prouve ni la CI, ni le contenu de l'image, ni la recette du VPS. Refaire
ce contrôle après déploiement; conserver séparément les preuves terrain. Contrat :
[cinq priorités du pilote](../../docs/plans/pilot-next-stage.md).

- Confirmer la distribution, ressources libres et sauvegardes du serveur.
- Inspecter `docker ps`, `docker compose version`, `ss -lntp` et la configuration
  Nginx existante. Confirmer que 8180 est libre. Ne pas arrêter les autres services.
- **Si Nginx tourne dans Docker**, `127.0.0.1` désigne son propre conteneur : ce
  gabarit hôte ne convient pas. Définir un réseau partagé restreint après inspection,
  ne pas publier l'API ou PostgreSQL pour contourner le problème.
- Vérifier A/AAAA du domaine et l'émission/renouvellement TLS par la procédure déjà
  utilisée sur le serveur. Ne pas activer le gabarit TLS sans certificat existant.
- Réserver un dossier dédié, par exemple `/opt/pulsar-dev`, avec le dépôt à la
  révision de `main` approuvée après fusion de la PR. Ne jamais stocker une clé SSH dans Git.

## 2. Configuration et lancement (depuis la racine du dépôt)

Copier `deploy/ovh/env.example` vers `deploy/ovh/.env`, permissions `600`, renseigner
chaque valeur. Les secrets sont à générer sur le serveur et conserver dans un
gestionnaire de mots de passe. Le mot de passe PostgreSQL doit être hexadécimal
pour rester valide dans l'URL. Garder la clé de chiffrement pour toutes les mises
à jour et sauvegardes. Ne jamais publier la sortie complète de `compose config`.

```bash
# Fonction shell, valable uniquement pour ce terminal, sans exporter les secrets.
dc() { docker compose --env-file deploy/ovh/.env -f deploy/ovh/compose.yml "$@"; }
dc config --quiet
dc build api web
dc up -d db
dc run --rm migrate
dc run --rm bootstrap
dc up -d api web
dc ps
curl --fail http://127.0.0.1:8180/api/v1/health/ready
```

Exécuter les commandes séparément et **s'arrêter au premier échec**. Ne jamais
continuer un déploiement après une migration en erreur. `bootstrap-platform.ts`
ne crée que les catalogues et un opérateur ; aucun compte `admin123`, aucun tenant
de démonstration. Un compte existant (mot de passe, statut, MFA) est préservé.
**Ne pas exécuter `pnpm db:seed` ni `prisma/seed.ts` sur ce VPS.**

Installer un nouveau site Nginx à partir de `nginx.conf.example`, sans écraser
les autres sites. Tester `nginx -t` puis recharger par la méthode du serveur.
Conserver un accès restreint (IP/VPN) pendant le pilote. Ne pas ouvrir 8180 dans
le pare-feu : seule la boucle locale doit y accéder.

Ouvrir `https://pulsar.intebec.ca/platform/login`. Le profil impose le MFA plateforme :
enrôler l'authentificateur et sauvegarder les codes de récupération. Créer ensuite
l'entreprise pilote et ses modules depuis l'admin. Le pilote email `log` ne livre
pas les invitations : l'opérateur peut copier le lien d'invitation affiché par
l'admin, le transmettre de façon sûre, puis l'utilisateur choisit son mot de passe.

## 3. Recette d'acceptation

Pour le lot Services/RH/SAV et exploitation connectée du 22 septembre, suivre aussi
la [recette métier détaillée](../../docs/plans/connected-business-server-acceptance.md).

- HTTPS et renouvellement TLS vérifiés ; seuls les ports voulus sont accessibles.
- Readiness HTTP 200 ; console `/platform/operations` lisible. « Non configuré »
  ou « Non vérifié » sur Hermes, APS, email, sauvegardes est attendu ici.
- Connexion plateforme + MFA ; connexion utilisateur tenant distincte.
- Créer des données fictives : vente → transport → expédition → préparation →
  livraison → facture. Vérifier le dossier et les liens vers chaque objet.
- Vérifier un compte aux droits limités et une seconde entreprise : aucun
  élargissement de droits à travers les dossiers.
- Déposer/télécharger un document, redémarrer l'API, vérifier sa persistance.
- Tester une restauration sur une **base jetable séparée**, pas sur la base active.
- Après recette seulement, configurer SMTP/S3 ou les runtimes dans un lot séparé.

## 4. Sauvegarde, mise à jour et retour arrière

### Exercice local automatisé (projets jetables uniquement)

Le script `node scripts/test-ovh-smoke.mjs` vérifie le démarrage puis restaure une
copie dans un **second projet Docker isolé**. Prérequis : Docker et les images
`pulsar-api:control-center-test` / `pulsar-web:control-center-test`, construites à
partir du code à qualifier; le port local 8180 doit être libre.

Il arrête les writers de son premier projet, effectue un `pg_dump -Fc` et une
archive des documents, restaure les deux dans de nouveaux volumes, compare les
empreintes des migrations, le mot de passe opérateur et un fichier binaire témoin,
puis contrôle readiness et l'obligation MFA après restauration. Une mutation
dans la copie confirme qu'elle ne change pas la source. Les archives ne sortent
pas de la machine et ne sont pas imprimées. Les deux projets jetables sont nettoyés.

Ce test n'utilise **ni la base de développement ni les fichiers de l'utilisateur**.
Le fichier témoin vérifie le stockage, pas le parcours d'upload métier. Il ne
prouve pas une sauvegarde hors VPS, la restauration de clés perdues, un test de
charge ou le fonctionnement TLS/SMTP/APS/Hermes. Conserver ces points dans la
recette serveur. Ne pas adapter ce script en lui donnant le nom du projet actif.

### Procédure sur l'environnement réellement déployé

Avant toute mise à jour, arrêter les écritures de ce projet (`dc stop web api`),
faire un dump PostgreSQL et une copie des documents, des secrets et de la révision.
Les secrets doivent être sauvegardés chiffrés avec un accès limité.

```bash
umask 077
# Adapter le chemin vers un dossier de sauvegarde dédié déjà vérifié.
dc exec -T db pg_dump -U pulsar -d pulsar -Fc > /chemin/verifie/pulsar.dump
# Documents : archive en sortie standard, sauvegardée SUR L'HÔTE.
dc run --rm --no-deps -T --entrypoint tar api -C /app/storage -czf - . > /chemin/verifie/documents.tar.gz
```

Vérifier les codes de sortie et les tailles ; un fichier présent seul n'est pas
une preuve de sauvegarde. Copier hors VPS et tester `pg_restore` dans une nouvelle
base de recette isolée. Conserver la preuve datée. Redémarrer ensuite le projet.

Pour mettre à jour : vérifier la révision, changer `PULSAR_BUILD_VERSION`, construire
les images, sauvegarder, exécuter `migrate`, `bootstrap` (catalogues seulement à
nouveau), puis recréer `api web` et refaire la recette. Garder les anciennes images.
Le retour à une ancienne image n'annule PAS les migrations. Si incompatibilité de
schéma, arrêter les écritures et restaurer un jeu cohérent base + documents + clés
dans un environnement séparé avant bascule. Ne jamais exécuter `down -v` sur ce
projet : cela détruirait ses volumes.

### Première mise à jour depuis une image API root

Après sauvegarde avec l'ancienne image et arrêt de `web api`, vérifier que le
volume `documents` de **ce projet** est bien celui monté à `/app/storage`.
Ne jamais viser un dossier hôte calculé ni le volume d'une autre application.
Un volume neuf prend déjà le propriétaire 1000 : cette étape concerne l'existant.

Avec la nouvelle image construite et la fonction `dc` définie plus haut :

```bash
# Opération ponctuelle, explicitement privilégiée, sur le seul volume documents.
dc run --rm --no-deps -T --user 0 --cap-add CHOWN --cap-add DAC_OVERRIDE --entrypoint chown api -R 1000:1000 /app/storage
# Puis contrôle sans privilèges, avant de redémarrer l'API.
dc run --rm --no-deps -T --entrypoint node api -e 'const fs=require("node:fs"); fs.accessSync("/app/storage",fs.constants.R_OK|fs.constants.W_OK); console.log("documents: accessible")'
```

Arrêter au premier échec. Ne pas ajouter `privileged`, ne pas lancer l'API en root
et ne pas faire de `chmod 777` pour contourner une erreur. Les capacités ajoutées
ne concernent que ce conteneur ponctuel de migration, jamais le service API.
Vérifier ensuite dépôt/téléchargement d'un document et redémarrage. Restaurer les
archives avec leurs permissions dans un environnement séparé en cas de retour arrière.

## À confirmer avant le vrai déploiement

Accès SSH configuré localement (pas de clé privée dans le chat), emplacement du
checkout, Nginx hôte ou conteneur, DNS/TLS, méthode de restriction du pilote,
destination des sauvegardes et créneau de déploiement. Aucune de ces opérations
distantes n'est exécutée par la préparation locale.

## Connexions externes pendant le pilote

`EMAIL_DRIVER=log` ne désactive pas un SMTP **tenant** déjà configuré : celui-ci
peut envoyer réellement. Les nouveaux panneaux de dossier utilisent leur SMTP
tenant ou une simulation, sans repli plateforme. Vérifier les connexions dans
Pulsar avant tout essai; SMS réel et réception IMAP ont leurs confirmations propres.
Ne pas restaurer des données de production avec leurs connexions actives dans un
environnement de recette connecté à Internet.

Les envois webhook/EDI et les pings réels revalident la destination à chaque
tentative : DNS A/AAAA vérifiés, adresse du socket épinglée, pas de redirection,
délai total de cinq secondes. Renseigner l'URL finale publique; les plages privées,
réservées et les mécanismes de transition IPv6 ne sont pas pris en charge.
`WEBHOOK_ALLOW_PRIVATE_URLS=true` est exclusivement un réglage dev/tests; le
démarrage en production le refuse et le transport ne l'honore pas en production.

Désactiver une connexion suspend les lignes en attente sans effacer l'historique;
un envoi déjà en vol peut finir. La réactivation reprend les lignes conservées et
revérifie les droits d'écriture de la cible entrante. Évaluer le stock d'événements
avant de réactiver. Le destinataire doit dédupliquer `X-Pulsar-Delivery` : une
réponse perdue peut provoquer un renvoi. Le test ne promet pas d'exactly-once.

La protection applicative complète, sans le remplacer, un filtrage réseau sortant
du VPS. Références : [OWASP SSRF](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html),
[client HTTP Node](https://nodejs.org/docs/latest-v22.x/api/http.html) et
[plages IPv6 spéciales IANA](https://www.iana.org/assignments/iana-ipv6-special-registry/iana-ipv6-special-registry.xhtml).
