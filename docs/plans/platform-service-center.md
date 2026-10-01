# Centre plateforme — services et connexions

Branche `codex/platform-service-center`, 1er octobre 2026.

## Parcours livré

Administration SaaS → **Services et connexions** (`/platform/services`). Le compte
plateforme est distinct d’un compte entreprise. Le lien existe aussi dans le tiroir
Diagnostic d’Exploitation. Aucun déploiement ou envoi réel fait par cette livraison.

- **Courriel plateforme** : conserver le serveur existant, imposer la simulation,
  ou enregistrer un SMTP dans Pulsar. Préréglages Brevo/OVH/SMTP personnalisé,
  expéditeur, réponse, port, TLS et secret masqué. Prise en compte aux prochains
  envois sans redémarrage de l’API.
- **Connexions entreprises** : choisir explicitement l’entreprise; observation
  authentifiée du runner, version et nombre de processus, fournisseur/modèle/clé
  ou login OAuth. Les chemins existants du runtime sont réutilisés. Un contrôle ACP
  ne prouve ni une inférence réelle, ni les droits/quota du modèle.
- **Courriel entreprise** : SMTP dédié ou héritage du transport plateforme. Le writer
  existant est réutilisé; aucune modification IMAP ni autorisation SMS implicite.
- **Mise en place serveur** : étapes et références de déploiement pour runners,
  APS, documents/sauvegardes. Aucun faux bouton d’installation/activation.
- **Journal** : 30 dernières interventions administratives, acteur réel, service
  et entreprise. Aucun contenu de courriel/chat, token OAuth ou secret.

## Priorité des transports et effet opérationnel

1. Transport explicitement capturé par le workflow (ou `null` : simulation figée).
2. SMTP entreprise actif, si le workflow le résout.
3. SMTP plateforme enregistré / simulation imposée dans l’admin.
4. Variables historiques `EMAIL_DRIVER`/`SMTP_*` si aucun réglage enregistré ou
   mode `ENVIRONMENT` choisi explicitement.

L’absence de ligne préserve le comportement existant. Aucun secret `.env` n’est
importé dans la BD ou affiché dans le formulaire. Une erreur de lecture/déchiffrement
ne déclenche jamais un repli silencieux vers un autre serveur.

Passer le transport global en simulation n’arrête **pas** les SMTP dédiés. Désactiver
un SMTP entreprise peut activer son repli réel plateforme. Les formulaires expliquent
cette portée et exigent une confirmation. Les files génériques préexistantes peuvent
utiliser le nouveau transport lors de leur prochaine tentative; aucun replay manuel
ou automatisme nouveau n’est ajouté.

Les envois de factures/avoirs conservent leur contrôle du canal figé : simulation
devenue SMTP ⇒ refus, jamais promotion silencieuse. Le transport est capturé une
fois avant l’envoi, y compris une simulation `null`; le workflow garde ses contrôles
PDF et son traitement des réponses incertaines. Les communications de dossier
continuent d’exiger leur propre SMTP tenant et leurs consentements existants.

## Vérifier sans envoyer

Le bouton SMTP contacte explicitement le serveur, exige TLS et vérifie les
identifiants. Il n’appelle jamais `sendMail`, ne relève aucun message et ne certifie
ni la livraison, ni SPF/DKIM/DMARC. Début/fin du test sont audités séparément. Erreurs
fournisseur brutes masquées; délais réseau bornés. Un SMTP hérité renvoie vers le
contrôle global, pas un faux succès tenant. Le contrôle global mémorise son résultat
uniquement si sa version n’a pas changé.

## Garde-fous

- Endpoints `/platform/services/**` : `PlatformController` et compte plateforme
  actif recontrôlé à chaque requête. JWT tenant, portail et jeton MFA intermédiaire
  refusés. Pas d’usurpation d’un compte métier, pas de délégation d’outils agent.
- Configurations tenant : tenant sélectionné vérifié côté serveur; entreprise
  suspendue en lecture seule. Aucun endpoint/secret de runner fourni par le navigateur.
- Version obligatoire et confirmation pour les modifications. Writers SMTP global,
  SMTP tenant et runtime utilisent leurs verrous transactionnels; audit des changements
  atomique avec la configuration. Acteur plateforme distinct du `User` d’entreprise.
- Secrets via `CryptoService`, projection fermée. Changement hôte/compte SMTP ou
  identité du fournisseur IA retire l’ancien secret. Nouvelle rotation SMTP globale
  incluse dans `reencrypt-secrets`; sauvegarder DB et clé de chiffrement séparément.
- Connexion OAuth : flux privé vers le navigateur, annulation à fermeture; tokens
  restent dans le home isolé du tenant. Aucun compte partagé implicitement entre tenants.
- Contrôle d’Exploitation reste une lecture : aucune activation, commande serveur,
  migration, envoi SMTP ou appel LLM en cliquant Actualiser.

## Déploiement et limites explicites

Migration additive `20261001150000_platform_service_center` : deux tables plateforme
(`platform_email_configs`, `platform_service_audits`), aucune activation ni migration
de secret. Appliquer les migrations avant les nouvelles images API/Web. Ne jamais
changer `ENCRYPTION_KEY` sans protocole de rotation.

Rollback : conserver les tables et secrets. L’ancienne API ignore le nouveau SMTP
en BD et reprend ses variables d’environnement; aligner explicitement ce transport
avant de revenir à une ancienne image. Ne pas supprimer les journaux ni relancer
des messages dont le résultat est incertain.

Ce palier ne provisionne pas de conteneur, ne modifie pas le routage opérateur, les
volumes ou les domaines egress. Installer et rattacher le runner reste une opération
serveur initiale (voir `deploy/agent-runner/README.md`). Le mode IA managé avec budget
mutualisé/refacturation reste futur. La connexion actuelle reste propre au tenant.

SMS réel, STOP/consentements et collecte IMAP réelle restent autorisés par un humain
interne dans l’entreprise; diagnostics seulement dans ce centre. Pas de modification
S3/APS/SMTP réseau ou DNS par un simple interrupteur. Liste entreprises bornée à 500,
limite visible; recherche/pagination serveur à ajouter pour un grand parc.

Les preuves locales sont inscrites dans `docs/etat-du-projet.md`. Les tests doublés
ne remplacent ni la migration VPS, ni une qualification SMTP/OAuth réelle autorisée.
