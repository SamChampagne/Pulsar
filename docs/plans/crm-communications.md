# CRM opérationnel — communications et séquences

Branche : `codex/crm-communications`. Lot 1 : courriel ; SMS et connecteurs entrants
supplémentaires restent au lot suivant. Aucun envoi externe activé par le développement.

## Contrat

- Scénarios désactivés à la création, mode simulation par défaut. Déclenchement manuel
  depuis un contact ou à la création d'un nouveau contact (aucun rattrapage historique).
- De 1 à 5 étapes en texte brut, délais relatifs à la réussite de l'étape précédente.
  Contenu et destinataire figés à l'inscription ; une seule inscription par scénario/contact.
- En mode gouverné, un agent existant doit être choisi explicitement. Le nouvel outil
  sensible passe par le registre et `handleMutatingTool` : PROPOSE/AUTO/DENY selon ses
  policies/caps. Aucun appel LLM nécessaire, aucune permission ajoutée automatiquement.
- Consentement explicite lié à l'adresse, désabonnement, arrêt sur réponse entrante connue,
  pause/reprise/arrêt, historique durable. Les messages déjà remis au fournisseur ne
  peuvent pas être rappelés ; une pause ne garantit pas l'annulation d'un envoi en vol.
- Isolation tenant et module/permissions revérifiés à l'exécution, y compris au dernier
  contrôle avant remise au fournisseur. Pas d'envoi depuis ReactionExecutorService.
- Une campagne envoyée signifie mise en file terminée, pas livraison prouvée. Afficher
  les vrais compteurs outbox et distinguer les erreurs d'enfilage.

## UX

Conserver Geist, Tailwind 4 et les composants maison. Éditeur de scénario lisible,
étapes ordonnées, modes explicites, aperçu texte, erreurs locales, états vides et clavier.
Accès depuis CRM et fiche contact ; historique + prochaines étapes au même endroit.

## Qualification — 14 septembre 2026

- Build complet shared → database → API → SPA réussi. Typecheck web : 0 erreur,
  41 avertissements préexistants (8 fichiers hors nouveau parcours).
- 823 tests unitaires : shared 577, API 221, web 25 (dont 3 nouveaux tests de garde outbox).
- 97 tests API ciblés : CRM, email core, conversations, gouvernance phase 14 et
  13 nouveaux cas séquences. PostgreSQL réel, transport substitué dans la nouvelle suite
  pour garantir l'absence d'envoi externe. Les autres suites utilisent le driver log.
- 2 tests Playwright : création/persistance, inscription depuis le contact, pause/reprise/
  arrêt, aucune sortie en simulation, largeur 390 px ; désabonnement sans mutation GET.
  Captures desktop/mobile inspectées. La suite API complète n'a pas été relancée ici.
- Migration additive `20260914180000_crm_communications` appliquée aux bases locales
  `pulsar_relaunch_20260913` et `pulsar_relaunch_test_20260913`. Aucun `.env` modifié.
- Une première compilation a rencontré un conflit d'accès au dossier `dist` avec le
  watcher de développement ; elle a été relancée avec le watcher arrêté, puis réussie.

## Utilisation

1. CRM → Automatisations → Nouveau scénario. Conserver Simulation, personnaliser les
   étapes (texte brut, `{{name}}` / `{{company}}`), activer puis enregistrer.
2. CRM → Contacts → ouvrir un contact avec courriel valide → Suivis automatiques →
   choisir le scénario → Démarrer. Le worker passe chaque minute ; Actualiser les suivis
   affiche le résultat. Aucun courriel ni proposition n'est créé en simulation.
3. Pour préparer le mode gouverné, documenter l'accord dans Consentement courriel puis
   choisir un agent actif disposant de `crm.manage` et `core.email.send`, et autoriser
   `send_crm_sequence_email` si sa liste d'outils est restrictive. Par défaut l'agent
   propose : l'humain voit le destinataire, l'objet et le texte figés avant approbation.
4. Une politique AUTO explicitement configurée autorise l'envoi sans LLM, toujours via
   `handleMutatingTool` (caps/circuit breaker/audit). Ne pas augmenter l'autonomie d'un
   agent globalement pour ce seul besoin : privilégier une règle ciblée sur cet outil.
5. Qualifier SMTP et la réception entrante avec une adresse de test avant toute activation
   métier. Le driver log n'envoie rien. Le suivi de réponse ne voit que les courriels
   réellement ingérés par Pulsar. `WEB_URL` doit désigner l'URL publique correcte pour le
   lien de désabonnement. Cliquer le lien affiche une confirmation ; seul POST révoque.

## Exécution et reprise

La source de vérité est `CrmSequence` → `CrmSequenceRun` → `CrmSequenceStepRun`.
Le worker traite au plus 50 étapes/passage, en rotation pour éviter qu'une file de
propositions en attente ne bloque les nouvelles étapes. Une récupération bornée à 100
succès/passage rétablit les étapes suivantes après interruption. Un verrou transactionnel
PostgreSQL exclut les traitements simultanés du même identifiant ; la clé unique
`EmailMessage(tenantId, dedupKey)` protège également les appels répétés de l'outil.
Cela ne constitue pas une certification multi-instance de toute la plateforme.

La garde d'envoi est revérifiée avant le claim et avant remise au transport : tenant,
module, agent actif/permissions/allowlist, état du suivi, consentement et réponse connue.
Une garde en pause ne libère jamais le claim d'un autre worker. Un désabonnement annule
les étapes restantes ; un courriel supprimé par la garde apparaît FAILED dans l'outbox
legacy, sans retry, avec `CANCELLED_BY_COMMUNICATION_GUARD` (l'étape CRM dit Annulé).
Les anciennes campagnes conservent leur enum SENT pour compatibilité, libellé désormais
« Traitement terminé » ; les compteurs séparent échecs d'enfilage et états outbox.

## Limites de ce premier lot

Pas de SMS réel, pipeline/devis/rendez-vous comme déclencheurs, segmentation avancée,
horaires locaux d'envoi, limites budgétaires SMS ni preuve de livraison SMTP. Ne pas
présenter ces possibilités comme livrées. Les futures règles devront réutiliser cette
file et cette gouvernance. Le raccordement SMTP réel sera qualifié séparément.

- L'inscription automatique concerne les nouveaux contacts uniquement. Une adresse sans
  accord préalable est ignorée en mode gouverné, avec raison dans l'audit ; aucun accord
  n'est présumé depuis un simple formulaire ou la présence d'une adresse.
- Pas de remise à zéro d'un suivi arrêté/terminé ni d'éditeur de scénario graphique à
  embranchements. Modifier le scénario ne modifie pas ses inscriptions existantes.
- Un arrêt pendant une remise SMTP ne permet pas de garantir la non-réception. Une
  interruption du processus après le claim outbox SENDING conserve l'état ambigu de
  l'outbox existante : pas de renvoi aveugle, vérification opérateur/fournisseur nécessaire.
- Le premier lot ne transforme pas encore toutes les communications en une seule timeline
  intermodule. Les étapes sont visibles sur le contact et reliées aux courriels/actions.
- Le sélecteur contact affiche les 100 premiers scénarios ; la liste principale est paginée.
  Segmentation/recherche du sélecteur à approfondir avant un catalogue important.
