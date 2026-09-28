# Communications — Telnyx et courriel guidé

## Périmètre

Connexion **core par entreprise**, indépendante de CRM, TMS, Services et Billing.
`/connect/sms` configure Telnyx et propose un envoi transactionnel humain avec journal.
`/connect/email` et `/emails/config` partagent la même configuration SMTP/IMAP.
Les modules courriel existants réutilisent EmailConfigService; le nouveau service SMS
ne leur ajoute pas implicitement des notifications ni des campagnes.

## Telnyx

- Droits `core.sms.read`, `core.sms.send`, `core.sms.manage` dans les rôles. Une
  session doit être renouvelée après attribution. Le writer exige un humain interne
  actif; comptes techniques et agents exclus. Aucun nouvel outil IA mutating.
- `TenantSmsConfig` : numéro E.164, Messaging Profile UUID, clé AES-GCM via
  CryptoService, activation, réel/simulation et limite 1–500 tentatives par jour UTC,
  par mode. API : uniquement `hasApiKey`, jamais la clé ni son ciphertext.
- L’activation réelle se fait **dans Pulsar**, avec droit manage, confirmation et
  audit. `SMS_DRIVER` n’est plus lu. `liveAuthorized=false` à la migration : aucune
  ancienne configuration ne devient réelle sans confirmation humaine. La clé publique
  Ed25519 et l’origine HTTPS publique doivent être configurées avant activation.
- La simulation valide le parcours Pulsar mais ne contacte pas Telnyx et ne vérifie
  ni la clé, ni la propriété du numéro, ni les autorisations du profil.
- Envoyer : numéro international, texte non blanc ≤1 600 caractères, confirmation
  explicite de contenu/destinataire/autorisation, UUID de reprise, version de config.
- Verrou PostgreSQL `sms:<tenantId>` : configuration et préparation sérialisées;
  acteur revérifié, version attendue, plafond et audit atomiques. Clé unique
  `(tenantId, operationKey)`; fingerprint acteur/corps/version. Changer le contenu
  ou l’acteur avec la même clé retourne 409. Le replay précède les règles courantes.
- Le registre SENDING est commité **avant** le réseau. POST fixe
  `https://api.telnyx.com/v2/messages`, timeout 10 s, aucun redirect/retry, réponse
  bornée 64 KiB. Secrets et réponses brutes ne vont pas dans les logs métier.
- SENDING → SIMULATED / ACCEPTED / REJECTED / UNKNOWN via le workflow partagé.
  HTTP 4xx sauf 408 : rejet. Coupure, 408, 5xx ou réponse incohérente : UNKNOWN.
  Si le résultat n’est pas persisté après appel, SENDING reste conservé. Le replay
  ne rappelle jamais le fournisseur, même après désactivation ou changement de clé.
- Le navigateur garde la demande exacte en sessionStorage **avant** l’envoi,
  dans une clé tenant/utilisateur; aucune clé Telnyx n’y est stockée. Après coupure,
  reprendre la même demande. UNKNOWN/SENDING exigent vérification dans Telnyx avant
  de clore la reprise locale. Fermer celle-ci ne change pas le journal fournisseur.

### Mise en service

1. Dans Telnyx, disposer d’un numéro SMS associé au Messaging Profile de ce compte.
2. Attribuer les trois droits à la personne habilitée, puis ouvrir Connexions → SMS.
3. Saisir le numéro, le profil, la clé dans le formulaire et un plafond réduit.
4. Enregistrer **simulation**, confirmer un message fictif et vérifier son journal.
5. Dans Pulsar, ajouter la clé publique Base64 de Telnyx (Keys & Credentials) et
   l’origine HTTPS, sans chemin/barre finale. Copier l’URL affichée dans le champ
   Webhook URL entrant du Messaging Profile Telnyx. Ce paramétrage fournisseur est
   distinct du serveur Pulsar; aucun SSH ni `.env` requis. Un profil/numéro vérifié
   ne peut pas être partagé entre deux entreprises Pulsar (index SQL partiel).
6. Hors test automatique, autoriser le mode réel dans Pulsar et confirmer un seul
   SMS vers un numéro de test autorisé. Vérifier retour signé, livraison puis STOP.
   Les frais, restrictions pays et enregistrements d’expéditeur restent propres au compte.

**Limites explicites :** acceptation ≠ livraison/lecture; pas de MMS, pièce jointe,
campagne, CRM automatique ou IA d’envoi.
Pas de promesse exactly-once côté fournisseur; Pulsar empêche le renvoi d’une même
demande engagée, mais une nouvelle clé est une nouvelle demande. La limite porte
sur les tentatives, pas les segments facturés. Les clés historiques restent dans le
registre pour conserver l’idempotence. Une désactivation ne rappelle pas un appel
déjà engagé. Le consentement initial prouvé et sa réactivation contrôlée restent
à construire **avant** les scénarios automatiques; STOP seul n’est pas ce registre.

### Retours signés et STOP (v2)

`POST /sms/webhooks/:configId` est public mais authentifié par signature Ed25519
sur les octets exacts `timestamp|rawBody`, fenêtre de 5 minutes dans les deux sens,
corps ≤64 KiB. Tenant résolu par configuration serveur, jamais par le payload.
Profil, numéro, sens, type SMS et un seul destinataire sont contrôlés. Les autres
types d’événement signés sont ignorés. Aucun contenu distant ni média n’est téléchargé.

L’événement projeté et son empreinte sont persistés sous verrou SMS tenant, unique
`(tenantId,eventId)`. Reprise identique sans effet; contenu divergent ⇒409. Les retours
et l’audit sont atomiques, sans SMS/email ni effet métier externe. `lastWebhookAt`
n’avance pas la version de configuration. Un changement de clé publique invalide
les anciens signataires; les réponses entrantes concernent uniquement le profil/numéro
actuels. Conserver l’ancienne configuration pendant la vidange d’un ancien compte.

`message.finalized` alimente un état de livraison séparé : PENDING→DELIVERED,
FAILED ou UNCONFIRMED, via Shared. La première preuve finale appliquée est terminale;
une preuve ultérieure contradictoire est conservée dans le registre, jamais écrasée
silencieusement. Rapprochement exact providerMessageId/profil/numéros/tenant, jamais
par texte ou proximité horaire. Un retour arrivé avant la réponse d’envoi est conservé
et rapproché à la persistance de l’ID fournisseur. Sans ID fournisseur connu (UNKNOWN
ou crash avant persistance), aucune association supposée : inspecter Telnyx. Ancien
numéro/profil sortant accepté uniquement si un message historique exact est trouvé.

`message.received` alimente la liste paginée Réponses. STOP, STOPALL, UNSUBSCRIBE,
CANCEL, END, QUIT, ARRET/ARRÊT et DESABONNER/DÉSABONNER (message entier, casse ignorée)
créent une suppression tenant/numéro. Elle bloque tout nouvel envoi, simulation incluse,
sur tous les numéros d’envoi du tenant, sous le même verrou que la préparation. STOP
reste reçu lorsque la connexion sortante est suspendue. START n’efface rien; aucun
bouton de contournement ni accusé SMS automatique. Cette protection ne rappelle pas
un appel déjà engagé. Le consentement initial reste une confirmation humaine par envoi.

L’URL enregistrée est capturée sur le message et transmise explicitement à Telnyx
pour les accusés sortants; pas de repli implicite sur une URL d’un autre profil.
L’adresse doit être accessible en HTTPS depuis Internet; le fonctionnement local ne
valide ni DNS/TLS ni le routage du fournisseur.

## Courriel

La configuration distingue fournisseur/identité, boîte entrante et vérification.
Le composeur et les gabarits proposent une rédaction texte simple ou HTML avancé.
Une conversion HTML → texte est confirmée avant perte de mise en forme; charger un
gabarit ou brouillon IA ne l’écrase pas par un ancien texte. La modification des
gabarits utilise désormais PUT, conformément au contrôleur (ancien PATCH invalide).
Suppression de gabarit et envoi manuel demandent confirmation; le toast annonce la
mise en file plutôt qu’une livraison déjà réussie. Le bouton Composer suit le droit
core.email.send; la liste des gabarits reste soumise à core.email.manage.
Cartes SMTP personnalisé, Brevo (clé SMTP, pas API), OVHcloud Canada/Europe MX Plan.
Ce sont des raccourcis : vérifiez les paramètres précis de votre offre fournisseur.
OAuth Microsoft/Google, native Graph et connexion API Brevo ne sont pas implémentés.

La projection affiche le canal effectif enregistré, séparé du brouillon. SMTP tenant
actif est prioritaire sur le transport plateforme, **même en EMAIL_DRIVER=log**.
Désactiver SMTP tenant revient au transport plateforme; ce n’est pas un coupe-circuit.
IMAP réel utilise `inboundLive` par tenant, indépendant de EMAIL_DRIVER. Activation
confirmée/versionnée par un humain interne; une nouvelle boîte ou un changement de
compte demande confirmation. `inboundActive` permet de suspendre la collecte. Les
anciennes configurations migrent en simulation et doivent être réautorisées dans
l’UI; la migration ne déclenche jamais de nouvelles lectures externes.
Relevé toutes les cinq minutes; test IMAP sans import, résultat simulé/réel explicite.
Le test requiert une sauvegarde et une confirmation dans l’UI, il peut envoyer réel.

Sauvegarde transactionnelle et audit atomique; version attendue transmise par l’UI
(API historique sans version encore compatible). Changer hôte ou identifiant retire
le secret précédent sans nouveau mot de passe. Ports IMAP 1–65535, champs bornés,
nom d’expéditeur sans saut de ligne. `replyTo` stocké est maintenant transmis au
SMTP tenant; un override explicite du message reste prioritaire. Connexion SMTP
bornée et transport ponctuel fermé après usage. Le outbox financier existant et ses
gates ne sont pas modifiés; pas de nouveau canal de contournement des factures/avoirs.

Aperçu commun des gabarits, du composeur, de l’historique et de l’identité : largeur
bureau/mobile, sujet et destinataires, DOMPurify + iframe sandbox opaque + CSP.
Scripts, navigation, formulaires et ressources distantes bloqués. Les variables restent
visibles; aperçu ≠ rendu exact de tous les clients email et ≠ preuve de délivrabilité.
Le corps envoyé n’est pas modifié par l’aperçu. Aide et tutoriels Connexions/Courriels
spécifiques complétés, sans réinitialiser la progression des utilisateurs existants.

## Vérification

Migration `20260927100000_tenant_sms` appliquée uniquement à la base locale isolée.
Tests transport avec fetch simulé; HTTP avec Telnyx/SMTP remplacés, scénarios d’audit
et réponse perdue injectés. Aucun vrai envoi, secret client, LLM, déploiement ou seed global.

V2 : migrations `20260927110000_communications_app_controls` et
`20260927111000_sms_webhook_binding` sur la même base isolée. 20 scénarios HTTP et
8 parcours Chromium; transport Telnyx, SMTP et IMAP réels remplacés par mocks.
Signatures Ed25519 de recette, mauvaise signature/horodatage, autre profil/tenant,
collision de connexion, replay/contenu divergent, retour avant réponse, rollback
d’audit, STOP en suspension et activation IMAP depuis l’UI vérifiés. Captures
bureau/mobile inspectées; aucune preuve fournisseur réel obtenue par ces tests.

## Références fournisseur consultées

Suite locale C3a : [communications dans les dossiers](dossier-communications.md).
Les décisions opérationnelles initiales sont désormais consignables avec preuve;
STOP reste bloquant. Les anciens canaux gardent les limites décrites ci-dessus,
notamment les courriels génériques et les séquences. Les réponses reçues ne sont
pas automatiquement liées aux dossiers; aucune réactivation automatique.

- [Telnyx — Send a message](https://developers.telnyx.com/api-reference/messages/send-a-message)
- [Telnyx — signature et réception des webhooks](https://developers.telnyx.com/docs/development/api-fundamentals/webhooks/receiving-webhooks)
- [Telnyx — événements SMS et URL de retour](https://support.telnyx.com/en/articles/4334722-how-to-leverage-webhooks)
- [Telnyx — Messaging Profile](https://support.telnyx.com/en/articles/3562059-setting-up-a-messaging-profile)
- [Brevo — paramètres SMTP](https://help.brevo.com/hc/en-us/articles/7924908994450-Send-transactional-emails-using-Brevo-SMTP)
- [OVHcloud — configuration MX Plan Canada](https://help.ovhcloud.com/csm/en-mx-plan-email-iphone-configuration?id=kb_article_view&sysparm_article=KB0052077)
