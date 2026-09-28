# Programme enterprise — approfondir Pulsar sans perdre sa modularité

Date : 2026-09-24. Branche locale : `codex/pilot-business-depth`.
Source : [registre des 271 fiches V2–V4](../audits/README.md), rapport fourni par l’utilisateur.

Dernier incrément local : [I2l.3 — dossier fournisseur documentaire](billing-supplier-dossiers.md),
registre transversal factures/avoirs/pièces, synthèse exacte par devise et filtres paginés,
lecture Finance autonome sans dette ou contexte opérationnel inféré.
Il prolonge [I2l.2 — avoir fournisseur reçu](billing-supplier-credits.md),
source qualifiée, cumuls monétaires bornés, original protégé et retour WMS facultatif
versionné. Finance autonome, sans paiement/comptabilisation ni modification de stock.
Il prolonge [I2l.1 — facture fournisseur générale](billing-supplier-invoices.md).
Il suit [WMS I2k — suivi fournisseur](wms-supplier-return-followup.md) : constats partiels
et corrections versionnées, sans modifier la sortie ni créer d’avoir.
Il suit I1 Catalogue/Achats et I2a–I2h
lots, comptages, Services, Fabrication, quarantaine, Qualité et traçabilité. I1/I2 restent
partiels; les 271 exigences ne sont pas clôturées par ces incréments.

## Décisions de conception

Le rapport est une cible métier à confronter aux services et aux scénarios réels, pas une
instruction d’exécuter son HTML ni une preuve de 271 défauts. Ses recommandations ne
remplacent pas les règles du dépôt. L’inspection de ce lot porte sur les référentiels et
leurs consommateurs; l’ensemble Finance/APS/POD n’a pas été requalifié dans ce lot.

- Garder le bureau d’applications et les composants Pulsar. Un panneau latéral conserve
  la liste et son contexte; les options avancées apparaissent quand le travail le demande.
- Les capacités communes sont partagées, les transactions métier restent distinctes.
  Une entreprise utilisant uniquement Transport ou Services ne doit pas acheter/activer
  un autre module pour créer ses références nécessaires.
- Distinguer dépendance de données et dépendance métier : facturer exige les droits de
  Facturation; entretenir une adresse ne les exige pas. Masquer un champ n’est pas une sécurité.
- Configurable ne signifie pas arbitraire : libellés et vues libres, règles de processus
  explicites, validation serveur commune, versions et explications des effets. Ne pas
  introduire des interrupteurs qui contournent audit, états ou isolation.
- Aucune migration de fusion par nom/courriel. Une correspondance commerciale ne donne
  jamais accès aux transactions ni documents de tous les comptes d’un groupe.
- Privilégier une boucle métier démontrée à une nouvelle liste sans action aval. Les agents
  expliquent/proposent via les services gouvernés; ils ne créent pas leurs propres règles.
- Le rôle de Pulsar pour comptabilité officielle/paie est à confirmer par entreprise :
  natif ou externe, mais un seul maître par objet, contrats et rapprochements explicites.
  Aucun moteur fiscal/légal n’est déduit d’un exemple illustratif du benchmark.

## Séquence de réalisation

| Lot                               | Périmètre et fiches principales                                              | Prérequis / sortie attendue                                                                                                                                                             |
| --------------------------------- | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| E0 — Qualification                | ST05, DO04, AX05; inspection des 271 fiches                                  | Catalogue des exigences conservé; existence, configuration, mode simulé, tests et limites distincts. Pas de pourcentage enterprise inventé.                                             |
| E1 — Identité et engagement       | CL01–CL10, CR02–CR03, CA01–CA03, PO01–PO03                                   | Carnet versionné → rôles transactionnels figés → devis/commande révisés → conditions/prix/crédit. Un donneur d’ordre, un livré, un facturé et un payeur distincts sans fuite de droits. |
| E2 — Vérité de livraison          | PD01–PD04, PD06–PD09, PD12, PD16, TD01/TD12–TD14                             | Contenu et unités explicites; exemple 100 = 92 remises + 5 à bord + 3 manquantes. Dommages inclus dans remises, pas additionnés. POD, acceptation, retour et facture distincts.         |
| E3 — Engagements de transport/APS | TD02, TD06–TD09, AD01–AD03, AD08–AD12                                        | Pas de double tender/réservation; plan publié et exécution partielle protégés, publication sur entrées fraîches. Aucun dépassement des contrats APS existants.                          |
| E4 — Finance démontrée            | F01–F18, F32/F35/F36, FI01–FI07 puis coûts F19–F28                           | Audit des writers actuels, périodes, écritures/reprise et sous-livres; partiels/avoirs/paiements rapprochés. Politique validée avant comptabilité officielle.                           |
| E5 — Service et cash              | SA01–SA07, SE01–SE07, PO04–PO06, SV01–SV06                                   | Droits de support, SLA, visites/contrats, coût/prix et couverture séparés; retour physique et correction financière reliés sans automatisme implicite.                                  |
| E6 — Exécution métier             | WX/QX/MX/EX/BX/HX, AF/RH/QU/FA/FL/CY                                         | Qualité bloquante, stock admissible, atelier réel, qualifications et maintenance; déployer selon profil distribution, industrie, service ou transport.                                  |
| E7 — Canaux et maîtrise           | CO/IX, WF, ST, DO/DX, EM/UX/SI                                               | Contrat d’échange, version, autorité, ordre des événements, accusé métier, compensation et conservation; livré avec chaque lot concerné.                                                |
| E8 — Optimisation                 | BI/AX, AG, PE, CA04–CA06, CR01/CR04–CR06; extensions Finance conditionnelles | Mesure réconciliée et retour à la source avant optimisation; scénarios comparés, limites du solveur et gains démontrés.                                                                 |

Ce tableau regroupe les 271 fiches indexées, sans les considérer comme autant de développements
indépendants ni transformer les liens du rapport en graphe strict. Chaque lot sera découpé
en incréments déployables après inspection. E1 n’impose pas E2 à une entreprise de services.
La paie, la douane, la banque et la comptabilité de groupe restent des marchés/contrats à
qualifier, pas des options annoncées comme prêtes.

## E1a — carnet de références livré dans ce lot

### Parcours

Clients → registre → **Carnet**, ou Transport → Clients → **Carnet**, ou espaces Données
de Services/SAV/Facturation/Achats fournisseurs/administration interne du Portail.
Ajouter une adresse ou un contact, donner un libellé et une fonction libre, choisir des
dates éventuelles, enregistrer avec un motif, corriger ou désactiver puis consulter l’historique.

- Plusieurs entrées, recherche et pagination serveur par identité/type.
- Dates civiles : début inclusif, fin exclusive; date de comparaison explicite dans l’écran.
  Il s’agit de validité descriptive, jamais d’une révocation de session ou d’un accès portail.
- Versions append-only : snapshot complet, auteur interne, date et raison. Pas d’API de
  suppression d’entrée ou de réécriture d’une ancienne version.
- Modification exige la version courante. Deux changements concurrents à partir de la même
  version ne peuvent pas s’écraser. Le type adresse/contact et le propriétaire sont immuables.
- Création/édition idempotentes sur tenant/acteur/operationKey; l’empreinte inclut propriétaire,
  identifiant cible, version attendue, données normalisées et motif. Même clé/autre corps → 409.
  Rejouer une ancienne opération retourne son reçu historique, sans rétablir cette ancienne version.
- Le client conserve la demande dans le stockage de session de l’onglet, par entreprise,
  utilisateur et carnet, avant envoi. Une erreur réseau/5xx conserve exactement clé et corps;
  une nouvelle action n’est pas proposée tant que sa réponse n’est pas clarifiée. La reprise
  est manuelle; le serveur relit toujours les droits courants.
- Validation partagée fermée UI/API : champs inconnus rejetés, limites, téléphone, courriel,
  formats postaux, dates réelles et intervalle cohérent. Pas de géocodage ni garantie postale.

### Modèle et frontières

`PartyDirectoryEntry` pointe vers exactement un `Customer` OU un `BusinessPartner`, avec
FK composites tenant + propriétaire et contrainte SQL XOR. `PartyDirectoryRevision` stocke
le reçu/version dans la même transaction que l’entrée, sous verrou business tenant. Les
lectures, recherches, compteurs et historiques filtrent tenant, propriétaire et rôle partenaire.
Les routes sont générées depuis un catalogue serveur fermé, avec module et permissions propres
à chaque consommateur. L’audit global conserve l’identité de l’action; le détail est dans le journal.

Migration additive 112 : aucune copie automatique d’adresses ni fusion d’identités, aucune
mise à jour de facture, de Location, d’expédition, de stock, de portail ou de paramètre de tenant.
L’application Clients n’est pas activée automatiquement. Les fournisseurs bénéficient du
même carnet via Achats fournisseurs, sans les transformer en clients.

### Ce que cette livraison ne couvre PAS

CL01, CL03 et CL07 sont seulement **partiellement fondés**, pas validés au sens du rapport :

- Pas encore de Party globale, hiérarchie de comptes, personne partagée entre entreprises,
  affiliation avec révocation d’accès, crédit commun ou rôles payeur/facturé sur les transactions.
- Les anciennes coordonnées principales/facturation/livraison restent distinctes du carnet.
  Aucun champ n’est synchronisé dans les deux sens. La sélection d’une entrée/version sur
  les devis, commandes, factures et notifications est le prochain incrément E1b.
- Pas de révision à date d’effet d’un ancien état : les dates décrivent la dernière version,
  et Historique permet de lire les snapshots; l’écran « Validité au » n’est pas une requête
  bitemporelle des données telles qu’elles étaient connues ce jour-là.
- Pas d’envoi, de pouvoir mutating IA, d’auto-approbation, de préférence marketing ni de signature.
- Le stockage de reprise est limité à l’onglet : fermer la session du navigateur peut le perdre.
  Après perte de ce stockage, inspecter le carnet et l’historique avant de saisir à nouveau.
- Pas de rétention/anonymisation métier dédiée; ne pas y saisir de secrets, données bancaires,
  médicales ou pièces d’identité. Les lecteurs du référentiel peuvent voir son carnet et son histoire.

### E1b — avancement et suite

Premier incrément E1b.1 : sélection explicite et gel des coordonnées dans les devis Services
et factures clients. Voir [contrats et limites](document-coordinates.md).
E1b.2 étend le même contrat aux [commandes Transport](transport-order-coordinates.md),
avec protection de concurrence et planification atomique. E1b.3 relie explicitement la copie
facture au [PDF d’avoir et à sa suggestion de destinataire](credit-document-coordinates.md).
E1b.4 sécurise [publication et remise de la facture client](customer-invoice-documents.md),
avec accès portail au fichier canonique et fermeture des raccourcis automatiques historiques.
E1b.5 ajoute le [carnet autonome CRM et le gel des commandes commerciales](crm-order-coordinates.md),
sans imposer une fiche Customer, avec version parent, relecture sous verrou et reprise UI.
E1b.6 branche les [commandes fournisseurs](supplier-order-coordinates.md), avec des rôles
propres au fournisseur, sans confondre son adresse et le lieu de réception de l’acheteur.
Achats seul suffit; copies figées et réceptions WMS restent indépendantes.
E1b.7 livre la [revue des usages d’une entrée du carnet](directory-document-impact.md) :
brouillons et copies engagées historiques, cinq types de documents, pagination et droits
consommateurs jusque dans les compteurs. Aucune propagation automatique ni lecture d’identités liées.
E1b.8 livre le [rapprochement explicite et la fiche entreprise](enterprise-information-depth.md) :
revue/confirmation des liens existants, lectures inverses gardées, profils privés et versionnés,
15 champs descriptifs et 20 renseignements nommés. Aucun champ opérationnel n’agit implicitement.
Le même plan couvre l’enrichissement de tous les modules (programme I), qui reste à implémenter
par lots avec validations, usages et tutoriels; les profils ne clôturent pas cette demande globale.
Restent aussi les autres PDF/envois, l’identité/adresse de l’acheteur,
les anciens rapprochements ambigus et les quatre identités transactionnelles.
Les cinq axes ci-dessous décrivent le programme complet, pas cinq tâches closes.

1. Choix explicite d’adresse/contact et de leur **version** sur les brouillons consommateurs.
2. Snapshot des rôles et coordonnées au jalon d’engagement défini par chaque métier.
3. Prévisualisation des effets d’une modification sur les dossiers ouverts, sans toucher au passé.
4. Correspondance humaine Customer/BusinessPartner/CRM; doublons signalés, aucune fusion implicite.
5. Contrôle d’accès portail distinct de la fonction descriptive; expiration d’affiliation traitée
   seulement lorsque le modèle d’autorité associé sera disponible et testé.

## Preuves requises à chaque incrément

Conserver fiche du rapport, constat de code, écart résiduel, mode natif/connecté, règles et
autorité, version/snapshots, cas nominal, partiel, correction, concurrence/replay/panne,
isolation/rôle limité et effets aval. Ajouter doc et tutoriel spécifiques sans relancer
automatiquement les tutoriels déjà vus. Tester l’app seule et avec ses connexions autorisées.
Les compteurs financiers et physiques doivent se réconcilier au-delà d’une seule page de liste.

## Recette locale E1a — 2026-09-24

- Migration additive `20260924010000_party_directory` appliquée sur la base locale isolée
  `pulsar_enduser_20260921` seulement (112 migrations). Aucun reset, `.env` ou base utilisateur modifié.
- Builds Shared, Database, API et Web réussis. Vérification Svelte : zéro erreur,
  douze avertissements préexistants hors de ce lot.
- 929 tests partagés, dont 16 sur le contrat du carnet; 666 tests unitaires API;
  129 tests Web, dont deux sur les demandes de reprise stockées par session/utilisateur/carnet.
- 93 tests HTTP : `module-autonomy`, `business-foundations` et `taxes`. Les nouveaux scénarios
  du carnet couvrent les façades, droits limités, isolation tenant/propriétaire, validation,
  création concurrente, version attendue, reprise ancienne et conservation des données principales.
- Huit parcours Playwright : `module-autonomy.spec.ts` et `party-directory.spec.ts`,
  Chromium, un worker. Clients seul et Services seul : adresse/contact, dates, désactivation,
  historique, écriture réellement commise puis réponse perdue et reprise après rechargement;
  lecture seule et autres parcours d’autonomie préservés. Captures ordinateur/mobile inspectées.
- Les tests HTTP créent un préfixe `autonomy-…` à transmettre via
  `PULSAR_AUTONOMY_TENANT_PREFIX` aux tests Web; régénérer les fixtures avant de rejouer
  le scénario de tutoriel première ouverture (il conserve réellement son état par utilisateur).
- Commandes unitaires : `pnpm --filter @pulsar/shared test`,
  `pnpm --filter @pulsar/api test -- --runInBand`, `pnpm --filter @pulsar/web test`.
  Les tests HTTP nécessitent le `DATABASE_URL` de recette explicite; ne pas les exécuter
  sur une base de production. Les parcours navigateur nécessitent API/Web pointant sur cette base.

Ce lot n’est pas une qualification complète des autres domaines du rapport. Aucun email réel,
accès externe, pouvoir agent, déploiement, commit, push ou PR n’est produit par cette livraison.

## Sources et limites de recherche

Le catalogue conserve les références du rapport; elles n’ont pas toutes été relues ni leurs
exemples certifiés. Pour ce lot, lecture indépendante des pages officielles suivantes :

- [Microsoft — account, contact, customeraddress](https://learn.microsoft.com/en-us/power-apps/developer/data-platform/customer-entities-account-contact) :
  distingue entreprises, personnes et adresses, et permet plusieurs coordonnées. Pulsar
  s’en inspire sans recopier son schéma ni ses automatismes de création d’adresses vides.
- [Oracle — Trading Community Architecture](https://docs.oracle.com/cd/E26401_01/doc.122/e48950/T172155T172158.htm) :
  référence conceptuelle pour séparer identité et relation commerciale. La livraison E1a
  n’est pas une implémentation de TCA.

Le détail Finance/paie/fiscalité requiert des choix de marché et validation par le responsable
métier avant d’appliquer les exemples du rapport comme politique réelle.
