# Recette serveur — exploitation connectée

Lot du 22 septembre 2026, branche `codex/end-user-workflows`, une PR vers `main`.
Le déploiement reste manuel par le propriétaire. Aucun VPS, DNS, certificat ou
service externe n'a été modifié par ce lot.

## Installation ou mise à jour

Suivre [le runbook OVH](../../deploy/ovh/README.md), qui contient la configuration
Docker/Nginx, les sauvegardes, migrations, bootstrap et retour arrière.

1. Attendre la CI et fusionner la PR. Noter le SHA testé et sauvegarder base,
   documents, clés et ancienne image avant la mise à jour. Ne pas changer les clés.
2. Depuis le checkout propre du serveur, récupérer la révision approuvée; renseigner
   `PULSAR_BUILD_VERSION`. Vérifier où tourne Nginx avant d'utiliser le gabarit hôte.
3. Construire `api web`, arrêter les écritures du projet, appliquer `migrate`, puis
   `bootstrap`. **S'arrêter à la première erreur**. Ne jamais utiliser `db push`,
   `migrate reset`, `down -v` ou le seed de démonstration sur ce serveur.
4. Redémarrer API/web, vérifier `/api/v1/health/ready` et `/platform/operations`.
   Les 106 migrations présentes à cette livraison doivent être appliquées; ne pas
   réordonner ni supprimer les migrations déjà connues du serveur.
5. Activer les modules nécessaires sur une entreprise pilote avec données fictives.
   Actualiser les rôles/permissions puis se déconnecter/reconnecter. Le bootstrap
   synchronise les catalogues mais n'accorde pas de nouveaux droits aux rôles existants.

Le profil Docker actuel n'embarque **ni Hermes ni APS**. Planning Services, devis,
facturation et suivis fonctionnent sans eux. Les calculs MRP/APS et conversations
AI nécessitent un provisionnement distinct; un statut « non installé » n'est pas
un succès de recette AI. Garder les courriels en `log` pendant ces essais.

## Comptes et configuration

- Deux entreprises pilotes pour vérifier l'isolation; un gestionnaire, un intervenant
  et un lecteur restreint. Le gestionnaire qui approuve les heures est distinct de
  leur auteur/bénéficiaire et de la dernière personne les ayant corrigées.
- Modules : Catalogue, Services, RH, SAV, Qualité, Achats fournisseurs, Facturation;
  WMS pour pièces/réceptions; CRM pour la correspondance société; Fabrication seulement
  si l'on teste les exigences de postes ou le MRP.
- Mon travail : `core.operating.tasks.read`; réglages : `core.tenant.manage`.
  Chaque source conserve ses propres droits; une tuile absente peut être normale.
- Services : `services.read/manage`, `services.time.write/approve`; disponibilité :
  `hr.availability.read`; exigences : `hr.qualifications.read`; lien poste :
  `manufacturing.read`; facturation : `billing.customer-invoices.read/manage`.
- Dans Mon travail → réglages des suivis : fuseau IANA de l'entreprise, sources et
  horizon d'expiration. Confirmer par exemple `America/Toronto` avant de planifier.

## Scénarios d'acceptation

| Parcours          | Manipulation                                                                                                 | Résultat attendu                                                                                                 |
| ----------------- | ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| Mon travail       | Créer un SAV sans responsable, un dossier Qualité ouvert, des heures soumises et une qualification expirante | Signaux avec raisons et liens sources; aucune copie de motif d'absence                                           |
| Fin d'un suivi    | Affecter le SAV, traiter le dossier ou approuver les heures puis actualiser                                  | Le signal concerné évolue/disparaît sans clôture cachée d'un autre module                                        |
| Planning          | Affecter une intervention avec durée; filtrer jour/semaine/personne/équipe; déplacer une carte               | Panneau de vérification, confirmation et relecture des versions avant écriture                                   |
| Contraintes       | Essayer chevauchement, absence approuvée ou compétence ne couvrant pas toute la période                      | Refus explicite; un créneau adjacent est accepté; ancien dossier incomplet signalé                               |
| Devis → projet    | Créer un devis avec prestation, enregistrer puis accepter deux fois                                          | Prix figés, un seul projet brouillon; activation et interventions restent explicites                             |
| Client partagé    | Relier le partenaire Catalogue au client Facturation et, si souhaité, à la société CRM                       | Correspondances explicites, aucun rapprochement par nom ni changement d'une ancienne facture                     |
| Travaux → facture | Saisir/soumettre/approuver 90 minutes; sélectionner la source et un tarif de 80/h                            | Facture **brouillon** de 120 avant taxes; lien vers Facturation; aucun envoi automatique                         |
| Reprise           | Reprendre exactement la même demande après une réponse réseau incertaine                                     | Même résultat, aucune seconde facture; une source déjà facturée est refusée                                      |
| Correction        | Tenter réouverture du temps/retour de pièce déjà facturés                                                    | Refus; supprimer seulement le brouillon via Facturation libère la source, l'ancienne clé reste consommée         |
| Droits            | Ouvrir les mêmes pages avec lecteur restreint, puis une autre entreprise                                     | Aucun détail sensible ni mutation interdite; accès serveur protégé même par URL directe                          |
| Tutoriel          | Première entrée avec nouvel utilisateur puis retour au module                                                | Présentation adaptée au module une seule fois; progression conservée; aucun bouton permanent « tutoriel métier » |
| Stock/MRP         | Réceptionner partiellement une commande, tenter une sur-réception et consulter le stock                      | Registre WMS atomique, quantité exacte, sur-réception refusée; aucun double comptage MRP                         |

## AI — recette séparée, volontaire

Après provisionnement Hermes, configurer le fournisseur **dans Pulsar pour ce tenant**.
Créer le preset Coordinateur Services et SAV en **PROPOSE**, sans always-on, avec droits
et modules minimaux. Les boutons Assistant ouvrent une conversation préparée, sans
envoi automatique. Demander une lecture du dossier puis une proposition d'affectation
ou de suivi SAV : elle doit rester PENDING jusqu'à approbation. Modifier le dossier
entre proposition et approbation : la version obsolète doit être refusée.

Le modèle ne doit pas approuver heures, congés, habilitations ou factures, ni envoyer
un message client avec ces nouveaux outils. Les contrôles incomplets de planning ne
peuvent être acceptés par l'agent. Pas de nouveaux réveils always-on pour ces signaux;
le worker MRP existant conserve son propre workflow. Qualifier qualité des réponses,
coûts et latence séparément : les tests sans fournisseur ne les prouvent pas.

## Limites et preuve de recette

Pas d'APS de main-d'œuvre, de réservation de capacité Fabrication, de synchronisation
automatique CRM, d'heures générées depuis un devis, de grille tarifaire reprise
automatiquement ou de workflow complet d'avoir compensatoire Services. Après
approbation d'une facture, ne pas contourner le gel des sources par édition SQL.

Le planning affiche au plus 100 personnes/500 interventions; les sources facturables
sont bornées et les limites signalées. Les données sont contrôlées au moment de la
mutation; une absence approuvée ultérieurement nécessite une revue du planning.
Le pilote scanner clavier doit encore être essayé sur les vrais Zebra/USB/Bluetooth.

Noter SHA, date, entreprise fictive, navigateur, résultats et erreurs sans secrets.
Ne transmettre ni token JWT, ni lien d'invitation, ni dump de données. Aucun test
local ne remplace la vérification HTTPS, fichiers persistants et restauration VPS.
