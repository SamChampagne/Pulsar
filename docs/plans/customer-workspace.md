# Dossier client 360° — P2a

## Usage et portée

Depuis une ligne client/partenaire ou une fiche société CRM, **Dossier 360°** réunit
les dossiers accessibles, avec leur référence, titre, statut et dernière modification.
Il réutilise les façades de Fiche entreprise : Clients est facultatif. Services seul
conserve projets, interventions et devis; la lecture d’un client ne donne pas accès
aux factures. L’aide et la Documentation Clients expliquent les liens; une leçon
spécifique complète la première visite, sans réinitialiser les tutoriels existants.

Sections P2a : projets, interventions et devis Services; demandes SAV; factures
clients; opportunités et commandes CRM; commandes Transport. Cette liste n’est pas
un inventaire de tous les objets de Pulsar : paiements, avoirs, pièces jointes,
expéditions, contrats et factures fournisseur restent dans leurs modules sources.
Un partenaire fournisseur utilise les mêmes correspondances explicites, mais cette
vue ne remplace pas le dossier financier fournisseur spécialisé.

## Identités : un seul lien

| Fiche ouverte   | Services / SAV                            | Factures / Transport        | CRM                              |
| --------------- | ----------------------------------------- | --------------------------- | -------------------------------- |
| Customer        | Partenaire dont billingCustomerId = fiche | Cette fiche                 | Sociétés dont customerId = fiche |
| BusinessPartner | Cette fiche                               | billingCustomerId explicite | crmCompanyId explicite           |
| CrmCompany      | Partenaire dont crmCompanyId = fiche      | customerId explicite        | Cette fiche                      |

Les interventions héritent du partenaire de leur projet : c’est leur relation métier
directe, pas une déduction d’identité. Aucun parcours Customer → partenaire → CRM
ni CRM → partenaire → Customer. Aucun rapprochement par nom, copie de carnet ou
reconstruction depuis un ancien snapshot. Les liens courants peuvent changer ce
qui est visible ici; la propriété et la copie historique d’un document ne changent
jamais. Les anciens liens contradictoires ne sont pas réparés par la lecture.

## Contrat API et sécurité

`GET <façade PARTY_ACCESS>/:id/workspace?source=…&search=…&page=…&pageSize=…`

- Source fixée par la façade : garde module et permission, puis recontrôle service.
- Section autorisée uniquement avec module actif **et permission de lecture du
  document**; filtrage avant compteurs, requêtes et projection de liens.
- Source explicitement demandée mais interdite ⇒ 403 générique; aucune existence
  divulguée. Fiche hors tenant ⇒ 404. Aucun accès public/portail externe ajouté.
- Tous les documents et chaque relation de sélection portent tenantId serveur,
  y compris les anciennes relations CRM sans FK tenant composite.
- Parent, correspondances, compteurs et page dans un snapshot RepeatableRead.
  Maximum huit sections; taille de page de 1 à 100, numéro de page de 1 à 100 000,
  recherche de 120 caractères.
  Ordre stable updatedAt décroissant puis id croissant; aucun chargement de tous
  les dossiers/identités en mémoire ni troncature silencieuse à vingt sociétés.
- Compteurs de section sans filtre, tous statuts; total de la page filtré par recherche.
  Aucun total monétaire, dette déduite, sommaire de paiement ou note privée exposé.
- Une erreur échoue la lecture entière : jamais remplacée par des zéros. Les
  permissions restent celles du JWT; cache modules existant de trente secondes.

Les liens UI pointent vers les dossiers exacts et leurs gardes existantes. Dossier
360° n’est pas une autorisation supplémentaire. L’état CRM affiché est l’étape
métier générale; le pipeline configurable détaillé reste dans l’opportunité.

## UX

Composants Pulsar existants; navigation latérale sur ordinateur, sélecteur compact
sur mobile. Recherche et pages serveur, date/fuseau utilisateur, actualisation
explicite. Réponses périmées ignorées si la sélection change. Chargement, aucune
section autorisée, sélection vide et panne sont distincts. Après échec, les anciens
dossiers disparaissent et Réessayer relit le même périmètre. Aucun writer métier,
changement de statut, activation, envoi, audit de mutation ou nouvel outil IA.

## Validation et suite

Tests ciblés : droits source/cible, modules désactivés, Services autonome, tenant
étranger, relations historiques incohérentes, liens directs et noms identiques,
pagination/recherche, absence de mutation, erreurs; UI bureau/mobile et reprise.
Les résultats exécutés sont consignés dans `docs/etat-du-projet.md`.

Aucune migration ni déploiement requis par ce lot. Ce premier panneau n’est pas
encore un moteur de blocages/prochaines actions ni une synthèse financière.
Suite : P3a, qualifier les exceptions Services (acceptation, partiel, correction
après facturation), puis exposer uniquement des états métier sourcés dans ce dossier.
