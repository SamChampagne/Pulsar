# Finance I2m.2c — immobilisations et amortissements qualifiés

## Périmètre

Extension : [I2m.2d.2e.1](billing-asset-history-qualification.md) qualifie les
journaux de dotations déjà enregistrés, ensemble sur preuve. Le registre original
reste inchangé et le plan futur des anciens actifs reste bloqué.

Finance autonome : nouvelles immobilisations dans une devise de transaction
explicitement déclarée, plan linéaire mensuel exact et écriture contrôlée par mois.
Le profil comptable reste une cible de préparation, jamais un défaut de devise.
Pas de conversion, acquisition automatiquement comptabilisée, méthode fiscale,
prorata journalier, réévaluation, cession comptable ou période fermée dans ce lot.

## Contrat

- Anciennes immobilisations et dotations sans devise : aucun backfill, aucun plan
  historique inventé. Lecture seule; leur qualification avec preuves reste un lot
  distinct. Les nouveaux amortissements sans devise sont interdits.
- Création : UUID, devise, coût et résiduel exacts (0 ≤ résiduel ≤ coût), dates
  civiles, premier mois explicitement choisi, durée 1–1200 mois, comptes actifs
  locaux distincts (charge EXPENSE, amortissement cumulé ASSET).
- Convention V1 clairement affichée : mensualités complètes, cumuls linéaires
  arrondis au centime (demi supérieur); chaque dotation est la différence entre
  deux cumuls. Somme exacte = coût − résiduel, jamais de montant négatif.
- DRAFT modifiable à version attendue; activation après revue/token capture un
  plan immuable. Aucun changement des paramètres financiers après activation.
- Comptabiliser seulement le prochain mois du plan, à la date civile de fin de
  mois, non future en UTC. Pas de trou, doublon, anticipation ni montant client.
  Une allocation nulle est tracée sans écriture fictive de montant zéro.
- Verrou business tenant puis GL; relecture sous verrou. Dotation, cumul, journal,
  version, audit et opération de reprise sont atomiques. Reprise UUID/acteur/corps
  avant validation du nouvel état. Aucun nouveau pouvoir agent; humain actif et
  droit distinct `billing.assets.post` pour la comptabilisation.
- Retirer du suivi exige motif/version/confirmation, état DISPOSED via la machine
  existante. Ce retrait ne vend pas l’actif et ne solde pas sa valeur comptable.
  Pas de suppression physique des brouillons; historique conservé.
- UI séparant plan prévisionnel et dotations enregistrées, devise affichée sur
  chaque montant, accès journal avec son droit, reprise persistée par utilisateur
  et entreprise. Aide, documentation et premier tutoriel enrichis sans reset.

## Suite

Qualification contrôlée des anciens actifs et de leurs écritures avec preuves,
contrepassations, devise fonctionnelle/taux, périodes/clôtures et cession comptable.

## API et compatibilité

Tous les endpoints restent sous `/api/v1/billing/fixed-assets`, module Finance et
droits actifs. `GET /accounts` fournit les comptes actifs utiles au registre sans
imposer le droit de lecture du journal. Le plan comptable initial existant est
provisionné si l’entreprise n’en a encore aucun. Aucune dépendance à Flotte ou WMS.

- POST : UUID `operationKey`, code, nom, catégorie et référence (chaînes vides
  acceptées pour ces deux dernières), devise, date `YYYY-MM-DD`, premier mois
  `YYYY-MM`, coût/résiduel **chaînes** de deux décimales maximum, durée et comptes.
- PATCH `/:id` : même contenu complet et `expectedVersion`; seulement DRAFT.
- GET `/:id/schedule` : objet `asset/qualified/rows/depreciations/next/nextDue/reviewToken`,
  remplace l’ancien tableau flottant. Le plan figé est lu tel quel, avec hash
  canonique indépendant de l’ordre des propriétés JSONB.
- POST `/:id/activate` : UUID/version, `confirmed: true`, token de la revue courante.
- POST `/:id/depreciate` : UUID/version, `confirmed: true`, `period: YYYY-MM` exact
  du prochain mois. Aucun montant ou date comptable fournis par le client.
- POST `/:id/dispose` : UUID/version/confirmation/motif; retire du suivi,
  conserve le nom historique du endpoint mais ne comptabilise aucune cession.
- DELETE : refus 409; GET `/:id/history` : vingt dernières opérations versionnées.

Les anciens clients doivent être adaptés : bodies versionnés obligatoires,
montants chaînes, premier mois et devise explicites, confirmation des actions.
`billing.assets.post` doit être attribué explicitement aux rôles concernés, puis
leur session rafraîchie. Aucun rôle existant ni agent n’est promu par ce lot.

Migration additive **135** : `20260927060000_fixed_asset_currency`. NULL conservés
sur anciens actifs/dotations; aucune copie supposée depuis un réglage ou GL.
Chaque nouvelle dotation positive lie son écriture par FK composite tenant/journal;
une dotation nulle exige une absence de journal. Les opérations lient acteur et actif
du même tenant et ne sont jamais réécrites par les writers. Suppression restreinte.
L’interface conserve le corps exact par tenant/utilisateur avant envoi, bloque une
seconde opération et ne jette pas une demande incertaine sur un 403 intermédiaire.

Limites connues : registre encore en liste complète (sans charger les snapshots
de plan dans la liste), plan paginé côté écran par 24 mois, durée maximale 1200 mois.
L’historique d’opérations montre 20 versions; les calculs incluent toutes les dotations.
La qualification d’un ancien actif exigera un parcours distinct avec preuves et revue;
créer un nouveau dossier ne doit pas servir à doubler un actif historique existant.

## Vérifications locales — 2026-09-27

- Shared : 1077 tests, dont les plans exacts sur 1 à 1200 mois, sommes au centime,
  mois nuls, année bissextile, résiduel et valeurs maximales.
- API unitaires : 691; Web : 217, dont validation fermée des demandes conservées
  et contenu du tutoriel spécialisé.
- HTTP : 140 tests, 11 suites Finance; 11 scénarios actifs couvrent isolation,
  rôles, bodies invalides, reprise acteur/corps, versions, plan figé, concurrence,
  mois futurs, comptes inactifs, rollback d’audit et historique NULL.
- Chromium : 9 parcours profil/budgets/journal/rapports/actifs; plan puis dotation,
  réponse perdue après commit, 403 intermédiaire, rechargement et même clé,
  journal filtré sur la dotation, retrait sans cession et vues 390 px.
- Svelte : 0 erreur, 12 avertissements déjà présents hors écran immobilisations.
- Builds Shared, Database, API et Web réussis; vérification de whitespace ciblée sans erreur.
- Base de test uniquement, aucun seed global, `.env`, push ou déploiement modifié.
