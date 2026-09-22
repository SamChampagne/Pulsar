# Qualifications RH, suivis métier et tutoriels contextualisés

Lot du 22 septembre 2026 — branche `codex/end-user-workflows`.

## Parcours livrés

- RH → Compétences : référentiel de savoir-faire (`COMPETENCE`) et d’autorisations (`AUTHORIZATION`). Code/nature fixes, nom et activation modifiables avec contrôle de version.
- RH → Habilitations : attestation datée, référence vérifiée, auteur, renouvellement par nouvelle ligne et révocation motivée définitive.
- Fabrication → Qualifications des opérateurs : exigences par poste puis contrôle ponctuel d’un employé à une date. C’est une lecture des qualifications, pas une réservation de capacité ou une affectation.
- SAV : responsables internes, échéances civiles, files personnelles/sans responsable/en retard. Dossier et historique existants conservés.
- Achats fournisseurs : files de préparation, arrivages confirmés, échéances dépassées, clôtures et annulations; accès aux réceptions partielles/reliquats déjà opérationnels depuis chaque commande.
- Tutoriels RH, Qualité, SAV et Achats : scénarios distincts, longueur variable, étapes filtrées selon les liens autorisés, exploration, pratique et reprise. Aucun bouton « Tutoriel métier » sur les accueils; présentation automatique uniquement à la première visite par utilisateur/module, relance volontaire dans l’aide.

## Pourquoi les anciens tutoriels paraissaient absents

La progression persistée de l’utilisateur de démonstration indiquait `COMPLETED` en version 1
pour RH et Qualité. Des tests navigateur utilisaient ce même compte pour finir les guides.
Les parcours refondus utilisent la version 2, sans réouverture automatique si une version
précédente a déjà été présentée. Les tests de persistance utilisent maintenant un compte dédié : ils ne
terminent plus les guides du compte démo. Aucune remise à zéro des préférences client.

La première présentation enregistre immédiatement `IN_PROGRESS`, avant toute action.
Un retour, rechargement ou changement de version ne relance donc pas le tutoriel, même
inachevé. L’aide « ? » conserve une relance volontaire. Si l’enregistrement échoue, une
erreur explicite reste affichée : aucun faux indicateur local de présentation enregistrée.

Le moteur ne suppose plus cinq étapes. RH en a sept avec tous les droits, Qualité six,
SAV cinq, Achats six. Un utilisateur RH personnel ne voit pas les routes de gestion.
« Pratiquer sur cet écran » enregistre l’étape, ferme le guide et ouvre la vraie page.
« Reprendre mon parcours » n’ouvre pas le guide au-dessus d’un formulaire déjà ouvert.
Les actions métier restent explicites; aucune écriture métier automatique pendant le tutoriel.
Les autres parcours conservent leur contenu métier, avec des intitulés spécifiques plutôt
que trois titres génériques. Ce ne sont pas encore des exercices dont l’achèvement métier
serait détecté automatiquement : le guide accompagne, il ne certifie pas une formation.

## Données et contrôles RH

Migration additive `20260922100000_skills_support_followup` : `HrSkill`, `HrQualification`,
`WorkCenterSkillRequirement`, responsable/échéance SAV. FK composites tenant et contraintes
de période/révocation; aucune donnée existante convertie en attestation supposée.

Les attestations sont immuables sauf la transition ACTIVE → REVOKED via la machine partagée.
Les dates civiles sont réelles et inclusives; fin facultative, jamais avant le début.
Le référentiel et l’employé doivent être actifs à l’attestation. Un dossier employé sans login
peut être qualifié par un gestionnaire. Le bénéficiaire relié au compte courant ne peut ni
s’auto-attester ni s’auto-révoquer. Le vérificateur est un utilisateur interne actif, non agent
et non compte technique. L’interface exige une confirmation de vérification; l’API reste
réservée au droit d’attestation, ce n’est pas une signature électronique réglementaire.

La création conserve une clé UUID par utilisateur/tenant avant envoi. En cas de réponse perdue,
la même clé et le même contenu sont rejoués, avec un fingerprint lié à l’acteur. Changer le
contenu sous la même clé retourne 409. La révocation conserve date, auteur et motif; une
version périmée ou une double décision concurrente est refusée. L’audit général garde statut
et identité de l’opération, sans référence du certificat ni motif RH.

Les écritures RH partagent le verrou transactionnel de tenant métier. L’édition des exigences
prend aussi un verrou de ligne sur le poste, puis vérifie `expectedUpdatedAt`. Jusqu’à 30
références actives, sans doublon. Retirer la dernière exigence ne qualifie personne par défaut.

## Permissions et séparation entre modules

| Opération                                   | Modules          | Permissions                                     |
| ------------------------------------------- | ---------------- | ----------------------------------------------- |
| Lire référentiel et attestations détaillées | RH               | `hr.read`                                       |
| Créer/modifier une compétence               | RH               | `hr.read` + `hr.manage`                         |
| Attester/révoquer                           | RH               | `hr.read` + `hr.qualifications.manage`          |
| Lire exigences et vérifier une couverture   | RH + Fabrication | `manufacturing.read` + `hr.qualifications.read` |
| Modifier les exigences                      | RH + Fabrication | précédentes + `manufacturing.manage`            |
| Lire/modifier le suivi SAV                  | SAV              | `support.read` / + `support.manage`             |

`hr.qualifications.read` ne donne pas `hr.read`. La projection Fabrication inclut seulement
l’identité minimale employé, le poste et chaque exigence couverte/non couverte. Aucun
justificatif, référence, auteur, motif ou période complète n’est transmis. Les résultats sont
calculés dans une transaction de lecture RepeatableRead, tenant-scopée.

Une attestation ACTIVE couvre une exigence si son début est au plus la date demandée et sa fin
est absente ou au moins cette date. Employé, référence et poste doivent être actifs. Les
résultats sans exigences, employé inactif, poste inactif et qualification manquante sont
distincts. Une révocation actuelle invalide aussi une demande de contrôle portant sur une
date passée : ce n’est pas un moteur de reconstruction historique.

## Suivi opérationnel

SAV : l’affectation et l’échéance se font après la création, depuis le dossier ouvert ou en
traitement. Le responsable vient des utilisateurs internes actifs de l’entreprise. Une
désactivation ultérieure reste visible; le dossier n’est pas silencieusement réattribué.
Mes demandes à traiter et Sans responsable excluent les dossiers résolus/clôturés. Le filtre
retard compare l’échéance au jour UTC, également avant pagination. Toute modification garde
la version et le journal existants. Aucun courriel, SMS, SLA contractuel ou temps réservé.

Achats : `orderStatus` et `orderFollowup=late` filtrent sur le serveur avant pagination. Un
retard signifie commande CONFIRMED à date attendue passée (jour UTC), pas nécessairement un
reliquat physique. Les quantités reçues/restantes se consultent par ligne dans Réceptions et
reliquats; la confirmation n’écrit toujours aucun stock et la clôture administrative n’invente
aucune réception. Aucun paiement ni envoi fournisseur ajouté.

## Exploitation et limites

Appliquer les migrations puis reconstruire shared/database/API. Les nouvelles permissions
sont synchronisées au démarrage; renouveler le JWT ou se reconnecter pour les voir.
La recette locale utilise uniquement `pulsar_enduser_20260921`, API :3100 et web :5173.
Ni `.env`, ni base client, ni hébergement OVH n’ont été modifiés.

Pas de paie, droit du travail, aptitude médicale, documents RH joints, notifications d’expiration,
plan de formation, signature réglementaire ou décision AI RH. Pas d’agent chargé d’attribuer
des habilitations. Le contrôle Fabrication ne lit pas les absences, ne réserve aucun opérateur
et ne remplace pas la vérification humaine requise avant une opération réelle.

## Recette

Validation finale : 1 522 tests unitaires (875 shared, 529 API, 118 web), 69 tests HTTP ciblés
sur cinq suites et 60 scénarios navigateur sur sept suites. Compilation complète et typechecks
réussis; 12 avertissements web préexistants hors de ce lot. Schéma/migrations sans divergence.
La recette navigateur couvre aussi mobile et les réponses perdues. Un défaut de teardown des
intercepteurs de préférences a été corrigé avant la dernière passe complète (60/60).

Ajustement de première visite (même lot) : suppression des boutons d’accueil, mémorisation
dès la présentation et absence de relance automatique après retour, rechargement ou nouvelle
version. Une ancienne demande de relance manuelle n’est pas rejouée après déconnexion puis
reconnexion dans la même SPA. Vérifications : **118 tests unitaires web**, typecheck sans
erreur (12 avertissements préexistants), **61 scénarios navigateur**, puis **12 scénarios ciblés**
repassés après le contrôle de reconnexion. Documentation intégrée et contrat mis à jour.

- `packages/shared/src/hr-skills.spec.ts` : dates inclusives, expiration, révocation, bornes.
- `apps/api/test/skills-followup.e2e-spec.ts` : droits, isolement, idempotence, concurrence,
  modules, projections minimales et suivis SAV/achats.
- `apps/web/e2e/skills-followup.spec.ts` : saisie, réponse perdue, contrôle Fabrication,
  révocation, affectation SAV, tutoriel versionné, pratique/reprise.
- Régressions RH, Qualité, Services, Achats, scanners et moteur de tutoriels.

La suite logique : alertes d’expiration et matrice compétences par équipe, puis exigences
sur les opérations/gammes et planification tenant compte de la durée/disponibilité. Côté SAV :
notifications configurables puis SLA et vue équipe. Côté Achats : retour fournisseur et
rapprochement facture, en réutilisant WMS/Finance et leurs permissions.
