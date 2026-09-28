# Profondeur métier — Clients, fuseaux, tableaux et programme transport/finance

Date : 2026-09-23. Branche locale `codex/pilot-business-depth`.

## Périmètre livré dans ce lot

- Clients est une application **facultative**, avec `clients.read` / `clients.manage`.
  Ses deux registres exposent les tables historiques Customer (Transport/Facturation)
  et BusinessPartner client (Services/SAV). Aucune copie et aucune fusion par nom.
  Les façades des autres modules continuent sans Clients, Catalogue ou TMS imposé.
- Deux adresses structurées indépendantes par fiche : facturation et livraison par défaut.
  Aucune déduction depuis les anciennes Location. Aucun déplacement, recalcul de taxes
  ou remplacement d’un document déjà publié. Copier les adresses est une action explicite.
- La version lue est envoyée par le nouvel éditeur. Un Customer modifié entre-temps
  produit 409; les API historiques sans version restent compatibles. BusinessPartner
  garde son verrou et sa version obligatoires. Les données appartiennent au tenant JWT.
- Préférence IANA utilisateur, conservée sur le serveur. NULL suit le navigateur.
  Un bandeau reste visible dans le shell connecté, même sur mobile; il ouvre le réglage.
  Les helpers communs et les journaux migrés appliquent le fuseau utilisateur, avec
  décalage sur les instants complets pour distinguer les heures répétées à l’automne.
  Les chaînes YYYY-MM-DD sont civiles, jamais converties en un autre jour.
- Composant de tableau réutilisable, déployé dans les espaces Données et Clients :
  colonnes visibles, largeur à la souris/au clavier, réinitialisation, débordement contenu.
  Préférence **sur cet appareil**, isolée par tenant/utilisateur/tableau; aucune donnée
  métier ni permission modifiée. Colonnes d’identité et actions restent visibles.
- Documentation intégrée et tutoriel Clients spécifique, première entrée par utilisateur.

Migrations additives 110/111 : timeZone sur UserPreferences; adresses JSON sur Customer
et BusinessPartner. Pas de backfill inventé. Appliquées à la base de recette isolée seulement.

### Recette du lot

- 913 tests partagés, 666 tests unitaires API et 127 tests Web réussis.
- 80 tests HTTP réussis : `module-autonomy`, `business-foundations` et `taxes`.
  Couverture des droits, de l’isolation tenant, des adresses séparées, des versions
  concurrentes, des préférences et des calculs fiscaux existants (dont plus de trois lignes).
- Cinq parcours Playwright réussis : Services seul avec création intégrée,
  Clients seul (adresses, fuseau, colonnes et mobile), premier tutoriel Clients,
  Flotte seule et utilisateur Services en lecture seule. Aucune erreur navigateur relevée.
  Une contrainte HTML de code pays incorrecte a été détectée puis corrigée pendant la recette.
- Génération Prisma, builds shared/database/API/Web réussis. Contrôle Svelte : zéro erreur,
  douze avertissements préexistants. Contrôle des espaces Git réussi.

Recette sur `pulsar_enduser_20260921` uniquement, API locale sur 3100 et Web sur 5173.
Pour rejouer les cinq parcours, recréer les fixtures HTTP d’autonomie puis transmettre
leur nouveau préfixe `PULSAR_AUTONOMY_TENANT_PREFIX` à Playwright. Le parcours de première
entrée enregistre réellement la progression du compte de test; il exige une fixture neuve.
Les tests métier ordinaires masquent seulement la lecture des tutoriels via interception,
sans modifier les préférences de l’utilisateur de démonstration.

Aucun envoi réel de courriel, appel ISAAC, dépôt douanier, commit, push ou déploiement.
Clients est disponible à l’activation; aucun module supplémentaire n’a été imposé aux
entreprises existantes. Les modifications des lots locaux précédents sont conservées.

### Limites explicites

Ce n’est pas encore un dossier client 360° : pas de carnet multi-adresses, contacts multiples,
plafond de crédit ou rapprochement des identités depuis Clients. Le rapprochement existant
Services → Facturation reste disponible dans Services → Données. Les adresses ne sont pas
encore préremplies dans tous les documents; leur capture historique devra être ajoutée à
chaque writer de document, sans réécrire l’ancien.

Les plannings de site (Fabrication/Cour/Services) gardent leur fuseau métier explicite.
Les anciens champs `datetime-local` restent des saisies dans le fuseau de l’appareil :
ne pas prétendre qu’ils interprètent tous une heure saisie dans le fuseau choisi. Leur
migration demande un contrôle des heures inexistantes/ambiguës et une confirmation du
décalage. Ne jamais changer silencieusement les instants stockés ou les snapshots APS.
Les portails publics et l’administration plateforme indépendante ne sont pas couverts
par le bandeau du shell métier. Les tableaux spécifiques non migrés gardent leur ancien UI.

## Constats vérifiés dans le code

| Sujet     | Existant                                                                   | Écart à traiter                                                                                                         |
| --------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Cargo     | TransportOrder, Shipment, Load, shipment_load_legs, BOL                    | Pas de dossier de remanifeste versionné ni import cargo métier complet                                                  |
| POD       | Preuve par Shipment, signataire/date/notes, capture chauffeur et documents | Réserves, quantités acceptées/refusées, corrections historisées, hors-ligne/idempotence à approfondir                   |
| Connect   | Import CSV de référentiels, webhook entrant, EDI X12, outbox et journal    | Pas de véritable adaptateur ISAAC qualifié ni mapping durable de ses identifiants                                       |
| Fiscalité | Gabarits SALES/PURCHASE, nombre variable de lignes, calcul à base commune  | Pas de plafond 3 retrouvé; règles de juridiction, dates d’effet, exemption et taxes composées absentes du calcul simple |
| Clients   | Plusieurs identités historiques avec correspondances explicites            | Converger l’expérience sans migration automatique risquée ni module obligatoire                                         |
| Temps     | UTC + fuseaux métiers pour certains plannings; affichages hétérogènes      | Préférence livrée, conversion des éditeurs et audit de tous les formats à poursuivre                                    |

## Sources primaires et conséquences de conception

Références consultées le 2026-09-23. Ce cadrage n’est pas une certification douanière ou
fiscale; les règles d’une entreprise doivent être validées avec son analyste/comptable/courtier.

- [ARC — transporteurs de marchandises](https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/gst-hst-businesses/charge-collect-specific-situations/freight-carriers.html) :
  le traitement dépend notamment de la nature du mouvement et des accords intertransporteurs.
  Un trajet Canada→Canada passant aux États-Unis n’est pas assimilé automatiquement à une exportation.
- [ARC — mémorandum 28-2](https://www.canada.ca/en/revenue-agency/services/forms-publications/publications/28-2/freight-transportation-services.html) :
  distinguer taxable, détaxé et exonéré; conserver la justification et les sources du mouvement continu.
- [ARC — lieu de fourniture](https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/gst-hst-businesses/charge-collect-place-supply.html) :
  ne pas choisir la taxe transport simplement d’après l’adresse du payeur.
- [ASFC — D3-4-2](https://www.cbsa-asfc.gc.ca/publications/dm-md/d3/d3-4-2-eng.html) et
  [D3-1-1](https://www.cbsa-asfc.gc.ca/publications/dm-md/d3/d3-1-1-eng.html) :
  distinguer données cargo, moyen de transport, responsable de transmission, corrections et remanifestes.
  Un PDF BOL local n’est pas un accusé d’acceptation eManifest.
- [ISAAC — intégrations](https://www.isaacinstruments.com/platform/seamless-integration/) et
  [programme partenaire](https://www.isaacinstruments.com/platform/seamless-integration/open-platform/join-isaac-become-a-partner/) :
  la plateforme annonce des API; le contrat technique, les droits de données et l’environnement
  d’essai doivent être obtenus avant de coder un adaptateur actif. Aucun endpoint propriétaire inventé.

Conséquence architecturale : une observation télématique, une présence physique de marchandise,
une preuve de livraison et un état douanier sont quatre faits différents. Aucun GPS ne doit
automatiquement confirmer contenu, livraison ou mainlevée.

## Lots suivants, dans cet ordre

### A. Achever les référentiels et l’expérience temporelle

1. Dossier client relié par IDs explicites à CRM/Services/TMS/Facturation/SAV; détails d’un
   module seulement s’il est activé et autorisé. Pas de total financier sans devise/période.
2. Carnet d’adresses typées (facturation/livraison/enlèvement/autre), contacts par rôle,
   langues, devises, conditions de paiement et inscriptions fiscales validées.
3. Capturer l’adresse choisie sur le brouillon puis la figer au jalon métier adapté; séparation
   payeur/expéditeur/destinataire. Révision explicite si modification après acceptation.
4. Composant de saisie d’instant avec zone + décalage, rejet des heures inexistantes, choix
   entre les occurrences ambiguës. Qualifier Toronto/Vancouver/Kolkata et les passages DST.
5. Migrer les tableaux métier avec clés stables et préférences serveur par vue si demandé.

Critère : client uniquement Transport ou Services utilisable de bout en bout; aucune activation
supplémentaire pour ses références; historique inchangé après modification du client.

### B. Cargo, import et remanifestes opérationnels

Clarifier avec l’utilisateur si « remanifeste » signifie regroupement/transfert opérationnel,
dossier douanier, ou les deux. D’abord un modèle de contenu par expédition : identifiant externe,
colis/manutentions, poids/volume/unités explicites, scellés, marchandises et références.

- Import Connect : gabarit CSV, mapping enregistré, prévisualisation ligne par ligne,
  erreurs de références/unités/fuseaux, clé d’import idempotente et reprise sans doublon.
  Pas d’association automatique par nom approximatif; aucun dispatch à l’import.
- Révisions de manifeste append-only : origine, destinataire, acteur, motif, empreinte,
  numéro de révision, documents remplacés, contenu exact et jambes de transport.
- Split/merge/transfert : quantité source = répartie + reste; contrôle de capacité,
  cohérence shipment_load_legs en transaction; refus après jalons gelés sans correction.
- Générer à nouveau produit une version traçable, jamais l’effacement d’un ancien PDF.

Critères : réponse réseau perdue, doublon d’import, transfert simultané, chargement complété,
multi-tenant, palette partagée, échange de remorque et pertes partielles testés.

### C. POD et télématique

- POD structuré : livrés/refusés/manquants/endommagés, réserves, identité du signataire,
  heures appareil/serveur, emplacement avec précision et consentements appropriés.
- Documents protégés via DocumentsService, lien au manifeste/révision pertinent,
  corrections append-only et idempotence. Une correction ne supprime pas la preuve originale.
- Adaptateur ISAAC via Connect : credentials chiffrés par tenant, mapping véhicule/remorque/
  chauffeur, curseur, horodatage source/réception, dédoublonnage, points tardifs, détection
  périmée, pause, reprise bornée et journal d’erreurs. Contrat/sandbox fournisseur requis.
- La télématique observe; scanner/manifestes justifient le contenu. L’affectation camion↔cargo
  doit être datée afin qu’un point reçu en retard ne soit pas attribué au nouveau chargement.
- Aucun appel externe ni nouvelle autorité mutating pour l’AI sans gate et approbation.

Critère : camion hors ligne, événement répété/en retard, identifiant inconnu, changement de
remorque et fournisseur indisponible ne font jamais avancer une livraison automatiquement.

### D. Transfrontalier et finance configurable

- Dossier douanier distinct : pays traversés, expéditeur/destinataire/importateur/exportateur,
  courtier, références cargo/conveyance, régime, port, documents, statuts déclarés et accusés.
  Canada/États-Unis reste une hypothèse à confirmer; pas de transmission gouvernementale
  avant sélection d’un fournisseur/protocole et qualification.
- Catalogue fiscal versionné : juridiction, dates d’effet, catégorie de service/article,
  type taxable/détaxé/exonéré, motif/preuve, comptes, base et ordre de calcul.
  N lignes de taxes, pas trois colonnes fixes; taxes composées seulement si explicitement
  configurées et validées. Limites techniques bornées distinctes des règles fiscales.
- Calcul exact Decimal, devise/arrondis explicites, simulation expliquée avant validation;
  figer taux/base/motif/version sur chaque ligne. Jamais recalculer les documents validés.
- Finance : périodes/verrouillage, factures fournisseurs et rapprochement, acomptes,
  notes de débit, remboursement/affectation d’avoirs, conversion FX datée, balances
  auxiliaires/GL, relances autorisées et audit des corrections.

Critères : Québec→Ontario, Canada→États-Unis, États-Unis→Canada, Canada→Canada via les USA,
mouvement continu, sous-traitance, changement de taux à date, avoir partiel et multi-devise.
Les attendus fiscaux de ces cas doivent être approuvés par l’expert métier, pas inventés par l’AI.

## Approfondissement des autres modules (cadrage, non livré)

| Module         | Prochaine profondeur utile                                                         | Protection à conserver                                               |
| -------------- | ---------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| WMS            | Lots/séries, quarantaine, réservation, unités de manutention, scans et traçabilité | Stock via mouvements atomiques, jamais par champ client              |
| Fabrication    | WIP, temps par opération, rendement, traçabilité matière, capacité humaine         | Snapshots BOM/MRP/APS immuables, unités/sites explicites             |
| Cour           | Visite/remorque/contenu datés, rendez-vous multi-dossiers, conflits physiques      | Occupation dérivée et transitions gardées                            |
| Flotte         | Observations télématiques, inspections, usage daté et maintenance préventive       | Maintenance seule modifie la disponibilité, jamais réactiver RETIRED |
| Achats         | Retours, factures et rapprochement trois voies, écarts quantités/prix              | Réception physique distincte de clôture et paiement                  |
| CRM / Services | Client unifié visuellement, contrat/SLA, devis révisé, forfait/temps/pièces        | Sources facturables uniques, approbation indépendante                |
| SAV / Qualité  | SLA, garanties, retours et confinement/relibération du stock                       | Décision humaine, preuves et historique sans écrasement              |
| RH             | Matrice de qualifications, expiration, capacité, conservation des données          | Accès minimaux, pas de diagnostic ni décision légale automatique     |
| Agents         | Lecture sourcée du contexte, propositions de corrections, reprises après incident  | Permissions/modules/caps et gouvernance inchangés                    |
| Plateforme     | Test d’activation isolée pour chaque module, charge, restore, observabilité        | Pas de connecteur actif présenté comme qualifié sans preuve          |

Avant chaque lot : scénario réel de l’analyste → invariants → responsabilités des données →
écrans/actions → tests des échecs → tutoriel métier spécifique → documentation des connexions.
Ne pas ajouter des champs universels sans préciser qui les écrit, qui les lit et quand ils se figent.
