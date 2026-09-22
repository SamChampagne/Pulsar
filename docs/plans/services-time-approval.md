# Services — approbation des heures

Lot local du 21 septembre 2026 sur `codex/end-user-workflows`, suite de
[services-assignment-time.md](services-assignment-time.md). Aucun push/PR dans ce lot.

## Parcours et règle de contrôle

Le registre `/services/time`, le détail projet et l'onglet Temps de travail des interventions
partagent le même workflow et les mêmes totaux. Une saisie concerne une personne, une date et
une intervention; il ne s'agit pas encore d'une feuille hebdomadaire regroupée.

| État                      | Actions permises                                                         |
| ------------------------- | ------------------------------------------------------------------------ |
| À soumettre (`RECORDED`)  | Corriger, annuler avec motif, soumettre                                  |
| À approuver (`SUBMITTED`) | Retirer la soumission; approuver ou demander une correction              |
| À corriger (`REJECTED`)   | Corriger, annuler avec motif, resoumettre                                |
| Approuvé (`APPROVED`)     | Rouvrir pour correction avec motif, sans modifier directement les heures |
| Annulé (`VOIDED`)         | Lecture seule, aucune suppression ou réactivation                        |

Les mutations exigent un projet actif. La clôture d'un projet (terminé **ou** annulé) exige
désormais que tous ses temps soient approuvés ou annulés, en plus des interventions fermées.
Une réouverture du temps retire immédiatement sa contribution au total approuvé; les heures
restent déclarées. La correction doit ensuite être soumise et approuvée à nouveau.

La permission `services.time.approve` est **distincte** de `services.manage` et
`services.time.write`. Un responsable qui peut gérer un projet n'acquiert pas automatiquement
le droit d'approuver. Les administrateurs système reçoivent la nouvelle permission via la
synchronisation existante; les autres rôles sont configurés explicitement dans Accès.

La personne qui approuve, demande une correction ou rouvre doit être interne et active, et
différente de l'intervenant, de l'auteur initial de la saisie et de l'auteur de sa dernière
correction journalisée. Aucun contournement administrateur ni auto-approbation. Cela nécessite
un autre utilisateur habilité, même pour un tenant utilisé au départ par une seule personne.
Si un gestionnaire saisit pour un intervenant, ni l'un ni l'autre ne peut approuver cette saisie.

Soumettre/retirer reste accessible au propriétaire avec `services.time.write`, ou au
gestionnaire avec `services.manage`. La lecture d'équipe exige `services.read`; ce périmètre
n'est pas un module RH confidentiel. Le module Services doit être activé sur tous les endpoints.

## Stockage et transitions

- `ServiceTimeStatus` est étendu; aucun état existant n'est réinterprété comme approuvé.
- `canTransitionServiceTime` de `@pulsar/shared` reste obligatoire, avec contrôle supplémentaire
  de l'action demandée côté service. Une demande `REOPEN` ne peut pas retirer une soumission.
- Chaque décision/correction/annulation écrit un `ServiceTimeReview` dans la **même transaction**
  que le changement de l'entrée : auteur, action, état avant/après, motif et snapshots avant/après
  de la date, des minutes, de la note et du caractère facturable. L'ancienne approbation n'est
  jamais effacée lors d'une réouverture. Le journal ne possède aucun endpoint d'édition/suppression.
- Le journal est relié à son entrée et son auteur par FK composites tenant/id, avec une version
  unique `(tenantId, timeEntryId, entryVersion)`. Les noms affichés restent les noms actuels
  des utilisateurs; les identifiants d'acteur et snapshots métier sont conservés.
- Toutes les écritures utilisent le verrou tenant partagé avec projets/interventions. La
  décision réclame la version et le statut par `updateMany` conditionnel; une décision concurrente
  sur la même version échoue en 409. La version progresse strictement.
- Le contrôle de personne peut réutiliser le client transactionnel d'`OwnershipService`, sans
  emprunter une connexion supplémentaire pendant que la transaction détient le verrou.
- Les décisions sont aussi envoyées à l'audit existant après commit. Le journal métier atomique
  garantit la trace de la version même si cet audit best-effort est indisponible.

Le plafond quotidien compte **tous les temps non annulés**, quel que soit leur état de revue.
Un refus ne libère donc pas artificiellement de capacité de saisie. Les corrections restent
limitées aux états À soumettre/À corriger. Le classement facturable devient figé avec la version
approuvée, mais ne déclenche aucun calcul de montant, facture ou paie.

## API et interface

Nouvelles routes relatives à `/api/v1` :

- `POST services/time-entries/:id/review` : `action`, `expectedUpdatedAt`, motif obligatoire
  pour `REJECT` et `REOPEN`; actions autorisées `SUBMIT|WITHDRAW|APPROVE|REJECT|REOPEN`.
- `GET services/time-entries/:id/reviews` : historique paginé, projection explicite sans
  courriel, rôle ou secret. Le registre expose la dernière entrée et le nombre d'événements.
- `GET services/time-entries?status=...` : filtre serveur appliqué avant pagination. Les
  totaux complets suivent **tous les filtres**, pas seulement les lignes de la page visible.

L'UI ajoute les badges d'état, le raccourci À approuver, les heures approuvées/en attente et
le détail des heures approuvées déclarées facturables. Chaque décision a une confirmation
contextuelle; refus/réouverture demandent un motif. Historique affiche les personnes, dates,
motifs et versions consultables, avec pagination. La navigation/fermeture des panneaux est
protégée pendant une décision. Les contrôles serveur restent l'autorité, notamment si une
correction par un autre utilisateur a rendu l'approbateur inéligible entre-temps.

Après une réponse incertaine, l'UI bloque le renvoi de la décision et propose de fermer pour
inspecter l'état/historique rafraîchis. La version empêche une double décision. La création
de temps conserve son intention durable et sa clé d'idempotence du lot précédent.

La refonte reste ciblée : composants, typographie, thèmes, panneaux et navigation Pulsar
conservés; pas d'identité graphique secondaire. Aide contextuelle, Documentation et tutoriel
Services expliquent le nouveau cycle; les visites terminées ne sont pas réimposées.

## Migration et compatibilité

`20260921230000_services_time_approval` : nouveaux états, table de journal, indexes et
contraintes. Appliquée uniquement sur `pulsar_enduser_20260921` (**88 migrations**), sans
modifier `.env` ni la base utilisateur. Une mise à jour du jeton est nécessaire pour obtenir
la nouvelle permission. API et web ont été relancés/utilisés sur cet environnement isolé.

Les anciennes entrées `RECORDED` restent À soumettre; aucun journal rétroactif n'est fabriqué
et les anciennes corrections ne sont pas attribuées à un acteur supposé. Les anciennes
annulations gardent leur motif. Les projets déjà fermés restent en lecture seule, y compris
s'ils possèdent des temps historiques non approuvés : aucune réouverture de projet implicite.
Avant une future facturation, prévoir une procédure explicite pour ce stock historique.

## Vérifications

- Tests unitaires du graphe de transitions : soumission obligatoire, retrait, refus,
  resoumission, réouverture et états interdits.
- Tests HTTP/PostgreSQL : permission dédiée, indépendance auteur/intervenant/dernier
  correcteur, mutations interdites pendant/après revue, motifs, snapshots, pagination,
  totaux filtrés, décision concurrente, fermeture concurrente et isolation tenant.
- Tests navigateur : soumission/retrait avec impossibilité d'auto-approuver; deuxième
  utilisateur, refus/correction/resoumission, perte de réponse après approbation réelle,
  inspection sans doublon puis réouverture motivée. Scénarios précédents conservés.

Résultats sur la base isolée : **1 474 tests unitaires** (shared 846, API 526, web 102),
**37 tests HTTP/PostgreSQL** (business-foundations, end-user-workflows, scanning-tours) et
**32 scénarios navigateur Chromium** des mêmes lots réussis. Typecheck complet : zéro erreur,
12 avertissements préexistants; compilation complète réussie. Contrôle visuel du registre et
de l'historique avec les versions avant/après correction effectué dans le navigateur local.
Ce lot n'est pas une recette complète de tous les modules historiques ni d'un environnement
de production.

## Suite et limites

Prochaine tranche : correspondances Catalogue ↔ articles WMS, puis pièces consommées depuis
les interventions via `InventoryService.postMovement`, avec confirmations et idempotence.
Ensuite seulement : devis/facturation sur versions approuvées et pièces réellement consommées,
avec snapshots financiers et interdiction de rouvrir silencieusement une version déjà facturée.

Hors périmètre : validation hebdomadaire/en masse, plusieurs niveaux d'approbation, délégation,
notifications/relances, minuteur, signature, paie, facturation, stock, événements et outils AI.
La revue est humaine, aucun agent ne peut l'exécuter hors du futur registre/gouvernance.
