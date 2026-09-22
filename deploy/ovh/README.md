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

Les images API existantes tournent encore en root et incluent les outils de build.
Leur réduction et le passage non-root sont une étape de durcissement séparée.
Ce profil de dev n'est pas une certification de production.

Qualification locale du 2026-09-13 : images API/web construites ; script
`scripts/test-ovh-smoke.mjs` réussi (migrations, bootstrap idempotent, aucun tenant
démo, proxy/readiness, MFA imposé, redémarrage). Les tests qui exécutent réellement
APS nécessitent encore sa base et son runtime complet. Voir les résultats détaillés
dans [le plan de relance](../../docs/plans/control-center-workflows.md).

## 1. Pré-vol — à effectuer avec accès au VPS

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

## À confirmer avant le vrai déploiement

Accès SSH configuré localement (pas de clé privée dans le chat), emplacement du
checkout, Nginx hôte ou conteneur, DNS/TLS, méthode de restriction du pilote,
destination des sauvegardes et créneau de déploiement. Aucune de ces opérations
distantes n'est exécutée par la préparation locale.
