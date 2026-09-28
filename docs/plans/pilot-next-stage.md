# Prochain palier Pulsar — cinq priorités approuvées

Décision du 27 septembre 2026 : lancer les cinq axes proposés après revue de la
roadmap. Ce document fixe l'ordre actif; les anciennes phases restent des archives
de livraison, pas un indicateur de disponibilité client. Branche conservée :
`codex/pilot-business-depth`; changements non publiés préservés.

## Ordre actif et critères de sortie

| Priorité                  | Travail                                                                                                        | Preuve attendue pour terminer                                                                                   |
| ------------------------- | -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| P1 — Pilote fiable        | Révision livrée, CI, migrations, permissions, restauration, VPS/TLS, invitations et documents                  | Révision approuvée installée sur la cible, recette datée et restauration démontrée; le local seul ne suffit pas |
| P2 — Dossiers et UX       | Client 360°, origine/état/blocage/prochaine action, création contextuelle, configuration progressive           | Parcours sans ressaisie; sections et compteurs filtrés selon droits/modules; apps autonomes                     |
| P3 — Services complet     | Devis → projet → intervention → temps/pièces → validation → facture → SAV/correction                           | Nominal, partiel, correction, rôle limité, panne/reprise et concurrence avec preuves aval                       |
| P4 — Finance à deux modes | Externe : échanges/maître et rapprochement; natif : périodes, corrections, change, sous-livres et affectations | Choix par entreprise, sources et totaux réconciliés par devise; aucune dette inférée d'un registre documentaire |
| P5 — IA qualifiée         | Missions SAV/MRP/exceptions, vrai fournisseur, budget, qualité, refus et reprise worker                        | Propositions sourcées, droits/caps, coûts/latence mesurés, interruptions et instructions malveillantes testées  |

P1 commence maintenant, puis P2/P3 sur Services, choix précédent du propriétaire.
Transport (POD/quantités/partiels/remanifestes) et Fabrication (exécution partielle,
replanification WIP) gardent des lots spécialisés. Le premier pilote concret peut
faire évoluer leur priorité. Location/POS/restauration/e-commerce restent ultérieurs.
L'ancien axe Location du 22 septembre n'est ni supprimé ni annoncé comme implémenté.
La reprise prospective des anciens actifs I2m.2d.2e.2 reste au backlog Finance :
elle ne bloque pas un pilote qui n'utilise pas ces historiques.

## P1a — précontrôle du pilote

Livraison locale : Administration SaaS → Exploitation → **Préparer le pilote**.
Services/Transport/Fabrication et l'option agents sont des filtres de recette,
jamais une activation de modules ou une modification de configuration.

- Observations API/base, migrations attendues/appliquées, révision déclarée et
  politique d'enrôlement MFA. Courriel global distinct de la remise réelle.
- APS n'est requis qu'en Fabrication; son absence ne bloque pas Services. Le runtime
  agents n'est requis que si l'opérateur inclut l'IA dans le périmètre.
- Restauration, HTTPS, isolation/permissions, charge/reprise, métier complet,
  rôle comptable, scanners et vraie mission IA demeurent **à vérifier**. Aucun bouton
  ne les valide arbitrairement. Aucune preuve opérateur persistée dans ce lot.
- Export JSON : date, environnement/version déclarés, périmètre et contrôles;
  pas de contenu client, compteurs d'entreprises, clés ni erreurs brutes.
  Export désactivé pendant le rafraîchissement et après échec; les anciennes
  observations restent visibles et explicitement périmées.
- Conclusion : « blocages détectés » ou « recette terrain encore requise ».
  Jamais « prêt production », pourcentage de maturité ou certification automatique.

### Comparaison des migrations

Lecture bornée des scripts livrés et de `_prisma_migrations`, sous `PlatformController`.
Comparaison des noms et empreintes SHA-256; LF/CRLF équivalents, SQL modifié divergent.
Non appliquées, tentatives non terminées, doublons ou migrations actives hors version
bloquent le précontrôle. Tentatives rolled-back ignorées. Lecture indisponible =
inconnu, jamais zéro. Aucun SQL de migration exécuté ni historique réparé.

Le contrôle compare l'historique déclaré aux scripts, pas tous les objets du schéma :
les changements SQL manuels nécessitent leur propre revue. Un SHA déclaré ne prouve
ni l'origine de l'image ni la CI. Une politique MFA imposée ne prouve ni une connexion
réelle avec second facteur ni la révocation des sessions déjà émises.

### Portée d'exécution

Accès SSH non confirmé : le propriétaire ne sait pas encore si un alias existe.
Pas de tentative VPS, modification DNS/TLS, email réel, appel LLM payant ou runtime
distant. Aucun commit/push/PR automatique. Base locale isolée, aucun seed global.

## Lots suivants

### P1b — version candidate et serveur

Définir le périmètre complet et exclure secrets/stockage du commit; passer tests,
types, builds et revue des migrations. Une PR de livraison après revue du périmètre,
CI verte sur le SHA retenu. Avec accès confirmé, inspecter Docker/Nginx sans arrêter
les services voisins puis suivre [le runbook OVH](../../deploy/ovh/README.md).
Recette : SHA/image, TLS, mise à jour, restauration séparée base/documents/clés,
deux entreprises et rôles limités, invitations, documents et absence de doublons.

### P2a — dossier client 360° en lecture seule

Livré localement : [contrat P2a](customer-workspace.md), bouton Dossier 360° dans les
fiches partagées. Huit sections selon droits, recherche/pagination serveur et liens
sources. Aucun solde, prochaine action calculée ou création cross-module ajouté.

Partir des correspondances explicites Customer/BusinessPartner/CrmCompany. Aucune
fusion par nom ou transitivité implicite. Sections CRM, Services, Facturation et
SAV filtrées avant requêtes et compteurs selon droits/modules de chaque cible.
Pagination serveur, pas de total interdevises; liens vers dossiers exacts, données
inaccessibles non exposées. Clients reste facultatif pour les apps autonomes.
Premier lot : navigation/synthèse, pas de writers cross-module supplémentaires.

### P3a — exceptions Services

Intercalé C3a : [communications de dossier](dossier-communications.md), SMS/courriel
humains depuis client, intervention, opportunité et expédition; préférences avec
preuve, modèles et historique local à la source. Réponses et réactivation STOP
restent une suite explicite, sans déclarer la recette fournisseur ou P3 terminés.

Premier chaînon livré localement : [acceptation des travaux P3a.1](services-work-acceptance.md).
Option par projet avant activation, réponses client consignées/historisées,
contrôle des sources à facturer et de la clôture. Le scénario complet de correction
après facturation reste à qualifier; ce lot ne clôt pas P3.

Inventorier l'existant avant d'ajouter : devis figés, affectations, habilitations/
absences, temps approuvés, pièces/retours, facture/avoir et SAV. Scénario d'entreprise
avec acceptation des travaux, retour partiel et correction après facturation.
Compléter les chaînons manquants; stock et finance restent distincts, compensation
et audit obligatoires. Les formulaires avancés doivent conserver une saisie simple.

### P4a — Finance externe/natif

Choisir le maître par objet et le logiciel externe avant l'adaptateur. Un export
n'est pas une synchronisation : identifiants source, version, devise, accusés/rejets,
anti-doublon et rapprochement à spécifier. En natif, contrat de périodes/corrections
avant sous-livres. Politiques fiscales et usages officiels à valider avec le métier;
ne pas déverrouiller implicitement les anciens actifs.

### P5a — mission gouvernée en PROPOSE

Mission SAV ou MRP, tenant de recette, provider et budget explicitement autorisés.
Corpus nominal, droits restreints, source changée, contenu malveillant et interruption.
Mesurer propositions valides/refus attendus/coût/latence/reprise. Traiter la récupération
des runs durables avant de multiplier les réveils; aucune autonomie hors caps.

## Règle de livraison commune

Par lot : règles et provenance, tests métier/droits/panne/concurrence, UI bureau/mobile,
aide, Documentation et tutoriel adapté lorsqu'il existe. Pas de reset des tours ni
de nouveau bouton permanent. Distinguer développé localement, testé localement,
validé sur VPS et accepté par utilisateur. Les 271 exigences enterprise ne sont pas
déclarées closes par cette feuille de route. Résultats : `docs/etat-du-projet.md`.
