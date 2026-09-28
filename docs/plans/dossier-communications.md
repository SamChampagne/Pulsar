# Communications dans les dossiers — C3a

## Parcours livré

Le bouton **Communications** ouvre un tiroir Pulsar depuis une fiche client/partenaire,
une société CRM, une opportunité, une intervention ou le détail d’une expédition.
Il ne déplace pas la navigation et n’impose pas un autre module métier.

1. Choisir Courriel ou SMS, puis une coordonnée proposée ou saisir explicitement un destinataire.
2. Consulter son autorisation opérationnelle. Un gestionnaire du dossier ayant
   `core.communications.manage` consigne une décision, sa date et sa preuve/référence.
3. Composer ou sélectionner un modèle propre à l’entreprise. Les variables fermées
   `{{dossier}}`, `{{client}}`, `{{destinataire}}` sont remplacées à la sélection.
   Les valeurs manquantes restent visibles et bloquent l’envoi.
4. Relire l’aperçu, le destinataire et le mode réel/simulation, puis confirmer.
5. Consulter l’historique du dossier. Les dates suivent le fuseau d’affichage utilisateur.

Modèles : nom, objet courriel, texte et activation modifiables dans le panneau;
version attendue et audit. Maximum 100 modèles par canal. Texte simple échappé,
pas de HTML exécutable, pièce jointe, facture ou avoir depuis ce compositeur.
Les modèles HTML du module Courriel et l’outbox financier conservent leurs propres parcours.

## Portée et droits

- `core.communications.read` **et** droit de lecture du canal **et** module/droit de
  lecture de la source. Chaque requête, historique et reprise revérifie la source.
- Envoi : droit `core.sms.send` ou `core.email.send`, humain interne actif confirmé.
- Décision du contact : droit de gestion du dossier + `core.communications.manage`.
- Modèles : gestion des communications + gestion du canal.
- Aucun outil agent, campagne, minuterie ou envoi automatique ajouté.

`COMMUNICATION_ACCESS` est une liste fermée. Les façades PARTY_ACCESS désignent une
même identité réelle, sans fusion Customer/BusinessPartner/CrmCompany. Le module
Services fonctionne seul; Transport, CRM et Clients ne sont pas des prérequis cachés.
Les suggestions utilisent seulement les FK explicites du document : intervention
→ projet → partenaire, opportunité → société → contacts CRM, expédition → commande
→ client. Chaque lecture vérifie le tenant, même pour les anciennes FK simples.
Le carnet CONTACT complète ces coordonnées lorsque actif et valide au jour UTC.
Pas de conversion implicite de téléphone local en E.164 ni de transitivité entre identités.

L’historique est attaché au dossier exact, pas automatiquement remonté chez le client.
Le droit de lecture SMS seul ne donne pas accès aux messages d’un dossier : ces SMS
sont exclus du journal général; ils restent accessibles depuis le dossier autorisé.
Les courriels opérationnels sont dans `DossierCommunication`, pas dans l’outbox
générique `EmailMessage` qui ne possède pas ces contrôles de source. Les réponses
reçues restent dans les boîtes des canaux et ne sont pas rattachées automatiquement.

## Autorisations de contact

Une préférence est commune au tenant + canal + coordonnée normalisée, sans preuve
de propriété de cette coordonnée. Inconnue = envoi depuis dossier interdit. Autorisée
ou refusée = décision humaine versionnée; l’audit conserve acteur, preuve, date,
source, ancienne et nouvelle version dans la même transaction que la préférence.
Ce registre ne certifie pas la conformité juridique et ne constitue pas un opt-in marketing.
Les notes de preuve ne sont pas exposées par le panneau de lecture; consulter l’audit
demande les droits propres au journal d’audit.

Un refus SMS bloque aussi les nouveaux envois manuels du journal SMS général.
Un STOP reste toujours bloquant, même si une ancienne autorisation est positive.
Ce lot **ne réactive pas** un STOP; START ne change rien. Une future réactivation
devra vérifier la preuve et les restrictions du fournisseur sans effacer l’historique.
Les préférences ne changent pas les notifications système, invitations, factures,
séquences CRM historiques ou le compositeur courriel générique; leur harmonisation
nécessite une politique distincte, pas un changement implicite de leurs contrats.

## Engagement, reprise et simulation

Le serveur capture le dossier et recontrôle son jeton de revue, la version de
connexion, la préférence et les droits. Le destinataire reste un choix explicite.
Le texte réellement confirmé est conservé; un changement ultérieur du modèle ne
réécrit jamais un envoi. Le journal et l’audit sont commités **avant** le réseau.

- SMS réutilise exclusivement `SmsService` : cap, signature des retours, STOP,
  registre et gouvernance existants. Le lien de dossier se crée dans la même transaction.
- Courriel : un seul appel `EmailService` avec le SMTP tenant capturé, jamais de repli
  vers un SMTP plateforme invisible. Sans SMTP tenant actif : simulation, aucun réseau.
  Ce choix est propre au nouveau panneau; les anciens envois conservent leur repli historique.
- `SENDING` et `UNKNOWN` ne sont jamais réémis. SMTP accepté n’est pas une preuve de
  livraison. SMS accepté et livraison Telnyx sont deux états différents.
- Clé UUID liée à tenant/acteur/corps/source/versions. La reprise exacte renvoie
  le résultat historique après recontrôle d’accès, même si les préférences ont changé.
  Un corps différent avec la même clé est refusé. Les audits échoués avant engagement
  annulent toutes les écritures et aucun transport n’est appelé.

Le navigateur conserve la demande dans sessionStorage par tenant/utilisateur/dossier
avant envoi. « Vérifier l’envoi » réutilise la même demande. Une vérification manuelle
peut fermer cette demande locale en effaçant son texte, sans rappeler/annuler le message
ni déclencher un nouvel envoi. La fermeture d’un onglet peut perdre ce cache : inspecter
le journal/fournisseur avant de recréer un message. Pas de garantie exactly-once fournisseur.

## Suite distincte

1. Rattachement explicite et audité des réponses SMS/courriel à un dossier.
2. Réactivation contrôlée après STOP, preuve et confirmation côté fournisseur.
3. Harmonisation des préférences avec les anciens envois opérationnels et séquences.
4. Parcours Services P3a complet puis recette fournisseur HTTPS autorisée sur le VPS.

Migration `20260927120000_dossier_communications`, aucune réécriture des messages anciens.
Résultats de recette et état des environnements : `docs/etat-du-projet.md`.
