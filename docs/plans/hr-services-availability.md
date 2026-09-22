# RH → Services — disponibilité minimale

Lot local du 22 septembre 2026, branche `codex/end-user-workflows`.
Suite de [RH v1](hr-foundations.md) et des [affectations Services](services-assignment-time.md).

## Parcours livré

1. Activer RH et Services; créer le dossier employé avec son compte interne associé.
2. Attribuer `services.read` + `hr.availability.read` au planificateur.
   `services.manage` reste nécessaire pour écrire. Renouveler le JWT après changement de rôle.
3. Approuver une absence via le workflow RH existant, avec une autre personne habilitée.
4. Dans Interventions, ou dans le détail d’un projet, repérer le signal sur les interventions
   ouvertes et lire le résumé de la page visible. Ouvrir le panneau et modifier personne/horaire
   pour prévisualiser le nouveau jour avant d’enregistrer.
5. Après une décision RH, utiliser **Actualiser les absences**. Revenir dans la fenêtre du
   navigateur relance aussi la lecture, sans modifier les champs du formulaire.

Le panneau et les lignes conservent les composants et thèmes Pulsar. Le contrôle a des états
de chargement, erreur et données manquantes; les réponses tardives d’un ancien choix sont écartées.
L’aide de page, les articles RH/Services, la connexion et le tutoriel Services expliquent le lien.
Les visites déjà terminées ne sont pas réimposées; elles restent relançables depuis l’aide.

## Contrat de confidentialité

`hr.availability.read` est un nouveau droit, distinct de `hr.read`, `hr.self` et `hr.approve`.
Il autorise un planificateur à consulter le signal journalier des autres comptes humains de son
tenant, sans consulter leur dossier RH. Restreindre ce droit aux personnes qui planifient le travail :
des recherches répétées par jour peuvent permettre de reconstituer une indisponibilité.

`POST /api/v1/services/availability/check` est une **lecture**, avec JSON :

```json
{
  "timeZone": "America/Toronto",
  "items": [{ "userId": "compte-interne", "scheduledAt": "2030-01-02T15:00:00Z" }]
}
```

De 1 à 50 couples par requête, dates réelles dans la plage RH 1900–2199 et horodatages avec
offset obligatoires. Fuseau validé via Intl. Réponse dans l’ordre de la requête : `timeZone`,
`checkedAt`, `items: [{date, state}]`. Aucun identifiant d’employé/demande, intervalle d’absence,
type, motif, numéro, historique ou auteur de décision n’est retourné. Aucune copie dans Services,
aucun événement ni nouvel outil AI. La réponse n’est pas stockée dans localStorage.

Les droits sont contrôlés par le contrôleur ET le service; les deux modules sont recontrôlés
via le cache existant (TTL 30 s; invalidation au changement dans le processus courant).
Toutes les lectures utilisent le tenant du JWT. Une personne inconnue, étrangère, agent ou
compte technique produit 404 pour toute la demande, sans résultat partiel. Les champs inconnus
sont rejetés. La projection des données lues en base est minimale.

La transaction `RepeatableRead` donne un snapshot cohérent des comptes, liens et absences.
Elle ne prend pas le verrou des writers métier et ne réserve rien. Une approbation postérieure
nécessite une nouvelle lecture. Les écritures Services/RH et leurs contrôles restent inchangés;
l’indisponibilité du contrôle ne bloque pas l’enregistrement d’une intervention.

## Sens des résultats

| Résultat                             | Interprétation                                                     |
| ------------------------------------ | ------------------------------------------------------------------ |
| ABSENT                               | Une absence APPROVED couvre le jour demandé, début et fin inclus.  |
| NO_APPROVED_ABSENCE                  | Aucune absence APPROVED ce jour; **pas** une garantie de capacité. |
| EMPLOYEE_NOT_LINKED                  | Aucun dossier employé relié au compte : non vérifié.               |
| EMPLOYEE_INACTIVE                    | Dossier RH désactivé : non vérifié.                                |
| USER_UNAVAILABLE                     | Compte non actif, non affectable : non vérifié.                    |
| Module/droit absent ou erreur réseau | Le navigateur affiche non vérifié et efface l’ancien résultat.     |

Brouillons, soumissions, refus et annulations ne déclenchent jamais ABSENT. Le libellé libre
d’équipe ne crée aucun lien RH. Le résumé ne concerne que les interventions PLANNED/IN_PROGRESS
avec une personne et un horaire sur la **page visible**, pas un KPI global. Les dossiers clos ne
sont pas réinterprétés comme des conflits historiques.

## Dates et limites

Une intervention stocke actuellement un instant de début, pas un créneau avec durée.
Le navigateur transmet explicitement son fuseau, identique à celui du champ et des dates affichées.
Le serveur convertit l’instant en date civile de ce fuseau, puis compare aux dates RH inclusives.
Exemple : 2 janvier 02:30 UTC est encore le 1er janvier à Toronto. Les changements d’heure
utilisent les règles de Intl. Une heure locale inexistante au printemps est refusée par le formulaire.
Une heure répétée d’automne conserve l’interprétation Date du navigateur; aucun sélecteur d’offset
ne permet encore de distinguer les deux occurrences.

Deux utilisateurs dans des fuseaux différents peuvent donc vérifier des jours différents pour
le même instant : le fuseau est toujours affiché. Ce n’est pas encore un calendrier d’entreprise
ou d’employé. Un prochain lot devra fixer ce référentiel avant tout blocage ou réservation, et
gérer les interventions sur plusieurs jours.

Pas de durée planifiée, double réservation, horaires d’équipe, jours ouvrables, demi-journées,
compétences, remplacement automatique, disponibilité Fabrication, paie ou calcul légal.
Aucune conformité réglementaire spécifique n’est revendiquée.

## Vérification et exploitation

Pas de migration, seed global ou changement de `.env`. Le catalogue de permissions se synchronise
au démarrage; les admins système le reçoivent selon la règle existante, les autres rôles doivent
être configurés explicitement. Tests uniquement sur la base isolée `pulsar_enduser_20260921`.
Les résultats finaux du lot sont consignés dans `docs/etat-du-projet.md`.

## Suite recommandée

1. Compétences/habilitations RH datées, avec lecture minimale vers les postes Fabrication.
2. Durée planifiée et fuseau métier stable, conflits d’occupation et capacité Services.
3. Planification d’équipe puis propositions AI gouvernées, jamais décision RH autonome.
