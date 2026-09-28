# Informations métier et rapprochement explicite — E1b.8 / programme I

## Demande et principe

Enrichir tous les modules sans transformer chaque écran en formulaire géant. Ce lot livre
le rapprochement des identités existantes et la fiche entreprise; **il ne clôt pas
l’enrichissement métier de tous les modules**. Les lignes ci-dessous sont les lots suivants,
pas une déclaration de champs déjà implémentés ni une qualification de toutes les lacunes.

Trois catégories doivent rester différentes :

1. Données structurées utilisées par les workflows : unités, dates, affectations, taxes,
   approbations, réservations. Elles exigent des règles et des tests métier dédiés.
2. Informations descriptives : consignes, références, contexte de relation. Elles n’agissent
   jamais silencieusement sur le fonctionnement du système.
3. Extensions tenant : champs spécifiques avec type, validation et droits. Les valeurs libres
   ne remplacent pas une FK, un montant exact, une habilitation ou une politique fiscale.

Les champs supplémentaires restent facultatifs au départ; sections adaptées, divulgation
progressive, longueurs limitées, recherche et affichage configurable. Toute future obligation
tenant devra préserver les anciens dossiers et s’appliquer à une étape explicite du workflow.

## Livré : fiche entreprise partagée, privée et versionnée

Sur Customer, BusinessPartner et CrmCompany : raison sociale, nom commercial, immatriculation
et registre/juridiction, secteur détaillé, site Web, référence externe, responsable de compte
descriptif, langue souhaitée, fuseau IANA, heures d’ouverture, consignes commande/facturation/
livraison et notes internes. Jusqu’à 20 informations nommées supplémentaires (texte).

Entrée UI **Fiche entreprise** : Clients, clients Transport, société CRM, partenaires Catalogue,
Données Services/SAV/Achats/Facturation/Portail interne. Les façades utilisent le module et les
droits du consommateur. Le centre Clients reste facultatif; Achats seul fonctionne.

`GET|PUT <façade>/:id/business-profile` : données fermées via `validatePartyProfile`, version
attendue obligatoire (0 pour première création), verrou business tenant, CAS logique. Une
réponse incertaine impose une relecture; aucun retry automatique ni écrasement aveugle.
Table `PartyBusinessProfile`, XOR et trois FK composites tenant/propriétaire. Pas de backfill.
Les trois identités gardent trois fiches distinctes même après rapprochement.

La donnée n’est pas ajoutée aux anciennes projections, aux PDF, aux emails, aux carnets ou
aux portails publics. Les utilisateurs internes ayant accès à la même fiche partagée peuvent
la lire via leur façade; ce n’est pas un coffre pour données RH, secrets ou coordonnées bancaires.
Le responsable n’assigne personne, le fuseau ne remplace pas la préférence utilisateur,
les consignes ne bloquent pas le dispatch et aucune taxe/échéance ne se calcule depuis ce texte.
Le secteur détaillé ne réécrit pas `CrmCompany.industry`; la raison sociale descriptive ne
remplace pas l’identité légale figée sur un document commercial.

## Livré : rapprochement des liens existants

Pas de nouveau registre d’identité ou de fusion. Lecture directe des liens
`BusinessPartner.billingCustomerId`, `BusinessPartner.crmCompanyId`, `CrmCompany.customerId`.
Depuis Customer/CRM : lecture inverse bornée; depuis partenaire : choix explicite.
La lecture CRM directe est distinguée du lien partenaire; rien n’est déduit par transitivité.

`GET …/identity`, candidats paginés par famille autorisée, `POST …/identity/review`, puis
`POST …/identity/confirm`. Module et droits de la source + lecture de chaque famille cible
avant recherche; aucun ID, nom ou compteur d’une famille masquée. La revue ne modifie rien.
Le jeton de revue couvre acteur, version source, choix, motif et versions des cibles. La
confirmation recontrôle ces faits sous le verrou business. Un jeton est un contrôle de fraîcheur,
pas une permission ni une signature d’identité réelle. L’utilisateur reste responsable de vérifier
qu’il s’agit de la même entreprise. Pas de synchronisation des contacts/profils/dossiers.

Le writer existant `ServicesCommerceService.partnerLinks` reste unique; nouvelles façades
Clients/SAV/Achats, anciens endpoints Services/Catalogue compatibles. Le client est actif,
les FK sont tenant-scopées, les cibles partenaire sont uniques. Le client de facturation ne
change plus après usage dans un lot de factures Services. Les writers CRM (édition et
conversion) partagent désormais le verrou et refusent une correspondance contradictoire.
Conversion concurrente : relecture dans la transaction, pas de second client créé sur une
ancienne lecture. Un deal déjà converti conserve son `convertedCustomerId`, même si le lien
direct de sa société a changé depuis. Les anciens liens ambigus ne sont ni supprimés ni réparés automatiquement.

Les anciennes API de liens restent disponibles sans le nouvel écran de revue. Aucun agent,
permission portail ou pouvoir de paiement n’est ajouté. Aucun rapprochement Customer/Carrier,
déduplication CRM globale, import, fusion ou recherche floue dans ce lot.

## Matrice d’approfondissement — tous les modules

**I1a livré après E1b.8** : fiche article spécialisée produit/prestation, références fournisseur
versionnées et conditions choisies/capturées sur commande. [Contrats I1a](catalog-purchasing-depth.md).
**I1b livré ensuite** : conditionnements multiples à contenu fixe, code-barres propre, choix
capturé sur commande et réception exacte avec preuve du nombre de colis. [Contrats I1b](catalog-packaging.md).
I1 n’est pas clôturé : grilles/paliers, dérogations, documents et imports restent ouverts;
I2 reste partiel : **I2a lots/dates déclarées WMS** couvre réception, rangement, préparation
et arrivages Achats, avec soldes atomiques et journal. [Contrats et limites](wms-lots.md).
**I2b livré** : comptages par lot, refus des instantanés périmés et ajustements à reprise durable. [Contrat I2b](wms-lot-counts.md).
**I2c livré** : lot explicite des pièces Services, preuve figée et retours au lot d’origine, avec contrôles d’avoirs conservés. [Contrat I2c](services-part-lots.md).
**I2d livré** : déclaration atelier multi-lots et preuve matières → produit, journal relié à l’OF. [Contrat I2d](manufacturing-lots.md).

**I2e livré** : correction complète v2 sur OF en cours, mouvements compensatoires, reprise durable et quantités nettes OF/impacts; preuve MRP figée. [Contrat I2e](manufacturing-reversals.md).

**I2f livré** : quarantaine manuelle sur tout le lot, sorties gardées WMS/Services/atelier,
libération documentée avec droit distinct et disponible MRP/APS net. [Contrat I2f](wms-lot-quarantine.md).
**I2g livré** : contrôle de lot choisi avant exécution, fraîcheur du registre, preuve conforme
citable dans une libération humaine et préparations WMS ouvertes liées. [Contrat I2g](quality-lot-controls.md).
**I2h livré** : parcours amont/aval borné des preuves atelier vérifiées, chronologie,
contrepassations et dossiers directs WMS/Services/Transport selon les droits. [Contrat I2h](wms-lot-traceability.md).
**I2i livré** : destruction/rebut et sortie physique vers un fournisseur explicite,
sans libération artificielle de quarantaine, revue/confirmation humaine, preuve et reprise
durables. WMS seul suffit. [Contrat I2i](wms-stock-exits.md).
**I2j livré** : réception d’achat explicitement capturée sur un retour, cumul documentaire
borné, justificatifs append-only et reprise fichier exacte. [Contrat I2j](wms-return-purchase-evidence.md).
**I2k livré** : constats déclaratifs reçus/acceptés/refusés, cumuls exacts, corrections append-only,
justificatif du retour et reprise exacte, WMS autonome. [Contrat I2k](wms-supplier-return-followup.md).
**I2l.1 livré** : registre général de factures fournisseur dans Finance, autonome,
montants déclarés exacts, originaux protégés, lignes d’achat liées explicitement et
qualification documentaire figée. Aucun paiement/comptabilisation/stock. [Contrat](billing-supplier-invoices.md).
**I2l.2 livré** : avoir fournisseur reçu, source qualifiée et cumul exact par ligne/taxe;
original protégé, lien de retour WMS facultatif, versionné et gardé. [Contrat](billing-supplier-credits.md).
Ne pas déduire un crédit du prix d’achat ou du retour accepté; aucune comptabilisation.
**I2l.3 livré** : dossier fournisseur avec factures/avoirs/preuves, recherches et filtres,
synthèse exacte par devise, identité courante distincte des copies et liens gardés.
Le reste documentaire n’est pas une dette payable. [Contrat](billing-supplier-dossiers.md).
Réponse directe du fournisseur, comptabilité fournisseurs, quarantaine partielle, allocation par pièce et rappel
réglementaire complet, corrections partielles et OF terminés, séries et FEFO restent
ouverts, comme I3–I5.
Les codes de conditionnement ne remplacent pas le registre global WMS.

Chaque ligne est à qualifier contre le code et les 271 exigences importées avant livraison.
Ordre : I1 données articles/fournisseurs, I2 exécution physique, I3 relation/service,
I4 finance/qualité/RH, I5 partage/pilotage. Ne pas activer un module seulement pour remplir une fiche.

| Module / espace             | Informations à approfondir                                                                                         | Règles et connexions à livrer avec les champs                                                       |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| Clients                     | Rôles donneur d’ordre/livré/facturé/payeur, affiliations, identifiants fiscaux datés, accords commerciaux          | Identités explicites; validation et capture à l’engagement; aucune fusion automatique               |
| CRM                         | Segmentation, origine de prospect, critères de qualification, concurrence, décisionnaires, consentements par canal | Pipeline configurable; consentement prouvé, révocation; pas de SMS/email depuis un champ libre      |
| Catalogue                   | Marque, fabricant, référence fabricant, variantes, dimensions, emballages, notices, codes-barres                   | Codes uniques selon portée, unités exactes, séparation produit/prestation, lien WMS explicite       |
| Achats fournisseurs         | Références fournisseur par article, délais, MOQ, multiple d’achat, devise, conditions, prix datés                  | Conversions achat/stock capturées; approbation; taxes et réception/retour sans stock fictif         |
| Transport                   | Nature marchandise, colis/palettes, références client, contraintes d’accès, RDV, température, douane               | Quantités conservées, fenêtres/fuseaux, règles réglementaires qualifiées, versions cargo/POD        |
| WMS / inventaire            | Conditionnements, lots/séries, péremption, règles de rangement, seuils et emplacements préférés                    | Scans, conversions explicites, FEFO si qualifié, réservation/quarantaine et mouvements atomiques    |
| Fabrication / MRP           | Révision technique, outillage, instructions opération, rendement/rebut, temps réels, lot de fabrication            | BOM append-only, déclarations opérationnelles, généalogie/qualité, matière et APS revalidés         |
| Cour / quais                | Gabarit, équipement de quai, restrictions, horaires, motif visite, scellement, consignes sécurité                  | Capacité/occupation réelles, RDV versionnés, aucun statut WMS/TMS modifié par une note              |
| Flotte                      | Compteurs, énergie, propriétaire/location, échéances, garanties, pièces, symptômes et diagnostic                   | Maintenance et conformité gardées, compteurs historisés, coûts liés aux pièces/fournisseurs         |
| Achats transport            | Spécification service, équipement, fréquence, hypothèses volumes, exigences dossier transporteur                   | Offres comparables, devise/unité explicites, décision humaine et validité des tarifs                |
| Services                    | Site client, périmètre, livrables, contacts sur site, accès, équipement installé, acceptation client               | Affectation avec habilitations, calendrier/fuseau, pièces/temps facturables et preuve d’acceptation |
| SAV                         | Catégorie/sous-catégorie, canal, impact, urgence, équipement/série, garantie, diagnostic, engagement de réponse    | SLA avec calendriers/escalades; lien intervention; retours et compensations distincts               |
| Qualité                     | Spécification/version, échantillon, méthode, équipement de mesure, cause, action corrective/préventive             | Mesures/unités/tolérances, validation humaine, quarantaine et libération explicites                 |
| RH                          | Poste, site, type de contrat, dates, rattachement, compétences et habilitations                                    | Droits RH renforcés; validité des habilitations; pas de santé/paie dans un champ partagé            |
| Finance / facturation       | Références PO client, échéanciers, conditions, dimensions analytiques, motifs, règles fiscales datées              | Arrondis exacts, périodes, plafonds/approbations, sous-livres réconciliés, fiscalité qualifiée      |
| Portail client              | Contacts autorisés, affiliations, préférences de communication, périmètre des données visibles                     | Publier une projection autorisée seulement; notes internes exclues; révocation des accès            |
| Portail transporteur        | Contacts opération/facturation, pièces demandées, échéances et refus motivés                                       | Permissions externes, documents protégés, tender/POD/facture via workflows existants                |
| Sites & pages               | Métadonnées de page, formulaires métier, provenance et consentement, langues                                       | Validation des champs publics; mappage CRM explicite; aucune exposition des notes internes          |
| Analytics                   | Définition d’indicateur, unité, période/fuseau, source, cible, dimensions et responsable                           | Calculs vérifiables, filtres autorisés, navigation vers preuves, fraîcheur visible                  |
| Agents / workers            | Mission, périmètre de lecture, sources autorisées, règles d’escalade, critères de réussite                         | Gouvernance, caps, évaluations; nouvelles données privées jamais exposées implicitement             |
| Connecteurs                 | Mappage de champs, système maître, provenance, version de schéma, clé d’idempotence                                | Validation, quarantaine/reprise, secrets chiffrés et aucune écriture arbitraire                     |
| Documents / Documentation   | Classement métier, propriétaire, révision, validité, source et liens                                               | Conservation et accès selon dossier; expliquer portée/règles/limites de chaque nouveau champ        |
| Réglages / Personnalisation | Groupes/champs visibles, ordre, valeurs par défaut, obligations par étape, vues de tableau                         | Préférences utilisateur distinctes du schéma tenant et des permissions serveur                      |

### Pourquoi pas cent champs texte partout ?

Un champ « lot » sans journal de mouvements par lot ne donne aucune traçabilité. Une mention
« plafond crédit » sans contrôle du solde ne protège aucun engagement. Un téléphone ne prouve
aucun consentement SMS. Les prochains lots doivent intégrer champs, validations, usages,
contrôles, tutoriels et tests ensemble. Les champs personnalisés existants restent séparés de
la fiche entreprise; généraliser leur schéma sans casser les anciens documents reste ouvert.

## Sources comparatives primaires (consultées le 2026-09-24)

Repères de conception, pas spécifications à copier ni preuve de conformité de Pulsar :

- [Odoo — Contacts](https://www.odoo.com/documentation/18.0/applications/essentials/contacts.html) : séparation contacts, adresses et paramètres commerciaux.
- [Business Central — fiches articles](https://learn.microsoft.com/en-au/dynamics365/business-central/inventory-how-register-new-items) : distinction article stocké, non stocké et prestation.
- [Business Central — fournisseurs](https://learn.microsoft.com/en-gb/dynamics365/business-central/purchasing-how-register-new-vendors) : identité fournisseur et adresses de remise distinctes.
- [Business Central — suivi article](https://github.com/MicrosoftDocs/dynamics365smb-docs/blob/main/business-central/inventory-how-work-item-tracking.md) : lot/série et opérations de stock liés.

## Recette / déploiement

Migration 118, additive, table vide sans transformation historique. Base locale isolée
`pulsar_enduser_20260921` seulement; `.env` inchangé. Aucun déploiement, PR, push ou email réel.
Résultats du 2026-09-24 :

- 945 tests Shared, 686 unitaires API et 131 Web réussis.
- 161 HTTP distincts sur huit suites : profils/identités (17), autonomie (48), connexions
  métier (18), impact du carnet (11), coordonnées CRM (10) et trois suites CRM (57).
- Cinq parcours Chromium : fiche entreprise/reprise après réponse perdue, rapprochement
  confirmé, lecture limitée et deux régressions CRM incluant le tutoriel de première visite.
- Captures desktop/mobile inspectées; pas de débordement horizontal à 390 px.
- Builds Shared/Database/API/Web réussis. Svelte : zéro erreur, douze avertissements
  préexistants dans cinq fichiers. Vérification des espaces Git propre.

Ces résultats ne qualifient pas une charge enterprise, le serveur OVH ou l’ensemble des
combinaisons de modules. Les anciennes API de liens, imports et autorisations opérationnelles
restent des surfaces à qualifier séparément; aucune promesse de fusion ou conformité globale.
