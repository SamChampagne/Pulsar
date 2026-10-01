# TODO — structured by phase

Conventions: `[ ]` open, `[x]` done. Keep this file updated as work lands; link PRs when relevant.

## Priorités actives — décision du 27 septembre

- [x] IA A1 : inventaire runtime visible, métadonnées bornées sans LLM, fournisseur/clé/URL isolés, validation liée à la configuration, permissions ACP système refusées, outils Hermes génériques retirés du parcours Pulsar, modèle explicite et session morte récupérable. [Analyse et contrat](docs/plans/ai-runtime-renewal.md).
- [x] IA A2a : candidat 0.21.5 installé séparément depuis son lock, huit contrôles ACP avec LLM/MCP synthétiques; reprise stricte, EOF et cancel. [Preuves et limites](docs/plans/ai-runtime-qualification.md). Runtime actif inchangé.
- [x] IA A2b / A3a : résultat typé moteur → ACP → runtime → worker/chat, refus fournisseur explicite sans heuristique texte, annulation distincte, timeout de tour, reprise manuelle après FAILED/KILLED et compteurs cumulés honnêtes. Neuf contrôles sur l’actif 0.16.0 et le candidat 0.21.5 sans appel réel. [Contrat et limites](docs/plans/ai-turn-outcomes.md).
- [x] IA A2c.1 : banc Linux hors ligne non-root, dépendances verrouillées et sources vérifiées; neuf contrôles ACP. API OVH non-root/read-only et exercice permissions/sauvegarde/restauration. [Preuves et limites](docs/plans/ai-linux-qualification.md).
- [x] IA A2c.2 code : image runner de production séparée, isolation OS par tenant, secrets/egress, reprise et rollback documentés. Candidat toujours non promu. [Profil de déploiement](deploy/agent-runner/README.md).
- [x] IA A2d code : Espace IA global, historique privé, modèles et workers, conversations/brouillons parallèles; runner 4 processus par défaut, configuration de groupe immuable et login exclusif. [Contrat](docs/plans/global-ai-workspace.md).
- [ ] IA A2c.2/A2d recette VPS : déployer le runner, tester connexion/OAuth réel et mission métier PROPOSE sur tenant pilote; aucune preuve locale ne remplace cette validation.
- [ ] IA multi-réplicas : remplacer le verrou interactif mono-instance par un bail distribué avant tout scale-out de l’API.
- [ ] IA A3–A5 : interface de moteur, benchmark métier autorisé (dossier/MRP/intervention), mesures de coûts et qualité, contexte sourcé, file durable et isolation serveur. Aucun gagnant ni production validée par les tests locaux A1.

- [x] Priorité communications demandée : Telnyx sortant tenant-scopé, clé chiffrée, droits, confirmation, simulation et reprise sans réémission; SMTP/IMAP guidé et aperçus texte/HTML bureau/mobile. [Contrat](docs/plans/communications-telnyx-email.md).
- [x] Communications v2 : activation SMS et IMAP par entreprise dans l’UI, confirmation et migration sans activation; webhooks signés, livraison séparée, réponses et STOP tenant-scopé. Aucun nouvel envoi automatique.
- [x] Communications C3a : panneau dans client/intervention/opportunité/expédition, décisions de contact versionnées avec preuve auditée, modèles opérationnels, aperçu et historique protégé par droits métier/canal; simulation, idempotence et reprise sans réémission. [Contrat](docs/plans/dossier-communications.md).
- [ ] Communications suivant : rattacher explicitement les réponses aux dossiers; réactivation contrôlée après STOP et harmonisation des anciens envois/séquences. Recette réelle Telnyx/SMTP HTTPS autorisée avant automatisations gouvernées. La configuration du Webhook URL entrant reste à copier dans le profil Telnyx; aucune validation fournisseur réelle locale.

[Programme des cinq axes](docs/plans/pilot-next-stage.md). La dernière tâche Finance
ne dicte plus à elle seule la prochaine priorité produit.

- [x] P1a : précontrôle dans Exploitation, profils Services/Transport/Fabrication, IA optionnelle, migrations comparées et export daté; observations distinctes de la recette réelle.
- [x] P1b publication : PR #82 fusionnée, CI finale et `main` vertes; 346 tests navigateur réussis, 114 ignorés. [État final et recette du 30 septembre](docs/releases/post-deployment-validation-2026-09-30.md).
- [ ] P1b exploitation : navigation VPS vérifiée sur l'entreprise de test, API/PostgreSQL OK. Restent image/SHA, migrations, MFA plateforme, deux tenants/rôles limités, invitations/documents et restauration; SSH non confirmé. Santé du cœur ne valide ni APS ni Hermes, signalés non installés.
- [ ] Qualification CI pilote : préparer les fixtures HTTP dans la base du job navigateur, commencer par autonomie/dossier 360/acceptation Services actuellement conditionnels; ne pas compter les 114 ignorés comme réussites. Diagnostiquer aussi le teardown Jest signalé le 30 septembre.
- [ ] Durcissement ingress : qualifier et tester les en-têtes HTTP absents sur le VPS (HSTS/CSP/anti-framing/nosniff/referrer) sans casser cartes, aperçus ni pages publiques; aucune modification serveur implicite.
- [x] P2a : dossier client 360° en lecture seule, liens explicites directs, huit types de dossiers, sections/compteurs selon droits/modules, pagination/recherche et navigation vers les sources. [Contrat et limites](docs/plans/customer-workspace.md).
- [ ] P3a : parcours Services complet avec exceptions, acceptation des travaux, correction après facture et reprise contrôlée.
- [x] P3a.1 : acceptation des travaux configurable avant activation du projet; réserves/historique, droit dédié, reprise exacte, contrôle avant facture Services et clôture. [Contrat](docs/plans/services-work-acceptance.md). Pas de signature électronique; scénario global P3a encore ouvert.
- [ ] P4a : contrat Finance externe/natif; maître par objet, export/accusés/rapprochement; périodes/corrections avant sous-livres natifs.
- [ ] P5a : mission IA en PROPOSE sur vrai provider avec budget autorisé, qualité/coût/latence, refus/interruption, puis récupération workers.

Location, POS, restauration et e-commerce restent ultérieurs. Les lots enterprise
ci-dessous conservent leurs limites; ils ne sont pas tous terminés.

## Audit enterprise — 2026-09-24

[Programme et critères de preuve](docs/plans/enterprise-audit-program.md) · [271 exigences conservées](docs/audits/README.md).

- [x] Importer et indexer les fiches V2–V4 avec provenance, statut initial et critères; distinguer exigences, constats et preuves.
- [x] E1a : carnet partagé multi-adresses/contacts, versions et historique, dates descriptives, droits consommateurs, concurrence/reprise et UI ordinateur/mobile.
- [x] Documentation intégrée et tutoriel Clients spécifique, sans accès portail ni mutation historique implicites.
- [ ] E0 : qualifier les 271 fiches contre le code et les parcours; ne pas compter E1a comme clôture de CL01/03/07.
- [x] E1b.1 : choisir et figer adresse/contact/version sur devis Services et factures clients; contrôle de fraîcheur et de version à l’engagement. [Contrats](docs/plans/document-coordinates.md).
- [x] E1b.2 : commandes Transport, coordonnées figées à confirmation, version/concurrence et planification atomique; tutoriel spécifique. [Contrats](docs/plans/transport-order-coordinates.md).
- [x] E1b.3 : copie facture explicitement reprise sur le PDF d’avoir, provenance, motif manuel et suggestion séparée de destinataire; aucun envoi implicite. [Contrats](docs/plans/credit-document-coordinates.md).
- [x] E1b.4 : PDF canonique de facture client, publication/source revues, remise explicite dédoublonnée, accès portail vérifié et fermeture des anciens raccourcis automatiques. [Contrats et compatibilité](docs/plans/customer-invoice-documents.md).
- [x] E1b.5 : carnet propre aux sociétés CRM et copie versionnée des coordonnées de commande, gel atomique à confirmation, concurrence et autonomie; documentation et tutoriel. [Contrats](docs/plans/crm-order-coordinates.md).
- [x] E1b.6 : coordonnées fournisseur explicites et gel atomique des commandes, sans confondre fournisseur et destination WMS; autonomie, reprise UI, documentation et tutoriel. [Contrats](docs/plans/supplier-order-coordinates.md).
- [x] E1b.7 : usages du carnet sur cinq types de documents, versions des brouillons et copies engagées distinctes, compteurs et liens gardés par droits/module, pagination en base et documentation/tutoriels. [Contrats](docs/plans/directory-document-impact.md).
- [ ] E1b suite : résolution des anciens liens ambigus, adresse/identité de l’acheteur et autres sorties PDF/envois; étendre la vue d’impact seulement après qualification des nouveaux consommateurs.
- [x] E1b.8 : revue/confirmation des liens partenaire–Customer–CRM, lecture inverse gardée, concurrence CRM et fiche entreprise descriptive (15 champs + 20 informations nommées), autonome dans les modules consommateurs. [Contrats et matrice](docs/plans/enterprise-information-depth.md).
- [ ] Programme I : enrichissement natif de tous les modules — articles/fournisseurs, exécution physique, Services/SAV, Finance/Qualité/RH puis partage/pilotage. Chaque champ opérationnel exige workflow, validations, droits, tutoriel et tests; la fiche entreprise ne clôt pas ces lots.
- [x] I1a : fiche article produit/prestation, références fournisseur versionnées, prix/devise/MOQ/multiple/validité et copie explicite sur commande; contrôle à confirmation, lecture seule et documentation/tutoriels. [Contrats](docs/plans/catalog-purchasing-depth.md).
- [x] I1b : conditionnements et codes-barres structurés, copie explicite sur commande et réceptions exactes en colis ou unités de base, scan sans mutation, reprise idempotente et documentation/tutoriels. [Contrats](docs/plans/catalog-packaging.md).
- [x] I2a : lots immuables et dates déclarées, opt-in nouveaux articles, soldes par lot et journal atomiques, réception/rangement/préparation/Achats et documentation/tutoriels. [Contrats et limites](docs/plans/wms-lots.md).
- [x] I2b : comptages par lot/unité, contrôle d’instantané même après mouvement net zéro, réconciliation atomique, ajustements à reprise durable et tutoriel spécialisé. [Contrat](docs/plans/wms-lot-counts.md).
- [x] I2c : consommation explicite par lot dans Services, preuve figée et retours partiels au lot d’origine, autonomie Services/WMS et contrôles de facturation conservés. [Contrat](docs/plans/services-part-lots.md).
- [x] I2d : déclaration atelier multi-lots, sortie produit tracée, preuve directe matières → produit et remontée journal → OF gardée; documentation/tutoriel. [Contrat](docs/plans/manufacturing-lots.md).
- [x] I2e : contrepassation complète de déclarations v2 sur OF en cours, revue/motif/reprise, mouvements compensatoires atomiques, quantités nettes OF/impacts et preuves MRP; documentation/tutoriel. [Contrat](docs/plans/manufacturing-reversals.md).
- [x] I2f : quarantaine manuelle globale par lot, sorties gardées centralement, libération documentée avec droit distinct, disponible MRP/APS net et reprise/historique; [contrat et limites](docs/plans/wms-lot-quarantine.md).
- [x] I2g : contrôle Qualité de lot à source immuable, fraîcheur révision/mouvements, libération humaine avec preuve conforme facultative et préparations WMS ouvertes liées; droits/reprise, documentation et tutoriels. [Contrat](docs/plans/quality-lot-controls.md).
- [x] I2h : traçabilité amont/aval bornée sur preuves atelier vérifiées, chronologie et contrepassations, dossiers WMS/Services/Transport gardés par accès; lecture seule, documentation et tutoriels spécifiques. [Contrat](docs/plans/wms-lot-traceability.md).
- [x] I2i : sorties documentées destruction/rebut et retour fournisseur, WMS autonome, revue humaine et droits distincts, stock/proof atomiques, quarantaine conservée, reprise exacte et documentation/tutoriel. [Contrat](docs/plans/wms-stock-exits.md).
- [x] I2j : réception d’achat explicitement capturée, cumul borné sans réservation, preuves commerciales gardées, justificatifs append-only et reprise fichier exacte; guides WMS/Achats adaptés. [Contrat](docs/plans/wms-return-purchase-evidence.md).
- [x] I2k : réception/acceptation/refus fournisseur déclaratifs et cumulatifs, pièce obligatoire, corrections append-only, versions/reprise exacte et WMS autonome; documentation et tutoriels adaptés. [Contrat](docs/plans/wms-supplier-return-followup.md).
- [x] I2l.1 : registre de factures fournisseur dans Finance autonome, montants déclarés exacts, pièces protégées, liens Achats explicites, qualification documentaire figée et reprise exacte. [Contrat](docs/plans/billing-supplier-invoices.md).
- [x] I2l.2 : avoir fournisseur reçu séparé, lié à une facture QUALIFIED, plafonds exacts par ligne/taxe, original protégé et confirmation humaine. Contexte facultatif de retour WMS versionné et gardé; aucun montant déduit du retour, aucun paiement/stock/comptabilisation. [Contrat](docs/plans/billing-supplier-credits.md).
- [x] I2l.3 : dossier fournisseur documentaire, identité courante/historique, factures/avoirs/pièces, synthèse exacte par devise, filtres et pagination en base, téléchargements protégés, liens aux dossiers sources, aide et tutoriel spécifiques. Aucune dette/paiement inférée. [Contrat](docs/plans/billing-supplier-dossiers.md).
- [x] I2m.1 : échéancier fournisseur opérationnel, dates/montants exacts, revue/confirmation humaine, révisions append-only, reprise/concurrence et fraîcheur après avoir; synthèse séparée par devise, liens Finance, aide/doc/tutoriel. Aucun paiement ou posting. [Contrat](docs/plans/billing-supplier-schedules.md).
- [x] I2m.2a : devise capturée sur nouvelles écritures, NULL historique conservé, rapports exacts par devise et couverture, saisie manuelle idempotente/audit atomique, reprise UI, gardes banque/budget, aide/doc/tutoriel. [Contrat et limites](docs/plans/billing-ledger-currency.md).
- [x] I2m.2b : cible comptable configurable par entreprise (Pulsar/externe), révisions et droit dédié; budgets à devise/période figées, écarts exacts, historique non qualifié préservé, archivage et reprise durable. Documentation et tutoriel sans reset. [Contrat](docs/plans/billing-accounting-profile-budgets.md).
- [x] I2m.2c : nouvelles immobilisations par devise, plan exact figé après revue, dotations mensuelles atomiques et idempotentes, droit dédié, historique et reprise durable. Anciens actifs NULL en lecture seule, retrait distinct d’une cession comptable, documentation et tutoriel sans reset. [Contrat](docs/plans/billing-fixed-assets-currency.md).
- [x] I2m.2d.1 : qualification documentée des écritures historiques manuelles, preuve protégée, revue humaine, annotation révocable sans réécriture, audit atomique et reprise durable. Journal/rapports/budgets cohérents, aide/doc/tutoriel et dossier mobile. [Contrat](docs/plans/billing-historical-qualification.md).
- [ ] I2m.2d.2 : reprise des sources historiques liées (paiements/factures/actifs) avec preuves et rapprochement des dossiers métier; ne pas utiliser la qualification manuelle pour les contourner.
- [x] I2m.2d.2a : paiements historiques entièrement affectés, rapprochement source exact, qualification groupée avec contrepassation et retrait cohérent. Annulation sur comptes originaux, contrôle bancaire, preuve/droits/reprise, aide et tutoriel. [Contrat](docs/plans/billing-payment-qualification.md).
- [x] I2m.2d.2b : factures clients/transporteurs cohérentes et avoirs clients historiques, rapprochement exact et qualification groupée, garde des avoirs connus, droits source, UI/doc/tutoriel. [Contrat et limites](docs/plans/billing-invoice-qualification.md).
- [x] I2m.2d.2c : paiements historiques partiellement affectés, journal rapproché de la seule portion affectée, reste déclaré explicitement hors comptabilité, qualification/annulation groupée et banque toujours bloquée. UI/doc/tutoriel adaptés. [Contrat et limites](docs/plans/billing-partial-payment-qualification.md).
- [x] I2m.2d.2d : factures transporteur ajustées avec acceptation tracée, rapprochement exact du payable/écarts/taxes conservées, preuve et revue sans réécriture. UI/doc/tutoriel spécialisés. [Contrat et limites](docs/plans/billing-accepted-carrier-qualification.md).
- [x] I2m.2d.2e.1 : dotations historiques rapprochées et qualifiées ensemble par actif sur preuve, retrait groupé, originaux inchangés; registre relié au dossier, aide/doc/tutoriel. Aucun plan futur activé. [Contrat](docs/plans/billing-asset-history-qualification.md).
- [ ] I2m.2d.2e.2 : reprise prospective des anciens plans d’actifs sur preuves, valeur/date de départ et durée restante explicites, sans reconstruire l’historique ni doubler les dotations. Formes comptables non standard, acceptations manquantes et autres sources incohérentes à qualifier séparément; aucune reprise sans journal implicite.
- [ ] I2m.2d / E4 : qualifier les actifs et écritures historiques avec preuves, contrepassations contrôlées, devise fonctionnelle/taux et périodes/clôtures, puis sous-livre fournisseur. Le profil I2m.2b est une cible, pas une activation officielle ou un connecteur. Aucun paiement à brancher sur le seul reste documentaire.
- [ ] I2l suite : corrections d’avoirs qualifiés, multi-factures, rapprochement trois pièces; I2m suite : gabarits de conditions de paiement, allocations et balance âgée réconciliée. Le reste créditable et l’échéancier opérationnel ne sont pas une dette payable.
- [ ] I1 suite : tarifs multiples/paliers, dérogations, notices et imports à qualifier. I2 suite : comptabilisation/corrections des avoirs fournisseur, réponse directe du fournisseur, retours multi-lignes/non suivis par lot/MRP, quarantaine partielle, corrections partielles/aval et OF terminés; allocation par pièce, rappel réglementaire complet, séries et FEFO. Les dates déclaratives ne remplacent pas ces workflows.
- [ ] Facturation : qualification SMTP, résolution gardée des anciennes remises/incertitudes, renvoi explicite et documents compensatoires.
- [ ] E1 suite : rôles donneur d’ordre/livré/facturé/payeur, affiliations et pouvoirs, conditions commerciales, révisions et crédit.
- [ ] E2/E3 : conservation des quantités POD, corrections et preuves distinctes des effets financiers; engagements transport/APS et exécution partielle.
- [ ] E4 : qualifier Finance existante, maître comptable natif/externe, périodes et sous-livres réconciliés avant nouvelles politiques fiscales.
- [ ] E5–E8 : approfondir les profils Services/Industrie/Distribution/Transport, les échanges, l’observabilité et les agents suivant les preuves du programme.

## Profondeur métier — 2026-09-23

Programme et sources : [Clients, fuseaux, cargo et finance](docs/plans/business-depth-clients-time-zones.md).

- [x] Clients facultatif sur référentiels existants, droits propres, adresses facturation/livraison séparées, tutoriel métier et documentation.
- [x] Préférence de fuseau utilisateur conservée, bandeau permanent dans le shell métier, affichage des instants des helpers/journaux migrés et dates civiles préservées.
- [x] Composant de tableau configurable, visibilité/largeur clavier-souris; espaces Données et Clients, préférences utilisateur/tenant/appareil.
- [ ] Généraliser la saisie explicite de fuseau avec résolution des heures ambiguës/inexistantes; conserver les fuseaux métiers et snapshots historiques.
- [x] Carnet multi-adresses et contacts versionné (E1a, 2026-09-24).
- [ ] Préremplissage/capture du carnet dans les documents, dossier client 360° et rapprochement humain des identités.
- [ ] Clarifier remanifeste opérationnel/douanier; import cargo prévisualisé et idempotent, révisions/transferts/split-merge avec conservation des quantités.
- [ ] POD réserves/quantités/corrections, adaptateur ISAAC après contrat API et sandbox, affectations datées et observations dédoublonnées.
- [ ] Fiscalité versionnée par juridiction/date/nature du service; N lignes et bases configurables, justificatifs, arrondis exacts et snapshots validés par l’expert métier.
- [ ] Approfondissements spécialisés WMS, Fabrication, Cour, Flotte, Achats, Services, SAV, Qualité, RH et agents selon la matrice du programme.

## Autonomie des modules — 2026-09-23

- [x] Façades et espaces Données par consommateur, création intégrée, parc Flotte sans TMS, Services/SAV/Achats sans Catalogue. [Contrats](docs/plans/module-autonomy.md).
- [x] Connexions explicites Facturation et stock accessibles depuis Services/Achats, sans activation Catalogue; droits cibles conservés.
- [ ] Qualifier toutes les combinaisons d’activation, les champs personnalisés obligatoires et les parcours administratifs complets des portails.
- [ ] Harmoniser les identités historiques avec rapprochement humain et généraliser le contrôle de version des fiches historiques, sans fusion par nom.

## Pilote métier fiable — cinq axes, 2026-09-22

- [x] Avoirs clients : publication PDF à identités figées, conservation protégée, remise explicite idempotente et distinction simulation/SMTP/incertain. [Contrats](docs/plans/customer-credit-documents.md).
- [ ] Qualifier les inscriptions et SMTP sur VPS; procédure gardée de résolution des remises, documents compensatoires puis remboursements/affectations de crédits.

Programme : [pilot-business-depth.md](docs/plans/pilot-business-depth.md), branche
`codex/pilot-business-depth`. Socle pilote et retours partiels Services locaux, aucun déploiement ni nouvelle PR.

- [x] Transport webhook/EDI : résolution DNS contrôlée à chaque tentative, connexion épinglée, redirections refusées et délai total borné.
- [x] Réactivation de connecteur : droits de la cible entrante/EDI et URL revérifiés, y compris PATCH de statut seul; version serveur contre les changements concurrents.
- [x] Désactivation : livraisons en attente suspendues et exclues du cron, historique conservé.
- [x] Qualification Docker : dump/restauration base et document binaire dans un second projet jetable; isolation, identifiants, migrations, readiness et MFA vérifiés.
- [x] Documentation opérateur et explications intégrées Connect/Réglages.
- [ ] Pilote : recette VPS, SMTP, vrais scanners, charge et stabilisation des tests navigateur restants.
- [x] Services : retours partiels historisés, quantités nettes facturables, versions contre sélection périmée et correction de brouillon guidée. [Contrat et limites](docs/plans/services-partial-returns.md).
- [x] Avoirs clients internes : taxes figées, validation comptable atomique, solde net, droits dédiés et retour Services séparé. [Contrat et limites](docs/plans/customer-credit-notes.md).
- [ ] Avoirs : notes de débit, remboursement et transfert de crédit rapprochés (PDF/envoi livrés localement, qualification métier externe restante).
- [ ] Parcours métier : achats fournisseurs, quarantaine Qualité et replanification WIP Fabrication.
- [ ] Dossiers : vue client Catalogue/CRM/Services/Facturation/SAV, liens réciproques et configuration guidée.
- [ ] IA : récupération de workers, missions qualifiées sur vrai provider et mesures coût/qualité/latence.
- [ ] Location : tables propres, réservations, contrats, départs/retours, connexions, tutoriel spécifique et documentation.

## Exploitation connectée — 2026-09-22

Contrats, limites et recette : [livraison](docs/plans/connected-business-delivery.md) ·
[essai serveur](docs/plans/connected-business-server-acceptance.md).

- [x] Mon travail : cinq sources dérivées, droits/modules, réglages et liens actionnables.
- [x] Planning Services jour/semaine, personnes/équipes, durée et fuseau entreprise, conflits/absences/qualifications, déplacement confirmé.
- [x] Partenaire Catalogue ↔ client Facturation/société CRM explicites; devis figé → projet.
- [x] Heures approuvées/pièces consommées → brouillon Facturation, sources uniques et reprise idempotente.
- [x] Coordinateur Services/SAV : huit outils, propositions gouvernées, aucune décision RH ou approbation financière.
- [x] Documentation, connexions et tutoriel Services actualisés; bureau et composants Pulsar conservés.
- [ ] Recette VPS, vrais périphériques Zebra/USB et fournisseur LLM réel, avec accès limités.
- [ ] Capacité APS main-d'œuvre, compensations Services après facturation, notifications et nouveaux déclencheurs always-on.

## Fondations multi-métiers — 2026-09-21

Contrats et périmètre : [business-foundations.md](docs/plans/business-foundations.md).

- [x] Application Documentation intégrée, guides/règles/limites des 22 espaces, recherche et relance des tutoriels.
- [x] Catalogue partagé des nouvelles apps : partenaires client/fournisseur, produits/prestations, versions et désactivation.
- [x] Achats fournisseurs : brouillon multiligne, confirmation figée, total Decimal et clôture administrative.
- [x] Services : projets, interventions, responsable textuel, horaire, compte rendu et clôtures gardées.
- [x] Services : personnes affectées, Mes interventions, feuilles de temps manuelles et totaux projet; versions, annulation motivée et reprise idempotente ([contrats](docs/plans/services-assignment-time.md)).
- [x] Tables métier distinctes, FK tenant composites, permissions, numérotation et audit; tutoriels première entrée.
- [x] Activation simultanée d’une nouvelle app résistante à la concurrence.
- [x] Correspondance Catalogue ↔ WMS un-à-un, unités contrôlées; pièces Services et retours intégraux idempotents ([contrats](docs/plans/services-parts-and-connected-documentation.md)).
- [x] Documentation approfondie : fiches de connexions, responsabilités, déclencheurs/effets/limites, parcours intermodules, glossaire et dépannage intégrés.
- [x] Correspondances explicites partenaires Catalogue ↔ société CRM/client Facturation (référentiel client historique partagé TMS).
- [x] Services : approbation indépendante des temps, refus/réouverture motivés, gel, journal transactionnel et garde de clôture ([contrats](docs/plans/services-time-approval.md)).
- [ ] Services : revue hebdomadaire/en masse, délégations, relances et procédure des temps historiques sur projets déjà fermés.
- [ ] Services : capacité avancée, retours partiels/stock mobile et signatures (planning humain, devis/facture brouillon livrés ci-dessus).
- [x] Achats ↔ WMS : arrivages partiels, reliquats, champs personnalisés, preuve paginée, reprise sans doublon et clôture motivée ([contrats](docs/plans/supplier-receipts-and-support.md)).
- [ ] Achats : liens projet/MRP, envoi, retours fournisseur, rapprochement facture et navigation WMS → commande fournisseur.
- [ ] Événements/worker always-on des nouvelles apps; outils interactifs Services/SAV livrés ci-dessus.
- [ ] Procédures privées par tenant dans Documentation et exercices tutoriels métier approfondis.
- [x] Tutoriels RH/Qualité/SAV/Achats versionnés et distincts, pratique/reprise, première présentation automatique par utilisateur et relance dans l’aide, comptes de recette isolés ([contrat](docs/plans/skills-followup-and-module-tutorials.md)).
- [x] SAV v1 : demandes client, qualification, priorité, lien Services cohérent, résolution/réouverture/clôture, historique, tutoriel automatique et documentation.
- [x] SAV : responsable interne, échéance civile et files Mes demandes à traiter/Sans responsable/Échéances dépassées. Achats : files serveur de préparation, arrivages et retards ([contrat](docs/plans/skills-followup-and-module-tutorials.md)).
- [ ] SAV : attribution d’équipe, délais/SLA, garanties, pièces jointes et portail client; pas d’envoi ni d’agent autonome livré.
- [x] Programme intégré des six modules restants : responsabilités des données, connexions, premier workflow et tutoriel requis; statuts « à développer ».
- [x] Qualité v1 : plans versionnés, critères figés, contrôles mesurés, NC atomiques, analyse/correction/vérification et journal; liens WMS/Fabrication/SAV, documentation et tutoriel ([contrats](docs/plans/quality-workflows.md)).
- [x] Qualité v2 : responsables/échéances, filtres de suivi, preuves PDF/PNG/JPEG via Documents avec accès métier, reprise idempotente et protection contre les accès génériques ([contrats](docs/plans/quality-workflows.md)).
- [ ] Qualité : liens retour, contre-contrôles reliés, quarantaine WMS; aucun stock libéré par une simple clôture.
- [x] RH v1 : employés, équipes, compte optionnel distinct et fixe, demandes d’absence, espace personnel, décision indépendante, chevauchements gardés, journal, documentation et tutoriel première visite ([contrats](docs/plans/hr-foundations.md)).
- [x] RH → Services : contrôle minimal des absences approuvées par jour, permission dédiée, liste et prévisualisation, états inconnus, fuseau explicite, aide/tutoriel et confidentialité ([contrats](docs/plans/hr-services-availability.md)).
- [x] RH : compétences/habilitations datées, révocation motivée, contrôle minimal des exigences d’un poste Fabrication; permissions et documentation dédiées ([contrat](docs/plans/skills-followup-and-module-tutorials.md)).
- [ ] RH : matrice par équipe, exigences des opérations/gammes puis disponibilité Fabrication, réaffectation auditée compte/employé, rétention et accès hiérarchiques. Alertes d'expiration livrées dans Mon travail; aucune paie ni donnée médicale.
- [x] Services : fuseau métier stable et durée prévue; planning revérifie tous les jours civils couverts par le créneau.
- [ ] Location, Commerce/POS, Restauration et e-commerce : implémentation et tutoriels exécutables, non livrés par leur documentation de cadrage.

## Utilisabilité client — 2026-09-21

Contrats, couverture et tests : [end-user-workflows.md](docs/plans/end-user-workflows.md).

- [x] Éditer/désactiver clients et transporteurs depuis listes et fiches; validations serveur.
- [x] Notes load versionnées avant exécution; corrections de taille des cartes et labels sûrs.
- [x] Aide contextuelle + guides textuels relançables, clavier opt-in, créations rapides article/bin.
- [x] Zone visible/éditable dans les emplacements, Apparence centralisée, import logo portail.
- [ ] Zones autonomes par site (y compris vides), affectation multiple et migration du classement existant.
- [ ] Dates avec raccourcis/fuseaux, autocomplete externe d’adresses après choix d’un fournisseur.
- [x] Visites guidées d’entrée des 18 espaces : surlignage, navigation, reprise serveur par utilisateur et relance depuis « ? » ([contrats](docs/plans/scanners-and-module-tours.md)).
- [ ] Exercices tutoriels métier approfondis par page/rôle et portail externe.
- [x] Scan clavier USB/Bluetooth et Zebra DataWedge : recherche dans 5 modules, sélection article/bin et comptage brouillon +1 EA avec confirmations.
- [ ] Comptage scanner testé sur matériel; préserver confirmations, idempotence et contrôle du stock.
- [ ] Bureau à deux panneaux conservant contexte et brouillons indépendants.
- [ ] Cohérence des partenaires inactifs dans tous les nouveaux dossiers, filtre Actifs/Inactifs et versions d’édition.
- [ ] Nettoyage des anciens logos et écriture atomique des réglages de branding concurrents.

## Fabrication / MRP — discret et procédés (2026-09-15)

- [x] M1 : poste Pulsar, politiques par entrepôt, demandes/arrivages, explosion multi-niveaux Decimal, snapshots immuables, garde unités et réception WMS non doublée ([contrats et trajectoire](docs/plans/manufacturing-mrp.md)).
- [x] M2.1 : BOM Decimal et versions publiées, sélection explicite MRP, unité/SKU après usage figés, site/version et instantané matières des OF ([contrats](docs/plans/manufacturing-definitions.md)).
- [x] M2.2a : commandes CRM → demandes MRP explicites, prévisions par période consommées sans double comptage, historique et droits croisés ([contrats](docs/plans/manufacturing-demand-sources.md)).
- [x] M2.2b1 : mappings CRM/WMS et ratios commerciaux exacts réutilisables, capturés sans réécriture des demandes ([contrats](docs/plans/manufacturing-mrp-units-ai.md)).
- [x] M2.2b2 partiel : validité figée des versions BOM, site des calendriers hérité par les postes, candidats APS gardés par site ([contrats](docs/plans/manufacturing-mrp-preparation.md)).
- [ ] M2 unités : conversions achat/stock, unités industrielles supplémentaires et quantités fractionnaires OF.
- [x] M3a : propositions → demandes d'achat internes / OF DRAFT, prévisualisation, confirmation, idempotence, refus des doublons inter-calcul et contexte lisible par l'analyste ([contrats et limites](docs/plans/manufacturing-mrp-preparation.md)).
- [x] M3b v1 : fournisseurs/conditions, bon mono-demande confirmé humainement, arrivages fermes et réceptions partielles WMS avec rapprochement sans double comptage ([contrats et limites](docs/plans/manufacturing-material-purchases.md)).
- [x] M3c partiel : poste Arrivages, report d’arrivée confirmée et clôture de reliquat historisés sans stock fictif ([contrats](docs/plans/manufacturing-operational-loop.md)).
- [ ] M3c suite : regroupement multi-lignes, intake de champs personnalisés WMS, taxes/factures/retours et unités achat/stock.
- [x] M4 v1 : impacts matières par site, arrivages datés dans APS, date minimale capturée et fraîcheur stock/achats à la publication; contexte courant pour l'analyste ([contrats](docs/plans/manufacturing-operational-loop.md)).
- [ ] M4 suite : WIP/temps réels par opération, baseline/gel et replanification partielle, APS multi-sites. Un OF actif avec déclarations bloque actuellement le recalcul global.
- [x] M5 v1 : atelier, consommation explicite/production bonne/rebut, journal WMS atomique et reprise idempotente, preuves au MRP ([contrats](docs/plans/manufacturing-operational-loop.md)).
- [ ] M5 suite : réservations, scans, correction compensatoire gouvernée, lots/généalogie et coûts réconciliés.
- [ ] M6 : recettes/batchs, rendements, coproduits, conversions masse/volume contrôlées, généalogie et qualité.
- [ ] M7 : pilotage et agents gouvernés ; outillage READ puis propositions approuvées, jamais d'achat externe automatique issu du calcul.
  - [x] M7a : analyste MRP, lectures bornées, tâche/worker/MCP, synthèse approuvée et recalcul sans boucle, suivi Pulsar.
  - [ ] M7b : qualification fournisseur LLM réel, budgets/évaluations, gros briefs paginés et reprise/observabilité 24/7.

## Modules visuels — priorité de relance (2026-09-14)

- [x] Cour & quais : poste de travail par site, plan configurable, occupation, planning et panneaux d’action ([contrats et limites](docs/plans/yard-visual-workspace.md)).
- [x] Gardes Yard : disponibilité et même site, concurrence, départ/annulation traçables, arrivée liée sans doublon.
- [x] Connexions explicites visite/rendez-vous ↔ chargement TMS ↔ réception/préparation WMS ([contrats et limites](docs/plans/yard-connected-dossiers.md)).
- [x] Référentiel entrepôts en lecture avec `wms.read`, sans dépendance à la lecture des localisations TMS.
- [ ] Cohérence guidée entre lignes/expéditions des dossiers reliés; validations des lignes et réservations de stock.
- [ ] Replanification contextuelle, horaires/capacités des quais et seuils de présence configurables.
- [x] WMS visuel v1 : zones/emplacements, files par site et déplacement confirmé depuis le stock ([contrats et limites](docs/plans/wms-visual-workspace.md)).
- [x] WMS guidé : réception/préparation par lignes, unités/stock/manque, correction en panneau, choix recherchables et validation versionnée ([contrats et limites](docs/plans/wms-guided-operations.md)).
- [x] Sérialiser édition/validation des documents WMS; revalider site/article/bin et besoin cumulé; préserver saisie et bloquer le retry incertain.
- [x] WMS rangement : file par site, journal contextualisé, unités capturées et MOVE idempotent avec reprise navigateur; scénario local DÉMO ([contrats et limites](docs/plans/wms-putaway-traceability.md)).
- [ ] WMS suite : recherche paginée sur les anciens référentiels de l'inventaire; annulation serveur explicite des intentions de MOVE incertaines; provenance par lot à concevoir.
- [ ] Réception/préparation partielles, quantités attendues/réelles, scans, allocations/réservations et règles de conversion d'unités.
- [x] Flotte visuelle : parc, échéancier UTC, historique paginé et panneaux d’intervention; concurrence multi-ordres et versions ([contrats et limites](docs/plans/fleet-visual-workspace.md)).
- [ ] Flotte v2 : anciens registres/documents paginés, inspections/relevés, création idempotente; vraie réservation atelier et disponibilité prévisionnelle à concevoir.
- [ ] Fabrication / PlaniAdvance : commencer par le contrat APS complet, les snapshots rejouables, les fuseaux, la publication gardée et la CI moteur; puis Gantt/scénarios et flux métier ([audit et lots](docs/plans/manufacturing-planiadvance-integration.md)).
- [x] Fabrication A1 : passerelle privée isolée, workflow moteur complet, artefacts/rejeu historique, publication gardée et voie CI APS ([contrats et limites](docs/plans/manufacturing-aps-foundation.md)).
- [x] Fabrication A2.1 : fuseau commun explicite/DST et fenêtres UTC rejouables, panneaux Pulsar de calcul/revue, comparaison moteur et confirmation versionnée ([contrats et limites](docs/plans/manufacturing-scenario-review.md)).
- [ ] Fabrication A2 suite : baseline/actions en entrée, arbitrage humain pour `review`, parité WIP/gel avancée, sites/fuseaux distincts, nuit, matières par site et quotas avant Gantt interactif.
- [ ] Agents : suggestions contextuelles gouvernées, motifs et résultats reliés aux dossiers.

## Relance UI — dossiers financiers connectés (2026-09-14)

- [x] Association audit → facture approuvée existante, tenant-scopée et idempotente.
- [x] Navigation facture/paiement/banque, sélection expliquée et confirmations UI.
- [x] Rapprochement bancaire un à un : montant, sens, devise, écriture réelle, concurrence.
- [x] Interdire annulation d’un paiement rapproché et suppression d’un compte avec mouvements.
- [x] Import CSV : prévisualisation, validation stricte du format pris en charge et dédoublonnage serveur ([lot 6](docs/plans/bank-csv-import.md)).
- [ ] Mapping guidé des formats bancaires et historique/correction des imports.
- [ ] Parcours documenté de correction d’une association audit/facture.
- [ ] Rapprochements partiels/groupés, frais, avances et FX : conception dédiée.
- [ ] Atomicité historique du rapprochement Freight Audit/factures; grand livre multi-devises.

Contrats, migration et preuves : [finance-connected-flow.md](docs/plans/finance-connected-flow.md).

## Phase 0 — Foundation

- [x] Monorepo pnpm workspaces + root scripts
- [x] Docker Compose PostgreSQL
- [x] Prisma schema: core (tenants, users, roles, permissions, audit, documents, notifications,
      integrations, module registry)
- [x] Prisma schema: transportation (Customer, Location, Carrier, Driver, Vehicle, Trailer,
      TransportOrder, Shipment, Load, Route, Stop, Rate, TrackingEvent, ProofOfDelivery)
- [x] Seed: permission catalog, module catalog, demo tenant + admin + sample data
- [x] API: auth (JWT login, /auth/me), guards (auth → module → permissions)
- [x] API: core controllers (tenant, users, roles, permissions, audit-logs, documents metadata,
      notifications, integrations, modules)
- [x] API: transportation controllers (master data CRUD, orders lifecycle, shipments,
      loads dispatch/transit/complete/cancel, routes & stops, tracking, POD)
- [x] Web: login, app shell, dashboard, transport orders (list/create/actions), customers,
      carriers, module settings
- [x] Docs: architecture, data model, multi-tenancy, module system, API conventions,
      getting started, PRODUCT_SPEC, ROADMAP, CLAUDE.md
- [x] First Prisma migration committed (`init`)
- [x] CI pipeline (.github/workflows/ci.yml: validate + typecheck + build + unit + e2e)

## Phase 1 — Usable TMS happy path

### API

- [x] Per-tenant number sequences (TO/SH/LD) — atomic `number_sequences` table
      (`SequencesService`)
- [x] Validate tenant ownership of all referenced ids in write payloads (`OwnershipService`)
- [x] Unit tests: workflow state machines (packages/shared, vitest)
- [x] E2E test: order → confirm → plan → load → dispatch → deliver → POD → close
      (`apps/api/test/workflow.e2e-spec.ts`)
- [ ] Unit tests on order/load services (mocked Prisma)
- [ ] Standardized error codes (machine-readable `code` field alongside message)

### Web

- [x] Transport order detail page (shipments, timeline, actions)
- [x] Shipments page with "assign to load" flow (pick existing load or create one)
- [x] Loads page: list + detail (assign resources, dispatch/start-transit/complete/cancel)
- [x] Route v0 on load detail: auto-generate stops from shipments + arrive/depart actions
- [ ] Route editor v1: manual stop reordering and planned times
- [x] Tracking timeline component (events per load/shipment)
- [x] POD capture form (load detail, per delivered shipment)
- [x] Toast notifications for action feedback

## Phase 2 — Collaboration & cost

- [x] Tendering: PLANNED→TENDERED workflow, Tender entity, public accept/decline endpoints +
      carrier page (`/tender/[token]`), expiry, dispatch gated on acceptance
- [x] Public tracking link per shipment (`/track/[token]`) + share/revoke endpoints
- [x] Driver mobile page (`/driver/[token]`): stop arrive/depart, POD + photo, revocable link
- [x] Cost engine: `calculateRateCost` (shared, unit-tested) + `LoadCostService` recompute hooks
- [x] Carrier scorecard endpoint + Analytics page (`transportation.analytics.read`)
- [x] Outbound webhooks v0 (HMAC signature, tender/load events)
- [x] Refresh tokens (rotation, hashed at rest) + transparent refresh in the web client + logout
- [x] File storage: local/S3 drivers behind FILE_STORAGE, upload/download endpoints, POD photos
- [x] E2E suite for the collaboration layer (7 tests)

## Phase 2.5 — Tender automation

- [x] Email channel (`EmailService`, log/SMTP drivers) — tender links emailed automatically,
      `emailedTo` surfaced in tender responses
- [x] Lane carrier preference lists (`LaneCarrierPreference`, GET/PUT /transportation/lanes,
      `/lanes` web page)
- [x] Auto-tendering chain (`auto-tender` endpoint, advance on decline, 5-min expiry cron,
      `tender.expired` webhook, `isAuto` flag)
- [x] Tenant modules cache (30 s TTL + invalidation on toggle) in `ModulesGuard`
- [x] E2E suite for tender automation (6 tests)

## Phase 3 — Operational depth

- [x] Order splitting at plan time (`PlanTransportOrderDto.shipments`, split form on order detail)
- [x] Manual route editor (reorder, planned arrival per stop, distance/duration → PER_KM cost)
- [x] Delivered email to the order's customer contact (tracking link included when shared)
- [x] User invitations (INVITED status, one-shot 72 h token, `inviteUrl` returned, Users page)
- [x] Forgot/reset password (1 h token, enumeration-safe, refresh tokens revoked on reset)
- [x] Webhook outbox (`webhook_deliveries`, retry cron with backoff, deliveries endpoint)
- [x] Phase 3 e2e suite (5 tests)

## Phase 4 — Platform & integrations

- [x] Inbound API keys (read-only scopes, X-Api-Key header, hash at rest, revocation,
      Settings → API keys page)
- [x] Audit interceptor (`@Audit` decorator, applied to master-data create/update)
- [x] Pre-signed URLs (S3 driver: GET + direct PUT upload with confirm step;
      local driver degrades to API download)
- [x] Post-planning shipment management (add shipment to PLANNED order, cancel PENDING shipment)
- [x] **Customer Portal module v1** (second business module): per-customer capability link,
      read-only orders/shipments/tracking view, module-gated management + public page
- [x] Phase 4 e2e suite (7 tests)

## Phase 5 — Portal v2, service accounts, Billing

- [x] Service accounts: API keys act as a hidden DISABLED tenant user → write scopes allowed,
      audit/FK attribution intact
- [x] Portal v2: order entry from the portal (DRAFT orders, locations projection, audited as
      `source: customer-portal`)
- [x] **Billing module v1** (third business module): carrier invoice drafts from completed
      loads' estimated costs, billable preview, approval, double-billing prevented by schema
- [x] Phase 5 e2e suite (4 tests; module-state resets make suites rerun-safe)

## Phase 6 — Commercial readiness (specs/plans: docs/superpowers/)

- [x] SSO (OIDC) per tenant: `Tenant.authConfig` (clientSecret chiffré), flow PKCE avec
      state chiffré AES-GCM, lookup `oidcSubject` d'abord (email = fallback de liaison,
      refusé si `email_verified: false`), code d'échange one-shot 60 s atomique,
      provisioning au premier login, page Settings → SSO
- [x] Platform administration plane: modèle `PlatformUser` disjoint, stratégies JWT
      étanches, `PlatformGuard` avec relecture du status, création de tenant complète
      (rôle admin + invitation 72 h + modules), suspend/reactivate (sessions tuées,
      `refresh()` re-vérifie le statut), pages `/platform/*`, garde-fou prod
      (mot de passe par défaut et secrets d'exemple publiés refusés au boot)
- [x] Billing v2: rapprochement facture transporteur — tolérance sur l'écart BRUT
      (Σ|écart ligne|, attrape les compensations), DISPUTED + re-reconcile (facture
      corrigée), résolution codifiée (`DisputeReasonCode`), PAID (`billing.invoices.pay`),
      export CSV non plafonné — sell-side reporté après rating engine v2 (audit TMS §5)
- [x] Fleet module discovery doc (docs/fleet-module-discovery.md)
- [x] SOC2-track hardening: CryptoService (enc:v1, boot fail-fast), Integration.config
      chiffré + masqué, script reencrypt-secrets idempotent (rotation + sweep initial),
      docs/runbooks.md
- [x] (imprévu) Restauration des drivers file-storage perdus par une règle .gitignore
      trop large (`storage/` → `/apps/api/storage/`)

### Dette notée à la revue des plans phase 6 (durcissements différés)

- [x] Décorateur composite `@PlatformController()` (= `@Public()` + `@UseGuards(PlatformGuard)`)
      — le pattern actuel rend l'oubli du second décorateur silencieusement ouvert
      **→ livré en 7.4** : `apps/api/src/common/decorators/platform-controller.decorator.ts` ;
      `platform-tenants.controller.ts` + `platform-mfa.controller.ts` migrated vers ce décorateur
- [x] Throttling sur `POST /platform/auth/login` (porte cross-tenant exposée)
      **→ livré en 7.4** : `ThrottlerModule` dans `AppModule`, `@UseGuards(ThrottlerGuard)` sur
      `PlatformAuthController` uniquement, 20 req/min/IP (commentaire in-code explique le seuil)
- [x] Inclure le slug du tenant dans le state OIDC chiffré et le vérifier au callback
      (défense en profondeur contre le rejeu d'états entre tenants)
      **→ livré en 7.4** : `tenantSlug` inclus dans le state via `packOidcState` ; `callback`
      vérifie `state.tenantSlug !== slug` et retourne 401 en cas de divergence
- [x] Cache du `Issuer.discover` par issuer (un aller-retour de découverte par login OIDC)
      **→ livré en 7.4** : `issuerCache` TTL 1 h dans `OidcService` ; retry-once avec
      `forceRefresh = true` si l'échange IdP échoue (rotation d'endpoints)
- [x] MFA (TOTP + recovery) pour les comptes plateforme — phase 7 (voir spec phase 6)
      **→ livré en 7.4** : `PlatformMfaService` (otplib v12, fenêtre ±1) ; colonnes
      `totpSecret enc:v1`, `mfaEnabledAt`, `recoveryCodes` bcrypt à usage unique sur `PlatformUser` ;
      step tokens `mfa-enroll` (10 min, secret chiffré dans payload) et `mfa-pending` (5 min)
      rejetés par `platform-jwt.strategy` ; endpoints `login` (3 branches dont
      `PLATFORM_MFA_ENFORCED`), `mfa/enroll`, `mfa/verify` (publics) et `mfa/enroll-start`
      (authentifié via `@PlatformController`) ; 14ᵉ migration
- [x] Export CSV factures : préfixer les champs libres commençant par `=+-@` (injection de
      formule tableur) — risque faible (outil interne mono-tenant), à durcir avant exposition
      **→ livré en 7.4** : `csvSafe()` dans `apps/api/src/common/csv.ts` appliqué sur tous les
      champs libres de l'export CSV des factures transporteur
- [x] Gardes de statut des factures dans la transaction (`updateMany` conditionnel + count)
      plutôt que read-then-write — fenêtre TOCTOU acceptable en UI d'ops, à fermer si API publique
      **→ livré en 7.4** : transitions buy-side (`approve`, `markPaid`, `reconcile`,
      `resolveDispute`) utilisent `updateMany` conditionnel sur le statut attendu ; `createDrafts`
      dans `CustomerInvoicesService` est transactionnel avec `P2002 → 409`

## Phase 7 — Le « cerveau » TMS (rattrapage audit)

### Chantier 7.1 — Rating engine v2 + entité Lane ✅

- [x] Lane comme entité de première classe : hiérarchie géo LOCATION < CITY < STATE < COUNTRY,
      clés normalisées NFD (`originKey`/`destinationKey`), contrainte d'unicité, ordre de
      spécificité déterministe (`compareLanes`, tie-break `rateId`)
- [x] Tarifs rattachés aux lanes : tranches CWT (`RateBreak`) avec règle as-if à toutes les
      bornes, prix d'accessorials (`RateAccessorialPrice`), table carburant datée
      (`FuelSurchargeTable` / `FuelSurchargeEntry`) — résolution à la date de référence
      (premier pickup planifié, sinon today), priorité `fuelTableId` sur pourcentage statique
- [x] Snapshot figé `Load.costDetail` : invariant « jamais de recompute sur COMPLETED »,
      `updateMany` conditionnel atomique (race-safe), forme documentée dans data-model.md
- [x] Rate shopping (`GET /loads/:id/rate-options`) : tri devise → complets → total → spécificité
      → rateId
- [x] Auto-tender par spécificité : la lane la plus spécifique ayant des préférences est
      sélectionnée en priorité
- [x] CRUD accessorials (`/transportation/accessorials`) + tables carburant
      (`/transportation/fuel-tables`) avec entrées datées
- [x] 4 nouvelles permissions (`transportation.accessorials.read`/`.manage`,
      `transportation.fuel-tables.read`/`.manage`) — `transportation.rates.*` pré-existait
- [x] Seed démo : lanes, accessorials, fuel-table avec entrées, tarifs v2 avec tranches
- [x] Suite e2e phase7 (11 tests) + migration de la suite tender-automation
- [x] 4 nouvelles pages web : rates v2, lanes v2, accessorials, fuel-tables ; détail du load
      enrichi (costDetail snapshot + rate options)
- [x] Migration Prisma `20260611100309_phase7_rating_engine_lanes` (11ᵉ migration)

### Chantier 7.2 — Intégrité du plan ✅

- [x] Fenêtres temporelles early/late sur TransportOrder, Shipment et Stop : colonnes renommées
      sans perte de données (RENAME), colonne `late` ajoutée ; `TimeWindow`, `validateWindowPair`,
      `windowViolations` dans `packages/shared/src/planning/windows.ts`
- [x] Validations dures (400) : early ≤ late par paire, pickupEarly ≤ deliveryLate — mais
      pickupLate ≤ deliveryEarly délibérément NON validé (fenêtres qui se chevauchent = légitimes) ;
      `assertWindowCoherence` + `resolveSplitWindows` dans `window-validation.ts`
- [x] Avertissements consultatifs `windowWarnings` sur GET order et GET load : compare les fenêtres
      planifiées des shipments aux bornes demandées par l'ordre (`shipmentWindowWarnings`) — jamais bloquant
- [x] Capacité 3 axes (poids/volume/palettes) : `checkCapacity` dans
      `packages/shared/src/planning/capacity.ts` ; axes sans valeur ignorés ; égal à la capacité = OK ;
      gate dans `shipments.assignToLoad` et `loads.assignResources` avec `force` booléen ;
      dépassement forcé = entrée d'audit unique consolidée
- [x] `capacityPallets` ajouté au modèle `Trailer` et exposé dans le DTO trailer
- [x] Entité de jonction `shipment_load_legs` : migration `20260611120000_phase7_2_plan_integrity`
      avec backfill des assignations existantes ; maintenue dans la même transaction que
      `Shipment.loadId` dans `assignToLoad`, `removeFromLoad` et `loads.cancel`
- [x] Analytics on-time : la borne de comparaison est `plannedDeliveryLate ?? plannedDeliveryEarly`
      (couvre les données migrées sans `late`)
- [x] Suite e2e phase7-2 (6 tests) ; 12 migrations au total

### Chantier 7.3 — Billing sell-side ✅

- [x] `CustomerInvoiceStatus` enum + `canTransitionCustomerInvoice` dans `packages/shared`
      (DRAFT → APPROVED → SENT → PAID ; suppression d'un DRAFT = échappatoire, pas une transition)
- [x] 4 permissions `billing.customer-invoices.read|manage|send|pay` dans le catalogue
- [x] Migration Prisma `20260611153442_phase7_3_customer_invoices` : tables
      `customer_invoices` + `customer_invoice_lines` (`transportOrderId @unique` — anti-double-billing ;
      lignes cascade à la suppression de la facture, RESTRICT sur l'ordre)
- [x] Séquence CINV (`customer-invoice`) via `SequencesService.nextNumber`
- [x] Seed : taux client démo FLAT 1 450 CAD (lane city, rattaché au customer de démo)
- [x] `RatingService.rateOrder` : taux _client_ uniquement (`customerId`), correspondance lane ou
      catch-all client, date de référence = dernier `actualDeliveryAt` des shipments sinon today,
      évaluation via `compareRateOptions` → le moins cher retenu
- [x] `CustomerInvoicesService` : preview billable (`ratable` / `unratable: NO_APPLICABLE_RATE`),
      `createDrafts` groupés par devise (un relevé par devise), `deleteDraft` (seule échappatoire),
      transitions conditionnelles `updateMany` (race-safe), `send` conditionné sur email client + succès `EmailService`
      (libellé « Billing statement »)
- [x] `CustomerInvoicesController` sous `@RequireModule(BILLING)`, chaque endpoint décoré
      `@RequirePermissions`
- [x] Web : page Invoices enrichie avec deux onglets (carrier / customer statements)
- [x] Suite e2e `phase7-3-sell-side` (7 tests) ; 13ᵉ migration

### Chantier 7.4 — Durcissements différés phase 6 ✅

Tous les items de la dette phase 6 sont soldés (voir annotations ci-dessus).

- [x] Décorateur composite `@PlatformController()` — `applyDecorators(Public(), UseGuards(PlatformGuard))`
- [x] Throttling sur `POST /platform/auth/login` — `ThrottlerGuard` 20 req/min/IP
- [x] Slug du tenant dans le state OIDC chiffré — `packOidcState` + vérification callback
- [x] Cache du `Issuer.discover` par issuer — TTL 1 h + retry-once refresh
- [x] MFA (TOTP + recovery) pour les comptes plateforme — `PlatformMfaService`, step tokens,
      3 branches login, `PLATFORM_MFA_ENFORCED`, 8 codes de récupération bcrypt à usage unique
- [x] Injection de formule tableur dans l'export CSV factures — `csvSafe()` sur champs libres
- [x] Gardes de statut des factures dans la transaction — `updateMany` conditionnel, `createDrafts`
      transactionnel `P2002 → 409`
- [x] Suite e2e `phase7-4-hardening` (6 tests) ; 14ᵉ migration

## Phase 8 — Audit MVP line closed (BOL, Transport Mode, Exceptions)

### Chantier 8.1 — Bill of Lading (BOL) ✅

- [x] `bol-data.ts` : pure builder `buildBolData` (shipper = first PICKUP stop, fallback
      shipment originLocation ; consignee = last DELIVERY stop, fallback destinationLocation)
- [x] `bol-render.ts` : pdfkit (LETTER, 3 signature blocks + exceptions/damages lines +
      conditions footer)
- [x] `BolService.generate` : allowed on DISPATCHED/IN_TRANSIT/COMPLETED ; BOL- sequence via
      `SequencesService` ; `DocumentsService.upload` with `entityType = 'bill-of-lading'` ;
      audited (AuditAction.CREATE)
- [x] `POST /loads/:id/bol` — generate (or regenerate; each call = new document)
- [x] `GET /loads/:id/documents` — list all BOL documents for a load
- [x] `GET /public/driver/:token/bol` — latest BOL for the load resolved by driver token;
      no document id exposed in public payloads; 404 when no BOL has been generated yet

### Chantier 8.2 — Transport Mode (FTL / LTL / PARCEL) ✅

- [x] `TransportMode` enum (FTL / LTL / PARCEL) in `packages/shared/src/enums/transportation.ts`
      ; mirrored in `schema.prisma`
- [x] `mode` field on `TransportOrder`, `Load`, and `Rate` (null on Rate = applies to all modes)
- [x] Rating engine filters both load mode and rate mode when evaluating options
- [x] First-assign mode inheritance: when a shipment is assigned to a load, the load's mode is
      inherited from the order if the load has none
- [x] `modeWarning` (non-blocking) returned by `assign-load` when load mode and order mode differ
- [x] `suggestMode` pure function (PARCEL ≤ 30 kg, LTL ≤ 4000 kg, FTL above) in
      `packages/shared/src/planning/mode.ts` — hint only, no automatic threshold arbitrage
      (assumed gap vs audit §4 — parameterizable thresholds deferred)
- [x] 15th Prisma migration `20260611200000_phase8_mode_notifications_bol`

### Chantier 8.3 — Exception & delay detection ✅

- [x] `isLate` pure function : deadline = `plannedArrivalLate ?? plannedArrivalEarly` ; never
      late if stop has been arrived at or if no deadline is defined
- [x] `DelayDetectionService` cron every 5 minutes; public `tick(now)` for E2E injection
- [x] Dedup on `(stopId, deadline)` stored in `TrackingEvent.payload.deadline` — a
      replanned-then-missed window re-alerts (new deadline = new key)
- [x] Creates a `DELAYED` `TrackingEvent` + a tenant-wide `Notification` (userId nullable)
      per late stop
- [x] `Notification.userId` nullable — broadcast: `OR [{ userId }, { userId: null }]` ;
      read-by-one = read-for-all v1 (cosmetic; real per-user read state deferred)
- [x] Bell UI integration in web shell

### Limitation connue — réplanning / alertes multiples (post-dispatch)

- Route rebuild (stop replanning) is API-restricted to OPEN/PLANNED loads today. The
  dedup key design correctly handles the replanned-window re-alert path (new deadline =
  new dedup key), but this code path is not exercisable over HTTP until continuous planning
  is shipped (audit §19.5). Noted for the future; not a phase-8 gap.

## Phase 10 — OSRM + carte opérationnelle

### Dette notée aux revues phase 10 (à ne pas « réparer » en silence)

- [ ] `routes.createForLoad` : le check OPEN/PLANNED puis l'appel OSRM (≤3 s) puis
      deleteMany+create hors transaction élargissent la fenêtre TOCTOU préexistante —
      envelopper deleteMany+create dans une transaction avec re-check de statut quand
      on s'y attaque.
- [ ] `loads/active-map` : la requête « dernière position par load » est non bornée
      (toutes les POSITION_UPDATE des loads actifs triées puis dédupliquées en JS).
      Passer à `DISTINCT ON` (queryRaw) ou borner par fenêtre temporelle, et/ou prévoir
      une purge/rétention des POSITION_UPDATE avant que les pings s'accumulent sur des
      semaines.
- [ ] Règle 15 incohérente sur les anciens handlers publics : seul `driver/:token/position`
      re-vérifie l'activation du module ; `getTracking`, `getDriverView`, `driverUpdateStop`,
      `driverCreatePod` ne le font pas (préexistant, à harmoniser).
- [ ] Throttle Nominatim 1 req/s in-process : valable mono-instance seulement (à revoir
      avec le passage Redis du cache modules).

## Phase 3 — Platform & integrations

- [ ] OIDC SSO per tenant (keep `core/auth` issuance API stable)
- [ ] Webhook outbox + API keys for inbound integrations
- [ ] Encrypt integration `config` secrets at rest (`integrations.service.ts` TODO)
- [ ] Platform admin plane (cross-tenant tenant management)
- [ ] Pagination cursors for large tables; index review

## Phase 4 — Second module

- [ ] Customer Portal module (new `apps/api/src/modules/customer-portal`, flips `available` in
      module catalog)
- [ ] Billing foundations (rated loads → invoice drafts)

## Phase 11 (palier 1) — Agent governance + MCP exposure

### Shared + DB

- [x] `@pulsar/shared` agent vocabulary: `RiskTier`/`AgentStatus`/`ProposalStatus` enums +
      pure helpers `isExecutableLive`/`evaluateAmountCap`/`evaluateRateCap`/`deriveIdempotencyKey`
      (vitest, browser-safe — `node:crypto` resolved lazily)
- [x] `agents.*` permission catalog entries (`core.agents.read|manage|actions.read|actions.approve`)
- [x] Prisma `Agent` + `ProposedAction` models (+ 3 enums), 18th migration

### API

- [x] `AgentsService` — register/list/revoke + one hidden DISABLED service-user per agent +
      `validateKey` → `AgentPrincipal` (rule 13)
- [x] `AgentsController` — JWT-auth CRUD (`agents.read`/`agents.manage`)
- [x] Tool registry — 8 dispatch tools (tier/permission/module/zod/handler over real TMS services)
- [x] `ProposedActionsService` — idempotent capped enqueue, race-safe approve (execute+audit)/reject
- [x] MCP server factory — per-agent scoped tool surface (permission ∩ modules ∩ allowlist)
- [x] `POST /api/v1/mcp` Streamable-HTTP stateless endpoint (agent-key auth, `@Public`) +
      `agent-actions` inbox controller (`agents.actions.read`/`agents.actions.approve`)
- [x] `AgentsModule` wired into `AppModule`; tool-services adapter bridges the registry to real services
- [x] E2E governance flow (`phase11-agents.e2e-spec.ts`, 7 tests)

### Web

- [x] Settings → Agents page (register, scopes, caps, one-time key reveal)
- [x] Agent-actions inbox + nav badge (gated on `core.agents.actions.read`; actions gated on approve)

### Docs

- [x] `docs/agents.md` Hermes/MCP connection guide; CLAUDE.md hard rules 21–23; status + TODO

### Deferred (noted at reviews — do not "fix" silently)

- [ ] `caps.autoApprove` bypasses the proposed-actions queue and its audit entity; audit then
      relies on the underlying TMS services' own `@Audit`/`AuditLogsService.log`. If autoApprove
      is used for SENSITIVE tools, add an explicit agent-action audit trail for it.
- [ ] `agent-actions` badge fetches the full pending list just to count `.length` — add a
      count-only endpoint when pending volumes grow.
- [ ] `create_load` tool only accepts `notes` (the real `CreateLoadDto`); carrier/mode/resource
      assignment needs separate tools before an agent can build a complete load end-to-end.
- [ ] Rate-limit / throttle the public `POST /mcp` endpoint (currently agent-key gated but
      unthrottled, unlike the public driver endpoints — `ThrottlerGuard` 20/min/IP).
- [ ] `ProposedActionsService.approve` does not re-check `agent.status === ACTIVE` nor module
      activation before executing — a proposal enqueued before the agent was revoked / the module
      disabled would still run on approval. Human approval is the gate, but re-checking would
      align with rule 15 and the factory's own filtering.
- [ ] `enqueue` idempotency TOCTOU: two concurrent identical calls both pass the `findUnique`
      check then `create`; the `(agentId, idempotencyKey)` unique index makes the second throw
      P2002 (uncaught → 500). No duplicate side effect (mutations don't run at enqueue). Catch
      P2002 and return the existing projection.

## Phase 11 (palier 2a) — Employee-agents (Hermes brain in Pulsar)

### Shared + DB

- [x] `@pulsar/shared` `AgentAutonomy` enum (`PROPOSE`/`ACT_LOW`/`AUTONOMOUS`) + helper
      (`packages/shared/src/agents/autonomy.ts`, vitest `autonomy.spec`)
- [x] `core.agents.chat` permission catalog entry
- [x] Prisma migration `20260613195333_phase11b_agents_employes` (19th migration): employee
      fields on `Agent` (persona/role/model/autonomy/avatar) + agent-conversations/messages tables

### API

- [x] Agent session token (short-lived, signed with `AGENT_SESSION_SECRET` → `JWT_SECRET` →
      dev default) so the Hermes runtime calls `/mcp` as the agent (`agent-session-token.spec`)
- [x] `HermesAcpClient` — ACP transport (stdio, newline-framed) + fake ACP server for tests
      (`hermes-acp.client.spec`)
- [x] `AgentRuntimeService` — spawns `python -m acp_adapter` as a child process **per
      conversation** (configurable via `HERMES_ACP_CMD`/`HERMES_ACP_ARGS`/`HERMES_ACP_CWD`)
- [x] `AgentConversationsService` persistence + `AgentConversationsController`
      (`GET/POST /agent-conversations`, `GET :id`, `POST :id/messages`, SSE turn endpoint)
- [x] `AgentRuntime` + `AgentConversations` wired into `AgentsModule`
- [x] Amount-cap-on-autoApprove fix: the auto-approve path now enforces `maxAmountPerAction`
      (governance hole closed in `mcp-server.factory.ts`)
- [x] E2E suite `phase11b-agents-employes.e2e-spec.ts`

### Web

- [x] Settings → Agents employee fields (persona/role/model/autonomy/avatar)
- [x] ⌘K "AI assistant" panel — streaming conversation + proposed-action cards

### Deferred (noted at reviews — do not silently fix)

- [ ] Set `AGENT_SESSION_SECRET` (or `JWT_SECRET`) in non-dev — the dev fallback is silent and
      insecure.
- [ ] Rate cap is NOT enforced on the auto-approve path (only the amount cap is) — auto-approved
      actions don't create proposals, so there's no trailing-minute count; needs a separate
      execution counter.
- [ ] `AgentRuntimeService`: no timeout on `initialize`/`newSession` (a hung Hermes leaks the
      child process); child stderr is not consumed (could block on a full pipe); the `live` Map
      can grow unbounded if `closeSession` is never called (no TTL/sweep).
- [ ] `closeSession` during an active `prompt()` silently ends the stream without an error.
- [ ] `GET /agent-conversations/:id` is tenant-scoped but NOT user-scoped (any tenant member can
      read another member's conversation) — asymmetric with `list()`; and `get()` returns the raw
      row including `tenantId`.
- [ ] SSE turn endpoint: client disconnect does not abort the runtime turn; no SSE heartbeat
      (proxy-timeout risk on long turns).
- [ ] `tool_call`→`proposalId` correlation is not persisted on `AgentMessage` (only assistant
      text is persisted) — needed for full audit linkage.
- [ ] `start()` does a double agent lookup (`getOwned` then `conversations.start` re-fetches).
- [ ] Rename `nowMs`→`nowSec` in agent-session-token for clarity (cosmetic).
- [ ] ACP runtime smoke (`HERMES_ENABLED`): verify real byte framing (newline-delimited),
      camelCase fields / snake_case methods, the `session/set_model` param key, and that
      non-permission reverse-ACP calls don't break a turn.

## Phase 11 (R1 — runtime managé)

Goal: Hermes is **installable and configurable from Pulsar**, per tenant, without editing `.env`.

### Install + shared

- [x] `scripts/setup-agents.mjs` (`pnpm agents:setup`): installs Hermes into `hermes-agent/.venv`
      via **uv** (auto-fetches a standalone CPython 3.12 — Hermes pins 3.11–3.13, so no manual
      Python install; idempotent venv create + always re-run pip install)
- [x] `@pulsar/shared` `RUNTIME_PROVIDERS` provider catalog (pure data, browser-safe — no Node
      import; api-key vs login providers, `keyEnvVar`/`loginCommand`)

### API

- [x] `AgentRuntimeConfig` Prisma model + 20th migration `20260613211931_phase11r1_agent_runtime_config`
- [x] `agent-runtime-env.ts` env builder (per-tenant `HERMES_HOME`, provider key env var or login) + `runtime-config.service.ts` (encrypts the API key via `CryptoService`, never returns it)
- [x] `runtime-config.controller.ts` — `/agent-runtime` REST (`GET providers`, `GET`/`PUT`,
      `POST test`) + `POST connect` **SSE** login (streams device code + URL); gated `agents.manage`
- [x] `openSession` injects the resolved runtime config (env + decrypted key) into the spawned child
- [x] E2E `phase11r1-agent-runtime.e2e-spec.ts`

### Web

- [x] **Settings → Runtime agents** page (pick provider, paste key or "Connecter" login over SSE)

### Deferred (noted at reviews — do not "fix" silently)

- [ ] **Vendoring**: decide whether `hermes-agent/` ships in the repo (commit) or as a git
      submodule, so a fresh clone has it — today it's local/untracked (`.gitignore` only covers
      `.venv`/`.hermes-home`).
- [ ] **`HERMES_ENABLED` real smoke test**: install via `pnpm agents:setup`, configure a real
      provider (or a login like Codex — note the `--type oauth` flag may be needed in the
      `openai-codex` `loginCommand` of `runtime-providers.ts`), confirm `/test` lists models and a
      ⌘K conversation gets a real reply + a proposed action.
- [ ] `testConnection` doesn't surface real model names (`HermesAcpClient` has no advertised-models
      API) — wire it when the client exposes models.
- [ ] `connectLogin` has no `req.on('close')` abort — the login child is killed only on generator
      teardown; add explicit abort on SSE disconnect.
- [ ] `UpsertRuntimeDto` lacks `@ApiProperty` decorators (Swagger docs).
- [ ] Carry forward palier-2a deferred items not yet resolved (auto-approve rate cap,
      `tool_call`→`proposalId` persistence on `AgentMessage`, `AgentRuntime` `live` Map TTL/stderr
      consumption, SSE client-disconnect abort + heartbeat, etc. — see the palier-2a list above).
- [x] **R2 (next palier): the rich agent UI Sam asked for** — an agent profile page; an activity
      view ("what they do": conversations + tool calls + proposed actions per agent); guided config
      with inline help; a first-class chat surface beyond the ⌘K drawer. **(shipped in R2 below)**

## Phase 11 (R2 — agents experience: first-class)

Goal: agents are **first-class citizens** of the UI — a roster, a per-agent profile + guided
config, an activity view, and a dedicated chat surface.

### Shared

- [x] `@pulsar/shared` `AGENT_ROLE_PRESETS` (pure data, browser-safe): dispatcher / billing-clerk /
      analyst, each with persona + suggested permissions + suggested autonomy (`role-presets.ts`,
      vitest `role-presets.spec`)

### API

- [x] `GET /agents/:id` projects the profile (`role`/`persona`/`autonomyLevel`/`permissions`) and
      **never leaks `secretHash`/`serviceUserId`** (shared `agentSelect`)
- [x] `GET /agents/:id/activity` → `{ conversations, proposedActions, stats }` scoped tenant+agent
      (counters: conversations/pending/executed/rejected); gated `core.agents.read`
- [x] E2E `phase11r2-agent-experience.e2e-spec.ts` (profile projection + no-leak, bogus-id 404,
      empty-then-populated activity)

### Web

- [x] Top-level **Agents** nav (gated `core.agents.read`) → roster of employee cards
- [x] Per-agent page `/agents/[id]` — **Profil & config guidée** (inline help + role presets),
      **Activité** (conversations + proposed actions + counters), **Chat** (talk to this employee)

### Deferred (noted at reviews — do not "fix" silently)

- [ ] `tool_call` → `proposalId` linkage on the activity list (today the proposed-action list and
      the conversation list are shown side by side, not threaded — needs `AgentMessage.proposalId`
      persistence carried forward from palier 2a).
- [ ] `riskTier` badge tone mapping for `MUTATING`/`SENSITIVE` on the agent activity list (minor
      cosmetic — currently a neutral tone for all tiers).
- [ ] **hermes-agent/ vendoring** (carried from R1): decide commit vs submodule so a fresh clone
      has the runtime — today it's local/untracked.
- [ ] **`HERMES_ENABLED` real smoke test** (carried from R1): install + configure a real provider,
      confirm `/test` lists models and a chat turn yields a real reply + proposed action.

## CRM — Dette backlog

- [ ] Unifier `CrmExceptionsService.detectStaleDeals` sur le helper partagé `isDealStale`/`DEFAULT_STALE_DAYS` (`@pulsar/shared`) — actuellement une 3e copie inline du seuil 7j (équivalente mais divergence latente). Aussi: enrichir `GET /crm/pipeline` avec `ownerName` (kanban affiche l'UUID brut) ; totaux kanban multi-devise = devise du 1er deal.

## Billing — ligne de facture libre (backlog, post Cycle 6)

- `CustomerInvoiceLine.transportOrderId` est NOT NULL @unique FK → `TransportOrder` : impossible de représenter une ligne de produit libre. Les factures issues d'une commande de vente CRM (`createDraftFromSalesOrder`) sont donc des **en-têtes** (total correct + snapshot dans `customData.soLines`), sans `CustomerInvoiceLine` → l'envoi/PDF affiche un total mais pas de détail de lignes. Fix futur : migration billing pour un type de ligne polymorphe/libre (`transportOrderId` nullable + `source`/`description`/`amount`/`salesOrderLineId?`), puis itemiser les factures SO et rendre les lignes dans `send()`.
- Minor: `createDraftFromSalesOrder` → `assertOwnedIfSet('customer', ...)` pour un skip propre si le Customer a été hard-deleted (sinon P2003→FAILED). Minor: retirer le `catch (BadRequestException)` mort dans `draftInvoiceFromSalesOrder`.

## Operational Convergence — dette production restante (2026-07-17, après durcissement final)

Contexte : stage `operational-convergence` (Waves 0→7 + Release Qualification Gates A→D + pont
CRM SalesOrder→TMS TransportOrder + passe de durcissement P0→P2). Branche non mergée. Prêt PR.

- [ ] **Multi-instance / Redis** : caches modules (30 s en mémoire), dispatcher d'agents +
      orchestration de la file `DomainEvent` en mémoire mono-process, throttle Nominatim in-process.
      Chemin Redis documenté dans `docs/runbook.md §6`, non implémenté. Bloque le multi-instance.
- [ ] **Observabilité** : logs `clé=valeur` + `x-request-id` seulement ; pas de tracing distribué
      ni de métriques agrégées.
- [ ] **Hermes réel non qualifié** : le runtime agent est best-effort (503 si absent) ; les tests
      utilisent le harness fake. Aucun run LLM réel dans ce gate.
- [ ] **S3 / SMTP réels non qualifiés** : smoke en `STORAGE_DRIVER=local` + `EMAIL_DRIVER=log`.
      Le stockage local n'est pas durable au remplacement de conteneur → S3 requis en prod.
- [ ] **Image Docker** : dev-deps non prunées (migrate/seed passent par la même image API et ont
      besoin de `prisma`+`tsx`) ; runtime encore root (non-root non prouvable par le smoke actuel
      qui n'exerce pas d'écriture de stockage local). Suivi : image de migration/seed séparée +
      non-root + volume inscriptible.
- [ ] **Wizard « Préparer l'expédition »** : la liste des locations fetch `pageSize=100` (max API) ;
      un tenant avec >100 locations n'en voit qu'un sous-ensemble. Prévoir un select recherché/paginé.
- [ ] **Playwright** : les 13 parcours profonds « catalogue » restent partiels ; le pont CRM→TMS est
      couvert (`fulfillment.spec.ts`) mais portail transporteur multi-load, tender public, portail
      conducteur load fermé, pick WMS lié, Freight-Audit→litige, agent Run Now = couverts côté e2e
      API, pas encore en navigateur.
- [ ] **Nettoyage `pulsar_rc`** : base de qualif jetable ; accumulation de données de test (ex. >200
      locations) — recréer proprement (`prisma migrate reset` + seed) avant une prochaine campagne.

## Référentiel partagé & Accès — dette issue de l'audit 2026-09-16

Contexte : branche `access-module-core-locations` (non mergée), suite à l'audit des dépendances
cachées de `docs/superpowers/specs/2026-09-16-access-module-core-locations-design.md` §4. Ce
chantier a fait des **Lieux** la première entité de master-data du cœur (`core/locations`,
règle 50) ; le reste du master-data partagé garde un seul point d'écriture TMS.

- [ ] **Arc suivant recommandé — `core/master-data`** : appliquer le même patron que les Lieux à
      `Customer`, `Carrier`, `Vehicle`, `Trailer`, `Driver`, `Lane` (module cœur + alias TMS
      conservés), puis rendre le roster Fleet, les pickers Billing/Procurement et l'admin des
      portails autonomes du TMS.
- [ ] Yard : formulaires porte/rendez-vous (`gate`, `appointments`) lisent `Carrier`/`Trailer` via
      `transportation/*` — bloquant sans TMS.
- [ ] Fabrication : `WmsItem` (nomenclatures) n'a qu'un seul point d'écriture, `wms/items` — bloquant
      sans module WMS activé.
- [ ] Fleet : `/assets` (accueil Fleet) appelle `transportation/{vehicles,trailers,drivers}` sans
      `.catch` (`assets/+page.svelte:84`) — propriétaire d'entité (Fleet vs TMS) à décider avant fix.
- [ ] Achats (Procurement) : RFP n'a aucun lien vers `Carrier`/`Lane` propres au module — dépend du TMS.
- [ ] Facturation (Billing) : pickers `Customer`/`Carrier` avalent l'erreur (`.catch → []`), liste
      vide silencieuse en cas de panne TMS au lieu d'un état d'erreur explicite.
- [ ] Portails client/transporteur/chauffeur : l'admin des liens (activation, jetons) ne vit que
      dans les pages TMS `customers`/`carriers` — pas d'écran dédié hors TMS ; les comptes portail
      restent **nommés** (pas de compte utilisateur dédié par contact externe).
- [ ] Nav Transport : domaine sans `anyPerms` (visible même sans aucune permission Transport) ;
      liens Partenaires (Clients/Transporteurs) sans `perm` → 403 après clic. Seul le lien « Lieux »
      a été gardé par permission dans ce chantier.

### Dette différée (revues Tasks 1-11, à ne pas « réparer » en silence)

- [x] ~~INVITED admin ne peut pas être révoqué quand c'est le seul admin « actif » du tenant~~ —
      **corrigé** (passe finale 2026-09-16) : `isLastActiveAdmin` lit désormais le statut de la cible
      et renvoie `false` si elle n'est pas ACTIVE (une cible INVITED/DISABLED ne compte pas dans le
      total d'admins ACTIVE, donc la révoquer ne peut pas verrouiller le tenant). Couvert par 2 tests
      unitaires + l'étape e2e 9b.
- [ ] Changement de rôle d'un utilisateur : pas d'audit before/after dédié (seul l'audit générique
      de la mutation existe) — ajouter un `AuditLogsService.log` explicite si le suivi de rôle
      devient sensible en prod.
- [ ] Le message d'erreur 409 sur `P2034` (conflit Serializable, ex. dernier-admin) dit « réessayer »
      alors qu'aucun retry automatique n'existe côté client — corriger le message ou ajouter un
      retry UI.
- [ ] `Button.svelte` n'a pas de passe-plat `title`/props restantes — un bouton d'action ne peut pas
      recevoir de tooltip natif sans modifier le composant partagé.
- [ ] Naviguer vers `/locations` depuis Réglages fait basculer le domaine actif de la sidebar sur
      Transport (résolution du domaine par préfixe d'URL, pré-existante) — UX mineure, pas de perte
      de droits.
- [ ] Un rôle personnalisé créé **avant** ce chantier et limité à l'ancien
      `transportation.master-data.read` (aucun n'existe en pratique aujourd'hui — seul `admin` avait
      ce type d'accès, régénéré via `PermissionsSyncService`) perdrait les sélecteurs de lieux tant
      que `core.locations.read` ne lui est pas ajouté à la main.
- [ ] `pnpm format` non relancé sur cette branche (dérive Prettier préexistante hors mission, comme
      notée sur `operational-convergence`).
- [ ] `UsersService.update()` : ordre des erreurs — l'`assertRolesOwned` (403/404 de propriété) est
      évalué avant le 404 « utilisateur introuvable », donc un PATCH sur un id inexistant avec un
      `roleIds` d'un autre tenant répond sur la propriété du rôle plutôt que sur l'utilisateur.
- [ ] `UsersService` : deux `findFirst` successifs dans la transaction Serializable (le lookup de
      statut puis celui d'`isLastActiveAdmin`) — correct mais redondant, fusionnable en une lecture.
- [ ] `auth/reset-password` : le message « Account is disabled » distingue, pour le porteur d'un jeton
      encore vivant, un compte désactivé d'un jeton invalide (divulgation mineure sur le chemin
      pré-authentification) — uniformiser le message si ça devient sensible.
- [ ] `users.service.spec.ts` : le faux `$transaction` renvoie le même objet prisma, donc il ne
      prouve pas que les écritures sont bien liées au client transactionnel (`tx`) — un faux
      distinguant `tx` du client racine rendrait le test de TOCTOU réellement contraignant.
- [ ] Jetons/sessions déjà émis pour des utilisateurs désactivés **avant** cet arc : la désactivation
      révoque maintenant jetons d'action et refresh tokens, mais les refresh tokens historiques d'un
      compte désactivé plus tôt restent en base (mitigé par la garde `DISABLED` de `resetPassword` et
      par la vérification de statut au login) — purge ponctuelle à prévoir si besoin.
- [ ] e2e `access-module` : les utilisateurs jetables créés par la suite restent DISABLED dans la base
      de dev (pas de suppression physique, par conception) — bruit cumulatif sur `/settings/users` au
      fil des exécutions locales.
- [ ] Page Rôles : « Tout lire » / « Tout gérer » sont **additifs** (ils ajoutent sans retirer), ce que
      l'étiquette ne dit pas — seul « Aucun » retire. Renommer ou rendre le comportement bascule.
- [ ] Page Rôles : deux `<th>` sans intitulé (colonne badge système et colonne d'actions) — en-têtes
      invisibles pour un lecteur d'écran.
- [ ] Page Utilisateurs : la cellule d'actions reste un `<td>` vide quand l'utilisateur n'a pas
      `core.users.manage` — préférer un tiret ou masquer la colonne.
- [ ] `PermissionsSyncService` : ~84 `upsert` séquentiels à chaque démarrage, puis attribution aux
      rôles `admin` de **toutes** les lignes `Permission` en base (pas seulement les clés du catalogue
      `@pulsar/shared`) — regrouper en `createMany`/batch et restreindre l'octroi aux clés du catalogue.
- [ ] Page Utilisateurs : le filtre de statut et la recherche s'appliquent **côté client** sur une
      unique page de 100 lignes — au-delà, le filtrage ment silencieusement ; passer au filtrage serveur.
- [ ] Autres minors de revue non bloquants : `resolveRoleTemplates` — chemin de dédoublonnage non
      testé unitairement ; `typeLabel()` dupliqué entre `LocationFormModal` et la
      page `/locations` ; double-fetch bénin sur `onSiteCreated` (accueil Yard, réponse périmée
      ignorée) ; `invitationLabel` a des branches mortes et l'arrondi `Math.ceil` des jours restants
      surestime légèrement le temps avant expiration ; reset-password sur un jeton déjà utilisé
      renvoie 401 avant 400 (comportement déterministe, juste pas celui documenté en premier).

## Portail client (comptes nommés) & Quoi de neuf — dette 2026-09-17

Contexte : branche `access-module-core-locations` (suite, non mergée), livrant Pages fix, le fil
« Quoi de neuf » (`ReleaseNote`, règle 52) et les comptes portail client nommés (`PortalUser`,
troisième plan d'auth, règle 51). Spec :
`docs/superpowers/specs/2026-09-16-portal-accounts-whats-new-design.md` §5.

- [ ] `TransportOrder` n'a pas de colonne `portalUserId` : l'attribution d'une action portail à un
      utilisateur nommé passe uniquement par l'audit/les commentaires, jamais une FK dédiée.
- [ ] Aucun throttling sur `public/portal/:token` (lien de compatibilité) — énumération possible en
      théorie, atténuée par le coût du token. `/portal/auth/*`, lui, EST throttlé
      (`@UseGuards(ThrottlerGuard)` classe + méthode, 20 req/min/IP, `portal-auth.controller.ts`).
- [ ] `GET /portal/view` renvoie toute la liste des lieux actifs du shipper (tenant-scopée, pas
      scopée client) — décision produit à prendre (restreindre aux sites du client + hubs publics).
- [ ] `unpublish` (`ReleaseNotesService`) repasse le statut à DRAFT sans effacer `publishedAt` ; un
      republish réutilise `note.publishedAt ?? new Date()` donc garde l'ancienne date — une note
      déjà vue (seenAt postérieur) republiée ne repasse pas « non vue ». À documenter ou à clarifier
      (`publishedAt: null` sur unpublish ?).
- [ ] `PUT /me/preferences` accepte un `releaseNotesSeenAt` fourni par le client (`@IsDateString`),
      plus large que `POST /release-notes/seen` qui, lui, horodate côté serveur — un client pourrait
      avancer arbitrairement sa date de dernière lecture.
- [ ] `requestPasswordReset` n'agit que sur un compte `ACTIVE` — un utilisateur `INVITED` qui a
      perdu son lien d'invitation n'a aucun parcours self-service ; seul le staff peut renvoyer
      l'invitation.
- [ ] Aucune tâche de rétention/nettoyage pour `portal_action_tokens`/`portal_refresh_tokens` —
      les lignes expirées/révoquées s'accumulent indéfiniment.
- [ ] `PortalAuthService.login` renvoie 401 sur un email inconnu sans passer par `bcrypt.compare`
      (retour anticipé sur `candidates.length === 0`) — oracle de timing théorique, à parité avec
      `core/auth` (dette déjà connue là-bas, pas un régression du portail).
- [ ] `sites.e2e-spec.ts` : la numérotation des cas est incohérente en fin de fichier (10, 11, 12,
      14, 13) — les cas 13/14 ont été ajoutés dans le désordre ; à renuméroter si le fichier est
      retouché.
- [ ] Spec §2.4 mentionne un lien de navigation « Image de marque » (ancre sur la carte existante)
      qui n'a pas été implémenté — seul « Clients & portail » existe dans le domaine « Portail
      client » (`apps/web/src/lib/modules/navigation.ts`).
- [ ] `CrmContact` et `PortalUser` ne sont pas liés — un contact CRM et un compte portail du même
      client restent deux identités séparées sans pont.
- [ ] Page jeton (`Customer.portalToken` / `public/portal/:token`) à déprécier une fois les comptes
      nommés adoptés — actuellement conservée comme mode de compatibilité (délègue au même
      `PortalContext`/`PortalService`).
- [x] Le mail de réinitialisation de mot de passe portail (`PortalAuthService.requestPasswordReset`)
      résout désormais le transport SMTP du tenant (`await emailConfig.resolve(user.tenantId)`,
      injecté via `EmailConfigService` — `EmailModule` global) avant `EmailService.send` ; retombe
      sur le transport plateforme (`undefined`) si le tenant n'a rien configuré.
- [ ] Les liens d'invitation portail restent visibles par le staff via l'outbox (`MailService`) —
      voulu pour les invitations (règle : le lien de réinitialisation, lui, ne passe jamais par
      l'outbox), mais à documenter si le modèle de menace change.
- [ ] `issueInvitation` (PortalUsersService) n'est pas transactionnelle (création du compte puis du
      jeton en deux étapes) — fenêtre TOCTOU théorique sans conséquence connue aujourd'hui.
- [ ] Les jetons de réinitialisation/invitation ne sont pas « supersédés » : redemander un reset
      laisse le jeton précédent valide jusqu'à expiration (parité avec `core/auth`, pas un bug neuf).
- [ ] `lastLoginAt` est écrit avant les gates de session (statut compte/client/module) — un login
      qui échoue ensuite sur une garde a quand même avancé l'horodatage.
- [x] Schéma Prisma : commentaire `ShipmentComment.authorId` mis à jour (couvre désormais les trois
      cas — `userId` STAFF, `customerId` lien partagé, `portalUserId` compte nommé — soft ref,
      jamais exposé).
- [ ] `TemplatesPanel` (web, fiche client) refetch les gabarits à chaque réouverture du panneau au
      lieu de mettre en cache/invalider explicitement.
- [ ] `DocumentsPanel.downloadDoc` (web) n'a pas de `try/catch` — un échec de téléchargement ne
      montre aucune erreur à l'utilisateur.
- [ ] `deleteTemplateFor` : la forme de l'entrée d'audit diffère des autres mutations de gabarits
      (à harmoniser si les gabarits deviennent un objet audité de premier ordre).
- [ ] Le gabarit de rôle du dispatcher porte une clé `CUSTOMER_PORTAL` même quand ce module n'est
      pas activé pour le tenant (`resolveRoleTemplates` filtre les gabarits par module, pas leurs
      clés internes) — une clé orpheline sans effet, pas une fuite de permission.
- [ ] `/whats-new` (web) : le `try/catch` englobe à la fois le chargement des notes et le marquage
      « vu » — un échec du second donne un message d'erreur trompeur sur le premier.
- [ ] Page plateforme « Notes de version » : les boutons de ligne (publier/archiver) ne se
      désactivent pas pendant la requête — double-clic possible.
- [ ] Aucun audit sur les mutations plateforme de `ReleaseNote` (create/publish/archive) —
      `AuditLogsService` exige un `tenantId`, précédent déjà accepté sur `platform/tenants`.
- [ ] Le paramètre `search` de `GET /release-notes` (et `/platform/release-notes`) n'est pas
      exploité côté service (filtrage à ajouter si le volume de notes le justifie).
- [ ] `HTTPS://` (schéma en majuscules) est rejeté par le validateur de `cta.href` des pages —
      fail-safe volontaire (cohérent avec le rejet des tentatives d'obfuscation `\`/`//`), mais un
      lien HTTPS légitime en majuscules serait refusé sans message explicite.
- [ ] Domaine de nav « Portail client » : pas de `anyPerms` (visible même sans aucune permission du
      module) — même dette que le domaine Transport (voir section Référentiel partagé ci-dessus).
- [ ] Messages d'erreur serveur du portail (ex. « Account is disabled », « Invalid token ») restés
      en anglais — pas de traduction FR contrairement au reste de l'UI web.
- [ ] `Toasts.svelte` (web) n'a pas de `role`/`aria-live` — les notifications transitoires ne sont
      pas annoncées par un lecteur d'écran.
- [ ] `portalApi` (client web) : une rotation de jeton (refresh) n'est pas répercutée dans le store
      de session tant que la page ne relit pas l'état — décalage possible entre le jeton en mémoire
      HTTP et l'état affiché.

## Pickers, portail v2 & connecteurs — dette 2026-09-17

Contexte : branche `access-module-core-locations` (suite, non mergée), arc 3 — aide à la saisie
(pickers partout), refonte du portail client, connecteurs (webhooks sortants/entrants, EDI X12,
clés API partenaires, flux iCal). Règles 53-55. Spec :
`docs/superpowers/specs/2026-09-17-pickers-portal-connectors-design.md` §C2.7 + minors des revues
(registre `.superpowers/sdd/2026-09-17-pickers-portal-connectors/progress.md`).

### Aide à la saisie (pickers)

- [ ] `apps/web/src/routes/(app)/crm/lists/+page.svelte` : recherche + sélection écrites à la main
      (duplique `EntityPicker`) — à convertir, c'est le dernier gros doublon repéré par la revue de
      couverture A5.
- [ ] `EntityPicker` n'a pas de prop `required`
      (`apps/web/src/lib/components/ui/EntityPicker.svelte`) : la validation native HTML est perdue
      partout où un `<Select required>` a été remplacé — les pages compensent par des vérifications
      manuelles à la soumission.
- [ ] Les lignes d'options du modal `EntityPicker` n'ont pas de `tabindex="-1"` : elles restent
      atteignables au `Tab` alors que la navigation prévue est ↑/↓/Entrée.
- [ ] `REGIONS_BY_COUNTRY` (`packages/shared/src/reference/geo.ts`) stocke des codes **nus**
      (`BC`, `TX`) et non les codes ISO-3166-2 composés (`CA-BC`, `US-TX`) — cohérent avec ce que la
      BD contient aujourd'hui, à trancher si un export normalisé devient nécessaire.
- [ ] Heuristique de genre des libellés FR par clé dans `EntityPicker`/`ReferenceSelect`
      (« Sélectionner un/une … ») — approximative, non pilotée par une table.
- [ ] `apps/web/src/routes/(app)/wms/cycle-counts/+page.svelte` : chargeur de bins devenu mort après
      le passage au picker ; `wms/bins` : le picker Entrepôt n'a pas `allowCreate` (contrairement aux
      autres écrans WMS) ; picker d'articles : le SKU s'affiche deux fois (libellé + détail).
- [ ] `LoadResourcesPanel` : le picker Chauffeur n'utilise qu'un champ (`labelKey="lastName"`,
      `detailKey="firstName"`) au lieu d'un libellé composé « Prénom Nom ».
- [ ] `selectedLabel` redondant sur les pickers produit de `manufacturing/boms` et
      `manufacturing/routings` (le composant sait déjà résoudre) ; `type="url"` manquant sur le champ
      « issuer » SSO.
- [ ] Libellé « Excédent » vs « Excès » incohérent entre écrans de capacité (TMS).
- [ ] `apps/web/src/routes/(app)/fleet/maintenance/+page.svelte` garde deux préchargements
      `pageSize: 100` (`vehicles`/`trailers`) uniquement pour afficher le nom de l'actif d'une ligne —
      acceptable tant que le roster reste petit, à convertir si la flotte grossit.

- [ ] `apps/web/src/lib/format.ts` : `formatTime` renvoie `—` sur une date invalide mais `formatDate` /
      `formatDateTime` renvoient encore `"Invalid Date"` — aligner les trois ; le badge de retard du
      tableau de dispatch affiche désormais `2026-09-16` (format long) au lieu de `16 sept.` — offrir un
      `formatDateShort` fr-CA si la largeur gêne.

### Portail client v2

- [ ] `PortalService.downloadInvoicePdfFor`
      (`apps/api/src/modules/customer-portal/portal.service.ts`) ne filtre pas
      `mimeType: 'application/pdf'` comme le fait `customer-invoices.service.ts` : un autre document
      attaché à la facture pourrait être renvoyé à la place du PDF (bug latent, aucun cas observé).
- [ ] Les panneaux paresseux du portail (`DocumentsPanel`, `ChangeRequestsPanel`, `InvoicesPanel`
      dans `apps/web/src/lib/portal/components/`) réessaient **indéfiniment** quand un `fetch`
      échoue : le drapeau `loaded` n'est pas posé en cas d'erreur (patron hérité d'`InvoicesPanel`).
- [ ] `KpiTile.svelte` (portail) n'a pas de `data-testid` : les assertions Playwright ciblent le
      texte, fragile à toute reformulation.
- [ ] `PortalMap.svelte` n'a pas de `ResizeObserver` (parité avec `OpsMap`) : la carte ne se
      redimensionne pas quand le conteneur change de taille sans redimensionnement de fenêtre.
- [ ] `OrdersTable.svelte` : le minuteur de debounce de la recherche n'est pas annulé au démontage.
- [ ] Le compteur d'en-tête des Commandes affiche brièvement `0` avant le premier chargement.
- [ ] Les lignes `<tr>` cliquables des tableaux du portail ne sont pas opérables au clavier
      (convention pré-existante de toute l'app, pas une régression de l'arc).
- [ ] Nommage `recordedAt` (projection de suivi) vs `occurredAt` (événements) non unifié — le web
      lit défensivement les deux.
- [ ] `GET /customer-portal/change-requests` (file staff) renvoie un tableau nu plafonné à 200
      lignes, pas un `Paginated<T>`.
- [ ] Le filtre de période des Commandes s'applique **côté navigateur** sur la page chargée
      (`PortalOrdersQueryDto` n'expose que `status`/`search`/`page`/`pageSize`) — une ligne explicite
      annonce les lignes masquées, mais un filtre serveur serait plus juste.

### Webhooks sortants & récepteur entrant

- [x] Compléter le garde URL partagé par un transport serveur : DNS A/AAAA revérifiés à chaque tentative, adresses privées/réservées refusées, IPv6 globale native seulement, adresse épinglée, aucune redirection. Livré dans le lot pilote du 22 septembre.
- [x] `WebhooksService.attempt()` et `ping()` utilisent le même transport gardé, y compris pour les anciennes livraisons et EDI.
- [ ] `transport-order.create` par récepteur entrant est **at-least-once** : une ligne
      `InboundMessage` restée `RECEIVED` est ré-exécutée après 2 minutes, ce qui peut créer une
      seconde commande. Clé métier à ajouter (`customerReference` ou n° de document) pour rendre la
      cible idempotente (`apps/api/src/core/connect/record-writer.service.ts`).
- [x] `PATCH /integrations/:id` avec seulement `{ status: 'ENABLED' }` revérifie la cible entrante/EDI, les droits et l'URL. Une version devenue périmée entre lecture et écriture produit 409.
- [ ] Messages d'erreur partenaire génériques : un refus de mapping ou d'écriture renvoie
      `status: 'FAILED'` + un texte peu actionnable ; le détail n'est visible que dans l'inbox
      (`apps/api/src/core/connect/inbound-hooks.service.ts`).
- [ ] Aucune **validation typée** des valeurs mappées (`packages/shared/src/integrations/mapping.ts`)
      : les transformations sont appliquées mais rien ne vérifie que la valeur produite correspond au
      type attendu par le champ cible — l'erreur ne remonte qu'au niveau du service métier.
- [ ] Aucune **expiration** des clés de déduplication : `InboundMessage.dedupKey` s'accumule
      indéfiniment (pas de purge, pas de fenêtre glissante).
- [ ] Deux plafonds de corps se chevauchent : le body-parser JSON de Nest tranche à **100 Ko** avant
      que le service n'applique son plafond de **256 Ko** — le 413 vient donc toujours de Nest.
      Harmoniser (ou documenter le plafond réel comme 100 Ko).
- [x] Studio `/integrations` : les PATCH partiels préservent les clés inconnues et les secrets masqués via `mergePreservingMasked` côté API; correction antérieure confirmée par les tests du lot pilote.
- [ ] Outbox sortante : claim distribué/reprise d'exécution; le transport protégé ne transforme pas les livraisons en exactly-once. Garder la déduplication partenaire par `X-Pulsar-Delivery`.
- [ ] La section « boîte de réception » de `/connect/inbound-hooks` appelle `GET /connect/inbox`
      (permission `core.connect.read`) sans conditionner son affichage à cette permission : un
      utilisateur qui n'a que `core.integrations.manage` voit un bloc en erreur.
- [ ] `GET /public/ical/yard/:token` n'a ni `Cache-Control` ni throttling (cohérent avec les autres
      routes `@Public()` — à traiter dans une passe globale).

- [ ] `DomainEventsService.bridgeToWebhooks` → `WebhooksService.emit` exécute un
      `integration.findMany` par événement métier, même pour un tenant sans webhook : ajouter un
      indicateur en cache « tenant a des webhooks » (`apps/api/src/core/operating/domain-events.service.ts`).
- [ ] Un nouveau webhook créé avec `events: []` s'abonne à tout le catalogue (dont
      `portal.change-request` avec la note libre du client) ; le studio pré-remplit désormais la
      liste héritée, mais l'API accepte toujours `[]` = tout — envisager d'exiger un choix explicite.

### EDI X12

- [ ] La déduplication des **210** est applicative (`findFirst` sur
      `(tenantId, carrierId, carrierInvoiceNumber)`, `apps/api/src/core/connect/edi.service.ts`) :
      un index unique serait plus sûr, mais il impacterait aussi la saisie manuelle des factures
      transporteur — migration + décision produit à prendre ensemble.
- [ ] Un interchange entrant **multi-ST** n'est traité que pour sa **première** transaction ; les ST
      suivants sont lus mais ignorés (`packages/shared/src/edi/`).
- [ ] Un 204 `CANCELLATION`/`CHANGE` est traité comme un `ORIGINAL` : `B2A-01` est lu par la couche
      pure mais pas exploité — chaque interchange distinct crée une commande.
- [ ] Aucun **fuseau horaire** dans les dates X12 : elles sont rendues telles quelles et interprétées
      en heure locale du serveur.
- [ ] Les numéros de contrôle sortants `ISA13`/`GS06` sont dérivés de l'horloge, pas d'un compteur
      persisté (`SequencesService` serait le bon support).
- [ ] `X-Idempotency-Key` est volontairement **ignoré** sur la porte EDI (l'interchange EST
      l'identité) — divergence assumée avec le récepteur JSON, à documenter côté partenaire.
- [ ] `serializeX12(null)` lève (protégé par le typage seulement) ; les champs de volume du segment
      `N7` ne sont pas couverts par les tests (`packages/shared/src/edi/`).
- [ ] Pas d'AS2/VAN, pas de 997, séparateur de répétition détecté mais non appliqué, composites non
      éclatés, motif `K1` tronqué à 60 caractères (limites v1 assumées).

### Clés API partenaires & flux iCal

- [ ] Le jeton iCal de la cour est stocké **en clair** dans `TenantModule.settings.icalToken`
      (`apps/api/src/modules/yard/ical/ical.service.ts`), alors que les autres secrets de l'arc sont
      hachés (`Integration.inboundTokenHash`, `ApiKey.keyHash`) — hacher (sha256) et comparer le hachage,
      ou déplacer vers une colonne dédiée.

- [ ] L'expiration d'une clé API est saisie en **date** et convertie en fin de journée _locale du
      navigateur_ (`apps/web/src/routes/(app)/settings/api-keys/+page.svelte`) : un administrateur
      dans un autre fuseau que le serveur peut être surpris de l'instant exact d'expiration.
- [ ] Aucune notification ni écran d'alerte avant l'expiration d'une clé : elle cesse simplement de
      fonctionner (401 générique, indistinguable d'une clé révoquée — choix de sécurité assumé).
- [ ] La remorque affichée dans la description iCal est « meilleur effort » (dernière `YardVisit`
      liée) : `DockAppointment` ne porte pas de référence de remorque.
- [ ] Le jeton iCal vit dans `TenantModule.settings.icalToken` (yard) en clair : c'est un jeton de
      capacité en lecture seule, mais il n'est pas haché contrairement aux jetons entrants.

### Hors périmètre v1 (assumé, spec §C2.7)

- [ ] SFTP/FTP, OAuth client (QuickBooks, Shopify), télématique, AS2/VAN, SCIM, file durable
      partagée entre les deux outbox, export vers un entrepôt de données.
# Suivi runner IA — 30 septembre 2026

- [x] Image dédiée verrouillée, transport privé API, homes persistants, proxy,
      diagnostic tenant et tests locaux sans fournisseur.
- [ ] Déployer le profil sur l’entreprise de test OVH, vérifier sa panne/reprise.
- [ ] Recette réelle fournisseur/OAuth et missions métier avec budget autorisé.
- [ ] Provisioning automatique des runners, concurrence maîtrisée et file durable.
      [Contrat de ce palier](deploy/agent-runner/README.md).
