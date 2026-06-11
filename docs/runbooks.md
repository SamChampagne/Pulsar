# Runbooks — opérations Pulsar

## Rotation de JWT_SECRET

Effet : tous les access tokens en circulation deviennent invalides immédiatement ;
les refresh tokens (opaques, hashés en base) restent valides — les clients web se
re-authentifient de façon transparente au prochain refresh.

1. Générer le nouveau secret : `openssl rand -base64 48`.
2. Mettre à jour `JWT_SECRET` dans l'environnement de l'API.
3. Redémarrer l'API (toutes les instances en même temps si plusieurs).
4. Vérifier : un login fonctionne ; un vieux token Bearer est rejeté en 401 puis
   rafraîchi automatiquement par le client web.

À rotationner immédiatement si : fuite suspectée, départ d'une personne ayant eu
accès à l'environnement de production.

## Rotation de ENCRYPTION_KEY (secrets au repos)

Les secrets chiffrés (Integration.config, OIDC clientSecret) portent le préfixe
`enc:v1:`. La rotation est un rechiffrement en place via le script dédié.

1. Générer la nouvelle clé :
   `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`.
2. Arrêter les écritures de configs (fenêtre courte ; les lectures continuent).
3. Lancer :
   `ENCRYPTION_KEY=<nouvelle> ENCRYPTION_KEY_OLD=<ancienne> pnpm --filter @pulsar/api reencrypt-secrets`
4. Mettre à jour `ENCRYPTION_KEY` dans l'environnement de l'API ; supprimer
   `ENCRYPTION_KEY_OLD`.
5. Redémarrer l'API.
6. Vérifier : la page Integrations s'affiche (déchiffrement OK), un webhook part
   signé (le secret est lisible).

⚠️ **Fenêtre d'indisponibilité partielle** : entre l'étape 3 (les lignes sont
rechiffrées avec la nouvelle clé) et l'étape 5 (l'API redémarre avec la nouvelle
clé), l'API en marche ne peut plus déchiffrer les configs — les webhooks et
lectures d'intégrations sont en erreur pendant ces minutes. Faire la rotation en
fenêtre de maintenance courte ; ces erreurs sont attendues, ce n'est pas un
incident (l'outbox rejouera les webhooks en échec).

Le script est idempotent : interrompu puis relancé avec les mêmes clés, il saute
les lignes déjà rechiffrées. Il refuse une rotation où ancienne et nouvelle clés
sont identiques.

Premier passage (chiffrement initial des lignes encore en clair) : même commande
sans `ENCRYPTION_KEY_OLD`.

## Backup / restore PostgreSQL

Sauvegarde quotidienne minimale :

    pg_dump --format=custom --no-owner "$DATABASE_URL" > pulsar-$(date +%F).dump

Restauration :

    createdb pulsar_restore
    pg_restore --no-owner --dbname=pulsar_restore pulsar-YYYY-MM-DD.dump

Points d'attention :
- La base contient des secrets chiffrés : **sans l'ENCRYPTION_KEY correspondante,
  un dump restauré a des configs illisibles.** Sauvegarder la clé séparément
  (gestionnaire de secrets), jamais dans le même stockage que les dumps.
- Le stockage fichiers (POD, documents) est hors base : sauvegarder le bucket S3
  ou le répertoire `STORAGE_LOCAL_DIR` avec la même rétention.
- Tester la restauration au moins une fois par trimestre (monter `pulsar_restore`,
  lancer l'API dessus en local, vérifier login + une page de données).
