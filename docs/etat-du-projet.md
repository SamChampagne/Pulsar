# État du projet — point de reprise

> **Correctif CI navigateur — 28 septembre 2026**, [PR #82](https://github.com/SamChampagne/Pulsar/pull/82),
> branche `codex/pilot-business-depth`. Le premier run distant passe APS, types,
> unités, API HTTP et build; navigateur rouge (13 échecs, 24 cas instables).
> Mocks Billing autonomes, contrats/libellés/tutoriels actualisés; connexion UI
> sans fetch de préférences en vol pendant les navigations, sans écriture de
> complétion fictive. Test utilisateur isolé ajouté et réussi trois fois.
> Recette complète Docker jetable, 1 worker, aucun retry : **345 réussis / 114
> ignorés / 1 échec de fixture plateforme**. Compte de test corrigé uniquement
> dans cette base, puis parcours plateforme réussi séparément : les **346 cas
> exécutables** ont donc réussi, mais pas dans une unique passe verte locale.
> Les 114 ignorés exigent des fixtures HTTP dédiées, aucun nouveau skip ajouté.
> Aucun code métier, secret réel, base de développement ou VPS modifié.
> Nouvelle CI distante à vérifier avant fusion; [diagnostic et limites](./releases/pilot-enterprise-2026-09-28.md).

> **IA A2c.1 / préparation PR serveur — 28 septembre 2026**, branche
> `codex/pilot-business-depth`. [Preuves et limites](./plans/ai-linux-qualification.md).
> Banc Linux hors ligne : **9 contrôles ACP** sur Hermes 0.16.0, Python 3.12.13,
> dépendances verrouillées et sources vérifiées; non-root, sans réseau externe,
> racine en lecture seule, capabilities retirées. Zéro fournisseur réel.
> API OVH non-root/read-only; migrations/bootstrap, MFA/readiness, migration des
> permissions d'anciens documents root et sauvegarde/restauration dans deux projets
> Docker jetables réussis. Base locale et VPS non touchés.
> **768 API + 1 127 Shared + 237 Web + 4 manifestes** réussis; typecheck réussi,
> 0 erreur Svelte et 12 avertissements antérieurs. Builds Docker API/Web réussis.
> Une première exécution interrompue a été relancée séparément avec succès.
> **Limite :** le banc n'est pas un service IA; A2c.2 runner de production,
> isolation par tenant/egress/secrets et A4 recette métier autorisée restent ouverts.
> Pas de promotion Hermes, modification `.env` ni appel/envoi réel. PR consolidée
> en préparation; CI distante et recette VPS restent distinctes de ces preuves.

> **IA A2b / A3a — résultats fiables, 28 septembre 2026**, même branche.
> [Contrat, preuves et suite](./plans/ai-turn-outcomes.md).
> Résultat structuré moteur → ACP → runtime → worker/chat : succès, échec,
> annulation; aucun succès déduit d’une fin de flux ni d’un texte généré.
> Refus fournisseur masqué jusque-là corrigé, timeout de tour 120 s, tâches
> réellement claimées libérées avec state machine/CAS/audit, jamais rouvertes
> si déjà résolues. FAILED/KILLED exigent une reprise manuelle, pas un nouveau
> réveil automatique par cron/événement après effets potentiels.
> Chat : réponses non validées/interrompues signalées et marqueur historique;
> compteur cumulatif du processus, pas un coût ni une mesure par message.
> Titres auxiliaires par modèle désactivés; documentation intégrée enrichie.
> **9 contrôles ACP par version**, vrais moteurs actif 0.16.0 et candidat 0.21.5,
> LLM/MCP localhost synthétiques. Sources et dépendances inchangées avant/après,
> zéro appel fournisseur réel. **768 tests API / 105 suites**, **18 Python**,
> **9 Shared**, **39 Web** et **3 Chromium** réussis. Captures bureau/mobile inspectées.
> Builds Shared/API/Web réussis; Svelte : 0 erreur, 12 avertissements antérieurs.
> API locale redémarrée : **3100 PID 13688**, Vite reste 5173; santé live/ready
> et Web login vérifiés. Aucune migration, modification `.env`, installation
> Hermes, clé réelle, commit/push/PR ou déploiement.
> **Suite :** A2c packaging Linux/isolement/rollback, puis A3b interface complète
> et A4 recette métier avec budget autorisé. File encore en mémoire; pas de
> sandbox OS, comptabilité LLM ou candidat promu. Aucun « meilleur modèle » prouvé.

> **IA A2a — qualification isolée, 28 septembre 2026**, même branche.
> [Constats, preuves et suite](./plans/ai-runtime-qualification.md).
> Candidat officiel Hermes 0.21.5, commit `f97608f178d1`, venv temporaire séparé
> installé depuis `uv.lock`. Actif Pulsar toujours 0.16.0, sous-module inchangé.
> **Huit contrôles réels ACP** avec LLM/MCP localhost synthétiques passent :
> modèle/outils, historique après redémarrage, homes/processus séparés, annulation,
> fermeture et dépendances inchangées. Aucun fournisseur réel ni donnée métier.
> **Écart bloquant confirmé :** HTTP 400 fournisseur présenté comme texte assistant
> et fin normale, sans erreur ACP typée. Candidat **non promu** en production.
> Profil candidat sans installation dynamique, recherche d’outils intermédiaire
> ni génération de titre par modèle; aucune de ces options n’est activée dans Pulsar.
> **Correctifs Pulsar :** reprise stricte par `session/load` + erreur explicite du
> wrapper si historique absent; transport fermé et échec d’écriture immédiats;
> notification cancel disponible. Aucun remplacement silencieux de conversation.
> **748 tests API / 104 suites**, **8 Python** sur le fork actif, **33 Web aide/tutos**,
> build/typecheck API et handshake ACP actif sans clé/prompt réussis.
> Documentation intégrée mise à jour, aucune modification UI fonctionnelle.
> API locale redémarrée avec les correctifs : **3100 PID 70776**, MCP interne sur
> 3100; `/health/live`, `/health/ready` et Web `/login` : HTTP 200. Vite reste 5173.
> Aucun changement BD/`.env`/clé/mission réelle, commit/push/PR ou déploiement.
> **Suite :** A2b/A3 résultats/erreurs/annulation/usage typés jusqu’au worker,
> puis packaging Linux isolé et recette métier autorisée. Pas encore de benchmark.

> **IA A1 — diagnostic et durcissement, 27–28 septembre 2026**, branche
> `codex/pilot-business-depth`. [Analyse, comparaison et suite](./plans/ai-runtime-renewal.md).
> **Constat :** fork Hermes 0.16.0 au commit `740ea2ff502e` du 22 juin;
> installé Python 3.12.13 / ACP 0.9.0 / MCP 1.26.0. Release officielle 0.21.5
> repérée le 27 septembre, non installée et non qualifiée pour Pulsar.
> **Livré localement :** diagnostic dans Agents → Connexion du modèle (page
> Connexion IA), versions et référence datée, inconnus explicites, aucun fetch/LLM.
> Configuration fournisseur/URL sans réutilisation de l’ancienne clé, invalidation
> des contrôles/modèles et protection contre les résultats tardifs de test/login.
> Environnement enfant en liste fermée et workspace tenant; wrapper ACP Pulsar
> limité au MCP Pulsar, sans outils génériques terminal/fichiers/browser/délégation.
> Refus des permissions hôte ACP, contrôle protocole, erreur du modèle non ignorée,
> session morte retirée du registre. Vérifier le runtime n’affirme plus tester
> l’inférence; modèles value/label rendus correctement et formulaire non enregistré
> bloquant pour login/test. Documentation intégrée et tutoriel Agents spécialisé,
> sans réinitialiser les parcours terminés. Design existant Pulsar conservé.
> **743 tests API** (104 suites), **230 Web + nouveau test tutoriel**
> (24 tests du fichier tutoriel repassés), **7 HTTP isolés**, **6 Python** contre
> le fork installé et **2 Chromium** bureau/mobile réussis. Handshake ACP réel
> via le nouveau wrapper réussi, sans clé ni prompt. Captures inspectées.
> Svelte : 0 erreur, 12 avertissements antérieurs; builds API et Web réussis.
> Aucune migration, installation/mise à jour Hermes, appel LLM, envoi réel,
> seed global, modification `.env`, commit/push/PR ou déploiement. Sous-module inchangé.
> API locale **3100 PID 18152**, Vite **5173 PID 37464**, base inchangée
> `pulsar_enduser_20260921`. Fixture `ai-runtime-1790568052525` uniquement pour recette.
> **Suite recommandée :** A2 qualification d’une version stable, A3 adaptateur
> interchangeable, A4 trois missions métier avec budget autorisé et mesures,
> A5 coûts/contexte/worker durable. Le wrapper n’est pas un sandbox OS et aucun
> benchmark de qualité des réponses n’a été exécuté. **C3b réponses de dossier
> reste ouvert**, décalé explicitement pour traiter la priorité IA demandée.

> **Communications de dossier C3a — 2026-09-27**, branche `codex/pilot-business-depth`.
> [Contrat, droits et limites](./plans/dossier-communications.md).
> **Livré localement :** panneau Communications dans les fiches client/partenaire,
> sociétés/opportunités CRM, interventions et expéditions. Saisie + aperçu côte à côte
> sur bureau, historique paginé propre au dossier, modèles opérationnels configurables
> et décisions de contact avec date/preuve/version/audit. Suggestions par FK explicites,
> jamais rapprochement par nom/numéro; Services testé sans Clients/Transport/Catalogue.
> Droit source + module + canal recontrôlés en lecture et reprise. SMS de dossier
> exclus du journal global; mail de dossier dans son registre à droits métier,
> sans toucher aux factures/outbox financier. SMTP tenant capturé ou simulation,
> **pas de repli plateforme dans ce nouveau panneau**. Texte échappé et confirmation,
> registre/audit avant réseau, idempotence acteur/corps/source/versions, aucun retry
> d’un message SENDING/UNKNOWN. Reprise conservée dans l’onglet navigateur.
> Refus SMS appliqué aussi au compositeur SMS général; STOP reste bloquant.
> Documentation intégrée et leçons distinctes Clients/Services/CRM/Transport complétées
> à la fin des parcours, sans reset ni nouveau bouton de tutoriel.
> **1 118 Shared + 723 API + 230 Web = 2 071 tests unitaires réussis.**
> **33 HTTP** (13 C3a + 20 régression communications) et **5 Chromium** réussis :
> points d’entrée des quatre modules, bureau/mobile, preuve, modèle, STOP, lecture seule,
> perte de réponse/reprise exacte. Captures inspectées. Svelte : 0 erreur,
> 12 avertissements antérieurs. Builds Shared/Database/API/Web réussis, version finale comprise.
> Migration `20260927120000_dossier_communications` uniquement sur
> `pulsar_enduser_20260921` (142 migrations); aucun écart de schéma des nouvelles tables.
> `.env` inchangé, pas de seed global, fournisseur réel, LLM, commit/push/PR ou VPS.
> API locale **3100 PID 46280**, Vite **5173 PID 37464**.
> **Suite :** rattacher explicitement les réponses aux dossiers, réactivation STOP
> contrôlée et harmonisation des préférences avec les anciens courriels/séquences;
> puis parcours Services P3a complet et recette fournisseur HTTPS autorisée.
> L’autorisation opérationnelle consignée ne certifie pas la conformité juridique
> et n’est pas un consentement marketing. Pas de déploiement ou délivrabilité réelle validés.

> **Communications v2 — commandes dans l’application, 2026-09-27**, branche `codex/pilot-business-depth`.
> [Contrat et mise en service](./plans/communications-telnyx-email.md).
> **Livré localement :** autorisation SMS réelle par entreprise dans Pulsar, sans
> `SMS_DRIVER`, confirmation humaine/version/audit et suspension sans réautorisation.
> Anciennes connexions `liveAuthorized=false` : pas d’activation lors de la migration.
> Clé publique Telnyx et origine HTTPS configurées dans l’UI; URL affichée à copier
> dans le profil fournisseur pour les réponses, capturée automatiquement pour les accusés.
> Webhooks Ed25519 sur octets exacts, fenêtre 5 min, validation profil/numéros,
> dédoublonnage durable et audit atomiques. Première livraison finale séparée de
> l’acceptation HTTP, rapprochement des retours arrivés avant la réponse d’envoi.
> Réponses et désabonnements paginés; STOP bloque les nouveaux envois tenant/numéro,
> y compris si l’expéditeur change. START ne réactive pas; aucun envoi automatique.
> Index partiel empêche de partager un même profil/numéro vérifié entre tenants.
> IMAP réel/simulé indépendant de EMAIL_DRIVER, choisi et confirmé dans l’application;
> anciennes boîtes en simulation jusqu’à réautorisation. SMTP et outbox financier inchangés.
> Documentation intégrée, catalogue et leçons propres aux communications mis à jour,
> sans réinitialiser les tutoriels. UI Pulsar conservée, captures bureau/mobile inspectées.
> **1 113 Shared + 723 API + 230 Web = 2 066 tests unitaires réussis.**
> **20 HTTP** isolés et **8 Chromium** réussis; signatures réelles de recette,
> fournisseurs SMS/SMTP/IMAP simulés. Types Svelte : 0 erreur, 12 avertissements antérieurs.
> Builds Shared/Database/API/Web réussis. Migrations `20260927110000_communications_app_controls`
> et `20260927111000_sms_webhook_binding` uniquement sur `pulsar_enduser_20260921`
> (141 migrations). `.env` inchangé, aucun envoi réel, LLM, seed global, commit/push/PR
> ni déploiement; modifications antérieures conservées.
> API locale **3100 PID 27504**, Vite **5173 PID 37464**.
> **Suite :** recette Telnyx réelle autorisée sur domaine HTTPS, consentement initial
> prouvé/réactivation contrôlée puis liens aux dossiers avant automatisations.
> Copier l’URL entrante dans Telnyx reste nécessaire; les tests locaux ne valident
> pas DNS/TLS, la délivrabilité ou la configuration réelle du fournisseur.
> Le parcours global Services P3a demeure la prochaine priorité produit.

> **Communications — Telnyx et courriel guidé, 2026-09-27**, branche `codex/pilot-business-depth`.
> Priorité explicitement demandée, intercalée avant la reprise P3a.
> [Contrat, configuration et limites](./plans/communications-telnyx-email.md).
> **Livré localement :** Connexions → SMS Telnyx, core autonome sans module métier,
> configuration par tenant, clé chiffrée, droits lecture/envoi/gestion, numéro E.164,
> profil, activation, simulation/réel et plafond quotidien. Envoi humain confirmé,
> registre avant réseau, reprise acteur/corps/version/clé et audit atomique.
> Aucun retry d'un SMS engagé : réponse perdue → inspection Telnyx; acceptation ≠ livraison.
> `SMS_DRIVER=log` bloque le réel. Aucun webhook réponse/STOP/livraison, campagne,
> automatisation CRM ou nouvel outil IA dans ce lot.
> **Courriel :** configuration Envoi/Réception/Vérification, préréglages SMTP
> personnalisé/Brevo/OVH Canada/Europe, état réellement enregistré, identité en aperçu.
> Répondre à transmis au SMTP; secret précédent retiré si serveur/compte change,
> version attendue UI, ports/champs bornés, audit atomique. Un SMTP tenant actif
> peut envoyer même en EMAIL_DRIVER=log; désactivation = repli plateforme, pas kill switch.
> Rédaction texte simple/HTML, confirmation avant conversion/envoi/suppression,
> aperçus bureau/mobile isolés et sans ressources distantes, modification gabarit
> corrigée (PUT au lieu de PATCH). Style Pulsar conservé; aide, documentation intégrée
> et tutoriels adaptés, sans réinitialisation des progressions.
> **1 111 Shared + 719 API + 230 Web = 2 060 tests unitaires réussis**
> (API : suite complète 716, puis 3 nouveaux tests SMTP ciblés).
> **13 HTTP** isolés avec transports simulés : droits/tenant, chiffrement/projection,
> validation, concurrence/replay, plafond, garde réel, rollback audit et réponse
> perdue après appel fournisseur. **6 Chromium** réussis : simulation et reprise
> après rechargement, rôle lecture et catalogue, configuration SMTP, aperçu sécurisé,
> gabarits texte simple créés/modifiés/réutilisés. Captures bureau/mobile 390 px inspectées.
> Builds Shared/Database/API/Web réussis. Typecheck API et Svelte : aucun blocage,
> 12 avertissements Svelte préexistants. Formatage ciblé et espaces Git vérifiés.
> Migration `20260927100000_tenant_sms` uniquement sur `pulsar_enduser_20260921`
> (139 migrations). `.env` inchangé, aucun secret client ni envoi réel, LLM, seed global,
> commit/push/PR ou déploiement. Changements antérieurs conservés.
> API locale **3100 PID 83596**, Vite **5173 PID 37464**.
> **Suite communications :** essai réel autorisé avec compte de test, webhooks signés
> et registre consentement/STOP avant notifications/automatisations métier. Le scénario
> global Services P3a reste la prochaine priorité produit; P1b/P4/P5 restent ouverts.

> **Services P3a.1 — acceptation des travaux, 2026-09-27**, branche `codex/pilot-business-depth`.
> **Livré localement :** option « Exiger l’acceptation des travaux » choisie sur un
> projet brouillon, onglet Acceptation des interventions, réserves et accord final
> historisés. Droit dédié `services.work.accept`, humain actif, version attendue,
> reprise acteur/clé/corps et audit atomique. [Contrat et limites](./plans/services-work-acceptance.md).
> Compte rendu/client capturés; accord final immuable, jamais signature électronique
> ou approbation des prix/quantités. Anciennes configurations facultatives conservées.
> Si exigée : sources temps/pièces bloquées avec motif et lien exact tant que
> l’intervention n’est pas terminée/acceptée; même contrôle serveur à la facture et
> à la clôture. Les autres interventions acceptées restent facturables séparément.
> Services autonome sans Catalogue/TMS/WMS/Facturation pour enregistrer l’accord.
> Interface Pulsar conservée, état visible dans la liste, saisie protégée, reprise
> après réponse perdue; aide, Documentation et parcours Services complétés, sans
> reset des tutoriels. Aucun nouveau pouvoir IA.
> **1 108 Shared + 702 API + 228 Web = 2 038 tests unitaires réussis.**
> **71 tests HTTP distincts réussis** : 16 acceptation + 55 régressions Services
> (fondations/connected-business). Droits, autre tenant, replay, concurrence,
> rollback audit, pagination, autonomie sans Billing, heures et pièces nettes vérifiés.
> **4 scénarios Chromium réussis** : lien facture → intervention, acceptation et
> déblocage, bureau/mobile 390 px inspectés, réponse perdue/rechargement/replay exact,
> rôle limité/panne et configuration facultative puis figée à l’activation.
> Typecheck API/Shared réussi; Svelte **0 erreur, 12 avertissements préexistants**.
> Builds Shared/Database/API/Web réussis, formatage ciblé et espaces Git vérifiés.
> Migration `20260927090000_service_work_acceptance` appliquée uniquement à
> `pulsar_enduser_20260921` (138 migrations). `.env` inchangé, aucun seed global,
> email réel, LLM payant, commit/push/PR ou déploiement. Changements antérieurs préservés.
> API isolée **3100 PID 20864**, Vite **5173 PID 37464**, readiness directe/proxy 200.
> **Suite P3a :** qualification du scénario global devis → plusieurs interventions →
> temps/pièces → acceptation → facture validée → avoir/retour physique → SAV,
> avec rôles limités et corrections. P3 n’est pas clos. P1b (CI/VPS), P4 et P5 ouverts.

> **Dossier client 360° P2a, 2026-09-27**, branche locale `codex/pilot-business-depth`.
> **Livré : bouton Dossier 360°**, à côté de Fiche entreprise dans Clients,
> les espaces Données consommateurs et les fiches CRM/Catalogue. Projets,
> interventions, devis, SAV, factures clients, opportunités/commandes CRM et
> commandes Transport; référence/titre/statut/date, recherche, pages et lien exact.
> [Contrat et limites](./plans/customer-workspace.md).
> Correspondances actuelles directes seulement, aucune fusion ou transitivité.
> Module ET droit document avant requêtes/compteurs; lecture RepeatableRead,
> tenant sur les dossiers et relations, pagination serveur et projection fermée.
> Services fonctionne seul; aucun module Clients imposé. Aucun total monétaire,
> note privée, changement métier ou nouveau pouvoir IA. États chargement/vide/
> accès limité/panne séparés; erreur ≠ zéro, reprise et réponses périmées gardées.
> Style Pulsar conservé, navigation bureau/sélecteur mobile; aide/Documentation
> dans chaque module consommateur et leçon Clients, sans reset des tutoriels.
> **1 106 Shared + 702 API + 227 Web = 2 035 tests unitaires réussis**;
> trente tests documentaires rejoués après la dernière mise à jour de l’aide.
> **26 HTTP / 2 suites réussis** : neuf nouveaux dossiers + dix-sept profils/liens.
> Inclut toutes les façades, droits, tenant étranger, liens CRM anciens incohérents,
> 22 sociétés sans troncature, absence de mutation et pages invalides. Le test
> page zéro a révélé un héritage de validation incomplet, corrigé et revérifié.
> **6 scénarios Chromium réussis** : trois nouveaux dossiers + trois régressions
> des profils/rapprochements. Desktop/mobile 390 px inspectés; recherche sans perte
> de focus, ouverture projet exacte, accès limité et panne/réessai vérifiés.
> Builds Shared/API/Web réussis, y compris l’aide finale; Svelte **0 erreur,
> 12 avertissements préexistants**. Formatage ciblé et espaces Git vérifiés.
> API isolée **3100 PID 75960**, Vite **5173 PID 37464**, readiness directe/proxy 200.
> Base `pulsar_enduser_20260921`; aucune migration, seed global, modification `.env`,
> commit, push, PR ou déploiement. Changements préexistants conservés.
> **Prochain lot : P3a, exceptions du parcours Services**, notamment acceptation
> des travaux, partiels et correction après facture; inventorier avant d’ajouter.
> P2 reste ouvert pour blocages/prochaines actions sourcés et création contextuelle.
> P1b (CI/VPS), P4 et P5 restent ouverts; aucun fournisseur IA réel testé.

## Incrément précédent — précontrôle pilote

> **Pilote P1a, 2026-09-27**, branche locale `codex/pilot-business-depth`.
> Les cinq priorités approuvées sont désormais l'ordre actif : **P1 pilote fiable,
> P2 dossiers/UX connectés, P3 Services complet, P4 Finance externe/natif, P5 IA qualifiée**.
> [Programme et critères de sortie](./plans/pilot-next-stage.md).
> **Livré localement : Administration SaaS → Exploitation → Préparer le pilote**.
> Profils Services/Transport/Fabrication et option IA, sans changement de modules.
> Comparaison bornée des scripts de migration et de l'historique PostgreSQL (noms/
> empreintes, LF/CRLF équivalents), inconnus explicites, aucune réparation ni migration.
> Révision déclarée/MFA/courriel/APS/agents distingués des essais réels; aucun verdict
> prêt production. Export JSON daté sans contenu tenant ni secret; indisponible après
> échec d'actualisation. Aucune mutation métier, envoi réel ou appel LLM.
> UI Pulsar conservée, documentation intégrée Réglages et runbook OVH actualisés.
> **1 104 Shared + 696 API + 226 Web = 2 026 tests unitaires distincts réussis**
> (Web : passe globale 225 puis 8 ciblés incluant le nouveau test documentaire).
> **19 tests HTTP / 2 suites réussis**, dont 5 nouveaux contrôles pilote;
> migrations locales **137 correspondantes**, accès anonyme/tenant/MFA-step refusés,
> opérateur désactivé refusé, erreurs isolées et absence de mutation vérifiées.
> **2 scénarios Chromium réussis**, rejoués après cadrage des captures; bureau et
> mobile 390 px inspectés. Export réel et erreur réseau/reprise testés.
> Builds Shared/API/Web réussis; Svelte **0 erreur, 12 avertissements préexistants**.
> API isolée **3100 PID 72600**; readiness directe et proxy 5173 : 200.
> Aucune migration nouvelle, seed global, modification `.env`, commit, push ou PR.
> Aucun VPS/DNS/TLS touché; le propriétaire ne sait pas encore si SSH est configuré.
> **P1b reste ouvert** : version candidate globale/CI puis recette serveur autorisée.
> **Prochain lot local : P2a, dossier client 360° en lecture seule**, liens explicites
> Customer/BusinessPartner/CRM et droits de chaque module avant requêtes/compteurs.
> P3/P4/P5 sont planifiés, pas livrés par P1a. I2m.2d.2e.2 (anciens plans d'actifs)
> reste au backlog Finance, sans bloquer les pilotes qui n'en ont pas besoin.

## Incrément précédent — dotations historiques groupées

> **Dotations historiques I2m.2d.2e.1, 2026-09-27**, branche locale
> `codex/pilot-business-depth`. Finance → **Reprise du journal** rapproche désormais
> toutes les dotations enregistrées d'une ancienne immobilisation, avec une seule
> devise attestée sur preuve et une qualification/retrait groupés. Cumul, périodes
> et comptes réellement postés vérifiés exactement; les mois absents sont signalés,
> jamais complétés. Origine NULL, actif, périodes, montants et journaux inchangés.
> Le plan futur reste bloqué : aucun snapshot historique inventé ni nouveau posting.
> Revue v6, sources recontrôlées sous verrous business → actif → GL, annotations/
> révision/audit atomiques, concurrence et reprise exacte, droits source sur toutes
> les preuves et replays. Aucun nouveau pouvoir IA; Finance autonome.
> [Contrat et limites](./plans/billing-asset-history-qualification.md).
> Registre relié au dossier exact, détail des périodes/comptes, cumul groupé distinct
> de la première écriture. Style Pulsar conservé, aide, Documentation et vingtième
> leçon Finance adaptées, sans réinitialiser les tutoriels déjà vus.
> **1 098 Shared + 691 API + 225 Web = 2 014 tests unitaires réussis**.
> **74 tests HTTP / 3 suites Finance réussis**, dont 43 de qualification.
> **11 scénarios Chromium réussis**, captures bureau/mobile 390 px inspectées.
> Rejeu final des deux parcours actifs après clarification des comptes : réussi,
> nouvelles captures inspectées. HTTP rejoués avec inclusion/retrait groupés
> vérifiés dans les résultats financiers : 74/74 réussis.
> Builds Shared/API/Web réussis; Svelte **0 erreur, 12 avertissements préexistants**.
> Aucune nouvelle migration, base isolée `pulsar_enduser_20260921` seulement,
> sans seed global ni changement `.env`. API **3100 PID 27796**, readiness directe
> et proxy 5173 : 200. Aucun commit, push, PR ni déploiement.
> **Suite I2m.2d.2e.2 / E4** : contrat de reprise prospective des anciens actifs
> (date/valeur de départ, durée restante, preuve, plan figé et garde anti-double
> dotation), puis périodes/clôtures et change explicites. Les sources incohérentes
> ou journaux manquants restent hors reprise; cible Pulsar/externe configurable.

## Incrément précédent — factures transporteur ajustées

> **Factures transporteur ajustées I2m.2d.2d, 2026-09-27**, branche locale
> `codex/pilot-business-depth`. Finance → **Reprise du journal** accepte un payable
> ajusté si une décision ACCEPT_INVOICED unique/cohérente est retrouvée dans l'audit
> du tenant, si les montants reçus/écarts concordent et si le journal existe déjà
> pour ce payable avec les taxes conservées. Aucun montant attendu, payable, taxe,
> solde, règlement ou journal n'est réécrit; pas d'auto-posting ni de backfill.
> L'UI distingue attendu/reçu, taxes figées, payable et écart; les écarts de lignes
> restent séparés. Date d'acceptation plutôt qu'un compteur d'avoirs clients.
> Justificatif, revue snapshot v5, version, audit atomique et reprise exacte;
> droits facture sur toutes les lectures/preuves/replays, Finance seul, aucun
> nouveau pouvoir IA. [Contrat et limites](./plans/billing-accepted-carrier-qualification.md).
> Documentation intégrée, aide et dix-neuvième leçon Finance adaptées sans reset
> des tutoriels. Historique manquant/ambigu, absence de GL et formes comptables
> non standard restent bloqués; ce lot ne certifie pas le traitement fiscal.
> **1 094 Shared + 691 API + 224 Web = 2 009 tests unitaires réussis**.
> **90 tests HTTP / 4 suites Finance réussis**, dont 36 de qualification.
> **9 scénarios Chromium réussis**, captures bureau/mobile 390 px inspectées.
> Rejeu final du parcours transporteur après affinage des libellés/date : réussi,
> nouvelles captures inspectées. Documentation générale synchronisée avec le lot.
> Builds Shared/API/Web réussis; Svelte **0 erreur, 12 avertissements préexistants**.
> Aucune migration nouvelle, base isolée `pulsar_enduser_20260921` seulement,
> sans seed global ni changement `.env`. API **3100 PID 69580**, readiness directe
> et proxy 5173 : 200. Aucun commit, push, PR ni déploiement.
> **Suite I2m.2d.2e / E4** : anciens plans d'immobilisations sur preuves, puis
> périodes/clôtures et change explicites. Les autres formes historiques exclues
> exigent leur propre contrat; la qualification manuelle ne les contourne pas.
> La cible comptable Pulsar/externe demeure configurable par entreprise.

## Incrément précédent — paiements partiellement affectés

> **Paiements partiels I2m.2d.2c, 2026-09-27**, branche locale
> `codex/pilot-business-depth`. Finance → **Reprise du journal** accepte un paiement
> historique partiellement affecté seulement si son journal correspond exactement
> à la somme affectée. L'UI distingue montant déclaré, affecté/comptabilisé et reste.
> Exemple 15,01 / 12,34 / 2,67 CAD : seule la portion 12,34 est qualifiée; aucun
> crédit client, avance fournisseur ou journal complémentaire n'est créé.
> Revue avec montants capturés (snapshot v4), preuve et décision humaine;
> original/contrepassation groupés, annulation sur comptes originaux, concurrence,
> audit atomique et reprise exacte. Banque toujours bloquée pour un paiement partiel.
> UI Pulsar native, aide, Documentation et dix-huitième leçon Finance adaptées sans
> réinitialiser les tutoriels. [Contrat et limites](./plans/billing-partial-payment-qualification.md).
> **1 090 Shared + 691 API + 223 Web = 2 004 tests unitaires réussis**.
> **84 tests HTTP / 4 suites Finance réussis**, dont 30 de qualification.
> **8 scénarios Chromium réussis**, captures bureau et mobile 390 px inspectées.
> Aucune migration nouvelle : base isolée `pulsar_enduser_20260921` seulement,
> sans seed global ni modification `.env`. Builds Shared/API/Web réussis;
> Svelte **0 erreur, 12 avertissements préexistants**.
> API isolée **3100 PID 30460**, readiness directe et proxy 5173 : 200.
> Aucun commit, push, PR ni déploiement.
> **Suite I2m.2d.2d / E4** : factures transporteur ajustées/non standard,
> puis anciens plans d'actifs, périodes/clôtures et change explicites.
> Paiements sans journal ou sans affectation restent bloqués; pas de ventilation
> implicite du reste. La cible Pulsar/externe reste configurable par entreprise.

## Incrément précédent — factures et avoirs historiques

> **Factures historiques I2m.2d.2b, 2026-09-27**, branche locale
> `codex/pilot-business-depth`. Finance → **Reprise du journal** rapproche désormais
> les factures clients/transporteurs et les avoirs clients : tiers, net, taxes figées,
> total, comptes réellement postés et cumul crédité. Devise source attestée sur
> preuve; original et avoirs NULL qualifiés/retirés ensemble, sans modifier le journal.
> Avoir à devise connue conservé et retrait isolé interdit. Nouvel avoir possible
> après qualification, toujours avec devise connue; concurrence émission/retrait
> testée sous verrou facture partagé. Droits source sur dossier/preuve/replay,
> annotation/révision/audit atomiques, aucun nouveau pouvoir IA.
> UI Pulsar native, synthèse net/taxes/avoirs, source en lecture seule, blocages
> explicites; aide, Documentation et dix-septième leçon Finance sans reset des tours.
> [Contrat et limites](./plans/billing-invoice-qualification.md).
> Aucun GL manquant créé. Factures transporteur ajustées dont les lignes attendues
> diffèrent du payable conservées et bloquées pour une reprise spécialisée.
> Aucune migration nouvelle : migration 137 réutilisée, base isolée
> `pulsar_enduser_20260921` seulement; aucun seed global ni changement `.env`.
> **1 088 Shared + 691 API + 222 Web = 2 001 unitaires réussis**.
> **101 HTTP distincts** : 99 dans 5 suites Finance + recontrôle 24 du lot avec
> deux cas supplémentaires (payable ajusté et concurrence avoir/retrait).
> **7 scénarios Chromium réussis**, captures bureau/390 px inspectées.
> La recette visuelle a identifié puis corrigé un texte d’aide périmé.
> Rejeu final des deux parcours facture après cette correction : réussi.
> Builds Shared/API/Web réussis; Svelte **0 erreur, 12 avertissements préexistants**.
> API isolée **3100 PID 66296**, readiness directe et proxy 5173 : 200.
> Aucun commit, push, PR ni déploiement.
> **Suite I2m.2d.2c / E4** : paiements partiellement affectés, factures ajustées
> et plans d’actifs historiques, puis périodes/clôtures et change explicites.
> La cible Pulsar/externe reste configurable sans activation implicite.

## Incrément précédent — paiements historiques

> **Paiements historiques I2m.2d.2a, 2026-09-27**, branche locale
> `codex/pilot-business-depth`. Finance → **Reprise du journal** rapproche les
> paiements clients/transporteurs entièrement affectés, leurs tiers, devises,
> montants et écritures originales/contrepassations. Preuve et confirmation humaine;
> droit `billing.payments.read` ajouté aux contrôles du dossier, preuves et replay,
> sans attribution automatique de rôle. Factures/anciens actifs restent exclus.
> Qualification groupée versionnée, sourceEntryId tenant-scopé, révision sur
> l’original; aucun NULL, montant, compte ou date original réécrit. Retrait groupé,
> annulation future portant la même qualification, audit et écritures atomiques.
> **Correctif : annuler inverse les comptes réellement postés, pas les réglages
> actuels du mode de paiement.** Retrait interdit pendant le rapprochement bancaire;
> validation banque accepte la devise attestée tout en gardant ses autres contrôles.
> Lecture source groupée en base, cents exacts, verrous business → paiement → GL.
> UI native responsive, blocages explicites et devise source en lecture seule;
> correction du composant Input pour transmettre `readonly`. Documentation, aide
> et seizième leçon Finance adaptées sans reset des tours.
> [Contrat et limites](./plans/billing-payment-qualification.md).
> Migration additive **137**, appliquée uniquement à `pulsar_enduser_20260921`.
> **1 084 Shared + 691 API + 221 Web = 1 996 unitaires** réussis.
> **118 HTTP distincts / 7 suites Finance** réussis; **5 scénarios Chromium**
> validés, captures bureau/mobile inspectées. La première passe UI a identifié le
> `readonly` ignoré; une autre assertion a été interrompue par le rechargement de
> développement pendant les tests Web. Rejeu séparé réussi après correction.
> Recontrôle final des **14 tests HTTP du lot : vert** après lecture groupée des
> factures. Builds Shared/Database/API/Web réussis; Svelte **0 erreur, 12 avertissements
> préexistants**. API isolée **3100 PID 19680**, readiness directe et proxy 5173 : 200.
> Aucun seed global, changement `.env`, commit, push, PR ni déploiement.
> **Suite I2m.2d.2b / E4** : factures historiques et documents compensatoires,
> paiements partiellement affectés puis plans d’actifs historiques, périodes et
> change. La cible Pulsar/externe reste configurable, sans activation implicite.

## Incrément précédent — qualification manuelle

> **Reprise historique manuelle I2m.2d.1, 2026-09-27**, branche locale
> `codex/pilot-business-depth`. Finance → **Reprise du journal** : justificatif
> protégé, revue des lignes et des effets, confirmation humaine avec droit
> **`billing.ledger.qualify`** distinct de la saisie. Annotation séparée
> QUALIFIED/WITHDRAWN versionnée et révocable; aucun montant, compte, date ou
> NULL original réécrit. Source métier liée (paiement/facture/amortissement) bloquée.
> Retrait motivé sans contrepassation, preuve et révisions conservées; nouvelle
> devise seulement après retrait et nouvelle revue. Audit et décision atomiques,
> verrous business puis GL, UUID/acteur/corps et replay avant état courant.
> Journal, balance, rapports et budgets utilisent la même devise effective et
> signalent les écritures qualifiées sur preuve. Les anciennes périodes reflètent
> la qualification **actuellement** confirmée, sans restitution de connaissance passée.
> UI Pulsar conservée, liste/dossier sur bureau et dossier prioritaire sur mobile;
> reprise persistante de preuve et de décision après coupure/403. Documentation
> intégrée, aide contextuelle et quinzième leçon Finance, sans reset des tutoriels.
> [Contrat, API et limites](./plans/billing-historical-qualification.md).
> Migration additive **136**, appliquée uniquement à `pulsar_enduser_20260921`.
> **1 080 Shared + 691 API + 220 Web = 1 991 unitaires** réussis.
> **147/147 HTTP**, 12 suites Finance; recontrôle final des 5 suites impactées :
> **58/58** après durcissement des lectures tenant/snapshot. **12 scénarios Chromium
> validés**, dont preuve/réponse perdue, confirmation/403/rechargement, retrait,
> droits, rapports, budgets et actifs. Une course du helper de connexion des tests
> a été corrigée, puis le scénario concerné repassé isolément; un timeout du
> sélecteur de comptes ne s’est pas reproduit dans la passe suivante.
> Captures bureau/mobile inspectées; builds **Shared/Database/API/Web réussis**.
> Svelte : **0 erreur, 12 avertissements préexistants**. Format/whitespace ciblés verts.
> Contrôle final des 7 tests du lot : vert, dont audit de preuve unique et atomique.
> API isolée **3100 PID 70492**, Vite **5173 PID 37464**, readiness 200. Aucun seed global,
> modification `.env`, commit, push, PR ou déploiement dans ce lot.
> **Suite I2m.2d.2/E4** : reprise des sources historiques liées avec rapprochement
> métier; contrepassations contrôlées, devise fonctionnelle/taux, périodes/clôtures
> puis sous-livre fournisseur. La cible Pulsar/externe reste configurable par tenant,
> sans activation comptable officielle ni connexion externe implicite.

## Incrément précédent — immobilisations et dotations

> **Immobilisations qualifiées I2m.2c, 2026-09-27**, branche locale
> `codex/pilot-business-depth`. Finance → **Immobilisations** : devise explicite,
> référence d’acquisition, dates civiles, premier mois choisi, coût/résiduel exacts
> et comptes locaux actifs. Brouillon versionné; revue puis activation figent le
> plan linéaire mensuel et ses paramètres. Arrondis sur les cumuls, total exact.
> Prochaine période seulement, fin de mois UTC non future; période nulle tracée
> sans GL fictif. Dotation/cumul/journal/version/opération/audit atomiques sous
> verrou tenant. Reprise UUID/acteur/corps, y compris après réponse perdue et 403.
> Droit distinct **`billing.assets.post`** à attribuer explicitement; humain actif,
> aucun nouveau pouvoir agent. Les anciens dossiers NULL restent en lecture seule.
> Retrait motivé sans suppression, **pas de cession comptable** ni posting d’acquisition.
> UI native Pulsar séparant prévision et réel, liste mobile, journal lié avec ses
> droits, actualisation et erreurs visibles. Documentation intégrée, aide `?` et
> quatorzième leçon Finance enrichies sans relancer les tours déjà complétés.
> [Contrat, API et limites](./plans/billing-fixed-assets-currency.md).
> Migration additive **135**, appliquée uniquement à `pulsar_enduser_20260921`;
> Prisma généré. **1 077 Shared + 691 API + 217 Web = 1 985 unitaires** réussis.
> **140/140 HTTP**, 11 suites Finance; **9/9 Chromium** (profil, budgets, journal,
> rapports, actifs), dont reprise réseau, droits, lien actif → GL et 390 px.
> Captures bureau/mobile inspectées; Svelte **0 erreur, 12 avertissements préexistants**.
> Builds **Shared/Database/API/Web réussis**, vérification de whitespace ciblée sans erreur.
> API isolée **3100 PID 35128**, Vite **5173 PID 37464**; readiness 200.
> Aucun seed global, changement `.env`, commit, push, PR ou déploiement dans ce lot.
> **Suite I2m.2d/E4** : reprise historique avec preuves, contrepassations contrôlées,
> devise fonctionnelle/taux, périodes/clôtures, puis sous-livre fournisseur.
> Le choix Pulsar/externe reste une cible, pas une activation comptable officielle.

## Incrément précédent — profil comptable et budgets

> **Profil comptable et budgets qualifiés I2m.2b, 2026-09-27**, branche locale
> `codex/pilot-business-depth`. Décision utilisateur : cible configurable par
> entreprise, Pulsar natif ou logiciel externe de référence. Profil avec devise
> fonctionnelle cible, motif, confirmation, versions et historique append-only.
> **Cible de préparation uniquement** : aucun GL officiel, change ou connecteur
> activé implicitement. Droit dédié `billing.accounting.configure` à attribuer
> explicitement aux rôles existants (pas d’extension automatique de privilèges).
> Finance → **Profil comptable / Budgets**. Nouveaux budgets à devise et période
> civiles UTC figées, comptes locaux actifs, écarts exacts sans somme interdevises
> ni faux total entre natures comptables. Couverture limitée aux comptes du budget.
> Le réalisé est un mouvement net de période, pas un solde de clôture.
> Révisions, archivage réversible, version attendue et reprise UUID/acteur/corps;
> audit et mutation atomiques. Ancien budget non qualifié laissé en lecture seule.
> UI Pulsar, cartes mobile, demandes restaurées et verrouillées après coupure,
> aide `?`, documentation intégrée et treizième leçon Finance sans reset des tours.
> [Contrat et compatibilité API](./plans/billing-accounting-profile-budgets.md).
> Migration additive **134**, appliquée uniquement à `pulsar_enduser_20260921`.
> Prisma généré, 134 migrations à jour. Unitaires : **1 072 Shared + 691 API +
> 212 Web = 1 975** réussis. HTTP **138/138**, 11 suites; Chromium **6/6** après
> disponibilité de l’API, captures bureau/390 px inspectées. Svelte **0 erreur,
> 12 avertissements préexistants**; builds Shared/Database/API/Web réussis.
> API isolée **3100 PID 55172**, Vite **5173 PID 37464**. Aucun seed global,
> modification `.env`, commit, push, PR ou déploiement dans ce lot.
> **Suite I2m.2c/E4** : immobilisations et historique qualifiés avec preuves,
> devise fonctionnelle/taux capturés, périodes/clôtures, puis sous-livre fournisseur.

## Incrément précédent — grand livre par devise

> **Grand livre et rapports par devise I2m.2a, 2026-09-27**, branche locale
> `codex/pilot-business-depth`. Finance → Grand livre / Rapports financiers.
> Nouvelles écritures avec devise source, historique NULL sans backfill, sommes
> exactes et sélection explicite; couverture des exclusions visible. Les âgés
> décrivent des soldes courants, pas une balance historique ni des échéances.
> Saisie manuelle confirmée, UUID/acteur/corps, verrou et audit transactionnels,
> reprise exacte après commit/503/403/rechargement. Champs restaurés et verrouillés.
> Contrepassations dans la devise originale; gardes avoirs, banque et budgets
> contre l’historique non qualifié. Aide `?`, documentation Finance et douzième
> leçon du premier tutoriel, sans reset ni bouton supplémentaire.
> [Contrat, API, preuves et suite](./plans/billing-ledger-currency.md).
> Migration additive **133**, appliquée uniquement à `pulsar_enduser_20260921`.
> Prisma validé, client généré et 133 migrations à jour sur cette base isolée.
> Unitaires : **1 068 Shared + 691 API + 209 Web = 1 968** réussis.
> HTTP : **144/144**, 11 suites Finance/fournisseur; Chromium **18/18**, avec
> passe finale des 3 parcours devise/reprise/balance après les retouches mobile.
> Captures ordinateur/390 px inspectées; Svelte **0 erreur, 12 avertissements
> préexistants**. Builds Shared/Database/API/Web réussis.
> API isolée **3100 PID 38956**, Vite **5173 PID 37464**. Aucun seed global,
> aucune modification de `.env`, aucun commit/push/PR/déploiement dans ce lot.
> **Limites** : pas de devise fonctionnelle, change, clôture, GL officiel garanti,
> dette fournisseur ou lettrage. Amortissements non qualifiés; contrat devise des
> budgets à définir. Les auto-postings de factures restent best-effort.
> **Suite I2m.2b/E4** : trancher maître comptable Pulsar/externe, qualification
> historique et devise fonctionnelle, périodes partagées, puis sous-livre fournisseur.

## Incrément précédent — échéancier fournisseur opérationnel

> **Échéancier fournisseur I2m.1, 2026-09-27**, branche locale `codex/pilot-business-depth`.
> Finance → Échéancier fournisseur : dates/montants convenus sur factures QUALIFIED,
> revue puis confirmation humaine, révisions append-only, retrait/rétablissement,
> reprise exacte après coupure et contrôle de version sous verrou tenant.
> Nouvel avoir qualifié ⇒ planning À revoir, conservé mais exclu de la prévision
> jusqu’à reconfirmation. Synthèses filtrées toutes pages, montants exacts par devise.
> Ce planning ne comptabilise aucune dette et ne déduit aucun règlement. Aucun effet
> stock, banque, courrier ou nouvel outil agent. Finance seul; droit dédié
> `billing.supplier-schedules.manage` à attribuer explicitement aux rôles existants.
> Liens facture/dossier/accueil Finance, UI Pulsar ordinateur/mobile, aide contextuelle,
> documentation et leçon du premier tutoriel sans reset ni nouveau bouton.
> Migration additive **132**, appliquée uniquement à `pulsar_enduser_20260921` local.
> [Contrat, preuves et suite](./plans/billing-supplier-schedules.md).
> Unitaires **1 051 Shared + 691 API + 199 Web = 1 941** réussis.
> HTTP fournisseur **44/44**, Chromium **15/15** réussis (factures, avoirs, dossiers,
> échéanciers, reprise après commit/403/reload, lecture seule et premier tutoriel).
> Captures bureau/390 px inspectées. Typage Svelte : **0 erreur, 12 avertissements
> préexistants**. Builds Shared/Database/API/Web réussis; Prisma validé/généré et
> aucun écart de schéma sur la nouvelle table dans la base isolée.
> API isolée 3100 PID **84240**, Vite 5173 PID **37464**. Lecture HTTP vérifiée après
> redémarrage du build API. Aucun seed global ni modification de `.env`.
> **Suite I2m.2/E4** : choix grand livre natif/externe, devise fonctionnelle/transaction
> et périodes, puis sous-livre fournisseur/contrepassations/lettrage. Le GL historique
> ne capture pas la devise : aucun raccord implicite à ce registre nouveau.
> `.env` inchangé; aucun commit, push, PR ni déploiement dans ce lot.

## Incrément précédent — dossier fournisseur documentaire

> **Dossier fournisseur I2l.3, 2026-09-27**, branche locale `codex/pilot-business-depth`.
> Finance → Dossiers fournisseur : répertoire actif/historique, factures/avoirs/pièces
> réunis sans duplication. Synthèse QUALIFIED exacte par devise sur l’historique complet,
> hors brouillons/annulés; reste documentaire explicitement distinct d’une dette payable.
> Filtres, dates civiles, pagination SQL stable, téléchargements protégés et ouverture
> directe des factures/avoirs dans les panneaux existants. Finance seul, lecture dédiée,
> aucune exposition des contextes Achats/WMS ou clés de stockage.
> Aide, documentation intégrée et tutoriel spécifique enrichis sans reset ni nouveau bouton.
> Aucun changement de schéma, aucun stock, paiement, envoi ou posting comptable.
> [Contrat et limites](./plans/billing-supplier-dossiers.md).
> Vérifications : **1 030 Shared + 691 API + 192 Web = 1 913 tests unitaires**;
> HTTP dossiers/factures/avoirs **35/35**, dont bornes de pagination et dates réelles.
> Chromium **12/12** : liens directs, fichiers protégés, filtres, lecture seule, synthèse
> en échec et réponses tardives; régressions de saisie/reprise et premier tutoriel.
> Ultime passe dossiers **5/5** après adaptation en fiches mobile; captures bureau/390 px
> inspectées. Typage Svelte : **0 erreur, 12 avertissements préexistants**.
> Builds Shared/API/Web réussis, y compris le bundle final après retouches mobiles.
> API de test 3100 PID **71056**, Vite 5173 PID **37464**; `.env` inchangé.
> **Suite** : définir le contrat dette fournisseur/échéancier puis posting et contrepassation
> comptables, sans assimiler le reste documentaire à un payable. Aucun push ou déploiement.

## Incrément précédent — avoirs fournisseur

> **Avoirs fournisseur I2l.2, 2026-09-26**, branche locale `codex/pilot-business-depth`.
> Finance → Factures fournisseur → facture QUALIFIED → Avoirs fournisseur : registre
> dédié, montants déclarés par ligne et position de taxe, original protégé et qualification
> humaine. Source/fournisseur/devise immuables; Finance seul fonctionne. Aucun paiement,
> comptabilisation, stock, envoi ou nouvel outil IA. La facture originale reste inchangée.
> Cumul exact QUALIFIED plafonné par composante, revérifié sous verrou business;
> brouillons sans réservation, version et reprise acteur/clé/corps, gel et annulation
> documentaire conservant le numéro. Droits gestion/qualification distincts.
> Retour WMS facultatif : dernier suivi du même fournisseur, révision capturée, nouveau
> suivi bloquant la qualification du brouillon; copie historique conservée après gel.
> Contexte masqué sans WMS/read; pas de retrait du lien, upload ou replay contournant l’accès.
> UI dans les panneaux Pulsar : original/avoirs qualifiés/reste créditable, formulaire
> progressif et readonly, reprise après coupure, chargement et erreurs explicites.
> Documentation intégrée approfondie, connexion WMS–Finance et étape de tutoriel propre
> aux avoirs, sans reset des utilisateurs existants ni nouveau bouton de tutoriel.
> [Contrat métier et limites](./plans/billing-supplier-credits.md).
> Vérifications : **11/11 HTTP avoirs + 17/17 factures + 65/65 WMS**;
> **1 021 Shared + 691 API + 189 Web = 1 901 tests unitaires**.
> **7/7 Chromium** : saisie, 503 après commit, 403 intermédiaire, reprise exacte,
> original et gel, solde, lecteur seul, sélection WMS sans montant inféré,
> régression factures/Achats et premier tutoriel. Captures bureau/390 px inspectées.
> Typage Svelte : **0 erreur, 12 avertissements préexistants**. Builds Shared/Database/API/Web
> réussis; ultime typage/build Web également réussi après les retouches de chargement de l’avoir.
> Migration additive **131**, uniquement `pulsar_enduser_20260921`; `.env` intact.
> API isolée 3100 PID **50220**, Vite 5173 PID **37464**. Aucun push, PR ou déploiement.
> **Suite** : dossier fournisseur (factures/avoirs/pièces, recherche et filtres), puis
> qualifier le contrat dette fournisseur/échéancier et posting comptable. Le reste
> créditable n’est jamais un montant payable. Multi-factures, correction d’avoirs
> qualifiés et allocation des retours par ligne restent hors de ce lot.

## Incrément précédent — factures fournisseur

> **Factures fournisseur I2l.1, 2026-09-26**, branche locale `codex/pilot-business-depth`.
> Finance → Factures fournisseur : registre dédié, fournisseur partagé créable sur place,
> numéro externe/dates civiles/devise, lignes nettes et taxes déclarées exactes, pièces
> originales protégées. Finance seul suffit; liens aux lignes Achats facultatifs et gardés.
> Brouillon éditable à version attendue → qualification humaine et gel documentaire,
> ou annulation conservée. Aucun paiement, grand livre, stock, envoi ou nouvel outil IA.
> Droits read/manage/qualify distincts; sources commerciales masquées sans accès Achats.
> Reprise tenant/acteur/clé/corps; upload exact après coupure; doublons fournisseur/numéro
> bloqués. Panneaux Pulsar conservés, états d’erreur explicites, garde des éditions non
> enregistrées et tutoriel fournisseur spécifique au premier accès, sans reset des anciens.
> Accueil Finance et navigation filtrés pour les utilisateurs limités au nouveau registre.
> [Contrat, documentation et limites](./plans/billing-supplier-invoices.md).
> Vérifications acquises : **17/17 HTTP fournisseur + 65/65 HTTP WMS**, **1 006 Shared**,
> **691 API**, **180 Web** unitaires. **4/4 Chromium fournisseur** : Finance seul, saisie,
> 503 après commit, refus intermédiaire, reprise exacte, original, qualification figée,
> lecture seule, accueil restreint, lien Achats et récupération d’une lecture échouée,
> premier tutoriel avec utilisateur neuf puis rechargement silencieux. Captures bureau
> et 390 px inspectées, pas de débordement. Svelte : **0 erreur, 12 avertissements existants**;
> builds Shared/Database/API/Web réussis; typage et build Web revalidés après les corrections UI.
> Migration additive **130** uniquement sur `pulsar_enduser_20260921`; `.env` intact.
> API isolée 3100 PID **59516**, Vite 5173 PID **37464**. Aucun push, PR ou déploiement.
> **Suite I2l.2** : avoir fournisseur reçu, lié explicitement à une facture QUALIFIED
> et ses lignes; original, cumuls exacts et confirmation humaine. Lien facultatif au suivi
> de retour WMS versionné, sans déduire le crédit du prix d’achat ni créer de stock.
> Pas encore de comptabilité fournisseurs, paiement, rapprochement trois pièces ou OCR.

## Incrément précédent

> **Suivi fournisseur WMS I2k, 2026-09-26**, branche locale `codex/pilot-business-depth`.
> WMS → Sorties documentées → retour POSTED : cumuls reçus, acceptés et refusés chez le
> fournisseur, réception/décision encore attendues, référence, compte rendu et pièce du dossier.
> Déclaration humaine, pas une signature du fournisseur; aucun effet stock, achat ou finance.
> Registre append-only, correction motivée en cas de baisse/date antérieure, historique paginé;
> parent, preuve physique et updatedAt d’origine inchangés. Verrou business puis WMS,
> version attendue et reprise exacte tenant/acteur/clé/corps. WMS autonome, même lorsque la
> lecture commerciale d’un ancien retour lié n’est plus disponible. Droits wms.read/manage
> et wms.stock.return; aucune capacité mutating IA supplémentaire.
> UI dans le panneau Pulsar existant, cumuls distincts, formulaire sur demande, fuseau affiché,
> lecture seule, états vide/erreur et reprise conservée après coupure/refus intermédiaire.
> Documentation intégrée, guide et tutoriels WMS/Achats adaptés, sans reset ni nouveau bouton.
> [Contrat et limites I2k](./plans/wms-supplier-return-followup.md).
> Vérifications acquises : **65/65 HTTP WMS**, **989 Shared**, **691 API**, **171 Web** unitaires.
> Svelte **0 erreur, 12 avertissements préexistants**; builds Shared/Database/API/Web réussis.
> **45/45 scénarios Chromium** réussis : WMS, fabrication, scans, tutoriels et journal.
> Nouveau parcours : correction motivée, 503 après commit, 403 intermédiaire, reprise exacte
> après rechargement et vérification GET sans renvoi, lecture seule; captures bureau/390 px inspectées.
> Parcours I2k rejoué après ajout du contrôle de largeur du formulaire ouvert à 390 px :
> réussi, capture de saisie inspectée. Aucun débordement horizontal.
> Migration additive **129** appliquée uniquement à `pulsar_enduser_20260921`; `.env` intact.
> Docker relancé, API isolée 3100 (PID **72468**), Vite 5173 (PID **37464**).
> Aucun push, PR ou déploiement. **Suite I2l** : qualifier la facture fournisseur générale,
> puis l’avoir explicitement rapproché, distinct du retour physique. Le schéma actuel de
> factures transporteur ne couvre pas ces achats; ne pas le détourner ni déduire un avoir du prix d’achat.

> **Retours et justificatifs WMS I2j, 2026-09-25**, branche locale `codex/pilot-business-depth`.
> WMS → Sorties documentées : rattachement facultatif d’un retour à une ligne de réception
> d’achat POSTED, avec fournisseur/article/lot/site/unité concordants. Copie commerciale figée,
> cumul DRAFT+POSTED borné, contrôle sous verrou business puis WMS, fraîcheur et replay exacts.
> WMS seul reste autonome; données commerciales et validation liée gardées par Achats + read.
> Réceptions anciennes/incomplètes signalées sans bloquer les autres choix; aucun historique inventé.
> Justificatifs PDF/PNG/JPEG : 10 Mo, 30 par dossier, append-only, auteur/date/empreinte/stade.
> Reprise navigateur par même fichier/clé ou vérification de l’enregistrement, sans doublon.
> Ajout après sortie identifié sans modifier la preuve initiale ni le stock; aucun ajout neuf
> sur dossier annulé. Documents protégés des routes génériques, téléchargements gardés.
> Navigation Achats ↔ retour, aide de page, documentation et tutoriels WMS/Achats adaptés,
> sans reset ni nouveau bouton. UI Pulsar conservée. [Contrat I2j](./plans/wms-return-purchase-evidence.md).
> Aucun avoir, remboursement, acceptation fournisseur, email, transport ni outil IA ajouté.
> Vérifications : **269 HTTP sur 14 suites validés après reprise ciblée** : la dernière passe
> groupée comptait 268 réussites et une fixture sans référence de réception; fixture complétée,
> puis **59/59 tests de la suite Lots** rejoués avec succès. **978 Shared, 691 API, 163 Web**
> unitaires réussis. **44 scénarios Chromium** réussis, puis parcours I2j rejoué après dernier
> durcissement des preuves historiques : refus de sélection incomplète, reprise des fichiers
> par renvoi exact et vérification, confidentialité WMS seul, téléchargement, bureau/390 px.
> Captures finales inspectées; sélecteur fichier réinitialisé après succès. Svelte **0 erreur**,
> **12 avertissements préexistants**; builds Database/API/Web réussis.
> Migration additive **128** appliquée uniquement à `pulsar_enduser_20260921`; `.env` intact.
> API isolée 3100 (PID **21872**), Vite 5173 (PID 77828). Aucun push, PR ou déploiement.
> **Suite recommandée I2k** : réception/acceptation/refus partiels déclarés côté fournisseur,
> preuves et versions; ensuite avoir fournisseur explicitement rapproché d’une facture,
> séparé de la sortie physique. Achats matières MRP et retours non suivis par lot restent distincts.

> **Sorties documentées WMS I2i, 2026-09-25**, branche locale `codex/pilot-business-depth`.
> WMS → Sorties documentées, ou Articles → Lots : destruction/rebut et retour physique
> fournisseur sur un article suivi, un lot, un emplacement et une quantité explicites.
> Préparation sans réservation, revue fraîche, compte rendu et confirmation humaine
> avec droits distincts. Stock, soldes et preuve atomiques; le reste du lot conserve
> sa quarantaine. Dossiers clos immuables, replay exact tenant/acteur/clé/corps et reprise
> navigateur après coupure/refus intermédiaire. Fournisseur partagé et capturé depuis WMS,
> sans activation Achats; modification du fournisseur avant sortie bloquante.
> Aucun avoir, remboursement, email, transport ni nouveau pouvoir IA automatique.
> UI Pulsar conservée; documentation intégrée, aide de page et tutoriel WMS huit étapes
> adaptés sans reset de progression ni nouveau bouton. [Contrat I2i](./plans/wms-stock-exits.md).
> Vérifications : **260 HTTP sur 14 suites**, **978 Shared, 691 API, 156 Web**,
> **43 scénarios Chromium** réussis. Svelte zéro erreur, douze warnings préexistants.
> Captures bureau/mobile inspectées après stabilisation du panneau, aucun débordement à
> 390 px; scénario de destruction/reprise rejoué une dernière fois avec succès.
> Builds Shared/Database/API/Web réussis. Migration additive **127** appliquée uniquement
> à `pulsar_enduser_20260921`; `.env` intact. API isolée sur 3100 (PID 37088), Vite sur 5173.
> Aucun push, PR ou déploiement. Pour OVH : migration puis bootstrap des catalogues,
> attribuer les nouveaux droits aux responsables; jamais de seed démo sur le VPS.
> **Suite recommandée** : justificatifs et rapprochement explicite retour ↔ ligne d’achat,
> suivi de réception fournisseur puis avoir fournisseur séparé du stock. Quarantaine
> partielle, séries, rappel réglementaire et allocation par pièce restent distincts.

> **Traçabilité des lots I2h, 2026-09-25**, branche locale `codex/pilot-business-depth`.
> WMS → Articles → Lots → Traçabilité du lot : parcours amont/aval par niveaux,
> preuves de liens atelier et dossiers directs du lot sélectionné. Fabrication,
> Services et Transport ne dévoilent leurs informations qu’avec module et droits.
> Preuves v2 vérifiées contre le journal, chronologie des mouvements et convergence
> des chemins; contrepassations exclues, versions anciennes et bornes signalées.
> Réceptions/préparations paginées, usages Services avec retours/net et unité capturée;
> seul le shipment explicitement lié est proposé, jamais assimilé à une livraison.
> WMS reste autonome. Aucune allocation par pièce, propagation de blocage, mutation
> de stock, migration/backfill ou nouveau pouvoir IA. Ce n’est pas un rappel réglementaire.
> UI Pulsar conservée, états vide/erreur/périmètre partiel, documentation et tutoriels
> WMS/Fabrication adaptés sans reset de progression ni ajout de bouton tutoriel.
> [Contrat et recette I2h](./plans/wms-lot-traceability.md).
> Vérifications : **253 HTTP sur 14 suites**, **977 tests Shared, 691 API, 153 Web**,
> **41 scénarios Chromium** réussis. Captures bureau/mobile inspectées; aucun débordement
> à 390 px. Svelte : zéro erreur et douze avertissements préexistants dans cinq fichiers.
> Builds Shared/API/Web réussis, vérification des espaces Git propre.
> Base de test `pulsar_enduser_20260921` seulement; `.env` intact. API isolée sur 3100
> (PID 79960), Vite sur 5173. Aucun push, PR ou déploiement.
> **Suite recommandée** : workflow explicite de disposition du stock bloqué — destruction/
> rebut documenté puis retours fournisseur — sans libération artificielle pour contourner
> la quarantaine. Quarantaine partielle, allocation unitaire et rappel restent distincts.

> **Qualité ↔ lots I2g, 2026-09-25**, branche locale `codex/pilot-business-depth`.
> WMS → Articles → Lots : inspections propres au lot, préparation guidée dans Qualité et
> préparations WMS ouvertes à revoir. Retour exact au lot depuis le contrôle, même hors page 1.
> Source fixée avant exécution; identité, révision de disposition et mouvements capturés.
> Tout mouvement ou nouvelle décision rend le contrôle périmé pour une nouvelle clôture/libération.
> Libération humaine pouvant citer un PASS terminé du même lot, preuve figée dans la décision;
> droits/modules/version/contexte revérifiés. WMS seul conserve le compte rendu manuel.
> Aucun stock modifié par Qualité, aucune libération automatique, nouveau pouvoir IA ou rappel aval.
> Panneaux Pulsar conservés, historique maintenu lors du rafraîchissement, reprise exacte après
> coupure/refus intermédiaire; documentation et tutoriels spécifiques sans reset des utilisateurs.
> [Contrat, limites et recette I2g](./plans/quality-lot-controls.md).
> Migration additive **126** appliquée uniquement à `pulsar_enduser_20260921`, `.env` intact.
> Vérifications : **249 HTTP sur quatorze suites, 687 unitaires API et 152 Web** réussis.
> **49 HTTP ciblés rejoués** après le dernier garde d’ownership; **40 scénarios Chromium réussis**,
> dont tutoriel Qualité première visite par utilisateur, parcours contrôle → preuve → libération,
> reprise réelle et affichage bureau/mobile inspecté, sans débordement à 390 px.
> Svelte : zéro erreur, douze warnings préexistants. Builds Database/API/Web réussis.
> API isolée sur 3100, Vite sur 5173. Aucun push, PR ou déploiement.
> **Suite recommandée** : généalogie aval transitive et dossiers déjà servis, sans déduire une
> allocation par pièce; ensuite workflows distincts destruction/rebut, retours fournisseur et
> quarantaine partielle. Ne pas libérer artificiellement un lot pour simuler ces opérations.

> **WMS — quarantaine des lots I2f, 2026-09-25**, branche locale `codex/pilot-business-depth`.
> Articles → Lots : blocage manuel du lot entier avec motif, révision et historique durable.
> WMS seul suffit; aucun couplage obligatoire à Qualité. Libération documentée avec droit
> distinct `wms.lots.release`; absence de blocage ne signifie pas certification qualité.
> Writer central : sorties WMS, pièces Services, consommations atelier et ajustements négatifs
> bloqués (comptages/contrepassations compris). Entrées/retours et MOVE conservent le blocage.
> MRP, impacts matières et APS matières excluent les quantités bloquées au site; preuve MRP
> et revue APS actualisées sans réécrire l’historique. Aucun stock modifié par la décision.
> Reprise navigateur exacte après coupure/refus intermédiaire, droits/version/tenant gardés,
> panneau Pulsar conservé, documentation des connexions et tutoriel WMS sept étapes sans reset.
> [Contrat, limites et recette I2f](./plans/wms-lot-quarantine.md).
> Migration additive **125** appliquée uniquement à `pulsar_enduser_20260921`, `.env` intact.
> Vérifications : **235 HTTP sur treize suites, 687 unitaires API, 966 Shared et 150 Web** réussis.
> **37 scénarios Chromium réussis**, dont réponse perdue/reprise de quarantaine, libération,
> droits distincts et tutoriel première visite. Captures bureau/mobile inspectées sans débordement.
> Svelte : zéro erreur, douze warnings préexistants. Builds Shared/Database/API/Web réussis.
> API isolée sur 3100, Vite sur 5173. Aucun push, PR ou déploiement.
> **Suite recommandée** : liaison explicite inspections Qualité ↔ décisions de lot puis revue
> des dossiers affectés/généalogie transitive. Quarantaine partielle, destruction/rebut et
> retours fournisseur doivent avoir leurs workflows propres; ne pas libérer pour les simuler.

> **Fabrication — corrections compensatoires I2e, 2026-09-25**, branche locale `codex/pilot-business-depth`.
> Contrepassation complète d’une déclaration v2 sur OF en cours : revue des effets, motif,
> attestation de situation physique, retrait du produit puis restitution des matières aux
> mêmes lots/bins. Original inchangé, nouvelle preuve et mouvements ADJUSTMENT atomiques.
> Stock insuffisant, version/revue périmée, preuve incompatible ou OF terminé ⇒ refus.
> Compteurs/clôture OF et impacts matières nets; MRP capture la correction sans réécriture
> historique ni double stock. APS global et annulation OF restent bloqués par tout historique.
> Reprise conservée avant envoi, même après reload/refus intermédiaire; journal lié à l’OF avec
> droits Fabrication. Panneau Pulsar conservé, documentation des connexions et tutoriel six étapes,
> sans reset des utilisateurs existants. Aucun nouveau pouvoir IA.
> [Contrat, limites et recette I2e](./plans/manufacturing-reversals.md).
> Migration additive **124** appliquée uniquement à `pulsar_enduser_20260921`, `.env` intact.
> Vérifications : **230 HTTP sur treize suites, 686 unitaires API, 148 Web et
> 35 scénarios Chromium distincts** réussis. 64 HTTP ciblés rejoués après durcissement.
> Captures bureau/mobile inspectées; aucun débordement à 390 px. Svelte : zéro erreur,
> douze warnings préexistants.
> Builds Database/API/Web réussis, SPA statique générée; `git diff --check` propre.
> API de test locale sur 3100, Vite sur 5173. Aucun push, PR ou déploiement.
> **Suite recommandée** : qualifier qualité/quarantaine et généalogie transitive; corrections
> partielles, chaîne aval et OF terminés restent des workflows distincts à spécifier.

> **Fabrication — lots atelier et généalogie directe I2d, 2026-09-25**, branche locale `codex/pilot-business-depth`.
> Atelier et stock réel répartit un composant sur plusieurs lots/bins et capture le lot des
> bons produits. Rebut sans stock, zéro sans lot, disponibilité propre à chaque lot, rollback
> complet. Preuve v2 figée matières → produit, limitée à la déclaration : aucune allocation
> par pièce ni attribution automatique de consommations antérieures. Preuves v1 inchangées.
> Journal WMS → OF seulement avec Fabrication activée + manufacturing.read. Fabrication/WMS
> suffisent, aucun module commercial imposé. MRP/APS et pouvoirs IA inchangés.
> Reprise navigateur liée à la même clé et aux mêmes lots, même après refus intermédiaire.
> Panneau Pulsar conservé, preuve responsive, dates d’événements au fuseau utilisateur,
> documentation des connexions et cinq étapes Fabrication spécifiques (première visite seulement).
> [Contrat, limites et recette I2d](./plans/manufacturing-lots.md).
> Aucun nouveau schéma/migration ni backfill : preuve JSON et FK lots des mouvements existantes.
> Base isolée `pulsar_enduser_20260921` uniquement; `.env` intact; aucun push, PR ou déploiement.
> **226 tests HTTP sur treize suites, 686 unitaires API, 964 Shared et 146 Web** réussis.
> **33 scénarios Chromium distincts** réussis, dont production multi-lots réelle et reprise
> exacte après réponse perdue puis refus intermédiaire; tutoriel première visite et régressions
> sans lot. Deux scénarios Fabrication rejoués après la dernière finition de libellé.
> Captures bureau/mobile inspectées, aucun débordement à 390 px. Svelte : zéro erreur,
> douze warnings préexistants. Builds Shared/API/Web réussis, SPA statique générée;
> `git diff --check` propre. API de test sur 3100, Vite existant sur 5173.
> **Suite recommandée** : corrections compensatoires gouvernées de déclarations atelier,
> puis qualité/quarantaine et généalogie transitive à qualifier séparément. I1/I3–I5 restent ouverts.

> **Services — lots des pièces I2c, 2026-09-25**, branche locale `codex/pilot-business-depth`.
> Pièces et stock choisit explicitement le lot disponible dans l’emplacement, affiche son unité
> et capture numéro/lot fournisseur/dates sur la sortie. Un retour partiel conserve le lot et
> le bin d’origine, même si la correspondance produit a changé. Quantités, avoirs et droits
> restent contrôlés; registre, consommation et soldes total/lot atomiques. Aucun stock implicite.
> Services + WMS suffisent, sans Catalogue/Achats. L’histoire figée reste consultable avec
> `services.read` même sans WMS; reprise après coupure conserve la clé et le lot exacts,
> y compris après un refus intermédiaire. Aucun backfill ni nouveau pouvoir d’agent.
> UI Pulsar conservée; documentation embarquée, liens entre modules et sept étapes Services
> spécifiques, présentées seulement à la première visite par utilisateur.
> [Contrat, migration et limites I2c](./plans/services-part-lots.md).
> Migration additive **123** appliquée uniquement à `pulsar_enduser_20260921`; `.env` intact,
> aucun push/PR/déploiement. **224 tests HTTP sur treize suites, 686 unitaires API,
> 964 Shared et 142 Web** réussis. **22 scénarios Chromium distincts** passent, dont
> première visite Services, reprise après réponse perdue/refus intermédiaire, retours/avoirs
> et régressions sans lot. Captures desktop/mobile inspectées; aucun débordement à 390 px.
> Svelte : zéro erreur, douze warnings préexistants. Builds Database/API/Web réussis,
> SPA statique générée, `git diff --check` propre. API de test locale sur 3100, Vite existant sur 5173.
> **Suite I2d** : déclarations atelier avec lots matières/produits finis et généalogie entrée/sortie.
> FEFO, quarantaine, séries et autres approfondissements I1/I3–I5 restent des lots distincts.

> **WMS — comptages par lot et ajustements durables I2b, 2026-09-25**, branche locale `codex/pilot-business-depth`.
> Comptage par article/lot avec unité capturée et zéro explicite. Scan ambigu ⇒ choix du lot,
> jamais incrément arbitraire. Enregistrement sans stock, réconciliation atomique et auditable.
> Tout mouvement du bin invalide l’instantané, même net zéro : annuler/recompter, aucun recalage
> implicite. Anciens dossiers sans capture sécurisée consultables/annulables, non réconciliables.
> Ajustement manuel avec clé liée à l’acteur/corps/lot; reprise navigateur après coupure ou
> rechargement sans double stock. Les clients historiques sans clé restent non dédoublonnés.
> UI Pulsar conservée, fiches de comptage sur téléphone, actions bloquées pendant relecture;
> aide de page, documentation embarquée et six étapes WMS spécifiques (première visite uniquement).
> [Contrat I2b et limites](./plans/wms-lot-counts.md).
> Migration additive **122** appliquée seulement à `pulsar_enduser_20260921`, sans backfill;
> `.env` intact, aucun push/PR/déploiement. Vérification API : **686 unitaires + 185 HTTP sur
> douze suites** réussis; Web : **140 unitaires**, zéro erreur Svelte / douze warnings préexistants.
> **964 Shared + 56 scénarios Chromium distincts** réussis (reruns ciblés inclus), captures
> desktop/mobile inspectées. Les fixtures de scan ont été alignées sur les six étapes métier
> et le format paginé des articles; aucun contrôle de stock n’a été retiré pour faire passer les tests.
> Builds Database/API/Web réussis, SPA adapter-static générée. API locale de test relancée sur 3100.
> **Suite I2c** : choix/capture des lots dans consommations et retours Services, puis atelier
> avec généalogie entrée/sortie. Aucun FEFO/quarantaine/série ajouté; MRP continue à lire le
> total physique sans allocation des lots. I1 restant et I3–I5 toujours ouverts.

> **WMS/Achats — suivi par lot I2a, 2026-09-25**, branche locale `codex/pilot-business-depth`.
> Nouveaux articles : choix explicite et définitif du suivi par lot. Registre d’identités et
> dates civiles déclarées, sans stock créé ni réinterprétation des articles existants.
> Réception WMS/Achats, rangement, préparation et ajustement portent le lot choisi. Solde
> par lot/emplacement, total Inventaire et journal atomiques, sorties concurrentes protégées.
> Reprise de MOVE/réception fournisseur conserve le lot exact; les replays historiques sans lot restent compatibles.
> UI Pulsar conservée, sélecteurs filtrés, journal ciblé, documentation et tutoriel WMS
> spécialisés (première visite par utilisateur, sans réinitialiser les tutoriels déjà vus).
> [Contrats, parcours et limites I2a](./plans/wms-lots.md).
> Recette : **964 Shared, 686 API unitaires, 136 Web, 172 HTTP distincts sur onze suites,
> 46 scénarios Chromium distincts** réussis. Contrôles desktop/mobile, droits, isolation,
> WMS seul, concurrence, stock par lot et réponse perdue. Builds Shared/Database/API/Web
> réussis; zéro erreur Svelte, douze avertissements préexistants. Migration additive **121**
> appliquée seulement à `pulsar_enduser_20260921`. `.env` intact; aucun push/PR/déploiement.
> **Limites importantes** : péremption informative, aucune FEFO/quarantaine/réservation/série.
> Comptage agrégé, consommation/retour Services et déclaration atelier sans choix de lot
> refusent les articles suivis. MRP lit le total physique sans allocation ni exclusion des périmés.
> **Suite I2b** : comptage par lot et ajustements à reprise durable, puis allocation explicite
> Services/atelier et généalogie. I1 restant et I3–I5 non clôturés par cette livraison.

> **Catalogue/Achats — conditionnements I1b, 2026-09-24**, même branche locale.
> Produits : plusieurs formats à contenu fixe, code-barres propre, activation et libellé versionnés.
> Choix humain du format/nombre sur commande : 2 cartons × 12 EA = 24 EA; prix et minima restent
> dans l’unité de base. Copie serveur revalidée à confirmation puis figée, sans backfill.
> Réception en colis ou unités de base, calcul exact sans arrondi, preuve du nombre reçu.
> Scan limité aux copies de la commande avec reliquat : sélection seulement, jamais stock automatique.
> Writers WMS et reprise idempotente existants conservés; Achats reste autonome sans Catalogue.
> UI Pulsar, documentation intégrée et tutoriels spécifiques enrichis sans réinitialisation.
> [Contrats et limites I1b](./plans/catalog-packaging.md).
> Recette : **964 Shared, 686 API unitaires, 133 Web, 109 HTTP distincts sur cinq suites,
> 6 parcours Chromium distincts** réussis. Captures desktop/mobile inspectées; zéro erreur Svelte,
> douze avertissements préexistants. Migration additive **120** appliquée à la seule base
> `pulsar_enduser_20260921`; `.env` intact, aucun push/PR/déploiement. API test 3100, Web 5173.
> Builds Shared/Database/API/Web et `git diff --check` réussis.
> **Suite recommandée I2 : exécution WMS**, qualifier lots/séries/péremption dans chaque mouvement
> avant FEFO ou réservation. Tarifs multiples/paliers, imports et notices I1 restent ouverts;
> I2–I5 ne sont pas livrés par ce lot. Aucune certification de lecteur physique ni GS1 composé.

> **Catalogue et Achats — I1a, 2026-09-24**, même branche locale.
> Fiche article privée : 15 informations produit (fabricant, modèle, dimensions, emballage,
> consignes…) ou 7 informations prestation (périmètre, livrables, exclusions…). Accessible
> depuis Catalogue et Données Services/Achats, sans activation croisée obligatoire.
> Références fournisseur versionnées : prix exact, devise, minimum, multiple, délai indicatif,
> validité UTC, conditionnement et consignes. Choix humain sur la ligne de commande; contrôles
> à l’enregistrement et à confirmation. Copies engagées conservées, aucune conversion implicite,
> aucun stock/email/achat MRP créé. Les commandes manuelles historiques restent compatibles.
> Sections et composants Pulsar conservés, documentation intégrée et tutoriels adaptés.
> [Contrats, API et limites](./plans/catalog-purchasing-depth.md).
> Recette : **955 Shared, 686 API unitaires, 132 Web, 93 HTTP distincts sur quatre suites et
> 5 parcours Chromium** réussis. Captures desktop/mobile inspectées; zéro erreur Svelte,
> douze avertissements préexistants. Builds Shared/Database/API/Web et diff-check réussis.
> Migration additive **119** appliquée seulement à `pulsar_enduser_20260921`; `.env` inchangé,
> aucun push/PR/déploiement. API locale de test sur 3100, web sur 5173.
> **Suite I1b** : conditionnements/codes-barres structurés et ratios achat/stock explicitement
> capturés jusqu’aux réceptions. Tarifs multiples/paliers et approbations restent à qualifier.
> Les lots I2–I5 (autres modules) restent ouverts : I1a ne clôt pas la demande globale.

> **Identités et profondeur des informations — E1b.8, 2026-09-24**, même branche locale.
> Fiche entreprise privée et versionnée sur Customer/BusinessPartner/CrmCompany : 15 champs
> descriptifs et jusqu’à 20 renseignements nommés, utilisables dans les modules consommateurs
> sans imposer Clients ou Catalogue. Panneau Pulsar groupé, saisie mobile et reprise après erreur.
> Rapprochement explicite depuis le partenaire : recherche autorisée, revue sans écriture,
> confirmation avec motif et versions recontrôlées; lecture inverse depuis Client/CRM.
> Aucun carnet fusionné, droit hérité, document réécrit ou règle métier déduite du texte.
> Writers CRM sérialisés : refus des liens contradictoires, conversions concurrentes sans
> duplication et provenance des anciens deals convertis préservée.
> [Contrats et matrice de tous les modules](./plans/enterprise-information-depth.md).
> **La demande d’enrichissement de chaque module reste ouverte** : ce lot livre les fiches
> entreprise et rapprochements, pas les champs opérationnels de Fabrication/WMS/RH/etc.
> Suite : Catalogue/Achats (articles, emballages, références fournisseurs et unités explicites),
> puis lots I2–I5 du plan. Documentation intégrée de neuf espaces et tutoriels enrichis.
> Recette : 945 tests Shared, 686 API unitaires, 131 Web, 161 HTTP distincts sur huit suites;
> cinq parcours Chromium, captures desktop/mobile inspectées. Builds Shared/Database/API/Web
> réussis; zéro erreur Svelte et douze avertissements préexistants. Migration 118 additive
> sur `pulsar_enduser_20260921` seulement; `.env` intact, aucun push, PR, SMTP réel ou déploiement.

> **Audit enterprise — documents liés au carnet E1b.7, 2026-09-24**, même branche locale.
> Depuis une adresse/contact, lecture des usages explicites dans les devis Services,
> factures clients et commandes Transport, CRM ou fournisseurs. Brouillons à vérifier
> séparés des copies engagées historiques; versions et rôles visibles, ouverture du bon
> dossier dans un nouvel onglet. Aucune propagation ni modification des documents.
> Modules/droits filtrés avant les requêtes, y compris les compteurs; aucun rapprochement
> implicite d’identités. [Contrats et limites](./plans/directory-document-impact.md).
> Panneau et composants Pulsar conservés, états erreur/reprise/vide; documentation intégrée
> et tutoriels métier de six modules enrichis sans réinitialiser leur progression.
> 940 tests Shared, 686 unitaires API, 130 Web et 115 HTTP sur cinq suites réussis;
> sept parcours Chromium, captures desktop/mobile inspectées. Builds Shared/API/Web réussis;
> zéro erreur Svelte, douze avertissements préexistants. Aucune nouvelle migration (117 présentes),
> base isolée `pulsar_enduser_20260921`; `.env` intact, aucun push, PR, SMTP réel ou déploiement.
> **Prochain lot : rapprochement humain des identités Customer/BusinessPartner/CrmCompany**,
> après inspection des liens existants, sans fusion automatique, droits hérités ou réécriture historique.
> Les rôles transactionnels, sorties commerciales restantes et qualification enterprise restent ouverts.

> **Audit enterprise — commandes fournisseurs E1b.6, 2026-09-24**, même branche locale.
> Adresse et interlocuteur choisis dans le carnet du fournisseur, gel atomique à confirmation,
> versions/identité/validité recontrôlées. Achats seul suffit; aucun Catalogue, client ou WMS imposé.
> Destination de réception distincte : jamais choisie dans le carnet du fournisseur. L’historique
> reste intact après changement du carnet, clôture, annulation ou arrivages partiels WMS.
> [Contrats et limites](./plans/supplier-order-coordinates.md). UI Pulsar conservée, reprise après
> réponses perdues, documentation intégrée et tutoriel Achats en sept étapes sans réinitialisation.
> 936 tests Shared, 686 unitaires API, 129 Web et 104 HTTP sur quatre suites réussis;
> quatre parcours Chromium (Achats et régression CRM), captures desktop/mobile inspectées. Builds Shared/Database/API/Web
> réussis; zéro erreur Svelte, douze avertissements préexistants. Migration 117 sur la seule
> base isolée `pulsar_enduser_20260921`; `.env` intact, aucun push, PR, SMTP réel ou déploiement.
> **Prochain lot : revue de l’impact des modifications du carnet sur les documents ouverts**,
> avec droits de chaque consommateur et aucune réécriture automatique des copies engagées.
> Les identités transactionnelles, PDF commerciaux restants et qualification enterprise restent ouverts.

> **Audit enterprise — commandes CRM E1b.5, 2026-09-24**, même branche locale.
> Carnet versionné propre à la société CRM, sans fiche Customer imposée ni module externe.
> Choix des adresses/contact au brouillon et gel atomique à confirmation; identité/validité/
> versions recontrôlées sous verrou commun, modifications concurrentes refusées. Devise
> protégée après engagement et sans conversion implicite des lignes. Aucun backfill ou
> transfert automatique vers Transport, Facturation, MRP ou portail.
> [Contrats, recette et limites](./plans/crm-order-coordinates.md). Documentation intégrée et
> tutoriel CRM en six étapes, sans réinitialisation des utilisateurs. Interface Pulsar conservée;
> reprise après réponses perdues testée, captures desktop/mobile inspectées.
> 935 tests Shared, 686 unitaires API, 129 Web; 131 HTTP distincts sur cinq suites, dont
> les ponts Transport/MRP, et deux parcours Chromium finaux. Builds Shared/Database/API/Web
> réussis; zéro erreur Svelte, douze avertissements préexistants. Migration 116 sur la seule
> base isolée `pulsar_enduser_20260921`; `.env` intact, aucun push, PR, SMTP réel ou déploiement.
> **Prochain lot : coordonnées et engagement des commandes fournisseurs**. Les PDF commerciaux,
> avenants, quatre identités transactionnelles et la qualification complète de l’audit restent ouverts.

> **Audit enterprise — PDF/remise des factures clients E1b.4, 2026-09-24**, même branche locale.
> Publication explicite d’un PDF canonique depuis les montants approuvés et les coordonnées
> revues, provenance, empreinte et reprise de stockage. Envoi confirmé avec destinataire/canal,
> dédoublonné et sans retry ambigu; portail du client concerné servi depuis le même fichier vérifié.
> Les raccourcis d’envoi client implicites/automatiques sont fermés; ancien historique d’envoi
> impose une revue opérateur. Simulation/file ne marquent pas la facture SENT; encaissement
> indépendant possible sur APPROVED via le workflow Paiements existant.
> [Contrats, compatibilité et déploiement](./plans/customer-invoice-documents.md).
> Documentation intégrée et tutoriel Facturation enrichis; UI Pulsar conservée, PDF et captures
> desktop/mobile inspectés. 686 unitaires API, 129 Web, tests Shared réussis, 134 HTTP distincts
> sur sept suites (rejeux ciblés inclus), trois parcours navigateur finaux. Builds Shared/Database/
> API/Web réussis; zéro erreur Svelte et douze avertissements préexistants.
> Migration 115 appliquée seulement à `pulsar_enduser_20260921`; aucun changement `.env`,
> SMTP réel, push, PR ou déploiement. Prochain lot : coordonnées/engagement des commandes CRM,
> puis fournisseurs; les rôles transactionnels et le reste de l’audit restent ouverts.

> **Audit enterprise — coordonnées du PDF d’avoir E1b.3, 2026-09-24**, même branche locale.
> L’opérateur peut reprendre explicitement l’identité/adresse figées sur la facture d’origine;
> version, date et provenance visibles, empreinte recontrôlée au gel. Une saisie alternative
> demande un motif lorsqu’une copie existe. Le courriel capturé reste une suggestion séparée,
> à vérifier et confirmer; aucune note privée ni adresse de livraison n’est imprimée.
> Facturation seule suffit. Reprise de publication après panne, PDF canonique et envoi
> dédoublonné préservés. Aucun changement comptable/fiscal, BOL, portail ou pouvoir IA.
> [Contrats et suite](./plans/credit-document-coordinates.md). Restent notamment le PDF/envoi
> de la facture elle-même, les commandes CRM/fournisseurs et les rôles transactionnels.
> Documentation intégrée et tutoriel Facturation enrichis sans réinitialiser les utilisateurs.
> Recette : 674 tests unitaires API (10 ciblés rejoués), 129 Web, 64 HTTP, deux parcours
> navigateur; PDF téléchargé et écrans desktop/mobile inspectés. Builds API/Web réussis;
> zéro erreur Svelte, douze avertissements préexistants. Aucune migration, modification `.env`,
> remise SMTP, push, PR ou déploiement; base isolée `pulsar_enduser_20260921` seulement.

> **Audit enterprise — commandes Transport E1b.2, 2026-09-24**, même branche locale.
> Coordonnées du carnet choisies sur le brouillon et figées atomiquement à la confirmation;
> version revue obligatoire pour une commande capturée, contrôle du client et des droits.
> Aucun module Clients/Facturation imposé. Édition/confirmation sérialisées et planification
> atomique : toutes les expéditions ou aucune; double planification concurrente refusée.
> Origine/destination, BOL chauffeur, emails et accès portail ne reçoivent aucune copie implicite.
> UI Pulsar conservée, grille mobile corrigée et contrôle navigateur renforcé. Tutoriel Transport
> spécifique à la première ouverture seulement; documentation intégrée mise à jour.
> [Contrats et suite](./plans/transport-order-coordinates.md). Restent commandes CRM/fournisseurs,
> PDF/envois explicitement revus et quatre identités transactionnelles; l'audit complet reste ouvert.
> Migration 114 appliquée uniquement à `pulsar_enduser_20260921`, `.env` inchangé.
> Recette : 666 tests unitaires API, 129 Web, 85 HTTP (dont autonomie 48 rejoués avec contrôles
> supplémentaires), quatre parcours navigateur finaux. Builds Database/API/Web réussis;
> zéro erreur Svelte, douze avertissements préexistants. Aucun push, PR ou déploiement.

> **Audit enterprise — coordonnées des documents E1b.1, 2026-09-24**, même branche.
> Devis Services et factures clients : choix explicite d’adresses/contact du carnet,
> contrôle des versions, validité et identité, copie figée atomiquement à l’acceptation/
> approbation. Aucun module Clients/Catalogue/Transport requis par ces deux consommateurs.
> La facture capturée exige une version revue à l’approbation. L’UI bloque l’approbation
> pendant la sauvegarde et impose une relecture après réponse incertaine. Anciennes données,
> destinataires, PDF, taxes, lieux et accès portail inchangés. Les commandes et quatre
> identités transactionnelles restent la suite. [Contrats et limites](./plans/document-coordinates.md).
> Documentation intégrée et tutoriels Services/Facturation actualisés. Migration 113 sur
> `pulsar_enduser_20260921` uniquement; aucune migration utilisateur, push, PR ni déploiement.
> Recette : 935 tests partagés, 666 API, 129 Web, 95 HTTP et cinq parcours navigateur;
> builds réussis, zéro erreur Svelte, douze avertissements préexistants.

> **Audit enterprise — carnet partagé E1a, 2026-09-24**, `codex/pilot-business-depth`.
> Les 271 fiches du rapport V2–V4 sont conservées et indexées, pas annoncées comme 271
> défauts prouvés ni fonctionnalités livrées. [Programme et limites](./plans/enterprise-audit-program.md),
> [registre des exigences](./audits/README.md). Premier incrément : carnet multi-adresses/contacts
> versionné, dates de validité descriptives, motif et historique, reprise manuelle après
> réponse incertaine et protection contre les modifications concurrentes. Accessible depuis
> Clients, Transport et les espaces Données consommateurs avec leurs propres droits/modules.
> Aucun accès portail accordé, aucune ancienne adresse ou transaction réécrite; CL01/03/07
> restent partiels. Prochain incrément : sélection/capture de versions dans les documents,
> puis rôles transactionnels et rapprochement explicite des identités. UI Pulsar conservée,
> documentation et tutoriel Clients mis à jour sans réinitialiser les tutoriels déjà vus.
> Migration 112 appliquée uniquement à `pulsar_enduser_20260921`; `.env` et base utilisateur
> inchangés. Recette : 929 tests partagés, 666 API, 129 Web, 93 HTTP et huit parcours navigateur.
> Builds réussis, zéro erreur Svelte et douze avertissements préexistants. Aucun push ni déploiement.

> **Profondeur métier — Clients, fuseaux et tableaux, 2026-09-23**, même branche locale.
> Nouveau module Clients facultatif, deux registres historiques sans fusion, adresses structurées
> facturation/livraison séparées et version sur le nouvel éditeur. Préférence de fuseau par
> utilisateur, bandeau permanent du shell métier, helpers/journaux adaptés; dates civiles préservées.
> Colonnes masquables/redimensionnables dans Clients et les espaces Données, par utilisateur/appareil.
> Tutoriel Clients spécifique et documentation intégrée. Migrations 110/111 appliquées seulement à
> `pulsar_enduser_20260921`; `.env` et base utilisateur inchangés. Pas d’ISAAC actif, import cargo,
> remanifeste douanier ou moteur fiscal transfrontalier annoncé comme livré.
> [Contrats, limites, recherches et prochains lots](./plans/business-depth-clients-time-zones.md).
> Reste notamment la migration des saisies date/heure (anciens champs = fuseau appareil),
> le carnet multi-adresses et la convergence explicite des identités. Aucun push ni déploiement.
> Recette : 913 tests partagés, 666 tests API, 127 tests Web, 80 tests HTTP et cinq parcours
> navigateur réussis. Builds validés; zéro erreur Svelte, douze avertissements préexistants.

> **Autonomie des modules — référentiels, 2026-09-23**, `codex/pilot-business-depth`.
> Espaces Données dans Flotte, Cour, Achats transport, Facturation, Portail client,
> Services, SAV et Achats fournisseurs; création intégrée aux sélecteurs. Façades avec
> droits du consommateur, mêmes tables/writers, aucune activation Catalogue/TMS nécessaire.
> Liens Services→Facturation et Services/Achats→WMS utilisables sans Catalogue; vrais
> droits/modules cibles conservés. [Contrats et limites](./plans/module-autonomy.md).
> Recette : 26 tests d’autonomie, 77 HTTP au total, 3 parcours navigateur, tests unitaires
> et builds réussis; zéro erreur Svelte, 12 avertissements préexistants.
> Aucun changement de schéma, PR ni déploiement. Validation sur base isolée uniquement.

> **Avoirs clients — PDF et remise explicite, 2026-09-23**, `codex/pilot-business-depth`.
> Identités et document figés, fichier protégé avec empreinte vérifiée, permission
> d’envoi distincte, simulation séparée du SMTP et aucune répétition automatique
> après une remise incertaine. Facture, GL et stock inchangés par la publication.
> Migration 109 sur la base isolée seulement; 75 scénarios HTTP distincts et le parcours navigateur
> PDF/réponse perdue/simulation réussis. Documentation et tutoriel mis à jour.
> [Contrats et limites](./plans/customer-credit-documents.md). Aucun envoi réel, push ou déploiement.

> **Pilote métier fiable — avoirs clients internes, 2026-09-23**, `codex/pilot-business-depth`.
> Brouillon/validation/annulation, taxes figées et arrondis cumulés, écriture compensatoire
> atomique, soldes de paiement/portail/créances ajustés. Retour physique Services autorisé
> par une ligne d’avoir validée, jamais automatique. La facture originale reste intacte.
> Migration 108 testée sur la base isolée seulement; 908 tests partagés, 648 unitaires API,
> 73 HTTP et parcours navigateur ordinateur/mobile réussis. Pas encore de PDF fiscal
> d’avoir, d’envoi client, remboursement ou transfert. Documentation et tutoriel actualisés.
> [Contrats, recette et suite](./plans/customer-credit-notes.md). Aucun push ni déploiement.

> **Pilote métier fiable — retours partiels Services, 2026-09-22**, même branche.
> Journal de retours compensatoires vers le WMS; affichage sorties/retournées/conservées,
> motifs et mouvements. La facturation relit la quantité nette et refuse une sélection
> antérieure à un retour. Brouillons corrigibles par suppression/recréation explicite;
> factures validées toujours figées, vrais avoirs restant à construire. Documentation
> intégrée et contenu du tutoriel Services actualisés, sans réinitialiser la progression.
> Migration additive testée sur `pulsar_enduser_20260921` uniquement : 17 retours historiques
> préservés, aucun mouvement de stock supplémentaire. `.env` et base utilisateur inchangés.
> [Contrats, parcours et limites](./plans/services-partial-returns.md).

> **Pilote métier fiable — premier lot, 2026-09-22**, branche `codex/pilot-business-depth`.
> Le programme demandé comprend cinq axes; seul son socle de pilote est implémenté
> dans ce lot : transport webhook/EDI gardé au moment de la connexion, droits de
> réactivation et version serveur, suspension des livraisons désactivées et exercice
> Docker de restauration base/documents dans un second projet isolé. Documentation
> intégrée Connect/Réglages et runbook OVH actualisés. Pas de migration, de déploiement
> VPS, de push ni de nouvelle PR. Parcours métier, dossiers client, IA et Location
> restent les lots suivants, sans changement de disponibilité des modules.
> [Programme, contrats et preuves](./plans/pilot-business-depth.md).

> **Exploitation connectée — 2026-09-22, `codex/end-user-workflows`.** Les quatre
> chantiers sont implémentés : Mon travail multi-métiers, planning Services/RH,
> devis/projet/travaux vers facture brouillon et coordinateur AI gouverné. Les lots
> locaux précédents sont conservés; main et ses protections MRP sont intégrés.
> Documentation, connexions et tutoriel Services actualisés sans changer le bureau
> d'apps ni le design Pulsar. Une seule PR est préparée; aucune fusion ou action OVH.
> [Contrats et vérifications](./plans/connected-business-delivery.md) ·
> [recette serveur](./plans/connected-business-server-acceptance.md).

Les comptes rendus ci-dessous sont historiques : leurs mentions « aucun commit/PR »
et limites fonctionnelles décrivent leur lot d'origine, pas cette livraison consolidée.

> **Compétences/habilitations, suivi SAV/Achats et tutoriels métier v2 (2026-09-22), branche `codex/end-user-workflows`.**
> RH : référentiel de compétences/autorisations, attestations datées immuables, renouvellement
> par nouvelle ligne, révocation motivée et reprise idempotente. Pas d’auto-attestation.
> Fabrication : exigences par poste (30 maximum), vérification minimale à une date, droits
> dédiés; aucune référence/motif RH exposé, aucune affectation ni disponibilité calculée.
> SAV : responsable interne, échéance et files personnelles/non attribuées/en retard.
> Achats : files serveur des brouillons, arrivages confirmés, retards, clôtures et annulations.
> Tutoriels RH/Qualité/SAV/Achats propres au métier, longueur variable, pratique/reprise,
> première présentation automatique par utilisateur/module, sans bouton « Tutoriel métier ».
> La version 2 ne relance pas les parcours déjà vus; la relance volontaire reste dans l’aide.
> Les tests ne terminent plus les guides du compte de démonstration.
> Documentation intégrée, aides et connexion RH/Fabrication actualisées, UI Pulsar conservée.
> **1 522 tests unitaires** (875 shared, 529 API, 118 web), **69 tests HTTP ciblés** (5 suites),
> **61 scénarios navigateur réussis** (7 suites, dont nouveaux parcours et mobile).
> Compilation shared/database/API/web et typechecks réussis (12 avertissements web préexistants).
> Schéma/migrations sans divergence; migration additive 96 uniquement sur la base isolée
> `pulsar_enduser_20260921`. `.env` et base client inchangés; API :3100, web :5173.
> Aucun commit, push ou déploiement. [Contrat, permissions et limites](./plans/skills-followup-and-module-tutorials.md).
> Suite : alertes d’expiration/matrice par équipe, puis exigences des opérations et capacité;
> notifications/SLA SAV et retours/rapprochement facture fournisseurs dans des lots séparés.

Les résultats ci-dessous sont historiques; les qualifications ne constituent pas une certification
réglementaire ni une preuve de disponibilité. Après actualisation des permissions, renouveler le JWT.

> **RH → Services — disponibilité minimale (2026-09-22), branche `codex/end-user-workflows`.**
> Contrôle en lecture des absences approuvées au jour du début prévu, fuseau du navigateur
> explicite, permission dédiée `hr.availability.read` + `services.read`, deux modules actifs.
> Liste des interventions et détail projet : résumé de la page et signaux par intervention;
> panneau : prévisualisation de la personne/date courante, actualisation et rejet des réponses
> tardives. Données manquantes, accès absent et erreurs = non vérifié, jamais disponible.
> Aucun motif, type, numéro, intervalle ni identifiant RH retourné; aucune copie persistée,
> mutation RH, réservation de capacité ou blocage du planning. Les dossiers clos sont exclus.
> Correction connexe : sélecteurs personne/prestation dans Services n’affichent plus le libellé
> du dossier initial après un changement de sélection. UI Pulsar conservée; aide, articles,
> connexion RH/Services, tutoriel existant et [contrat détaillé](./plans/hr-services-availability.md) à jour.
> **1 509 tests unitaires** (865 shared, 529 API, 115 web), **54 tests HTTP ciblés** (3 suites)
> et **56 scénarios navigateur** réussis (49 régressions + 7 nouveaux). Recette visuelle
> desktop/mobile, format vérifié, typecheck sans erreur (12 avertissements préexistants),
> compilation complète shared/database/API/web réussie.
> Aucune migration dans ce lot (95 migrations existantes); `.env` et base client inchangés.
> Tests sur `pulsar_enduser_20260921`, API :3100, web :5173. Aucun commit, push ou déploiement.
> Suite : compétences/habilitations RH vers Fabrication; côté Services, fuseau métier stable
> et durée prévue avant planning de capacité. Pas de paie, conformité légale ni décision AI RH.

La connexion est une indication au moment de la lecture : seuls les jours demandés sont vérifiés,
pas toutes les occupations de la personne. Une approbation/annulation ultérieure exige une
actualisation. Les horaires ambigus d’automne gardent le comportement Date du navigateur.
Les tests HTTP utilisent toujours `--forceExit` (handles existants); API unitaire en séquentiel.
Le catalogue de permissions est synchronisé au démarrage, mais le JWT doit être renouvelé.
Les compteurs ci-dessous restent les résultats historiques des lots précédents.

> **Qualité v2 + RH v1 (2026-09-22), branche `codex/end-user-workflows`.**
> Qualité : responsable interne, échéance civile, filtres Mes dossiers/Sans responsable/Retard,
> justificatifs PDF/PNG/JPEG protégés par les droits métier, reprise idempotente d’upload et
> exclusion du centre Documents générique (y compris alias de clé de stockage).
> RH : tables distinctes employés/équipes/absences/journal; lien utilisateur facultatif unique
> et fixe; espace personnel limité à son propre dossier; décisions humaines indépendantes,
> chevauchements sérialisés, dates réelles, versions optimistes et historique transactionnel.
> Interface Pulsar conservée, documentation métier et connexions approfondies, aide par écran
> et tutoriel automatique de première visite enregistré par utilisateur/tenant.
> **1 500 tests unitaires** (856 shared, 529 API, 115 web), **185 tests HTTP** (16 suites)
> et **49 scénarios navigateur uniques** réussis. Recette visuelle desktop/mobile;
> typecheck sans erreur (12 avertissements existants), build complet réussi, schéma aligné.
> 95 migrations uniquement sur `pulsar_enduser_20260921`; `.env` et base client inchangés.
> API locale :3100, web :5173. Aucun commit, push, PR ou déploiement externe.
> Contrats : [RH](./plans/hr-foundations.md), [Qualité v2](./plans/quality-workflows.md).
> Suite : disponibilité RH minimale vers Services, puis compétences/habilitations et
> capacité Fabrication. Pas encore de paie, données médicales, calcul de droits légaux,
> notification, blocage automatique de planning ou décision AI RH.

La commande unitaire API doit être exécutée avec `--runInBand` sur ce poste :
l’essai parallèle a épuisé la mémoire, puis les 529 tests ont réussi en séquentiel.
Les tests HTTP utilisent encore `--forceExit` (handles existants); aucun arrêt propre
de tous les runtimes n’est revendiqué. La recette navigateur attend désormais la fin
des interceptions de préférences RH/Qualité avant fermeture des pages, évitant une
erreur tardive de tutoriel attribuée au test suivant. APS et services tiers non testés.

> **Qualité v1 (2026-09-22), même branche `codex/end-user-workflows`.**
> Plans versionnés, contrôles à critères figés, mesures et vérifications, non-conformité
> atomique en cas d’échec, analyse/action/vérification et journal commun. Liens de contexte
> vers réceptions WMS validées, ordres de fabrication et SAV, droits revérifiés.
> Écrans Pulsar, écarts visuels explicites, mobile, aide, documentation métier approfondie
> et tutoriel première visite avec progression serveur. Pas de quarantaine/libération de
> stock, signature, notification ou nouvel outil AI; les cinq autres secteurs restent planifiés.
> Vérifications : **1 492 tests unitaires** (853 shared, 526 API, 113 web), **136 tests HTTP**
> (10 suites) et **43 scénarios navigateur uniques** (37 régressions + 6 Qualité) réussis.
> Typecheck sans erreur, 12 avertissements préexistants; compilation complète réussie,
> recette visuelle desktop/mobile. 93 migrations appliquées uniquement à la base isolée,
> Prisma sans différence, `.env` inchangé. Aucun commit, push, PR ou déploiement externe.
> Contrats, limites et prochaines étapes : [quality-workflows.md](./plans/quality-workflows.md).

> **Achats ↔ WMS, SAV et programme sectoriel (2026-09-22), même branche locale.**
> Réceptions fournisseurs partielles atomiques, reliquats calculés, champs personnalisés WMS,
> historique paginé, reprise réseau sans doublon et clôture motivée. Nouvelle app SAV :
> demandes client, qualification/priorité, lien intervention du même client, résolution,
> réouverture, clôture et historique transactionnel. Client du projet protégé tant que lié au SAV.
> Guide détaillé, connexion Services et tutoriel première visite; correction d’une course lors
> de l’enregistrement initial simultané des progressions. Programme de six autres modules
> dans Documentation (Qualité, Location, RH, Caisse, Restauration, e-commerce) : **cadrés,
> pas encore implémentés**, tutoriels correspondants à livrer avec chaque module.
> Vérifications : **1 484 tests unitaires**, **128 tests HTTP/PostgreSQL** (9 suites) et
> **37 scénarios navigateur** réussis après corrections; typecheck sans erreur (12 avertissements
> préexistants), compilation complète et recette visuelle SAV/Documentation réussies.
> 92 migrations sur base isolée, schéma aligné; `.env` inchangé, aucun push/PR.
> Contrats, procédure et limites : [supplier-receipts-and-support.md](./plans/supplier-receipts-and-support.md).

> **Services ↔ WMS et documentation approfondie (2026-09-21), même branche locale.**
> Correspondance produits Catalogue ↔ articles WMS, consommation et retour intégral de pièces
> depuis les interventions, stock atomique et reprise réseau idempotente. Navigation vers le
> journal de stock et retour au dossier sous contrôle d’accès. Documentation : fiches détaillées
> des connexions, trois parcours intermodules, glossaire, dépannage et recherche enrichie;
> tutoriels actualisés. 90 migrations sur base isolée, `.env` inchangé; aucun push/PR.
> Vérifications : **1 480 tests unitaires**, **122 tests HTTP/PostgreSQL** (9 suites) et
> **34 scénarios navigateur** réussis. Typecheck sans erreur (12 avertissements préexistants),
> compilation complète réussie; schéma Prisma aligné sur la base isolée. Recette visuelle du manuel réalisée.
> Contrats et suite : [services-parts-and-connected-documentation.md](./plans/services-parts-and-connected-documentation.md).

> **Services — approbation des heures (2026-09-21), même branche locale.**
> Soumission/retrait, approbation indépendante, refus et réouverture motivés. Heures figées
> pendant/après revue, journal transactionnel des décisions et corrections, totaux approuvés
> et filtre À approuver dans les projets/interventions/feuilles de temps. Clôture interdite
> avec des heures non traitées. Permission dédiée `services.time.approve`; aucune auto-approbation.
> Aide, Documentation et tutoriel mis à jour. Migration sur base isolée seulement; pas de push/PR.
> Vérifications : **1 474 tests unitaires**, **37 tests HTTP/PostgreSQL** et **32 scénarios
> navigateur** réussis; typecheck sans erreur (12 avertissements préexistants), compilation complète réussie.
> Contrats et limites : [services-time-approval.md](./plans/services-time-approval.md).

> **Services — affectations et feuilles de temps (2026-09-21), même branche locale.**
> Affectation à un utilisateur interne actif, filtres Mes interventions/Sans intervenant,
> registre `/services/time` et temps dans les projets/interventions. Saisie manuelle,
> corrections versionnées, annulation motivée, totaux complets et reprise réseau sans doublon.
> Permissions gestionnaire/collaborateur, verrou tenant, plafond quotidien et audit.
> Aide, Documentation et tutoriel enrichis. Migration uniquement sur la base isolée de test.
> Pas de paie, facturation ou mouvement WMS; pas de push/PR.
> Contrats et prochaine tranche : [services-assignment-time.md](./plans/services-assignment-time.md).

> **Documentation + fondations Services/Achats (2026-09-21), même branche locale.**
> Nouvelle app `/documentation` avec guides/règles des 22 espaces internes et tutoriels;
> Catalogue commun aux nouvelles apps, Achats fournisseurs multiligne et Services
> (projets, interventions, rapports). Six tables propres, références communes, workflows
> versionnés et audités. Migration additive appliquée uniquement à la base isolée de test.
> Pas encore de synchronisation CRM/TMS/WMS, réception fournisseur, facturation Services
> ou nouvel outil AI. Contrats et suite : [business-foundations.md](./plans/business-foundations.md).
> Pas de push/PR.

> **Scanners + tutoriels interactifs (2026-09-21), même branche locale.** Entrée clavier
> USB/Bluetooth et Zebra DataWedge dans 5 modules, pickers WMS/fabrication et comptages
> avec confirmations; visites guidées automatiques dans les 18 espaces internes, surlignage,
> navigation réelle et progression serveur par utilisateur. Migration `20260921170000_module_tours`
> appliquée seulement sur la base isolée de test. Matériel réel non testé, pas de push/PR.
> Contrats, configuration, couverture et limites : [scanners-and-module-tours.md](./plans/scanners-and-module-tours.md).

> **Utilisabilité opérationnelle — lot 1 (2026-09-21), branche locale
> `codex/end-user-workflows` depuis `access-module-core-locations`.** Édition/activation
> clients et transporteurs, validations coordonnées/adresses, notes de chargement versionnées,
> cartes recalées, aide contextuelle et guides textuels, créations rapides article/bin,
> zones visibles dans Emplacements, Apparence centralisée et import de logo portail.
> Pas de migration, push ou PR. Couverture exacte, tests et suite priorisée :
> [end-user-workflows.md](./plans/end-user-workflows.md). Restent notamment les zones autonomes,
> calendrier partagé, recherche mondiale d’adresses et bureau côte à côte. Le lot suivant
> ci-dessus remplace les guides textuels par des visites interactives et ajoute le scan clavier.
> **Boucle opérationnelle Fabrication (2026-09-15), implémentée localement.**
> M3c partiel : arrivages, reports de promesse et clôtures de reliquat historisés.
> M4 v1 : impacts matières par site, achats datés dans PlaniAdvance et revalidation
> du stock/arrivages avant publication. M5 v1 : consommation réelle, bons produits
> et rebuts, preuves WMS atomiques et reprise après coupure. Le worker distingue
> les preuves figées du MRP et les impacts courants, sans nouveaux outils de mutation.
> Panneaux/style Pulsar conservés, aucun nouveau thème.
> [Contrats, limites et reprise](./plans/manufacturing-operational-loop.md).
>
> Vérification : **94 tests HTTP** (MRP/APS avec moteur réel, CRM, WMS),
> **61 tests navigateur**, **666 tests shared**, **287 tests unitaires API**,
> **34 tests Python du bridge**. Build complet réussi; 0 erreur de type,
> 12 avertissements Svelte préexistants. 89 migrations dev/test sans dérive Prisma.
> API prête et web 5173 accessibles. Aucun envoi fournisseur ni test LLM réel.
>
> **Limite importante :** un OF actif avec déclaration atelier bloque encore un
> nouveau scénario APS global. Suite prioritaire : temps réels/restants par opération,
> gel de l'exécuté et replanification partielle (M4 WIP); ensuite achats multi-lignes,
> corrections compensatoires/qualité et qualification du worker réel.

> **MRP M3b v1 (2026-09-15), implémenté localement.** Poste Achats matières,
> fournisseurs versionnés, demandes BUY → bons mono-demande, confirmation humaine
> de commande passée hors Pulsar, réceptions partielles reliées au WMS et protection
> contre sur-réception/double comptage. Le MRP absorbe le solde confirmé; le worker
> peut lire les preuves sans nouveau pouvoir de mutation. UI Pulsar conservée.
> Aucun envoi fournisseur/LLM ni stock fictif ajouté dans Acme.
> Suite : achats M3c (multi-lignes, reports/reliquats), boucle matières–capacité M4.
> [Contrats, limites et reprise](./plans/manufacturing-material-purchases.md).
>
> Vérification M3b : **87 tests HTTP** (53 Fabrication/CRM avec moteur réel,
> 34 WMS), **54 tests navigateur**, **663 tests shared** et **285 tests unitaires API**.
> Build complet réussi, 0 erreur de type et 12 avertissements Svelte préexistants.
> 88 migrations dev/test, aucune dérive Prisma. API prête, web 5173 accessible;
> Acme conserve 0 demande d’achat et 0 fournisseur matières (aucune fixture ajoutée).

> **MRP M2.2b2 partiel + M3a (2026-09-15), implémenté localement.** Sites explicites
> des calendriers/postes, validité immuable des versions BOM, propositions → demandes
> d’achat internes / OF DRAFT par prévisualisation-confirmation idempotente. Doublons
> inter-calcul bloqués; préparations lisibles par le worker, sans nouvel outil de
> mutation IA. UI Pulsar conservée. Ni commande fournisseur ni stock/arrivage créé.
> Suite : achats matières M3b et rapprochement réceptions, puis boucle APS M4.
> [Contrats, limites et reprise](./plans/manufacturing-mrp-preparation.md).
>
> Vérification locale M3a : 48 tests HTTP (MRP/APS/CRM, voie moteur réel),
> 32 tests navigateur à API contrôlée, 661 tests shared et 285 tests unitaires API.
> Build complet réussi. Typecheck : 0 erreur, 12 avertissements Svelte préexistants hors de ce lot.
> Schémas Prisma dev/test sans dérive; API prête et web 5173 accessibles.

> **MRP M2.2b1 + M7a (2026-09-15), implémenté localement.** Correspondances
> produits CRM/articles WMS et ratios commerciaux exacts capturés par demande.
> Premier worker analyste MRP via les tâches, MCP et approbations existants;
> synthèses liées au calcul, recalcul gouverné, revue automatique opt-in sans boucle.
> Panneaux Pulsar conservés. Pas d'achat/OF/stock automatique ni de test LLM réel.
> Suite : validité/sites M2.2b2, exécution M3, qualification worker M7b.
> [Contrats, activation et preuves](./plans/manufacturing-mrp-units-ai.md).

> **MRP M2.2a (2026-09-15), implémenté localement.** Commandes CRM confirmées
> reliées explicitement aux articles/sites/dates MRP, prévisions par période et
> consommation sans double comptage. Exécution/annulation CRM prises en compte,
> provenance figée par calcul, droits croisés et concurrence de confirmation
> durcie. UI Pulsar conservée. Pas de conversion d'unités ni d'exécution achats/OF
> automatique. Suite : M2.2b puis M3. [Contrats et reprise](./plans/manufacturing-demand-sources.md).

> **MRP M2.1 (2026-09-15), implémenté localement.** Nomenclatures Decimal,
> versions publiées figées, règles MRP attachées à une version, site et instantané
> matières à la libération des OF. Unités/SKU WMS utilisés protégés. Panneaux et
> style Pulsar conservés. Les anciennes règles MAKE nécessitent une sélection
> explicite; aucun historique n'est inventé. M2 reste partiel, achats/atelier et
> recettes encore ouverts. [Contrats et reprise](./plans/manufacturing-definitions.md).

> **MRP M1 (2026-09-15), implémenté localement.** Poste `/manufacturing/mrp` :
> règles article/entrepôt, demandes/arrivages, explosion multi-niveaux Decimal dans
> le runtime PlaniAdvance, historique immuable et lien réception WMS sans double
> comptage. UI Pulsar conservée. Ce lot est un calcul de besoins, **pas encore le
> MRP complet exécutant achats/OF/atelier**. Cible confirmée : discret et procédés
> à terme. [Contrats, limites et suite M2–M7](./plans/manufacturing-mrp.md).

> 🇫🇷 Document de synthèse pour reprendre le travail (humain ou session Claude Code).
> Mis à jour à la fin de la **phase 16** (début de l'Acte II). Détail des tâches : [TODO.md](../TODO.md) ·
> vision : [ROADMAP.md](../ROADMAP.md) · règles de dev : [CLAUDE.md](../CLAUDE.md) ·
> **audit TMS vs référentiel entreprise : [audit-tms-2026-06-10.md](./audit-tms-2026-06-10.md)**
> (à lire avant de prioriser quoi que ce soit).

> **Aide à la saisie + portail client v2 + connecteurs (arc 3, 2026-09-17) —
> `access-module-core-locations` (non mergée, non poussée ; 40 commits depuis `a3aedc7`, HEAD
> `cefd4ea` après la passe de correction finale et sa re-revue).** Trois sous-projets. **(A) Pickers partout** : `EntityPicker` v2
> (`labelKey`/`detailKey`/`valueKey`/`listShape`/`selectedLabel`/`allowCreate`/`allowFreeText`,
> clavier ↑/↓/Entrée), `ReferenceSelect` + référentiels purs `@pulsar/shared/reference`
> (`COUNTRIES`, `REGIONS_BY_COUNTRY`, `CURRENCIES`, `WMS_UNITS`), libellés FR de statuts
> (`STATUS_LABELS_FR`/`labelFor`) et dates en `fr-CA` ; 15 familles d'écrans converties (TMS, cour,
> WMS, comptes GL, factures, CRM, lieux, lanes/rate studio, fabrication). **(B) Portail client v2** :
> coquille plein écran, tableau de bord (5 KPI + carte Leaflet), poste de travail Commandes paginé
> serveur + drawers commande/suivi, factures avec PDF, documents, **demandes de changement
> persistées** (`PortalChangeRequest`, migration `20260917134920_portal_change_requests`) avec file
> staff `/customer-portal/requests` ; les deux portes (session et lien à jeton) partagent le même
> cœur `PortalContext`. **(C) Connecteurs** : pont `DomainEventsService.emit → WebhooksService.emit`
> (tout le `DOMAIN_EVENT_CATALOG` au lieu de 6 événements TMS), formats `json|slack|teams|x12`,
> catalogue `GET /integrations/events`, test réel + replay, garde d'egress SSRF ; **récepteur
> webhook entrant** `POST /public/hooks/:token` (jeton haché en colonne indexée, HMAC, idempotence,
> mapping pur, 5 cibles métier sous le service-account) ; **EDI X12** 204/990/210/214 pur dans
> `@pulsar/shared/edi` + deux portes d'entrée ; clés API avec expiration et modèles de portée +
> schéma Swagger `x-api-key` ; flux **iCal** des rendez-vous de quai ; hub `/connect` +
> `/connect/inbound-hooks` + `/connect/edi`. Règles 53-55 ajoutées.
> Gates mesurées (HEAD `3bb0098`, puis suivi `047ddf1`/`cefd4ea` re-vérifiés : unit web 88, e2e portail 19/19, connect 6/6) :
> typecheck **0 erreur** (12 avertissements a11y web, baseline) ; unit **1384 tests** (shared 806/86,
> web 82/9, api 496/76) ; e2e complet `pnpm test:e2e` **832/840** (1 ignoré ; **7 échecs de cause
> externe** — moteur APS Python absent : `aps-runtime`, `manufacturing-scheduling`,
> `manufacturing-agent-tools`) ; Playwright `pickers`, `portal-accounts`, `customer-portal-requests`,
> `connect`, `access-roles`, `wms-workspace` **37/37** ; `git diff --check` propre.
> La revue finale (opus) a conclu « mergeable après correctifs » ; la passe de correction (commits
> `6f54124` API + `3bb0098` web) a fermé ses trois points importants : jeton iCal caviardé dans les
> journaux de requêtes, écritures d'intégration auditées (config masquée), `PATCH /integrations/:id`
> **fusionne** la config (`null` supprime une clé) au lieu de la remplacer — un enregistrement depuis
> le studio ne désarme plus le HMAC d'un récepteur ; plus dates **fr-CA** partout (85 appels sans
> locale → 0), studio pré-rempli avec la liste d'événements héritée, panneau commandes paresseux sur
> la page à jeton, résolution du `home` de domaine par permission, garde prod contre
> `WEBHOOK_ALLOW_PRIVATE_URLS`, e2e `phase3`/`access-module` stabilisés.
> Suite recommandée : ouvrir la PR (la branche porte trois arcs) ; dette restante dans TODO.md.
> Détail, contrats et dette : [pickers-portal-connectors.md](./plans/pickers-portal-connectors.md)
> et TODO.md § « Pickers, portail v2 & connecteurs — dette 2026-09-17 ».

> **Portail client (comptes nommés) + Quoi de neuf (2026-09-17) — `access-module-core-locations`
> (non mergée).** Trois lots : (1) Pages fix — lien public masqué sur brouillon, bloc `cta` avec
> validateur d'URL durci (rejette `javascript:`, protocole-relatif `//host`, antislash
> d'obfuscation) ; (2) fil « Quoi de neuf » — `ReleaseNote` entité **plateforme** (règle 52),
> `renderReleaseNoteBody` pur, état « vu » par utilisateur (`UserPreferences.releaseNotesSeenAt`),
> pages `/platform/release-notes` et `/whats-new` + badge Sparkles ; (3) **comptes portail
> client** — troisième plan d'authentification complet (`PortalUser`/`PortalActionToken`/
> `PortalRefreshToken`, JWT `portal: true`, `PortalJwtStrategy`/`PortalGuard`, rejet croisé avec
> les plans tenant et plateforme), invitation/connexion/désactivation avec garde du dernier ADMIN
> actif, gestion staff (`customer-portal/customers/:id/users`) et self-service ADMIN
> (`portal/users`), lien à jeton legacy (`Customer.portalToken`) conservé en compatibilité via un
> `PortalContext` commun. Règles 51-52 ajoutées.
> Gates mesurées : typecheck **0 erreur** (shared/database/api/web, 12 avertissements a11y
> préexistants) ; unit **1065** (shared 671/74 suites, web 52/7, api 342/64) ; e2e **complet**
> `pnpm test:e2e` **782/790 tests** (79 suites vertes, **3 en échec pour cause externe** — moteur
> APS Python indisponible : `aps-runtime`, `manufacturing-scheduling`, `manufacturing-agent-tools` ;
> 1 suite ignorée `phase10-osrm-real`, pré-existante ; `portal-accounts`/`release-notes` e2e PASS) ;
> Playwright `access-roles`/`whats-new`/`portal-accounts`/`wms-workspace` **22/22** verts ;
> `git diff --check` propre. Limites : `TransportOrder` n'a
> pas de colonne d'attribution portail (audit/commentaires seulement) ; le lien à jeton reste actif
> en compatibilité ; aucun throttling sur `public/portal/:token` (`/portal/auth/*`, lui, EST
> throttlé — `ThrottlerGuard` 20 req/min/IP) ; `CrmContact` et `PortalUser` non liés ; invitations
> toujours via l'outbox (voulu, contrairement au reset qui passe en direct, désormais sur le
> transport SMTP du tenant quand configuré). Suite recommandée : déprécier le lien à jeton, lier
> `PortalUser` ↔ `CrmContact`, colonne d'attribution portail sur `TransportOrder` si la traçabilité
> fine devient un besoin produit. Détail, contrats et dette :
> [portal-accounts-whats-new.md](./plans/portal-accounts-whats-new.md).

> **Accès & Lieux cœur (2026-09-16) — `access-module-core-locations` (non mergée).**
> `Location` devient une entité du cœur (`core/locations`, perms `core.locations.*` synchronisées
> au démarrage par `PermissionsSyncService` sur tous les tenants) ; `transportation/locations`
> n'est plus qu'un alias TMS. Raccourcis « Créer un entrepôt / + Site » dans WMS et Yard
> (gated `core.locations.manage`). Nouveau module Accès : page `/settings/roles` (permissions
> groupées par module, gabarits `ROLE_TEMPLATES` → `POST /roles/from-template`, garde de
> suppression d'un rôle assigné) et `/settings/users` enrichie (édition, expiration d'invitation,
> renvoi, réactivation) ; dernier administrateur actif protégé (auto-désactivation, réactivation,
> retrait du rôle admin) via transaction Serializable + claim conditionnel — la garde ne vise que
> des cibles **ACTIVE**, un admin INVITED reste donc révocable. Le gabarit `viewer` exclut les
> lectures sensibles de la plateforme (`core.audit.read`, `core.email.read`, `core.api-keys.read`,
> `core.users.read`, `core.roles.read`) et la carte de gabarit liste ses clés avant création.
> Règle 50 ajoutée.
> Gates mesurées : typecheck **0 erreur** (web/api/shared/database) ; unit **962** (shared 652,
> web 49, api 261) ; e2e **complet** `pnpm test:e2e` **751/759** (1 skip ; 3 suites en échec pour
> cause externe — moteur APS Python indisponible : `aps-runtime`, `manufacturing-scheduling`,
> `manufacturing-agent-tools` ; `access-module` PASS) ; Playwright **32/32** (`access-roles`,
> `wms-workspace`, `yard-workspace`) ; `git diff --check` propre. Limites : comptes portail client/transporteur/
> chauffeur toujours nommés (pas de compte utilisateur dédié) ; le master-data partagé restant
> (`Customer`/`Carrier`/`Vehicle`/`Trailer`/`Driver`/`Lane`) n'a toujours qu'un point d'écriture
> TMS. Suite recommandée : arc « Référentiel partagé » (`core/master-data`, même patron que les
> Lieux). Détail, contrats et dette : [access-module-core-locations.md](./plans/access-module-core-locations.md).

> **Reprise Fabrication / PlaniAdvance (2026-09-15).** #79 est fusionnée; la CI de
> `main` est verte, tests navigateur inclus. L'audit du projet original confirme
> que le moteur Python est déjà copié, mais que Pulsar n'expose qu'une partie du
> workflow industriel. Avant la refonte visuelle : contrat moteur, replay, fuseaux,
> publication gardée et vraie voie CI APS. **Lot A1 implémenté localement** : entrée
> moteur isolée par requête, artefacts/rejeu historique et publication gardée; UI
> inchangée en A1. **A2.1 implémenté localement** : fuseau commun explicite, fenêtres
> UTC/DST rejouables, panneaux Pulsar de calcul/revue et confirmation versionnée.
> Le lot A complet reste ouvert : sites distincts, baseline/actions en entrée,
> WIP/gel avancé, matières et quotas. [Contrats A2.1](./plans/manufacturing-scenario-review.md).
> [Contrats et limites A1](./plans/manufacturing-aps-foundation.md).
> [Audit comparatif et lots d'intégration](./plans/manufacturing-planiadvance-integration.md).
>
> **Livraison regroupée (2026-09-14).** Les 14 lots récents sont désormais réunis
> dans la [PR unique #79](https://github.com/SamChampagne/Pulsar/pull/79), vers `main`.
> Les PR #66 à #78 sont remplacées, sans suppression de leurs branches. Les tests web
> génèrent maintenant leur configuration SvelteKit avant Vitest, y compris sur un
> checkout propre. Les runs CI obsolètes d'une même PR sont annulés automatiquement;
> les cinq jobs restent actifs. Vérifier les checks de #79 avant toute fusion.
>
> **Flotte visuelle (2026-09-14) — `codex/fleet-visual-workspace`.**
> Parc filtrable, échéancier UTC, historique et interventions en panneaux; documents
> et chargements reliés selon les droits. Concurrence maintenance durcie : aucun
> retour disponible tant qu’un autre ordre reste actif. Registre conservé, DÉMO locale,
> aucune migration ni réservation d’atelier. Suite : Fabrication visuelle.
> [Contrats, preuves et limites](./plans/fleet-visual-workspace.md).
>
> **WMS rangement et journal (2026-09-14) — `codex/wms-putaway-traceability`.**
> File par entrepôt, mouvement confirmé, journal relié aux articles/emplacements/dossiers,
> unités capturées et reprise durable du MOVE après coupure. Scénario local DÉMO prêt à essayer.
> Aucun partiel ni réservation. Suite : Flotte visuelle; anciens référentiels WMS à paginer.
> [Contrats, scénario et limites](./plans/wms-putaway-traceability.md).
>
> **WMS guidé (2026-09-14) — `codex/wms-guided-operations`.**
> Réception/préparation par lignes : unités, emplacements, stock physique et manque,
> correction en panneau, validation globale confirmée et liens Cour/entrepôt.
> Édition et validation sérialisées, versions optimistes et références revérifiées.
> Aucun prélèvement partiel ni réservation. Suite : rangement traçable et MOVE robuste.
> [Contrats, validation et limites](./plans/wms-guided-operations.md).
>
> **WMS visuel (2026-09-14) — `codex/wms-visual-workspace`.**
> Poste de travail par entrepôt : réceptionner, ranger, préparer, finaliser;
> zones et emplacements, stock en panneau, classement visuel et déplacement confirmé.
> Référentiel WMS autonome en lecture, stock sérialisé entre opérateurs, contrôles
> de site/droits et audit. Ce n'est ni un plan physique ni un stock réservé.
> [Contrats, validation et suite](./plans/wms-visual-workspace.md).
>
> **Cour ↔ TMS ↔ WMS connectés (2026-09-14) — `codex/yard-connected-dossiers`.**
> Associations explicites aux chargements, réceptions et préparations, partagées
> entre rendez-vous et arrivée; navigation aller-retour depuis les fiches métier.
> Droits croisés, compatibilité site/sens, idempotence, audit et historique protégé.
> Aucun changement automatique de stock/statut. Suite : WMS visuel.
> [Contrats, tests et limites](./plans/yard-connected-dossiers.md).
>
> **Cour & quais visuel (2026-09-14) — `codex/yard-visual-workspace`.**
> Nouvelle priorité : approfondir chaque module avec une UI métier, bureau conservé.
> Plan configurable, occupation et planning par site, arrivées et mouvements en
> panneaux confirmés. Affectations concurrentes durcies; géométrie séparée des opérations.
> Migration locale additive, aucun push/déploiement. Contrats, tests et suite :
> [yard-visual-workspace.md](./plans/yard-visual-workspace.md).
>
> **Import CSV bancaire, lot 6 (2026-09-14) — `codex/bank-csv-import`.**
> Fichier ou collage → prévisualisation → confirmation. Validation stricte, lot atomique,
> doublons contrôlés en base et contre les mouvements historiques. Aucun virement ni rapprochement
> automatique. Contrats, formats et limites : [bank-csv-import.md](./plans/bank-csv-import.md).
>
> **Dossiers financiers connectés, lot 5 (2026-09-14) — `codex/finance-connected-flow`.**
> Association explicite audit → facture existante, paiements et contexte bancaire reliés.
> Rapprochement gardé par montant/sens/devise/écriture réelle, protections concurrence et annulation.
> Migration additive appliquée localement; aucun transfert bancaire, push ou déploiement.
> Contrats, tests et limites : [finance-connected-flow.md](./plans/finance-connected-flow.md).
>
> **Audit et traçabilité comptable, lot 4 (2026-09-14) — `codex/ui-finance-audit`.**
> Contrôle serveur partie/facture et édition/soumission concurrentes durcis.
> Audit transporteur en français, panneaux de saisie/litige, liens vers chargements,
> journal filtré depuis le paiement et économies par devise. Le suivi d’audit reste
> distinct du règlement comptable : [ui-finance-audit.md](./plans/ui-finance-audit.md).
>
> **Factures et paiements, lot 3 (2026-09-14) — `codex/ui-billing`.** Liste lisible,
> allocations par devise, parcours brouillon → validation, dossiers en panneaux
> et liens facture/ordre/chargement/paiement. Projections API tenant-scopées, sans
> modification comptable. Périmètre, tests et limites : [ui-billing.md](./plans/ui-billing.md).
>
> **Fiches de travail, lot 2 (2026-09-14) — `codex/ui-records`.** Opportunité,
> commande de vente, ordre de transport et chargement : navigation de sections,
> éditeur CRM commun, panneaux de préparation et erreurs locales. Contrat de lecture
> des lignes de commande corrigé. Périmètre, tests et suite : [ui-records.md](./plans/ui-records.md).
>
> **Refonte des écrans, lot 1 (2026-09-14) — `codex/ui-screens`.** Fiches CRM,
> réglages des modules, fenêtres Finance, accueils Agents/Flotte/Entrepôt/Intégrations,
> confirmations et onglets harmonisés. Bureau conservé, aucune API métier modifiée.
> Inventaire des 138 pages et reste à faire : [ui-screens.md](./plans/ui-screens.md).
>
> **Socle UI global (2026-09-14) — `codex/ui-workspace`.** Bureau iPhone conservé,
> cadre et navigation stables, changement d’app rapide, composants communs harmonisés,
> panneaux CRM, Dispatch et Finance allégés. Aucun backend ni droit modifié.
> Périmètre et suite : [ui-workspace.md](./plans/ui-workspace.md).
>
> **Lot CRM pipelines et connexions (2026-09-14) — `codex/crm-communications`.**
> Pipelines et colonnes configurables, actions courriel à l'entrée d'une colonne,
> contact principal explicite, arrêt sur sortie/changement de destinataire, outils agents
> adaptés aux colonnes et page Connexions centralisée. SMTP/IA existants réutilisés ;
> SMS/Graph/Meta et multi-comptes non livrés. Migration additive appliquée en local.
> Contrat et qualification : [crm-pipelines-connections.md](./plans/crm-pipelines-connections.md).
>
> **Lot précédent CRM communications (2026-09-14) — même branche.**
> Scénarios courriel configurables, simulation, gouvernance d'agent sans LLM obligatoire,
> consentement/désabonnement, pause/reprise/arrêt, historique depuis les contacts. Migration
> additive appliquée localement ; SMS et fournisseurs réels non qualifiés. Périmètre,
> tests et limites : [crm-communications.md](./plans/crm-communications.md).
>
> **Relance précédente (2026-09-13) — `codex/control-center-workflows`.**
> Console SaaS `/platform/operations`, diagnostics par entreprise, catalogue complet,
> dossiers intermodules `/workflows`, vues personnelles et accès contextuels livrés sur
> la branche. Profil OVH Linux/Docker/Nginx préparé pour `pulsar.intebec.ca` ; **pas déployé**.
> Vérifications et limites : [control-center-workflows.md](./plans/control-center-workflows.md).
> Installation distante : [runbook OVH](../deploy/ovh/README.md). L'emplacement réel de Nginx
> (hôte ou conteneur) reste à inspecter avec l'accès VPS. Les garanties de juillet
> ci-dessous sont historiques, pas une nouvelle certification de production.

> **Stage précédent (2026-07-17) — `operational-convergence` (branche non mergée, prête PR).**
> Waves 0→7 + Release Qualification (Gates A→D) + **pont CRM SalesOrder → TMS TransportOrder**
> (« Préparer l'expédition ») + passe de durcissement finale (autorisation cross-module des outils
> agents, complétion TransportOrder tenant-scopée/auditée/state-machine, contrat logistique aligné
> API↔agents↔UI, isolation DomainEvents + catch-up cron borné, parcours Playwright profond,
> polish Docker). Gates verts : typecheck 0, build, unit 810, e2e 604/605 (1 skip, exit 0),
> Playwright 18/18, smoke Docker same-origin prouvé. **Prêt PR / staging / prod mono-instance
> (sous S3+SMTP+secrets réels) ; PAS multi-instance** (Redis non implémenté). Détail + preuves :
> [docs/plans/operational-convergence.md](./plans/operational-convergence.md) §Release Qualification.

## Où on est rendu

| Phase                                                                   | Livré | Contenu clé                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ----------------------------------------------------------------------- | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0 — Fondation                                                           | ✅    | Monorepo pnpm, schéma Prisma multi-tenant, API NestJS (auth JWT, RBAC, audit, registre de modules), SPA SvelteKit, seed, Docker                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 1 — Happy path TMS                                                      | ✅    | Workflow complet en UI (ordre→shipment→load→route→livraison→POD), séquences par tenant, validation d'appartenance des FK, CI GitHub Actions                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 2 — Collaboration & coût                                                | ✅    | Tendering transporteur, lien de suivi public, page chauffeur mobile (POD+photo), moteur de coût, scorecard, refresh tokens, stockage local/S3                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 2.5 — Automatisation tender                                             | ✅    | Canal courriel (log/SMTP), listes de préférence par voie (lanes), re-tender auto sur refus/expiration (cron), cache modules                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 3 — Profondeur opérationnelle                                           | ✅    | Split d'ordre en N shipments, éditeur de route manuel, invitations + reset mot de passe, outbox webhooks avec retries, avis de livraison client                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 4 — Plateforme & 2ᵉ module                                              | ✅    | Clés API entrantes, audit déclaratif (@Audit), URLs pré-signées S3, gestion shipments post-planification, **module Customer Portal v1**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 5 — Portail v2 & Billing                                                | ✅    | Saisie de commandes depuis le portail, comptes de service (clés API en écriture), **module Billing v1** (factures transporteur)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 6 — Commercial readiness                                                | ✅    | **Plan d'admin plateforme** (création/suspension de tenants, PlatformUser disjoint, garde-fous prod), **SSO OIDC par tenant** (PKCE, state chiffré, provisioning), **rapprochement de factures transporteur** (tolérance sur écart brut, litiges codifiés, PAID, export CSV — réorientation issue de l'audit TMS), **secrets chiffrés au repos** (enc:v1 + script de rotation idempotent + runbooks), doc de découverte Fleet                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 7.1 — Rating engine v2 + Lane                                           | ✅    | **Lane entité première classe** (hiérarchie géo, clés normalisées NFD, spécificité déterministe), **tarifs v2** (tranches CWT as-if, accessorials, table carburant datée), **snapshot `costDetail` figé** (invariant COMPLETED + updateMany atomique), **rate shopping** (`GET /loads/:id/rate-options`), auto-tender par spécificité, CRUD accessorials + fuel-tables, 4 permissions, seed démo, 4 pages web (rates/lanes/accessorials/fuel-tables) + détail load enrichi, 11ᵉ migration                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 7.2 — Intégrité du plan                                                 | ✅    | **Fenêtres temporelles early/late** sur TransportOrder, Shipment et Stop (RENAME sans perte de données) ; validations dures 400 (`assertWindowCoherence`) + avertissements consultatifs `windowWarnings` sur GET order/load ; **capacité 3 axes** (`checkCapacity` poids/volume/palettes, axe inconnu ignoré, dépassement forcé = audit consolidé) ; `capacityPallets` Trailer ; **jonction `shipment_load_legs`** maintenue dans la même transaction + backfill ; on-time analytics `plannedDeliveryLate ?? plannedDeliveryEarly` ; 6 tests e2e ; 12ᵉ migration                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 7.3 — Billing sell-side                                                 | ✅    | **Relevés client** depuis les ordres livrés et ratés (`CustomerInvoiceStatus` DRAFT→APPROVED→SENT→PAID) ; `RatingService.rateOrder` (taux client uniquement, lane ou catch-all client, date de référence = dernier `actualDeliveryAt` sinon today, moins cher retenu) ; un relevé par devise (`groupByCurrency`) ; anti-double-billing (`transportOrderId @unique`) ; échappatoire DRAFT (suppression libère les ordres) ; envoi conditionné sur email client + succès email (libellé « Billing statement ») ; 4 permissions `billing.customer-invoices.*` ; séquence CINV ; 8 tests e2e ; 13ᵉ migration                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 7.4 — Durcissements différés phase 6                                    | ✅    | **MFA plateforme** (TOTP otplib ±1, `totpSecret enc:v1` + `mfaEnabledAt` + `recoveryCodes` bcrypt à usage unique, step tokens `mfa-enroll`/`mfa-pending` rejetés par `PlatformJwtStrategy`, 3 branches login dont `PLATFORM_MFA_ENFORCED`, `enroll-start` authentifié) ; **throttling** `PlatformAuthController` 20 req/min/IP ; **`@PlatformController()`** composite `Public + PlatformGuard` ; **cache `Issuer.discover`** TTL 1 h + retry-once ; **slug tenant dans le state OIDC** vérifié au callback ; **`csvSafe()`** sur les champs libres de l'export CSV ; **`updateMany` conditionnel** sur les transitions buy-side + `createDrafts` transactionnel `P2002 → 409` ; 6 tests e2e ; 14ᵉ migration                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 8 — Ligne MVP audit fermée (BOL, modes, exceptions)                     | ✅    | **BOL généré** : `buildBolData` pure (shipper = 1er stop PICKUP / fallback originLocation ; consignee = dernier DELIVERY / fallback destinationLocation), `renderBol` pdfkit (LETTER, 3 blocs signature + lignes exceptions + conditions), `BolService.generate` (DISPATCHED+, séquence BOL-, entityType `bill-of-lading`, audité), `POST /loads/:id/bol`, `GET /loads/:id/documents`, `GET /public/driver/:token/bol` (token-résolu, pas d'id interne dans le payload public, 404 si pas encore généré) ; **mode de transport** : enum `TransportMode` (FTL/LTL/PARCEL) sur `TransportOrder`, `Load`, `Rate` (null = tous modes), filtrage des deux côtés au rating, héritage premier-assign, `modeWarning` non bloquant, `suggestMode` hint (≤30 kg PARCEL / ≤4000 kg LTL / au-dessus FTL) — arbitrage à seuils non couvert (§4) ; **moteur d'exceptions** : `isLate` pure, cron 5 min + `tick(now)`, dedup `(stopId, deadline)`, événement `DELAYED` + `Notification` tenant (userId nullable, read-by-one = read-for-all v1), cloche UI ; 15ᵉ migration                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 9 — Refonte UI (console hybride)                                        | ✅    | **Design system maison** (Tailwind 4, tokens CSS prêts dark-mode, 17 composants `$lib/components/ui` + barrel), **shell repliable** (sidebar sombre par groupes, palette ⌘K navigation+actions avec slot assistant IA réservé, cloche notifications, pile d'overlays Escape), **28 pages refondues** (pattern liste+Panel, densité commutable persistée, skeletons, Modals form-in-children, helpers format), **LoadMap Leaflet** (détail load interne : stops + dernière position, lecture seule), pages publiques re-skinnées **sans exposition supplémentaire** (notes tender et liste shipments chauffeur retirées au passage), plan plateforme distinct (badge danger). **Zéro changement API** (`git diff main -- apps/api packages` vide) ; 93 e2e + 89 unit verts. Carte publique différée (payload sans coordonnées). Retours du test manuel intégrés : pages détail résilientes aux échecs des appels auxiliaires, modal rates élargi, **UI MFA plateforme livrée** (TOTP, enrôlement forcé, recovery codes — vérifiée par login TOTP réel)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 10 — OSRM + carte opérationnelle                                        | ✅    | **Moteur carto** `RoutingService` core (drivers env `ROUTING_DRIVER`/`GEOCODING_DRIVER`, défaut `none`, timeout 3 s best-effort, jamais bloquant), distances/durées auto au build de route (`distanceSource MANUAL\|OSRM\|HAVERSINE`, manuel jamais écrasé — y compris demi-coordonnées, géométrie GeoJSON simplifiée stockée même en manuel), **fallback haversine** badgé « estimate » dans l'UI ; **géocodage Nominatim** (cache BD global `geocode_cache`, 1 req/s in-process, UA custom, échec jamais mis en cache) au create/update de location ; **positions chauffeur** (`POST /public/driver/:token/position` borné ±90/±180, re-check module, throttlé 20/min/IP, dédoublonné 60 s + dedupKey minute race-proof ; pings page chauffeur : immédiat + visibilitychange + 2 min, indicateur avec opt-out) ; **carte live dashboard** (`GET /loads/active-map` sans géométrie, `isLate` du moteur d'exceptions réutilisé, OpsMap polling 45 s onglet visible, retards rouges, fitBounds premier chargement seulement) ; **suivi public avec carte** (lastPosition + coords o/d, jamais d'historique ni les autres stops) ; géométrie OSRM réelle sur le détail load (`L.geoJSON`) ; docker profil `osrm` opt-in + doc d'amorçage ; e2e OSRM réel conditionnelle ; 17ᵉ migration ; 10 e2e phase 10                                                                                                                                                                                                                                                                                                                      |
| 11 (palier 1) — Gouvernance d'agents + MCP                              | ✅    | **Identité `Agent`** (cousine d'`ApiKey` : permissions + `caps` + un service-user caché DISABLED PAR agent pour l'attribution d'audit, jamais loginable ; clé `ak_` montrée une seule fois, hash sha256 stocké) ; **endpoint MCP Streamable-HTTP stateless** `POST /api/v1/mcp` (auth par clé d'agent via header `X-Agent-Key`, `@modelcontextprotocol/sdk` 1.29) qui n'expose que les outils autorisés = permissions ∩ modules du tenant ∩ `caps.toolAllowlist` ; **8 outils dispatch** dans un registre unique (tier/permission/module/zod/handler réutilisant les services TMS) — READ/LOW exécutés en direct, MUTATING/SENSITIVE mis en **file `ProposedAction`** (idempotente sur `(agentId, idempotencyKey)`, plafonds montant + débit/min vérifiés à l'enfilage) ; **inbox d'approbation humaine** (`GET /agent-actions`, `POST :id/approve\|reject`, permissions `core.agents.actions.*`) : l'approbation re-vérifie le statut (claim atomique) puis exécute le vrai appel attribué à l'agent et audité avec l'approbateur ; `caps.autoApprove` = seul contournement de la file ; **2 pages web** (réglages agents avec clé unique + scopes + plafonds ; inbox actions avec badge nav gated `core.agents.actions.read`) ; aucun LLM ne tourne dans Pulsar à ce palier (BYO-agent, MCP-agnostique, Hermes = client de référence) ; **guide de connexion [docs/agents.md](./agents.md)** ; 18ᵉ migration ; 7 e2e phase 11                                                                                                                                                                                              |
| 11 (palier 2a) — Agents-employés (cerveau Hermes dans Pulsar)           | ✅    | **Agent-employé** = persona/rôle/modèle LLM/**niveau d'autonomie** (`PROPOSE`/`ACT_LOW`/`AUTONOMOUS`, `@pulsar/shared`) ajoutés à l'entité `Agent` ; **assistant ⌘K** qui _streame_ la conversation via **ACP** (`AgentRuntimeService` **spawn un processus Python Hermes par conversation** sur stdio — isolation tenant car l'enregistrement MCP de Hermes est process-global ; `HermesAcpClient` + faux serveur ACP pour les tests) ; **Hermes = cerveau, Pulsar = maison** (UI, identité, outils MCP, file de gouvernance) — les appels d'outils de l'agent tapent `POST /api/v1/mcp` **en tant qu'agent** via un **jeton de session** court (`AGENT_SESSION_SECRET`, fallback `JWT_SECRET`) → chemin palier 1 ; **conversations persistées** (`AgentConversationsService` + endpoints `GET/POST /agent-conversations`, `GET :id`, `POST :id/messages`, tour SSE) ; **gouvernance palier 1 réutilisée** + correction d'un trou : le **plafond montant est désormais appliqué sur le chemin d'auto-approbation** (`mcp-server.factory.ts`) — l'autonomie ne lève jamais les caps ; perm `core.agents.chat` ; runtime **opt-in & best-effort** (Hermes absent ⇒ 503, jamais de crash) ; **MCP-agnostique** (Hermes = runtime de référence) ; champs web (persona/rôle/modèle/autonomie/avatar) + panneau ⌘K ; 19ᵉ migration ; e2e `phase11b-agents-employes`                                                                                                                                                                                                                                                               |
| 11 (R1) — Runtime Hermes managé par Pulsar                              | ✅    | **Installation et configuration sans toucher au `.env`** : `pnpm agents:setup` installe Hermes dans `hermes-agent/.venv` via **uv** (récupère automatiquement un CPython 3.12 autonome — Hermes exige 3.11–3.13, donc aucune install Python manuelle) ; **config par tenant** (`AgentRuntimeConfig`, 20ᵉ migration) éditable dans **Réglages → Runtime agents** : choix d'un provider du catalogue `RUNTIME_PROVIDERS` (`@pulsar/shared`, pure data browser-safe) puis soit une **clé API chiffrée via `CryptoService`** (jamais renvoyée en clair), soit un **login OAuth** (Codex/Nous) dont Pulsar streame en SSE le device code + URL et dont les jetons vivent dans le `HERMES_HOME` par tenant ; **builder d'env** (`agent-runtime-env.ts`) + `runtime-config.service` (crypto) + `runtime-config.controller` (REST + SSE), injection de la config dans `openSession` du `AgentRuntimeService` ; endpoints `/agent-runtime` (`GET providers`, `GET`/`PUT`, `POST test`, `POST connect` SSE — gated `core.agents.manage`) ; runtime best-effort par tenant (503 si Hermes absent) ; page web Réglages + e2e `phase11r1-agent-runtime`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 11 (R2) — Espace Agents (citoyens de premier ordre)                     | ✅    | **Agents promus au niveau supérieur de la navigation** : onglet **Agents** → **roster de cartes « employés »** → page agent (`/agents/[id]`) à trois volets — **Profil & config guidée** (aide inline + presets de rôle `AGENT_ROLE_PRESETS` de `@pulsar/shared`), **Activité** (conversations + actions proposées + compteurs `conversations`/`pending`/`executed`/`rejected`) et **Chat** (parler à cet employé) ; `GET /agents/:id` projette le profil **sans `secretHash` ni `serviceUserId`** et `GET /agents/:id/activity` renvoie l'activité **scopée tenant + agent** (gated `core.agents.read`) ; presets = pure data testée (`role-presets.spec`) + e2e `phase11r2-agent-experience`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 12 — Operating Workbench                                                | ✅    | **Outbox `DomainEvent`** (best-effort, worker `processPending` race-safe claim `PENDING→PROCESSED`, échecs terminaux) ; **policies événement→tâche** dans `@pulsar/shared/operating` (pures, testées) : retards de stop et échecs tender émis comme events, mappés en `OperationalTask` idempotente sur `(tenantId, dedupKey)` ; **`OperationalTask` + inbox `/workbench`** (statuts via `canTransitionOperationalTask`, 2 permissions `core.operating.tasks.*`, tri priorité + statut) ; **`WorkbenchAgentRunner`** headless best-effort (agent `alwaysOn` + `handlesCategories` réveillé sur ses cas, Hermes absent ⇒ skip tâche revenue OPEN, `runCron` n'émet jamais d'exception) ; **4 outils workbench** au registre (list/get/claim/resolve tasks) + `triggeredByRef = "task:<id>"` dans le jeton de session agent ; 21ᵉ migration                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 13 — Main-d'œuvre 24/7                                                  | ✅    | **`AgentWorkerService`** dispatcher unique (réveil sur event + cron filet de sécurité, file en mémoire, concurrence plafonnée global/tenant/agent) ; **`AgentRun`** ledger durable + `GET /agents/:id/runs` ; **heartbeat** (`lastSeenAt`/`lastRunAt`) ; **`PAUSED` kill switch à chaud réversible** (endpoints pause/resume/run-now/pause-all) tuant les sessions Hermes en vol via `AgentRuntimeService.killAgentSessions`, `REVOKED` permanent ; **retry borné** sur erreurs de connectivité runtime (`classifyRunError` de `@pulsar/shared`, Hermes absent ⇒ run `SKIPPED`, autre échec terminal → tâche en OPEN) ; **revert claim-guarded** (un run ne revert IN_PROGRESS→OPEN que s'il a réellement claim) ; règle 24 préservée (best-effort, jamais de crash) + actions via file `ProposedAction` `triggeredByRef = "task:<id>"` ; UI web « Activité 24/7 » ; 22ᵉ migration                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 15-A — Control Tower (observabilité)                                    | ✅    | **KPI par agent** + dashboard manager du tenant + timeline d'activité/audit unifiée + compteur de trips de breaker alimentant le score de confiance, **calculés à la lecture** depuis `AgentRun`/`ProposedAction`/`OperationalTask`/`AuditLog` (`deriveAgentKpis`/`mergeTimeline` purs, aucun store de rollup, **aucune migration**) ; règle 30                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 16 — Freight Audit autonome (Acte II)                                   | ✅    | **`IncomingCarrierInvoice` découplé** + matching **déterministe** (`FreightAuditService`) de chaque ligne contre `Load.estimatedCost` **figé** (règle 16, jamais recalculé) via `evaluateReconciliation` + tolérances buy-side ; transitions par `canTransitionFreightAudit` (`@pulsar/shared`) ; **agent litige** ouvre via la file de gouvernance (`handleMutatingTool` → `ProposedAction`, `triggeredByRef = "task:<id>"`, tier SENSITIVE, cap sur `varianceTotal`) — l'agent ne calcule jamais, il propose ; **KPI économies récupérées** (`recoveredAmount` positif sur résolution `KEEP_EXPECTED`) ; `@RequireModule(BILLING)` ; 24ᵉ migration ; règle 31                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 14 — Autonomie & policy engine                                          | ✅    | **Porte de policy unifiée** : `evaluatePolicy` (`@pulsar/shared`, pur) au **point de décision unique** (`ProposedActionsService.handleMutatingTool`, appelé par le handler MCP) tranche auto-act vs propose ; **policy-as-data** — règles effectives depuis `caps.policies` ou le preset dérivé du dial `autonomyLevel` (`caps.autoApprove` legacy toujours honoré, rétro-compatible) ; **auto-exécution persistée dans le registre des propositions** (`ProposedAction EXECUTED autoApproved=true`, auditable + **compté pour le cap débit/min** — trou fermé : le chemin auto respecte désormais le débit) ; **cap MONTANT dur** (`maxAmountPerAction`) appliqué dans `enqueue` sur TOUS les chemins (seule enforcement montant pour un agent en PROPOSE, au-dessus → DENY, jamais levé par l'autonomie) ; **circuit breaker réversible** (`Agent.breakerTrippedAt` rétrograde en PROPOSE, ne modifie JAMAIS `autonomyLevel`, jamais d'escalade auto) ; **score de confiance** + **promotion d'autonomie confirmée par un humain** ; règles 23/24 préservées ; règle 29 ; 23ᵉ migration                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Dispatch Workbench v1 (pivot produit — postes de travail opérationnels) | ✅    | **Pivot produit** : le gap de Pulsar n'est plus « plus de features » mais la **tool experience** — l'app se présentait comme une admin SaaS (navbar→page→Card→Table→Form→Modal) au lieu de vrais postes de travail. Première surface profonde : **`/dispatch`, un poste de planification 3 panneaux** où l'opérateur ne quitte jamais l'écran — **backlog** de shipments non assignés (gauche) → **load builder** avec **barres de capacité 3 axes en direct** + timeline des stops + coût figé (`costDetail`, règle 16) au centre → **side panel** carte route/stops + rate options (spécificité) + carrier scorecard + tender (droite). Assignation au clic (pas de drag/drop en v1). **Polish nav/shell** : groupes ouverts par défaut (persistés en `localStorage`), entrée Dispatch proéminente, dé-doublonnage des surfaces agent (`/settings/agents` retiré de la nav). **Backend minimal, aucune migration, aucune nouvelle permission** (réutilise `transportation.planning.read\|manage`) : filtre **`GET /shipments?unassigned=true`** (`loadId: null` + statuts planifiables, tenant-scopé) + **`POST /loads/consolidate { shipmentIds }`** atomique (transaction unique : `assertOwned` règle 9, numéro `SequencesService` règle 8, assigne chaque shipment avec capacité niveau warning + `shipment_load_legs` règle 18, `recompute` règle 11, audité règle 6). e2e `dispatch-workbench` (filtre + atomicité/ownership). **Prochains postes** : Load Control Room, Agent Operations Center, Exception Desk, Rate Explorer, Workflow Config Designer ; **workbench v2** = drag/drop + panneau agent « propose » |
| Fleet Management v1 (4ᵉ module métier — maintenance & conformité)       | ✅    | **Premier module de l'expansion modulaire post-pivot** (feature pure, aucune agentique). Réutilise les assets TMS existants (`Vehicle`/`Trailer`/`Driver`, `carrierId == null` = flotte interne) : aucun CRUD asset dupliqué. **Maintenance** : `MaintenanceOrder` (`MaintenanceType` PREVENTIVE/REPAIR/INSPECTION, statut via `canTransitionMaintenanceOrder` + claim `updateMany` TOCTOU, cible exactement un asset `vehicleId` XOR `trailerId`, coût/odomètre/échéance), **sync du statut asset gardé** (`canTransitionAsset` : ouvrir un WO ⇒ `MAINTENANCE`, COMPLETED/CANCELLED ⇒ `AVAILABLE`, jamais sortir `RETIRED`, audité). **Conformité** : `ComplianceDocument` (FK souple polymorphe VEHICLE/TRAILER/DRIVER, ownership vérifiée par `subjectType`), **statut calculé jamais persisté** (`computeComplianceStatus` pur `@pulsar/shared` : VALID/EXPIRING≤30j/EXPIRED). **API** gated `@RequireModule(FLEET)` + 2 permissions `fleet.read                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | manage`:`/fleet/maintenance-orders`(+start/complete/cancel),`/fleet/compliance-documents`(+expiring),`/fleet/overview`. **Web** : groupe nav Fleet, **`/fleet`** (dashboard d'attention : WO ouverts, maintenance due 7j, conformité expirante/expirée + roster flotte interne) et **détail asset** `/fleet/vehicles\|trailers/[id]` (historique + actions WO, documents de conformité). 25ᵉ migration ; règle 32 ; unit (`MaintenanceService`/`ComplianceService`+ workflows shared) + e2e`fleet-module` (cycle WO→sync statut, overview, isolation) ; **vérifié au navigateur** (création WO → véhicule MAINTENANCE → complete → AVAILABLE, doc expirant remonté dans l'overview)                                                                                                              |
| Light WMS v1 (5ᵉ module métier — inventaire & flux entrepôt)            | ✅    | **2ᵉ module de l'expansion modulaire** (feature pure, aucune agentique) : boucle entrepôt complète, autonome (pas de couplage TMS en v1). L'entrepôt réutilise `Location` type `WAREHOUSE` (pas de nouvelle entité). **Cœur** : `StockMovement` (registre append-only, source de vérité : RECEIPT/MOVE/PICK/ADJUSTMENT) + `InventoryLevel` (solde par article × bin) maintenu **dans la même transaction** (`InventoryService.postMovement`, jamais muté seul) ; sortie vérifiée en dispo (409 si insuffisant, sauf ADJUSTMENT qui ne descend pas sous 0). **Entités** : `WmsItem` (SKU), `Bin` (RECEIVING/STORAGE/SHIPPING dans une Location WAREHOUSE), `Receipt`+`ReceiptLine` (inbound, `canTransitionReceipt` DRAFT→POSTED, n° RC-), `PickOrder`+`PickLine` (outbound, `canTransitionPickOrder` OPEN→PICKED→COMPLETED, n° PK-). **API** gated `@RequireModule(WMS)` + 2 permissions `wms.read                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | manage`:`/wms/items`, `/wms/bins`, `/wms/inventory`(+move/adjust),`/wms/receipts`(+post/cancel),`/wms/pick-orders`(+complete/cancel),`/wms/overview`. **Web** : groupe nav Warehouse, `/wms`(dashboard : articles, stock total, réceptions/picks ouverts, bins négatifs),`/wms/inventory`(déplacer/ajuster), workbenches`/wms/receiving`+`/wms/picking`, master-data `/wms/items`+`/wms/bins`. 26ᵉ migration ; règle 33 ; unit (workflows shared + Inventory/Receiving/Picking services) + e2e `wms-module`7/7 (boucle receive→putaway→pick, over-pick refusé 409, isolation) ; **vérifié au navigateur** (receive 10 → DOCK-01 → putaway → A-01 → pick 4 → solde 6). Bug attrapé en navigateur :`api()` plantait sur un corps vide (endpoints void move/adjust) → corrigé (tolère 200/201 vide) |
| WMS v2 — tressage TMS (picking des shipments sortants)                  | ✅    | Relie le WMS au TMS **sans toucher au TMS** : un `PickOrder` gagne un `shipmentId?` (FK, `onDelete SetNull`) ; `PickingService.create` valide `locationId === shipment.originLocationId` (Location `WAREHOUSE`). Le décrément reste à la complétion (règle 33 intacte). L'état « préparé » du shipment est **dérivé** de ses pick orders liés (`deriveShipmentPickStatus`, pur `@pulsar/shared`) — **aucun nouveau `ShipmentStatus`, aucun blocage du dispatch** (règle 2 préservée). `FulfillmentService` : `GET /wms/fulfillment/pending` (shipments sortants origine entrepôt + statut de préparation dérivé) + `GET /wms/fulfillment/shipments/:id`. **Web** : workbench `/wms/fulfillment` (file sortante → « Créer le pick order » pré-rempli → suivi), réf `↔ SH-…` + filtre `?shipmentId` sur `/wms/picking`. 27ᵉ migration ; règle 33 (clause v2) ; unit (`deriveShipmentPickStatus` + validation du lien) + e2e `wms-fulfillment` 5/5 (NOT_PICKED→PICKING→PICKED + décrément, rejet origine≠location) ; **vérifié au navigateur** (shipment « À préparer » → pick lié → complété → « Préparé » dérivé). Lane WMS only (zéro collision avec l'agent parallèle sur dispatch/agents/intégrations)                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Yard Management v1 (6ᵉ module métier — cour & quais)                    | ✅    | **3ᵉ module de l'expansion modulaire** (feature pure) : tableau de cour temps réel. **Entités** : `YardSpot` (DOCK_DOOR/PARKING/STAGING dans une Location), `YardVisit` (gate `CHECKED_IN→ASSIGNED→DEPARTED`, n° YV-, remorque Fleet optionnelle **ou** `trailerRef` libre + carrier optionnel), `YardMove` (journal append-only des changements de spot), `DockAppointment` (rendez-vous `SCHEDULED→ARRIVED→COMPLETED`, n° DA-, une visite l'honore). **Occupation dérivée** (un spot porte au plus une visite active — refus **409** sinon) ; chaque changement de `spotId` écrit un `YardMove` dans la **même transaction**. **API** gated `@RequireModule(YARD)` + 2 permissions `yard.read                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | manage`:`/yard/spots`, `/yard/visits`(+assign/move/check-out/cancel),`/yard/appointments`(+arrive/complete/cancel/no-show),`/yard/overview`, `/yard/board`. **Web** : groupe nav Yard, **tableau de cour `/yard`** (sélecteur de site, KPI, grille spots portes/parc avec occupant, file « À placer » + Affecter/Déplacer/Check-out), gate `/yard/gate`(check-in + visites actives),`/yard/appointments`, `/yard/spots`. 28ᵉ migration ; règle 34 ; unit (transitions visite/rendez-vous + `isSpotOccupied`) + e2e `yard-module` 8/8 (check-in→assign→move→check-out, occupation 409, rendez-vous lié) ; **vérifié au navigateur** (spots → gate check-in → board affecter porte → check-out → porte libérée). Module isolé, zéro collision                                                      |
| Control Tower de flux v1 (arc A)                                        | ✅    | **3 endpoints read-time** `GET /analytics/flow/{timeline,map,trace}` calculés à la lecture depuis `DomainEvent`/`OperationalTask`/`ProposedAction` via les helpers purs `buildFlowChains`/`buildFlowMap`/`buildEntityTrace` (`@pulsar/shared/analytics/flow`) — **aucun rollup, 1 migration (index seul, aucun nouveau modèle)** (`flow_event_subject_index` index composite performance) ; gated `@RequireModule(ANALYTICS)` + `analytics.read` ; **2 outils agent READ** (`get_flow_timeline`, `trace_entity`) ; page web `/analytics/flow` (3 onglets : timeline causalité event→task, tracé d'entité 6 étapes, carte inter-modules) ; règle 35                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Yard Plan v2 — plan visuel de la cour (1er « outil » Fleetbase)         | ✅    | **Élévation UI** : `/yard` passe de la grille de cartes à un **plan 2D interactif**. `YardSpot` += `posX/posY` (**display-only**, 29ᵉ migration) ; `PUT /yard/spots/layout` (sauvegarde groupée tenant-scopée) ; `GET /yard/visits/:id` inclut le journal `moves`. **Web** : `YardPlan.svelte` (canevas grille, **glisser-déposer HTML5 natif** zéro dépendance), `YardContextDrawer.svelte` (détail visite + **séjour live** + journal des mouvements + Déplacer/Check-out). **Mode édition de disposition** (glisser les spots sur la grille → Enregistrer) + **mode opération** (glisser une remorque « à placer » sur une porte = affecter, tuile occupée → autre = déplacer, clic = tiroir). Occupation/affectation **inchangées** (règle 34, posX/posY n'affectent jamais la logique). e2e `yard-plan` 3/3 (layout persiste, scoping, journal des mouvements) ; **vérifié au navigateur** (drag spots → enregistrer → drag-affecter une remorque → tiroir séjour+journal). Premier des outils visuels demandés par Sam (« outils, pas formulaires ») ; ma lane (l'autre agent fait le re-stylage web-only)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| TMS configurable v1 — règles configurables + champs personnalisés       | ✅    | **Réglages par tenant** via `PUT /modules/transportation/settings` (catalogue partagé `@pulsar/shared`) : `requireTendering` OPTIONAL/REQUIRED/DISABLED (gate au dispatch — tender accepté obligatoire, ou création de tender bloquée) ; `podRequiredBeforeCompletion` (gate à `complete`) ; `bolRequiredBeforeDispatch` (gate au dispatch — document `bill-of-lading` requis) ; `windowCoherence` STRICT/LENIENT (bypass de `assertWindowCoherence` à la création d'ordre) ; préfixes de documents `documentPrefixTransportOrder                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Shipment                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Load`(résolus dans`SequencesService`, **compteur indexé sur la clé jamais le préfixe**). **Champs personnalisés** : `PUT /transportation/custom-fields`(définitions TEXT/NUMBER/DATE/BOOLEAN/SELECT,`required`/`showInList`/`sortOrder`, validées par `validateDefinitions`de`@pulsar/shared`) ; `GET /transportation/custom-fields?entityType=`;`customData`accepté/validé par`validateValues`sur`POST/PATCH transport-orders`et`POST loads`avant persistance — jamais écrit sans validation (règle 35). Isolation tenant stricte (définitions et valeurs scopées`tenantId`). **Aucune migration supplémentaire** (colonnes `customData Json?`déjà présentes) ; règle 35 ; e2e`tms-configurable` 16/16 (5 réglages comportementaux + préfixe + custom fields + isolation) |
| CRM — courriel bidirectionnel + threads                                 | ✅    | Réception d'emails entrants via `InboundEmailDriver` (log/IMAP) + `InboundIngestService` idempotente sur `messageId` (threading RFC, match `CrmContact.email`, best-effort par tenant) ; `EmailThread` rattaché aux contacts/companies/deals + `EmailMessage` réutilisé (`direction` INBOUND/OUTBOUND) ; API `/crm/threads` (list/get/reply/link/archive) + 2 outils agent (`crm_read_threads` READ, `crm_reply_thread` SENSITIVE via `ProposedAction`) ; inbox `/crm/inbox` + config IMAP par tenant (`hasImapPassword` — secret chiffré, jamais renvoyé) ; endpoint `/crm/simulate-inbound` dev/CI ; e2e `crm-email-threads` ; règle 39                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| CRM — intelligence : kanban refait + coach de deals                     | ✅    | **Kanban pipeline enrichi** : glisser-déposer des deals entre colonnes, signaux stale/âge (`isDealStale`/`dealAgeDays` purs, `@pulsar/shared`) colorés par ancienneté, filtres et résumé par stade ; outil agent `crm_get_deal` (READ, contexte complet contact+company+threads) ; **coach de deals** `/crm/coach` — page turnkey + chat SSE vers un agent Hermes (`deal-coach` preset `@pulsar/shared`), créé via `POST /agents` sans nouveau cycle de module, actions inline approuvables ; gouvernance inchangée (ProposedAction via tier, Hermes best-effort 503→message) ; unit `deal-signals.spec.ts` + e2e `crm-get-deal`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| CRM — catalogue produits + lignes de produit sur les deals              | ✅    | **`CrmProduct`** (catalogue tenant : nom, code, prix unitaire, unité, description, archivage avec guard delete) + **`CrmDealLineItem`** (lignes associées à un deal : `productId?`, `name`, `quantity`, `unitPrice`, `discountPct`, montant calculé) ; `deal.amount` **recompute transactionnel** à chaque mutation de lignes (`sumLineItems` pur `@pulsar/shared`) ; outil agent `crm_list_products` (READ) ; **page `/crm/products`** (catalogue) + **page détail deal `/crm/deals/[id]`** (infos du deal + éditeur de lignes inline avec total live) ; e2e `crm-products` (recompute, delete-guard, isolation)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| CRM — commandes de vente                                                | ✅    | **`SalesOrder`** (cycle de statut DRAFT→CONFIRMED→FULFILLED→INVOICED→CANCELLED via `canTransitionSalesOrder`, `@pulsar/shared`) + **`SalesOrderLineItem`** (recompute `totalAmount` sur chaque mutation, garde DRAFT-only) ; séquence `SO-` ; **conversion depuis un deal gagné** (`POST /crm/deals/:id/create-sales-order`, copie les lignes du deal) ; API CRUD `/crm/sales-orders` gated `crm.manage` + `@RequireModule(CRM)` ; **pages web** `/crm/sales-orders` (liste paginée avec filtres statut/recherche) + `/crm/sales-orders/[id]` (détail + éditeur de lignes + actions de transition) + bouton « Créer une commande » sur le détail deal WON ; e2e `crm-sales-orders`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| CRM — événements de jalon + lien finance auto                           | ✅    | **Événements de jalon CRM** : `crm.deal.won` émis sur `POST /crm/deals/:id/advance` (→ WON) ; `crm.sales_order.confirmed` et `crm.sales_order.invoiced` émis sur les transitions SO correspondantes. **Lien finance auto (header v1)** : règle built-in seedée `crm.sales_order.invoiced → draft_invoice_from_sales_order` (réaction `REACTION_CATALOG`, `@pulsar/shared`) → `CustomerInvoicesService.createDraftFromSalesOrder` (idempotente sur `customData.salesOrderId`, header `CustomerInvoice DRAFT` avec total SO + soLines snapshot, aucune ligne FK transport — v1 gap connu) ; no-op si `customerId` absent ; e2e `crm-cross-module` 6/6 (deal.won, SO.invoiced, reaction→DRAFT, idempotence, sans-customer, isolation)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Billing configurable v1 (arc C — gabarit pour les autres modules)       | ✅    | **Réglages par tenant billing** via `PUT /modules/billing/settings` : `autoSendOnApproval` (approve → SENT si email client présent, best-effort) ; `toleranceMode` MAX/MIN (seuil de rapprochement = max ou min de l'absolu et du %) ; `invoiceNumberPrefix` / `customerInvoiceNumberPrefix` (préfixes `SequencesService` — compteur jamais remis à zéro) ; `defaultCurrency` (utilisé par `FreightAuditService.create` et `InvoicesService.createDraft`). **Champs personnalisés billing** : `PUT /billing/custom-fields` (définitions pour `INCOMING_CARRIER_INVOICE` ; `CustomFieldsService` générique `core/custom-fields` paramétré par `module`) ; `customData` validé par `validateValues` à l'intake `POST /freight-audit/incoming-invoices` — requis manquant ou option hors liste → 400 ; champ valide → 201 + `customData` visible au GET ; isolation tenant stricte. **Aucune migration supplémentaire** (colonnes et service générique hérités). e2e `billing-configurable` 17/17 (autoSend×2, toleranceMode MIN/MAX, préfixes, devise, custom fields 4 cas, isolation)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Billing — grand livre double-entrée + facture libre CRM                 | ✅    | **Grand livre double-entrée** : `ChartOfAccount` (plan comptable tenant, plan par défaut `DEFAULT_CHART` seedé — 7 comptes) + `JournalEntry`/`JournalLine` (toute écriture via `LedgerService.post`, `isBalanced` obligatoire, idempotent sur `(tenantId, sourceType, sourceId, sourceKind)`) ; auto-post best-effort depuis approve/pay (configurable `ledgerAutoPost`) ; trial balance calculée à la lecture ; `normalBalance` dérivé de `AccountType`, jamais persisté. **Facture libre CRM** : `CustomerInvoice` issue d'une `SalesOrder` (via réaction `draft_invoice_from_sales_order`) est désormais **itémisée** — crée de vraies lignes `CustomerInvoiceLine` libres (`transportOrderId` null, `source='sales-order'`) ; pas de snapshot `soLines` ; e2e `billing-ledger` ; règle 41                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Billing — Paiements                                                     | ✅    | **`Payment`/`PaymentAllocation`/`ModeOfPayment`** : boucle de paiement complète (RECEIVE client / PAY transporteur) ; allocations multi-factures ; `PaymentsService.submit` poste le GL **transactionnellement** (`sourceType='payment'`) et met à jour `amountPaid` + statut des factures allouées ; `cancel` inverse le GL (`sourceKind='reversal'`) et reverte les factures ; `mark-paid` sur les relevés clients (exige `SENT`) et les factures transporteur crée + soumet un `Payment` en coulisse et retourne la facture mise à jour. Modes de paiement configurables (`ModeOfPayment.accountCode`). Permissions `billing.payments.read                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | manage`; séquence`PMT-`; page web`/billing/payments`(liste + create) +`/billing/payments/[id]`(détail + annuler) ; e2e`payments` 14/14 ; règle 42                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Billing — Taxes multi-taux                                              | ✅    | **`TaxTemplate`/`TaxTemplateLine`** : gabarits SALES (→ relevés clients) et PURCHASE (→ factures transporteur), multi-taux, compte GL par ligne. Application EXPLICITE via `PATCH :id/tax` (DRAFT uniquement) — **jamais auto-appliquée** ; `isDefault` = pré-sélection UI uniquement. `computeTax` pur (`@pulsar/shared`, flat-on-net v1). `totalAmount = netAmount + taxAmount`. Approbation avec taxe > 0 génère une écriture GL **fractionnée** best-effort + idempotente : client → DR AR gross / CR Revenue net / CR compte-taxe ; transporteur → DR Expense net / DR input-tax / CR AP gross. 4 gabarits seedés (Canada GST/HST/QST, Achat GST) ; 9 comptes (dont 1010 banque, 1150 taxe intrants) ; e2e `taxes` 13/13 ; règle 43                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Billing — Rapports financiers                                           | ✅    | **États financiers calculés à la lecture** depuis `JournalLine` (+ `CustomerInvoice`/`IncomingCarrierInvoice` pour le vieillissement) via les helpers purs `buildProfitAndLoss`/`buildBalanceSheet`/`buildAging` (`@pulsar/shared/billing/reports`) — **aucun rollup, aucune migration**. `naturalBalance` (alias de `normalBalance`) dérivé de `AccountType`, jamais persisté. 5 endpoints `GET /billing/reports/{profit-and-loss,balance-sheet,cash-flow,ar-aging,ap-aging}` gated `@RequireModule(BILLING)` + `billing.ledger.read` (aucune nouvelle permission), tenant-scopés (règle 1). Vieillissement par tranches 0-30/31-60/61-90/91-120/120+ jours sur `approvedAt ?? createdAt` ; inclusion si `outstanding > 0`. Page web `/billing/reports` (5 onglets). **Arc Finance Billing complet** (Paiements + Taxes + Rapports, tous sur `crm-email-threads`). e2e `reports` 9/9 ; règle 44                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Billing — Banque & rapprochement                                        | ✅    | **`BankAccount`** (compte bancaire tenant lié à un `glAccountCode`, numéro masqué en projection) + **`BankTransaction`** (manuel ou import CSV via `parseBankCsv` pur `@pulsar/shared`, création des lignes telles quelles) ; **rapprochement 1:1** (`POST :txnId/match { paymentId }`) — filtre les candidats sur `ModeOfPayment.accountCode == glAccountCode`, claim via deux `updateMany` conditionnels dans une transaction (`UNRECONCILED→RECONCILED` + `Payment.reconciledAt`) ; dématch (`POST :txnId/unmatch`) ; **aucune écriture GL depuis Banking** (clearing sub-ledger, règle 41 préservée) ; `Payment.reconciledAt` est un marqueur uniquement (ne modifie jamais `status` ni `amountPaid`). Gated `@RequireModule(BILLING)` + `billing.ledger.read                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | manage`. Page web `/billing/banking`(onglets comptes/transactions/rapprochement) ; e2e`banking` 10/10 ; règle 45                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Billing — Budgets annuels                                               | ✅    | **`Budget`/`BudgetLine`** : budgets annuels par compte GL (`accountCode`, `fiscalYear`). La variance est **calculée à la lecture** (`GET /billing/budgets/:id/variance`) — agrège les `JournalLine` sur la fenêtre fiscale, puis `computeBudgetVariance` + `naturalBalance` purs (`@pulsar/shared`) dérivent `actual`, `variance` et `variancePct` par ligne ; **aucune écriture GL, aucun rollup persisté, aucune migration supplémentaire**. Gated `@RequireModule(BILLING)` + `billing.ledger.read                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | manage`(aucune nouvelle permission). Page web`/billing/budgets`. e2e `budgets`17/17 (dont 3 sur`fiscalYearStartMonth` — règle 49) ; règle 46                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Billing — Immobilisations (Fixed Assets)                                | ✅    | **Registre `FixedAsset`** (DRAFT → ACTIVE → DISPOSED via `canTransitionFixedAsset`, claim `updateMany` TOCTOU) + **`DepreciationEntry`** (enregistrement append-only par période). L'amortissement linéaire est calculé par `depreciationForNextPeriod` (pur `@pulsar/shared`) qui plafonne le montant afin que `accumulatedDepreciation` ne dépasse jamais `cost − salvage`. `POST :id/depreciate {period}` exécute une **transaction unique** : crée `DepreciationEntry` (unique `(tenantId,assetId,period)` — P2002 → 409 idempotence), incrémente `accumulatedDepreciation` sur l'asset, et poste le GL via `LedgerService.postTx` (`Dr 5100 dotation / Cr 1590 amortissement cumulé`, `sourceType='depreciation'` — règle 41). Les comptes 5100 et 1590 font partie de `DEFAULT_CHART` (seedés). **Pas d'écriture GL à l'acquisition ni à la cession en v1** (statut-only). Permissions `billing.assets.read                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | manage`; page web`/billing/fixed-assets`; e2e`assets` 9/9 ; règle 47                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Billing — Abonnements (Subscriptions)                                   | ✅    | **`Subscription`/`SubscriptionLine`/`SubscriptionInvoice`** : facturation récurrente par lignes libres (WEEKLY/MONTHLY/YEARLY). Cycle de statut ACTIVE → PAUSED → ACTIVE, ACTIVE/PAUSED → CANCELLED via `canTransitionSubscription` (`@pulsar/shared`, claim `updateMany` TOCTOU). `POST :id/generate` crée une `CustomerInvoice` DRAFT (lignes `source='subscription'`, numéro via `SequencesService` `'customer-invoice'`) + enregistre un `SubscriptionInvoice`, idempotent sur `(tenantId, subscriptionId, periodStart)` (P2002 → 409) + avance `nextRunDate` via `advanceRunDate` (pur, UTC, clamp fin-de-mois) — le tout dans une transaction atomique. **Aucune écriture GL directe** : la facture suit le flux billing normal (approve → GL). `POST /billing/subscriptions/run-due` est best-effort (`{ generated, skipped, errors }`, jamais d'exception globale). Permissions `billing.subscriptions.read                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | manage`; page web`/billing/subscriptions`; e2e`subscriptions` 11/11 ; règle 48                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Billing — Paramètres comptables (Account Settings)                      | ✅    | **`fiscalYearStartMonth`** (number 1–12, défaut 1 = exercice calendaire = comportement existant inchangé) ajouté au catalogue de config billing (`MODULE_SETTINGS_CATALOG`, `@pulsar/shared`) — **aucune entité, aucune migration, aucune nouvelle route**. Exposé sur `/billing/config` via le composant générique `ModuleSettings`. Consommé par `BudgetsService.variance` via la fonction pure `fiscalYearBounds(fiscalYear, startMonth)` (`@pulsar/shared/billing/fiscal`) qui délimite la fenêtre d'agrégation GL ; `startMonth=1` reproduit exactement [1er janv, 31 déc] — zéro régression. e2e `budgets` suite 6 (shift Jan→hors-fenêtre quand `startMonth=4`) 3/3 verts ; afterAll reset à 1 évite tout saignement cross-suite. Extensible vers une entité `FiscalYear` future sans rupture. Unit `fiscal.spec.ts` 3/3. Règle 49                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |

**Suite comptable ERPNext-style complète** (toutes sur `crm-email-threads`) : Paiements (règle 42) · Taxes multi-taux (43) · Rapports financiers (44) · Banque & rapprochement (45) · Budgets annuels (46) · Immobilisations (47) · Abonnements (48) · Paramètres comptables / exercice fiscal (49).

**La boucle économique complète fonctionne** : le client commande depuis son portail →
confirmation → planification (split possible) → tender automatique par lane avec courriel →
acceptation transporteur sans compte → dispatch → exécution mobile chauffeur → suivi public →
POD avec photo → BOL PDF généré → détection automatique des retards → facture transporteur
brouillon → approbation → relevé client.

**Chiffres** : 6 modules métier actifs (transportation, customer-portal, billing, fleet, wms, yard) + le plan
d'administration plateforme ; 29 migrations ; ~90 endpoints (dont `loads/active-map`,
`public/driver/:token/position`, `mcp` / `agents` / `agent-actions` / `agent-conversations`,
`agent-runtime` — install/config du runtime managé, `operational-tasks` / `/workbench`, et
`agents/:id/runs` + pause/resume/run-now/pause-all — main-d'œuvre 24/7) ;
31 pages web sur le design system phase 9 (Tailwind 4, 17 composants partagés) ; carte
opérationnelle live sur le dashboard + cartes Leaflet sur le détail load et le suivi public
(phase 10) ; couche gouvernance d'agents + endpoint MCP exposant 8 outils dispatch sous
validation humaine (phase 11 palier 1) ; agents-employés (cerveau Hermes spawné par
conversation, assistant ⌘K) sur la même file de gouvernance, plafond montant appliqué à
l'auto-approbation (phase 11 palier 2a) ; **runtime Hermes installé via `pnpm agents:setup`
(uv) et configuré par tenant dans Pulsar — clé chiffrée ou login OAuth** (phase 11 R1) ;
**agents promus citoyens de premier ordre** — roster, profil + config guidée (presets de rôle),
activité et chat sur `/agents` (phase 11 R2) ; **Operating Workbench** — outbox DomainEvent,
policies événement→tâche pures, inbox `/workbench`, WorkbenchAgentRunner headless best-effort,
4 outils workbench + `triggeredByRef` (phase 12) ; **main-d'œuvre 24/7** — `AgentWorkerService`
dispatcher (event + cron, concurrence plafonnée), `AgentRun` ledger durable + heartbeat, `PAUSED`
kill switch à chaud tuant les sessions Hermes en vol, retry borné sur connectivité, revert
claim-guarded, UI « Activité 24/7 » (phase 13) ; **autonomie & policy engine** — porte de
policy unifiée (`evaluatePolicy` pur, point de décision unique), policy-as-data
(`caps.policies` + preset du dial d'autonomie, rétro-compatible), auto-exécution persistée
dans le registre des propositions (cap débit fermé sur le chemin auto), circuit breaker
réversible (rétrograde en PROPOSE, jamais d'escalade) et promotion d'autonomie confirmée par
un humain (phase 14) ; **Control Tower — observabilité** — KPI par agent, dashboard manager du
tenant, timeline d'activité/audit unifiée, compteur de trips de breaker alimentant le score de
confiance, **calculés à la lecture** depuis `AgentRun`/`ProposedAction`/`OperationalTask`/`AuditLog`
(`deriveAgentKpis`/`mergeTimeline` purs, aucun store de rollup, **aucune migration** — toujours 23)
(phase 15-A) ; **Freight Audit autonome (Acte II)** — `IncomingCarrierInvoice` découplé, matching
déterministe (`FreightAuditService`) contre `Load.estimatedCost` figé (règle 16) via
`evaluateReconciliation`, transitions par `canTransitionFreightAudit`, agent litige via la file de
gouvernance (`ProposedAction`, `triggeredByRef`, cap sur `varianceTotal`), KPI économies récupérées
(`recoveredAmount` sur `KEEP_EXPECTED`), 24ᵉ migration (phase 16, règle 31) ; **pivot produit
vers des postes de travail opérationnels** — premier livré : **Dispatch Workbench v1**, surface
`/dispatch` 3 panneaux (backlog non assigné → load builder avec capacité 3 axes en direct + stops

- coût → side panel carte + rate options + tender) ; polish nav/shell (groupes ouverts par défaut,
  entrée Dispatch, surfaces agent dé-doublonnées) ; 2 ajouts backend (`GET /shipments?unassigned=true`,
  `POST /loads/consolidate` atomique), **aucune migration, aucune nouvelle règle** (réutilise
  les invariants existants 6/8/9/11/16/18) ; postes suivants à venir (Load Control Room, Agent
  Operations Center, Exception Desk, Rate Explorer, Workflow Config Designer ; panneau agent +
  drag/drop = workbench v2).

## Carte de la documentation

| Besoin                                               | Document                                                                        |
| ---------------------------------------------------- | ------------------------------------------------------------------------------- |
| Utilisation métier, parcours écran par écran         | [guide-fonctionnel.md](./guide-fonctionnel.md) 🇫🇷                               |
| Architecture, guards, décisions                      | [architecture.md](./architecture.md)                                            |
| Modèle de données et workflow                        | [data-model.md](./data-model.md)                                                |
| Liens publics, clés API, courriel, webhooks, billing | [collaboration.md](./collaboration.md)                                          |
| Isolation tenant / système de modules                | [multi-tenancy.md](./multi-tenancy.md) · [module-system.md](./module-system.md) |
| Conventions REST                                     | [api-conventions.md](./api-conventions.md)                                      |
| Démarrage local                                      | [getting-started.md](./getting-started.md)                                      |
| Connexion d'un agent IA (MCP) / Hermes               | [agents.md](./agents.md)                                                        |

## Sites — pages de destination & formulaires (module CRM-marketing)

Module `SITES` livré : `LandingPage` (slug globalement unique, statut DRAFT/PUBLISHED — publish/unpublish, audité, pas de machine d'états — contenu structuré validé par `validateLandingContent`) + soumissions de formulaire créant un lead CRM (`CrmContact`) quand le module CRM est actif (résolution `ModuleRef`, pas d'import statique) ; honeypot `_hp` silencieux ; payload public projection stricte sans `tenantId` (règle 40) ; pages web `/sites` (liste) + `/sites/[id]` (éditeur) + `/p/[slug]` (rendu public) ; e2e `sites.e2e-spec.ts` ; 30ᵉ migration.

## Session — Tressage automatique v1 (arc B) (2026-06-21)

Branche `cross-module-automation`. **Arc B complet** : 8 tâches livrées — moteur de réactions
déterministes (`RUN_ACTION`) branché sur l'outbox `DomainEvent` (phase 12) ; règles de réaction
stockées + éditeur UI ; 2 réactions built-in seedées (planification order → auto-pick WMS ;
livraison load → relevé client Billing) ; `ReactionExecution` ledger (unique sur
`(tenantId, eventId, ruleId)`, idempotent) ; anti-boucle single-hop (`DomainEvent.reactionRuleId`
⇒ RUN_ACTION non ré-évalué) ; gating module/règle best-effort jamais bloquant. Fix de cycle
JS circulaire dans `AutomationModule` (`ReactionExecutorService` résout `PickingService`/
`CustomerInvoicesService` via `ModuleRef` + lazy `require()` au lieu d'imports statiques qui
créaient le cycle `operating→automation→wms→operating`). Suite e2e
`cross-module-automation.e2e-spec.ts` 10/10. Suite complète 228/230 (1 flake cross-suite
phase16 S6.2 — passe en isolation 16/16 ; 1 skip phase13 timing connu).

## Session de stabilisation + framework de config (2026-06-20)

Branche `test-stabilisation` (depuis `main` post-merge PR#38). Deux blocs : (1) **stabilisation** —
correction d'une fuite cross-tenant en écriture (import CSV), flux award procurement cassé
(`@IsUUID` sur des CUID), crash page détail RFP, ownership freight-audit/connect, + specs e2e
procurement/connect ; e2e 214/214 (phase13 flake de pollution transitoire connu). (2) **Module
Configuration Framework** — réglages par tenant × module, catalogue déclaratif pur
(`@pulsar/shared`), `ModuleSettingsService` sur `TenantModule.settings` (aucune migration),
`GET/PUT /modules/:key/settings` (audité), panneau UI générique `/settings/modules/[key]` + entrée
« Configuration » par module ; 6 modules câblés (procurement bidUniqueness/award-rate, connect
locale CSV, carrier-portal POD, billing tolérances rétro-compat, fleet fenêtre conformité,
transportation capacité WARN/BLOCK + auto-tender). **Différés** : TTL token carrier-portal (migration),
seuils de mode (inertes — pas de consommateur API de `suggestMode`). Spec/plan :
`docs/superpowers/specs/2026-06-20-module-config-framework-design.md` + `.../plans/...`.

## Prochaine session — Pulsar Agent OS (phases 15 → 22)

> **Priorité immédiate (2026-09-17)** : la branche `access-module-core-locations` porte trois arcs
> non mergés (Accès & Lieux cœur, comptes portail + Quoi de neuf, pickers/portail v2/connecteurs).
> La passe de correction post-revue finale est faite (voir le bloc en tête de document) : ouvrir la
> PR. Le reste de cette section suit ensuite.

La **phase 16 est livrée** (Freight Audit autonome — début de l'Acte II) sur la branche
`phase-16` (suite des phases 12 → 15-A livrées). PR à ouvrir vers `main`.

La direction est verrouillée : voir la **roadmap stratégique adoptée le 2026-06-14**,
[docs/superpowers/specs/2026-06-14-pulsar-agent-os-roadmap.md](./superpowers/specs/2026-06-14-pulsar-agent-os-roadmap.md).
North star = **OS logistique modulaire où des agents Hermes tournent 24/7 comme employés
gouvernés**. Arc = agents d'abord (approfondir sur les 3 modules actuels), puis modules tressés
— chaque nouveau module arrive avec son agent.

- **Acte I (substrat 24/7)** : ~~12 Operating Workbench~~ ✅ · ~~13 Main-d'œuvre 24/7~~ ✅ ·
  ~~14 Autonomie & policies~~ ✅ · ~~15-A Control Tower (observabilité)~~ ✅ ·
  15-B red-team (prompt-injection + cross-tenant) · 15-C playbooks.
- **Acte II (agents phares)** : ~~16 Freight Audit autonome (§19.4)~~ ✅ · 17 Planification continue (§19.5).
- **Acte III (modules tressés, ré-ordonnable)** : 18 Integrations · 19 Yard · 20 Fleet · 21 WMS ·
  22 Analytics/réseau de données.

**Prochain pas concret** (au choix de Sam) : poursuivre l'Acte II avec **phase 17 — planification
continue** (§19.5 : plans/routes versionnés, mutables-après-confirmation avec diff,
`PlanProposal`/`PlanCommit`) ; ou pivoter vers les modules de l'**Acte III** (18 Integrations,
19 Yard, 20 Fleet, 21 WMS, 22 Analytics) ; ou revenir finir la phase 15 (**15-B** red-team
prompt-injection + cross-tenant, **15-C** playbooks). Pulsar reste **MCP-agnostique** ; Hermes
est le runtime de référence.

Benchmark Fleetbase (2026-06-12) : aucune IA chez eux — c'est l'axe de différenciation.

### Dette connue à garder en tête (ne pas « réparer » en silence)

- Permissions dans le JWT → effet au prochain refresh (≤15 min) — assumé ; même fenêtre
  pour les access tokens d'un tenant suspendu (documenté dans platform-tenants.service.ts).
- Cache modules en mémoire processus → passer à Redis quand l'API scale horizontalement.
- Courriels : driver `log` en dev ; tender/identité/livraison/invitation plateforme envoyés.
- Route v0 auto-générée (éditeur manuel dispo) ; pas de re-split après exécution.
- Webhooks limités à 5 tentatives ; configs d'intégration legacy encore en clair jusqu'au
  premier passage du script `reencrypt-secrets` (sweep initial documenté dans runbooks.md).
  Depuis l'arc 3 (règle 55) l'outbox porte **tout** le catalogue d'événements métier : une
  intégration sans liste `events` est abonnée à tout, et le garde d'egress est une défense au
  niveau de la chaîne (pas de résolution DNS) que `attempt()` ne rejoue pas.
- L'utilisateur `service-account@pulsar.local` apparaît dans la page Users (cosmétique).
- ~~UI MFA plateforme absente~~ — **réglé en fin de phase 9** : `platform/login` gère
  les 4 états (credentials → TOTP/recovery → enrôlement forcé avec secret manuel →
  affichage unique des recovery codes). Pas de QR code (secret + URL otpauth copiables) —
  une lib QR est un petit plus futur si besoin.
- Le driver S3 (restauré en phase 6 après l'incident `.gitignore`) n'a jamais tourné en CI
  (CI = driver local) — smoke test contre un vrai bucket avant le premier déploiement S3.
- `pnpm-workspace.yaml` local porte des placeholders auto-générés par pnpm (« set this to
  true or false ») et un `package-lock.json` parasite traîne — à nettoyer hors phase.
- `routes.createForLoad` : check de statut puis OSRM (≤3 s) puis deleteMany+create hors
  transaction — fenêtre TOCTOU élargie ; à envelopper dans une transaction avec re-check.
- `loads/active-map` : requête « dernière position par load » non bornée (dédup en JS) —
  passer à `DISTINCT ON` ou borner temporellement, et prévoir une purge des POSITION_UPDATE.
- Règle 15 incohérente sur les anciens handlers publics : seul `driver/:token/position`
  re-vérifie l'activation du module (getTracking/getDriverView/driverUpdateStop/driverCreatePod
  ne le font pas — préexistant, à harmoniser).
- Throttle Nominatim 1 req/s in-process : mono-instance seulement (à revoir avec le passage
  Redis du cache modules).

### Reprendre l'environnement

```bash
cp .env.example .env && pnpm setup     # si nouvel environnement
pnpm db:up && pnpm db:migrate && pnpm db:seed
pnpm dev                               # admin@pulsar.dev / admin123 (tenant acme)
pnpm test && pnpm test:e2e             # e2e = DB démarrée + seedée requise
```

Dans l'environnement cloud de session : PostgreSQL local (`service postgresql start`),
base `pulsar` + shadow `pulsar_shadow` ; les migrations se génèrent en non-interactif via
`prisma migrate diff` + `migrate deploy` (voir l'historique des migrations pour le motif).
