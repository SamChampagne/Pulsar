# P3a.1 — Acceptation des travaux Services

## Portée

Une intervention terminée décrit une réalisation; l’acceptation décrit la réponse
du client à son compte rendu. Ce lot ajoute cette distinction, sans signature
électronique, portail de validation, pièce jointe de preuve ni acceptation partielle
au sein d’une intervention. La référence de l’échange est déclarative, non vérifiée.
Les lots partiels se représentent par des interventions distinctes d’un projet.

Services fonctionne seul. Facturation et WMS restent facultatifs, activés seulement
pour leurs opérations. Aucun outil mutating agent ne consigne une acceptation.

## Configuration et décisions

- `ServiceProject.acceptanceRequired` vaut false par défaut, y compris historique.
  Choix possible en DRAFT seulement; après activation, l’exigence ne peut être levée.
- Intervention COMPLETED dans un projet ACTIVE, humain actif, `services.read` et
  `services.work.accept`. Gérer le planning ne suffit pas. Droits à attribuer et
  session à rafraîchir; pas d’octroi à tous les rôles existants.
- États Shared/Prisma : PENDING → RESERVATIONS ou ACCEPTED; RESERVATIONS →
  RESERVATIONS ou ACCEPTED; ACCEPTED terminal. Aucun rejet ne rouvre le workflow
  opérationnel. Décrire les reprises dans le journal puis une intervention dédiée.
- Nom du représentant, référence et note obligatoires, confirmation explicite.
  L’utilisateur interne consigne la réponse; le client n’est pas authentifié ici.
- `ServiceAcceptanceRecord` append-only : auteur, date serveur, décision, version
  de l’intervention et copie du titre/rapport/client/projet. Client du projet figé
  dès le premier enregistrement. Les coordonnées du carnet ne sont pas capturées.
- Portée de l’accord = travaux/rapport uniquement, jamais quantités ou prix.
  Les temps peuvent encore passer par leur approbation indépendante; les retours
  de pièces conservent leurs règles, notamment avoir préalable après facturation.

## Verrous et effets aval

Verrou business tenant commun à la décision, aux projets et à la facture Services.
Version attendue, CAS, enregistrement + état + audit dans la même transaction.
UUID unique par tenant, empreinte acteur/cible/corps : reprise exacte avant nouvel
état; acteur actif toujours recontrôlé. Clé réutilisée autrement = 409.

Si exigée : créer une facture depuis une source temps/pièce exige une intervention
COMPLETED et ACCEPTED. La lecture des sources conserve les lignes bloquées avec
motif et lien direct; la confirmation recontrôle, sans confiance dans le navigateur.
Le projet ne peut passer COMPLETED avec une intervention terminée non acceptée.
Les interventions annulées ne demandent pas d’acceptation. Annulation du projet
conserve les règles existantes, sans inventer de réponse client.

L’acceptation finale est immuable : aucun retrait ne peut invalider un brouillon
déjà créé. La facture capture toujours ses propres sources; l’accord historique
reste accessible via l’intervention source. Les factures manuelles indépendantes
ne sont pas rapprochées implicitement aux interventions.

## API et interface

- GET `/services/jobs/:jobId/acceptance?page=1` : lecture tenant, snapshot cohérent,
  pagination 20, page 1..100000, projection fermée sans empreinte/clé.
- POST même URL : `{operationKey, expectedUpdatedAt, status, representative,
reference, note, confirm:true}`; retour `{id,created}`.
- Formulaire projet : option expliquée avant activation. Intervention : onglet
  Acceptation, rapport à examiner, décision, historique paginé et auteur/fuseau.
- Reprise en sessionStorage tenant/utilisateur/intervention, conservée avant
  envoi; erreurs réseau/5xx gardent exactement le corps et la clé. Aucun bouton
  pour oublier une demande incertaine. Lecture échouée = pas de formulaire périmé.
- Aide, Documentation et parcours Services spécifiques mis à jour. Premier accès
  par utilisateur inchangé; aucun nouveau bouton de tutoriel ni reset de progression.

## Recette et suite

Tests : configuration/rétrocompatibilité, droits/module/tenant/humain, validation,
réserves/historique, replay, concurrence, rollback audit, facture et clôture.
UI : bureau/mobile, lecture seule, réponse incertaine et reprise sans doublon.

P3a reste ouvert : scénario complet devis → plusieurs interventions → temps/pièces
→ retours partiels → acceptation → facture validée → avoir → retour physique → SAV,
avec rôles limités. Ce lot n’annonce ni signature juridiquement certifiée ni recette
VPS accomplie. P1b, Finance à deux modes et qualification IA restent distincts.
