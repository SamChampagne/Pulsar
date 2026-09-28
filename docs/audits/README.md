# Audit enterprise — registre de suivi

Source fournie : `Pulsar_Audit_Metier_Enterprise (2).html`, V4 du 24 septembre 2026.
SHA-256 : `72e5a684beda76de7562201f71349865900f2cbc1ed6fc76551206085994c7fe`.

Les 271 fiches originales V2–V4 sont conservées dans [le catalogue JSON](./enterprise-2026-09-24.json), avec leurs règles, exceptions, critères et références. Le HTML et ses scripts ne sont pas exécutés ni intégrés à l’application. Les 52 epics initiaux restent des références de regroupement, pas 52 travaux additionnels à compter.

Ce registre décrit des exigences, pas des fonctions garanties. Le champ `status` du rapport et `qualification` importé ne sont pas une certification. Voir [le programme et les livraisons prouvées](../plans/enterprise-audit-program.md). Les constats antérieurs peuvent être dépassés : Clients et les améliorations locales du 23 septembre existent désormais.

## Index complet

Les parents/travaux liés du rapport ne sont pas assimilés automatiquement à des dépendances bloquantes. Les priorités V2 sont des phases, conservées telles quelles. Aucun regroupement de tâches ne signifie activation obligatoire des modules.

### Finance — socle

| Fiche  | Travail                                           | Priorité du rapport | Qualification |
| ------ | ------------------------------------------------- | ------------------- | ------------- |
| V2/F01 | Entités légales, livres et dimensions financières | 1                   | À qualifier   |
| V2/F02 | Journal immuable, contrepassation et traçabilité  | 1                   | À qualifier   |
| V2/F03 | Moteur de détermination comptable métier          | 1                   | À qualifier   |
| V2/F04 | File des erreurs et rapprochement sous-livre / GL | 1                   | À qualifier   |

### Finance — clôture

| Fiche  | Travail                                          | Priorité du rapport | Qualification |
| ------ | ------------------------------------------------ | ------------------- | ------------- |
| V2/F05 | Périodes ouvertes, arrêtés et écritures tardives | 1                   | À qualifier   |
| V2/F06 | Cockpit de clôture avec contrôles bloquants      | 2                   | À qualifier   |

### Finance — devises

| Fiche  | Travail                                           | Priorité du rapport | Qualification |
| ------ | ------------------------------------------------- | ------------------- | ------------- |
| V2/F07 | Taux datés, réévaluation et différences de change | 2                   | À qualifier   |

### Finance — fournisseurs

| Fiche  | Travail                                                | Priorité du rapport | Qualification |
| ------ | ------------------------------------------------------ | ------------------- | ------------- |
| V2/F08 | Rapprochement achat / réception / facture par ligne    | 2                   | À qualifier   |
| V2/F09 | Capture facture, doublons et validation fournisseur    | 2                   | À qualifier   |
| V2/F10 | Propositions de paiement et contrôle des bénéficiaires | 2                   | À qualifier   |
| V2/F11 | Statuts bancaires, rejets et reprise des paiements     | 2                   | À qualifier   |

### Finance — clients

| Fiche  | Travail                                                    | Priorité du rapport | Qualification |
| ------ | ---------------------------------------------------------- | ------------------- | ------------- |
| V2/F12 | Échéanciers, acomptes et facturation partielle             | 2                   | À qualifier   |
| V2/F13 | Lettrage partiel, déductions et encaissements non affectés | 2                   | À qualifier   |
| V2/F14 | Relances, promesses de paiement et litiges                 | 2                   | À qualifier   |
| V2/F15 | Exposition crédit reliée aux commandes et expéditions      | 2                   | À qualifier   |

### Finance — banque

| Fiche  | Travail                                      | Priorité du rapport | Qualification |
| ------ | -------------------------------------------- | ------------------- | ------------- |
| V2/F16 | Rapprochement bancaire plusieurs-à-plusieurs | 2                   | À qualifier   |

### Finance — trésorerie

| Fiche  | Travail                                            | Priorité du rapport | Qualification |
| ------ | -------------------------------------------------- | ------------------- | ------------- |
| V2/F17 | Prévision de trésorerie déterministe à 13 semaines | 3                   | À qualifier   |

### Finance — fiscalité

| Fiche  | Travail                                     | Priorité du rapport | Qualification |
| ------ | ------------------------------------------- | ------------------- | ------------- |
| V2/F18 | Détermination de taxes et preuves de calcul | 2                   | À qualifier   |

### Finance — coûts

| Fiche  | Travail                                         | Priorité du rapport | Qualification |
| ------ | ----------------------------------------------- | ------------------- | ------------- |
| V2/F19 | Valorisation des stocks et coût des sorties     | 2                   | À qualifier   |
| V2/F20 | Coût rendu et frais tardifs d’approvisionnement | 3                   | À qualifier   |

### Finance — industriel

| Fiche  | Travail                                                  | Priorité du rapport | Qualification |
| ------ | -------------------------------------------------------- | ------------------- | ------------- |
| V2/F21 | Coûts standards, versions et simulation make-or-buy      | 3                   | À qualifier   |
| V2/F22 | Encours, écarts d’OF et clôture financière de production | 3                   | À qualifier   |

### Finance — contrôle

| Fiche  | Travail                                                 | Priorité du rapport | Qualification |
| ------ | ------------------------------------------------------- | ------------------- | ------------- |
| V2/F23 | Budgets, réservations et consommation d’engagements     | 2                   | À qualifier   |
| V2/F24 | Allocations analytiques et rentabilité client/produit   | 2                   | À qualifier   |
| V2/F35 | Soldes d’ouverture, migration et rapprochement d’entrée | 1                   | À qualifier   |
| V2/F36 | Profils de séparation des fonctions et dossier d’audit  | 1                   | À qualifier   |

### Finance — actifs

| Fiche  | Travail                                                | Priorité du rapport | Qualification |
| ------ | ------------------------------------------------------ | ------------------- | ------------- |
| V2/F25 | Immobilisations : acquisition, livres et amortissement | 3                   | À qualifier   |
| V2/F26 | Cessions, composants et projets capitalisés            | 4                   | À qualifier   |
| V2/F34 | Contrats de location et échéanciers financiers         | 5                   | À qualifier   |

### Finance — contrats

| Fiche  | Travail                                              | Priorité du rapport | Qualification |
| ------ | ---------------------------------------------------- | ------------------- | ------------- |
| V2/F27 | Échéanciers d’abonnement, prorata et renouvellement  | 3                   | À qualifier   |
| V2/F28 | Revenu différé, jalons et obligations contractuelles | 4                   | À qualifier   |
| V2/F31 | Ristournes, commissions et provisions commerciales   | 3                   | À qualifier   |

### Finance — groupe

| Fiche  | Travail                                    | Priorité du rapport | Qualification |
| ------ | ------------------------------------------ | ------------------- | ------------- |
| V2/F29 | Intercompagnies : miroirs et rapprochement | 4                   | À qualifier   |
| V2/F30 | Consolidation, conversion et éliminations  | 5                   | À qualifier   |

### Finance — reporting

| Fiche  | Travail                                                   | Priorité du rapport | Qualification |
| ------ | --------------------------------------------------------- | ------------------- | ------------- |
| V2/F32 | États financiers paramétrables et pistes de justification | 2                   | À qualifier   |

### Finance — dépenses

| Fiche  | Travail                                        | Priorité du rapport | Qualification |
| ------ | ---------------------------------------------- | ------------------- | ------------- |
| V2/F33 | Notes de frais, justificatifs et remboursement | 4                   | À qualifier   |

### WMS

| Fiche   | Travail                                            | Priorité du rapport | Qualification |
| ------- | -------------------------------------------------- | ------------------- | ------------- |
| V2/WX01 | ASN, unités logistiques et réception contrôlée     | 2                   | À qualifier   |
| V2/WX02 | Unités multiples et poids variable                 | 2                   | À qualifier   |
| V2/WX03 | Emballage, contrôle final et manifeste             | 2                   | À qualifier   |
| V2/WX04 | Propriétaires, consignation et stock chez tiers    | 2                   | À qualifier   |
| V2/WX05 | Kits et services à valeur ajoutée                  | 3                   | À qualifier   |
| V2/WX06 | Slotting, réapprovisionnement et charge de travail | 4                   | À qualifier   |
| V2/WX07 | Retours, quarantaine et disposition traçable       | 2                   | À qualifier   |

### Transport

| Fiche   | Travail                                             | Priorité du rapport | Qualification |
| ------- | --------------------------------------------------- | ------------------- | ------------- |
| V2/TX01 | Moteur de charges achat et vente                    | 2                   | À qualifier   |
| V2/TX02 | Engagements transporteurs et tender explicable      | 3                   | À qualifier   |
| V2/TX03 | Itinéraires multi-étapes et correspondances         | 3                   | À qualifier   |
| V2/TX04 | Événements de suivi et ETA avec niveau de confiance | 3                   | À qualifier   |
| V2/TX05 | Charges à payer et ventilation du fret              | 2                   | À qualifier   |
| V2/TX06 | Surestaries, avaries et dossiers de réclamation     | 3                   | À qualifier   |

### Cour

| Fiche   | Travail                                           | Priorité du rapport | Qualification |
| ------- | ------------------------------------------------- | ------------------- | ------------- |
| V2/YX01 | Capacité future des quais et rendez-vous          | 2                   | À qualifier   |
| V2/YX02 | Missions de déplacement et chaîne de garde        | 3                   | À qualifier   |
| V2/YX03 | Contrôles d’entrée, scellés et libération         | 2                   | À qualifier   |
| V4/CY01 | Rendez-vous futur, admission et occupation réelle | P0                  | À qualifier   |
| V4/CY02 | Mouvement de remorque et contrôle de destination  | P0                  | À qualifier   |
| V4/CY03 | Libération de sortie et preuve de garde           | P0                  | À qualifier   |

### Planification

| Fiche   | Travail                                      | Priorité du rapport | Qualification |
| ------- | -------------------------------------------- | ------------------- | ------------- |
| V2/PX01 | Prévisions consommées et horizons gelés      | 2                   | À qualifier   |
| V2/PX02 | Politiques de stock et simulation de service | 3                   | À qualifier   |
| V2/PX03 | Sourcing et promesse CTP multi-sites         | 3                   | À qualifier   |
| V2/PX04 | Séquences, campagnes et changements de série | 4                   | À qualifier   |

### Fabrication

| Fiche   | Travail                                                | Priorité du rapport | Qualification |
| ------- | ------------------------------------------------------ | ------------------- | ------------- |
| V2/MX01 | Effectivité des nomenclatures et ordres figés          | 2                   | À qualifier   |
| V2/MX02 | Sous-traitance d’opération et stock chez fournisseur   | 3                   | À qualifier   |
| V2/MX03 | Coproduits, sous-produits et rendement réel            | 3                   | À qualifier   |
| V2/MX04 | Exécution guidée et reprise de non-conformité          | 2                   | À qualifier   |
| V2/MX05 | Temps machine, arrêts et OEE traçable                  | 4                   | À qualifier   |
| V4/FA01 | Sortie matière réelle et postconsommation distinctes   | P0                  | À qualifier   |
| V4/FA02 | Généalogie réelle et remplacement de composant         | P0                  | À qualifier   |
| V4/FA03 | Bilan de lot, coproduits et rendement réel             | P1                  | À qualifier   |
| V4/FA04 | Retouche et réparation sans effacer le premier passage | P1                  | À qualifier   |
| V4/FA05 | Achèvement partiel, clôture technique et encours       | P0                  | À qualifier   |
| V4/FA06 | Temps machine, main-d’œuvre et OEE sans inflation      | P1                  | À qualifier   |

### QMS

| Fiche   | Travail                                             | Priorité du rapport | Qualification |
| ------- | --------------------------------------------------- | ------------------- | ------------- |
| V2/QX01 | Spécifications contextuelles et libération physique | 1                   | À qualifier   |
| V2/QX02 | Échantillonnage et recontrôle à échéance            | 3                   | À qualifier   |
| V2/QX03 | Certificat d’analyse issu des résultats validés     | 3                   | À qualifier   |
| V2/QX04 | CAPA, rappel ciblé et coût de non-qualité           | 3                   | À qualifier   |
| V4/QU01 | Spécification applicable et résultats originaux     | P0                  | À qualifier   |
| V4/QU02 | Échantillonnage, essais destructifs et recontrôle   | P0                  | À qualifier   |
| V4/QU03 | Disposition par quantité et effet physique contrôlé | P0                  | À qualifier   |
| V4/QU04 | Instrument hors tolérance et impact rétrospectif    | P1                  | À qualifier   |
| V4/QU05 | Certificat d’analyse lié au lot réellement livré    | P0                  | À qualifier   |
| V4/QU06 | CAPA, preuve d’efficacité et rappel ciblé           | P1                  | À qualifier   |

### Achats fournisseurs

| Fiche   | Travail                                                       | Priorité du rapport | Qualification |
| ------- | ------------------------------------------------------------- | ------------------- | ------------- |
| V2/BX01 | Qualification fournisseur et choix sourcé                     | 2                   | À qualifier   |
| V2/BX02 | Contrats cadres et programmes de livraison                    | 3                   | À qualifier   |
| V2/BX03 | Ristournes et transactions éligibles                          | 3                   | À qualifier   |
| V2/BX04 | Prestations, dépenses et investissements                      | 2                   | À qualifier   |
| V2/BX05 | Performance fournisseur et litiges intégrés                   | 3                   | À qualifier   |
| V4/AF01 | Qualification fournisseur à l’engagement et au renouvellement | P0                  | À qualifier   |
| V4/AF02 | Comparaison d’offres sur un coût et un périmètre communs      | P1                  | À qualifier   |
| V4/AF03 | Contrat cadre et consommation d’engagement                    | P0                  | À qualifier   |
| V4/AF04 | Avenants de commande et approbation limitée                   | P0                  | À qualifier   |
| V4/AF05 | Réception de service et rapprochement par composante          | P0                  | À qualifier   |
| V4/AF06 | Score fournisseur, litige et biais d’échantillon              | P1                  | À qualifier   |

### Fleet / maintenance

| Fiche   | Travail                                               | Priorité du rapport | Qualification |
| ------- | ----------------------------------------------------- | ------------------- | ------------- |
| V2/EX01 | Compteurs et maintenance conditionnelle               | 3                   | À qualifier   |
| V2/EX02 | Gammes, pièces, ressources et sécurité d’intervention | 2                   | À qualifier   |
| V2/EX03 | Hiérarchie d’actifs et composants sérialisés          | 3                   | À qualifier   |
| V2/EX04 | Garanties et partage entre payeurs                    | 3                   | À qualifier   |
| V2/EX05 | Criticité, calibration et disponibilité publiée       | 3                   | À qualifier   |

### CRM

| Fiche   | Travail                                             | Priorité du rapport | Qualification |
| ------- | --------------------------------------------------- | ------------------- | ------------- |
| V2/CX01 | Qualification, doublons et conversion maîtrisée     | 2                   | À qualifier   |
| V4/CR01 | Étapes commerciales fondées sur des preuves         | P1                  | À qualifier   |
| V4/CR02 | Révisions de devis, validité et acceptation         | P0                  | À qualifier   |
| V4/CR03 | Marge approuvée sur une base explicite              | P0                  | À qualifier   |
| V4/CR04 | Prévisions commerciales sans double comptage        | P1                  | À qualifier   |
| V4/CR05 | Affectation, remplacement et continuité commerciale | P1                  | À qualifier   |
| V4/CR06 | Journal des interactions et engagements clients     | P1                  | À qualifier   |

### CRM / commandes

| Fiche   | Travail                                     | Priorité du rapport | Qualification |
| ------- | ------------------------------------------- | ------------------- | ------------- |
| V2/CX02 | Devis révisés, configuration et approbation | 2                   | À qualifier   |

### CRM / catalogue

| Fiche   | Travail                            | Priorité du rapport | Qualification |
| ------- | ---------------------------------- | ------------------- | ------------- |
| V2/CX03 | Prix, remises et marge explicables | 2                   | À qualifier   |

### Commandes / portail

| Fiche   | Travail                                    | Priorité du rapport | Qualification |
| ------- | ------------------------------------------ | ------------------- | ------------- |
| V2/CX04 | Avenants, reliquats et retours commerciaux | 2                   | À qualifier   |

### Catalogue / référentiels

| Fiche   | Travail                                                | Priorité du rapport | Qualification |
| ------- | ------------------------------------------------------ | ------------------- | ------------- |
| V2/CX05 | Hiérarchies clients, articles et attributs industriels | 1                   | À qualifier   |

### Services

| Fiche   | Travail                                                    | Priorité du rapport | Qualification |
| ------- | ---------------------------------------------------------- | ------------------- | ------------- |
| V2/SV01 | Contrats récurrents et droits de prestation                | 3                   | À qualifier   |
| V2/SV02 | Équipes, trajets et optimisation du planning               | 3                   | À qualifier   |
| V2/SV03 | Exécution mobile et synchronisation robuste                | 3                   | À qualifier   |
| V4/SE01 | Ordre de service, visites et clôtures distinctes           | P0                  | À qualifier   |
| V4/SE02 | Récurrence d’intervention séparée de la récurrence facture | P0                  | À qualifier   |
| V4/SE03 | Temps travaillé, coût, droit facturable et prix vendu      | P0                  | À qualifier   |
| V4/SE04 | Plafond contractuel, forfait et avenant                    | P0                  | À qualifier   |
| V4/SE05 | Pièces embarquées, installées, retirées et reprises        | P0                  | À qualifier   |
| V4/SE06 | Sous-traitant : réception de prestation et coût définitif  | P1                  | À qualifier   |
| V4/SE07 | Ressources, compétences et compte rendu collectif          | P1                  | À qualifier   |

### Services / projets

| Fiche   | Travail                                           | Priorité du rapport | Qualification |
| ------- | ------------------------------------------------- | ------------------- | ------------- |
| V2/SV04 | Coût projet, jalons et corrections de facturation | 2                   | À qualifier   |

### SAV

| Fiche   | Travail                                              | Priorité du rapport | Qualification |
| ------- | ---------------------------------------------------- | ------------------- | ------------- |
| V2/SV05 | SLA, files et escalades avec calendrier              | 2                   | À qualifier   |
| V4/SA01 | Dossier, incident, demande et priorité explicable    | P0                  | À qualifier   |
| V4/SA02 | Droits de support et consommation réversible         | P0                  | À qualifier   |
| V4/SA03 | Plusieurs horloges SLA et pauses justifiées          | P0                  | À qualifier   |
| V4/SA04 | Doublons, incident collectif et dossiers liés        | P1                  | À qualifier   |
| V4/SA05 | Garantie, couverture et recours fournisseur          | P0                  | À qualifier   |
| V4/SA06 | RMA, échange anticipé et retour de l’ancien matériel | P1                  | À qualifier   |
| V4/SA07 | Résolution, efficacité et coût réel du dossier       | P1                  | À qualifier   |

### SAV / Services

| Fiche   | Travail                               | Priorité du rapport | Qualification |
| ------- | ------------------------------------- | ------------------- | ------------- |
| V2/SV06 | Parc installé, garantie et boucle RMA | 3                   | À qualifier   |

### RH

| Fiche   | Travail                                                    | Priorité du rapport | Qualification |
| ------- | ---------------------------------------------------------- | ------------------- | ------------- |
| V2/HX01 | Affectations et qualifications datées                      | 1                   | À qualifier   |
| V2/HX02 | Compte de congés, fractions et acquisition                 | 3                   | À qualifier   |
| V2/HX04 | Temps valorisé et export paie contrôlé                     | 4                   | À qualifier   |
| V4/RH01 | Personne, emploi et affectation à dates d’effet            | P0                  | À qualifier   |
| V4/RH02 | Acquisition de congés, prorata et corrections rétroactives | P0                  | À qualifier   |
| V4/RH03 | Demande de congé, réservation et couverture d’équipe       | P0                  | À qualifier   |
| V4/RH04 | Temps prévu, présence et temps valorisé                    | P0                  | À qualifier   |
| V4/RH05 | Approbation et export paie avec corrections                | P0                  | À qualifier   |
| V4/RH06 | Qualification datée et départ sans accès résiduel          | P0                  | À qualifier   |

### RH / capacité

| Fiche   | Travail                                    | Priorité du rapport | Qualification |
| ------- | ------------------------------------------ | ------------------- | ------------- |
| V2/HX03 | Couverture de compétences et remplacements | 3                   | À qualifier   |

### Documents

| Fiche   | Travail                                        | Priorité du rapport | Qualification |
| ------- | ---------------------------------------------- | ------------------- | ------------- |
| V2/DX01 | Métadonnées, versions et rattachements fiables | 1                   | À qualifier   |
| V2/DX03 | Rétention, recherche et collecte de preuves    | 3                   | À qualifier   |

### Documents / Docs

| Fiche   | Travail                                                            | Priorité du rapport | Qualification |
| ------- | ------------------------------------------------------------------ | ------------------- | ------------- |
| V2/DX02 | Publication contrôlée et instructions applicables                  | 2                   | À qualifier   |
| V4/DO01 | Document de travail, édition approuvée et exemplaire envoyé        | P0                  | À qualifier   |
| V4/DO02 | Classement métier, rapprochement et droits des pièces              | P0                  | À qualifier   |
| V4/DO03 | Conservation, gel et suppression contrôlée                         | P1                  | À qualifier   |
| V4/DO04 | Guides applicables à la version et au profil client                | P0                  | À qualifier   |
| V4/DO05 | Recherche contextuelle et réponses fondées sur les bonnes versions | P1                  | À qualifier   |

### Portail

| Fiche   | Travail                                      | Priorité du rapport | Qualification |
| ------- | -------------------------------------------- | ------------------- | ------------- |
| V2/UX01 | Accès aux dossiers selon compte et rôle      | 1                   | À qualifier   |
| V2/UX02 | Demandes, devis et suivi transactionnel      | 2                   | À qualifier   |
| V4/PO01 | Droits par compte, site, dossier et action   | P0                  | À qualifier   |
| V4/PO02 | Acheteur, demandeur et approbateur client    | P1                  | À qualifier   |
| V4/PO03 | Panier fiable au moment de l’engagement      | P0                  | À qualifier   |
| V4/PO04 | Retours et litiges instruits par ligne       | P0                  | À qualifier   |
| V4/PO05 | Factures, relevés et paiement sans ambiguïté | P0                  | À qualifier   |
| V4/PO06 | Demandes clients avec accusé métier et suivi | P1                  | À qualifier   |

### Emails

| Fiche   | Travail                                               | Priorité du rapport | Qualification |
| ------- | ----------------------------------------------------- | ------------------- | ------------- |
| V2/UX03 | Consentement, délivrabilité et preuve de notification | 2                   | À qualifier   |
| V4/EM01 | Finalité, adresse et préférence au moment d’envoi     | P0                  | À qualifier   |
| V4/EM02 | Soumis, accepté, remis, rebondi et lu                 | P0                  | À qualifier   |
| V4/EM03 | Modèles, pièces et destinataires figés                | P0                  | À qualifier   |
| V4/EM04 | Reprises, plafonds et conversation unique             | P1                  | À qualifier   |

### Sites

| Fiche   | Travail                                                | Priorité du rapport | Qualification |
| ------- | ------------------------------------------------------ | ------------------- | ------------- |
| V2/UX04 | Formulaires publiés et conversion CRM robuste          | 3                   | À qualifier   |
| V4/SI01 | Formulaire publié et conversion CRM durable            | P0                  | À qualifier   |
| V4/SI02 | Publication de contenu et cohérence des offres         | P1                  | À qualifier   |
| V4/SI03 | Attribution et consentement sans écrasement d’identité | P1                  | À qualifier   |

### Connect / référentiels

| Fiche   | Travail                               | Priorité du rapport | Qualification |
| ------- | ------------------------------------- | ------------------- | ------------- |
| V2/IX01 | Contrats de données et système maître | 1                   | À qualifier   |

### Connect

| Fiche   | Travail                                               | Priorité du rapport | Qualification |
| ------- | ----------------------------------------------------- | ------------------- | ------------- |
| V2/IX02 | Connecteurs testés, rejeu et supervision de livraison | 1                   | À qualifier   |
| V4/CO01 | Contrat d’échange et accusés à plusieurs niveaux      | P0                  | À qualifier   |
| V4/CO02 | Ordre des changements et données tardives             | P0                  | À qualifier   |
| V4/CO03 | Idempotence de message et de transaction              | P0                  | À qualifier   |
| V4/CO04 | Mapping versionné et quarantaine des ambiguïtés       | P0                  | À qualifier   |
| V4/CO05 | Rapprochement source-cible et reprise ciblée          | P0                  | À qualifier   |

### Settings / Framework

| Fiche   | Travail                                               | Priorité du rapport | Qualification |
| ------- | ----------------------------------------------------- | ------------------- | ------------- |
| V2/IX03 | Rôles métier, périmètres et séparation des tâches     | 1                   | À qualifier   |
| V4/ST01 | Tenant, société, site et contexte métier              | P0                  | À qualifier   |
| V4/ST02 | Droits d’action, de ligne et de champ                 | P0                  | À qualifier   |
| V4/ST03 | Séparation des fonctions et accès exceptionnel limité | P0                  | À qualifier   |
| V4/ST04 | Paramètres métier versionnés et activation contrôlée  | P0                  | À qualifier   |
| V4/ST05 | Capacité activée, configurée, connectée et démontrée  | P0                  | À qualifier   |

### Flux / Framework

| Fiche   | Travail                                               | Priorité du rapport | Qualification |
| ------- | ----------------------------------------------------- | ------------------- | ------------- |
| V2/IX04 | Workflows versionnés et responsabilités réutilisables | 2                   | À qualifier   |

### Analytics / Dashboard

| Fiche   | Travail                                                       | Priorité du rapport | Qualification |
| ------- | ------------------------------------------------------------- | ------------------- | ------------- |
| V2/AX01 | Métriques communes et retour au dossier source                | 1                   | À qualifier   |
| V4/BI01 | Grain des faits et prévention des multiplications de montant  | P0                  | À qualifier   |
| V4/BI02 | Historique des dimensions et comparaison à périmètre constant | P1                  | À qualifier   |
| V4/BI03 | Fraîcheur, complétude et rapprochement visible                | P0                  | À qualifier   |
| V4/BI04 | Exception corrélée, responsable et effet économique           | P0                  | À qualifier   |
| V4/BI05 | Scénarios commerciaux, coût de service et décision            | P1                  | À qualifier   |

### Control Tower / Dashboard

| Fiche   | Travail                                           | Priorité du rapport | Qualification |
| ------- | ------------------------------------------------- | ------------------- | ------------- |
| V2/AX02 | Exceptions corrélées, propriétaire et conséquence | 2                   | À qualifier   |

### Agents

| Fiche   | Travail                                                           | Priorité du rapport | Qualification |
| ------- | ----------------------------------------------------------------- | ------------------- | ------------- |
| V2/AX03 | Outils autorisés et évaluations métier reproductibles             | 3                   | À qualifier   |
| V4/AG01 | Identité effective et outils à portée métier                      | P0                  | À qualifier   |
| V4/AG02 | Proposition, validation humaine et exécution sur la bonne version | P0                  | À qualifier   |
| V4/AG03 | Documents non fiables et extraction sans décision implicite       | P0                  | À qualifier   |
| V4/AG04 | Évaluation sur des cas métier et mode dégradé                     | P1                  | À qualifier   |

### Analytics / planification

| Fiche   | Travail                                         | Priorité du rapport | Qualification |
| ------- | ----------------------------------------------- | ------------------- | ------------- |
| V2/AX04 | Scénarios reliés à service, marge et trésorerie | 4                   | À qualifier   |

### Personnaliser / Docs / onboarding

| Fiche   | Travail                                              | Priorité du rapport | Qualification |
| ------- | ---------------------------------------------------- | ------------------- | ------------- |
| V2/AX05 | Espaces par rôle et capacités réellement disponibles | 2                   | À qualifier   |

### TMS · POD

| Fiche   | Travail                                                      | Priorité du rapport | Qualification |
| ------- | ------------------------------------------------------------ | ------------------- | ------------- |
| V3/PD01 | Politique POD par client, site et service                    | P0                  | À qualifier   |
| V3/PD02 | Preuve par arrêt, livraison, ligne et support                | P0                  | À qualifier   |
| V3/PD03 | Quantités reçues, acceptées, refusées et manquantes          | P0                  | À qualifier   |
| V3/PD04 | Capture de preuve et qualité des pièces                      | P0                  | À qualifier   |
| V3/PD05 | Mobile hors ligne et conflits de synchronisation             | P1                  | À qualifier   |
| V3/PD06 | Validation, rejet et nouvelle version du POD                 | P0                  | À qualifier   |
| V3/PD07 | POD manquant, délai de grâce et dérogation                   | P0                  | À qualifier   |
| V3/PD08 | Autorisation de facturer par quantité et version             | P0                  | À qualifier   |
| V3/PD09 | Réserves après facture et documents correctifs               | P0                  | À qualifier   |
| V3/PD10 | Tentative échouée, refus et relivraison                      | P1                  | À qualifier   |
| V3/PD11 | Réception avec réserves et responsabilité de l’écart         | P1                  | À qualifier   |
| V3/PD12 | Marchandises restantes et clôture de tournée                 | P0                  | À qualifier   |
| V3/PD13 | Contenants consignés et reprise des emballages               | P1                  | À qualifier   |
| V3/PD14 | Encaissement à la livraison et écart de caisse               | P1                  | À qualifier   |
| V3/PD15 | Lecture automatique de POD et contrôle de confiance          | P2                  | À qualifier   |
| V3/PD16 | Réception simple, preuve détaillée et droits de consultation | P0                  | À qualifier   |

### TMS · moteur métier

| Fiche   | Travail                                                     | Priorité du rapport | Qualification |
| ------- | ----------------------------------------------------------- | ------------------- | ------------- |
| V3/TD01 | Distinguer commande, besoin transport, expédition et trajet | P0                  | À qualifier   |
| V3/TD02 | Compatibilité de consolidation et règles de séparation      | P0                  | À qualifier   |
| V3/TD03 | Fractionner les quantités sans casser les supports          | P1                  | À qualifier   |
| V3/TD04 | Faisabilité du chargement au-delà du poids/volume           | P1                  | À qualifier   |
| V3/TD05 | Tarification détaillée et palier alternatif contractuel     | P1                  | À qualifier   |
| V3/TD06 | Courses entre réponses transporteurs                        | P0                  | À qualifier   |
| V3/TD07 | Publier puis modifier un plan en cours d’exécution          | P0                  | À qualifier   |
| V3/TD08 | Fenêtres, heure locale et durée de service                  | P0                  | À qualifier   |
| V3/TD09 | Chauffeur, équipement et historique de disponibilité        | P1                  | À qualifier   |
| V3/TD10 | Détention, franchise et horloges contractuelles             | P1                  | À qualifier   |
| V3/TD11 | Livraison directe et transport sans entrepôt Pulsar         | P1                  | À qualifier   |
| V3/TD12 | Registre des documents et remise au transporteur            | P0                  | À qualifier   |
| V3/TD13 | Facture transporteur, affectation et coût final             | P0                  | À qualifier   |
| V3/TD14 | Indicateurs de livraison et preuve sans faux positifs       | P0                  | À qualifier   |

### APS · règles avancées

| Fiche   | Travail                                                    | Priorité du rapport | Qualification |
| ------- | ---------------------------------------------------------- | ------------------- | ------------- |
| V3/AD01 | Pegging explicatif, protection de demande et réservation   | P0                  | À qualifier   |
| V3/AD02 | Réservation CTP provisoire et confirmation atomique        | P0                  | À qualifier   |
| V3/AD03 | Disponibilité après réception, contrôle et rangement       | P0                  | À qualifier   |
| V3/AD04 | Péremption, maturation et durée de vie au besoin           | P1                  | À qualifier   |
| V3/AD05 | Ressources simultanées, modes et quantités de capacité     | P1                  | À qualifier   |
| V3/AD06 | Attentes min/max, chevauchement et interruptions           | P1                  | À qualifier   |
| V3/AD07 | Lotissement, rendement et surplus assumé                   | P1                  | À qualifier   |
| V3/AD08 | Zone gelée et engagements partiellement exécutés           | P0                  | À qualifier   |
| V3/AD09 | Replanifier avant de recréer des achats ou OF              | P0                  | À qualifier   |
| V3/AD10 | Propagation des écarts et protection de la commande client | P1                  | À qualifier   |
| V3/AD11 | Objectifs hiérarchisés et diagnostic d’infaisabilité       | P1                  | À qualifier   |
| V3/AD12 | Publication sur données fraîches et transfert unique       | P0                  | À qualifier   |
| V3/AD13 | Stocks protégés, canaux et priorités en pénurie            | P1                  | À qualifier   |
| V3/AD14 | Boucle TMS–APS sur ETA, qualité et relivraison             | P1                  | À qualifier   |

### Clients / CRM

| Fiche   | Travail                                            | Priorité du rapport | Qualification                      |
| ------- | -------------------------------------------------- | ------------------- | ---------------------------------- |
| V4/CL01 | Partie, compte commercial, payeur et site livré    | P0                  | À qualifier — socle carnet partiel |
| V4/CL02 | Prospect, client actif, suspendu et fermé          | P0                  | À qualifier                        |
| V4/CL03 | Contacts et fonctions valides à une date           | P0                  | À qualifier — socle carnet partiel |
| V4/CL04 | Dédoublonnage et fusion sans perte de transactions | P0                  | À qualifier                        |
| V4/CL05 | Héritage des conditions avec exceptions explicites | P0                  | À qualifier                        |
| V4/CL06 | Crédit partagé et consommation concurrente         | P0                  | À qualifier                        |
| V4/CL07 | Changements sensibles et portée de revalidation    | P0                  | À qualifier — socle carnet partiel |
| V4/CL08 | Vue client 360 avec chiffres réconciliables        | P1                  | À qualifier                        |
| V4/CL09 | Références client et engagements de commande       | P1                  | À qualifier                        |
| V4/CL10 | Responsabilité et qualité du référentiel client    | P0                  | À qualifier                        |

### Catalogue

| Fiche   | Travail                                               | Priorité du rapport | Qualification |
| ------- | ----------------------------------------------------- | ------------------- | ------------- |
| V4/CA01 | Identités produit, variantes et cycle de vie          | P0                  | À qualifier   |
| V4/CA02 | Unités de vente, emballages et conversion datée       | P0                  | À qualifier   |
| V4/CA03 | Prix contractuels, remises cumulables et arrondis     | P0                  | À qualifier   |
| V4/CA04 | Assortiments et substitutions autorisées              | P1                  | À qualifier   |
| V4/CA05 | Kits, bundles et configuration réalisable             | P1                  | À qualifier   |
| V4/CA06 | Spécifications, certificats et publication multicanal | P1                  | À qualifier   |

### Finance

| Fiche   | Travail                                                       | Priorité du rapport | Qualification |
| ------- | ------------------------------------------------------------- | ------------------- | ------------- |
| V4/FI01 | Déduction client, escompte et abandon de créance              | P0                  | À qualifier   |
| V4/FI02 | Délettrage, rejet et remboursement traçables                  | P0                  | À qualifier   |
| V4/FI03 | Facture groupée et critères de séparation                     | P0                  | À qualifier   |
| V4/FI04 | Acompte, dépôt, avoir disponible et revenu différé            | P0                  | À qualifier   |
| V4/FI05 | Budget réservé, engagé et réalisé sans chevauchement          | P0                  | À qualifier   |
| V4/FI06 | Rapprochement bancaire ambigu et règles de reprise            | P0                  | À qualifier   |
| V4/FI07 | Correction tardive, période et réconciliation des sous-livres | P0                  | À qualifier   |
| V4/FI08 | Ristournes et commissions corrigées par les retours           | P1                  | À qualifier   |

### Fleet

| Fiche   | Travail                                                 | Priorité du rapport | Qualification |
| ------- | ------------------------------------------------------- | ------------------- | ------------- |
| V4/FL01 | Actif physique, emplacement et composant maintenu       | P0                  | À qualifier   |
| V4/FL02 | Compteurs absolus, différentiels et relevés corrigés    | P0                  | À qualifier   |
| V4/FL03 | Maintenance préventive : due, proposée et engagée       | P0                  | À qualifier   |
| V4/FL04 | Ordre de maintenance, autorisation de remise en service | P0                  | À qualifier   |
| V4/FL05 | Pièces réparables, garantie et coût de possession       | P1                  | À qualifier   |
| V4/FL06 | Modes de panne et choix réparer ou remplacer            | P1                  | À qualifier   |

### Flux

| Fiche   | Travail                                                         | Priorité du rapport | Qualification |
| ------- | --------------------------------------------------------------- | ------------------- | ------------- |
| V4/WF01 | Version de processus et version des règles réellement exécutées | P0                  | À qualifier   |
| V4/WF02 | Délégation et approbation par une personne admissible           | P0                  | À qualifier   |
| V4/WF03 | Échéances, rappels et escalades persistants                     | P0                  | À qualifier   |
| V4/WF04 | Approbations concurrentes et objet modifié                      | P0                  | À qualifier   |
| V4/WF05 | Échec partiel et compensation métier                            | P0                  | À qualifier   |

### Personnaliser

| Fiche   | Travail                                      | Priorité du rapport | Qualification |
| ------- | -------------------------------------------- | ------------------- | ------------- |
| V4/PE01 | Vues par rôle et filtres compréhensibles     | P1                  | À qualifier   |
| V4/PE02 | Champs configurables avec contrat de données | P1                  | À qualifier   |
