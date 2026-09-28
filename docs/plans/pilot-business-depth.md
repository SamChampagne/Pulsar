# Pilote métier fiable — programme en cinq axes

> Ordre actif actualisé le 27 septembre : [prochain palier](pilot-next-stage.md).
> Le présent document conserve le programme et les preuves du 22 septembre;
> Location reste ultérieure aux cinq priorités nouvellement approuvées.

Demande du 22 septembre 2026 : commencer les cinq axes proposés après analyse.
Branche : `codex/pilot-business-depth`, issue de `codex/end-user-workflows`.
Ce programme prolonge les fonctions existantes; une ligne planifiée n'est pas une
fonction livrée. Aucun déploiement, achat, appel LLM payant ou envoi client implicite.

## Ordre et critères de sortie

| Axe                       | Lots                                                                                                                                                           | Critère de sortie                                                                                                            |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 1. Pilote fiable          | Restauration isolée base/documents, connexions sortantes, permissions, recette multi-profils, observation et charge                                            | Une mise à jour/restauration rejouable, données et secrets préservés, aucune fuite inter-tenant; recette VPS datée           |
| 2. Parcours complets      | Services : retours partiels/avoirs; Achats : retours et rapprochement; Qualité : quarantaine/libération; Fabrication : avancement et replanification partielle | Chaque exception passe par une action auditée et compensatoire, sans altération des sources facturées ni du journal de stock |
| 3. Dossiers connectés     | Vue client liée Catalogue/CRM/Services/Facturation/SAV; liens réciproques; création contextuelle; recherche et configuration guidée                            | Un opérateur retrouve origine, état, blocage et prochaine action sans ressaisie; sections filtrées par droits/modules        |
| 4. IA utile et fiable     | Qualification fournisseur, reprise après interruption, missions planning/SAV/MRP, mesures coût/qualité/latence                                                 | Actions sourcées et approuvées, budgets respectés, reprise sans exécution aveugle d'une demande au résultat incertain        |
| 5. Location d'équipements | Disponibilités, réservations, contrats, départs, retours/inspection; connexions explicites                                                                     | Conflits de réservation bloqués, retour endommagé traité, documentation et tutoriel métier; aucun faux encaissement          |

Les axes 2 et 3 avancent sur Services en premier. Le lot Fabrication garde la
protection actuelle contre la replanification d'un OF commencé tant que le vrai
reste à produire/temps restant n'est pas modélisé. La Location nécessite ses
propres tables et workflows, pas une copie des actifs Flotte ni une mutation
implicite des soldes WMS. Commerce, restauration et e-commerce restent ultérieurs.

## Premier lot — socle de pilote

- [x] Transport webhook/EDI : résolution DNS vérifiée à chaque tentative,
      adresse épinglée pendant la connexion, redirections refusées, délai borné,
      réponses et erreurs sans contenu secret.
- [x] Réactivation d'un connecteur : revérifier la configuration existante et
      les droits d'écriture de sa cible, même pour un PATCH de statut seul.
- [x] Respecter la désactivation avant les tentatives de livraison en attente.
- [x] Étendre la qualification Docker avec dump/restauration de base et fichiers
      dans un second projet jetable, preuve d'intégrité et reconnexion après reprise.
- [x] Tests de régression, documentation opérateur et documentation intégrée.

Une mise à jour de connexion vérifie aussi `updatedAt` au moment d'écrire; une
cible changée entre la validation des droits et l'écriture renvoie 409. La version
avance au moins d'une milliseconde. Désactiver reste permis pour une configuration
ancienne invalide. Les reprises suspendues ne consomment pas le quota du cron.

## Preuves du premier lot

- API : 648 tests unitaires réussis dans 88 suites (passe finale complète).
- Web : 119 tests unitaires réussis dans 18 suites, dont le contrat documentaire.
- HTTP : 14 scénarios Connect sur la base isolée `pulsar_enduser_20260921`,
  avec vrai serveur local, signatures, suspension/reprise et redirection refusée.
- Transport : cas DNS mixtes public/privé, adresse épinglée sur une vraie socket,
  Host conservé, IPv4/IPv6, refus production du drapeau dev et timeout réel.
- Images API et compilation web construites; exercice Docker de restauration
  réussi dans deux projets jetables, sans tenant de démonstration. Le document
  témoin teste l'intégrité binaire du stockage, pas le parcours d'upload métier.
- Aucun schéma/migration modifié, ni `.env`, ni base client; stockage local
  utilisateur non publié. Pas de push, fusion, PR supplémentaire ou déploiement.

Pas de nouvelle campagne navigateur complète : seules les explications intégrées
changent côté web. Les avertissements Svelte et les handles Jest HTTP nécessitant
`--forceExit` restent des dettes préexistantes, sans suppression de contrôle.
La garantie webhook reste « au moins une fois » : pas de claim distribué ajouté
à l'outbox, une réponse perdue ou des dispatchers concurrents peuvent dupliquer
une livraison. Le partenaire déduplique son identifiant. Filtrage réseau sortant
du VPS et politique de rétention restent à qualifier séparément.

## Deuxième lot — retours partiels Services

- [x] Journal de retours physiques successifs, cumul borné, versions et idempotence;
      migration des anciens retours sans mouvement supplémentaire.
- [x] Cartes sorties/retournées/conservées et historique, saisie d’une quantité réelle,
      reprise après réponse perdue sans doublon.
- [x] Facturation nette, refus des sélections périmées, blocage des pièces facturées;
      correction guidée par suppression/recréation d’un **brouillon seulement**.
- [x] Documentation intégrée, liens Services/WMS/Facturation et tutoriel Services
      enrichis, sans nouveau bouton permanent ni réinitialisation utilisateur.
- [x] Avoirs clients internes : modèle, taxes figées, soldes de règlements et écritures compensatoires.
- [x] Publication PDF/envoi explicite d’avoirs, identités figées et protections anti-doublon. [Quatrième lot](customer-credit-documents.md).
- [ ] Qualification externe, remboursement et transfert de crédit.

[Troisième lot — avoirs clients](customer-credit-notes.md), 23 septembre : parcours
Facturation → avoir → retour physique Services, droit dédié, conservation de la
facture originale et tests fiscaux de calcul (pas une certification). La documentation
intégrée et le tutoriel sont enrichis. Le quatrième lot ajoute ensuite le PDF et
la remise explicite, mais aucun remboursement bancaire.

[Contrat détaillé](services-partial-returns.md). Cette étape n’achève pas l’axe 2 :
Achats, Qualité et Fabrication restent à compléter; dossiers clients, missions IA
et Location ne sont pas annoncés comme livrés.

### Vérifications du deuxième lot

- Migration : 17 anciens retours comparés (quantité, auteur, date, fingerprint,
  mouvement); aucun mouvement WMS supplémentaire. Base de recette isolée seulement.
- API : typage et build réussis, 648 tests unitaires / 88 suites; HTTP Services
  36 scénarios et parcours connectés 8 scénarios réussis (44 au total).
- Web : typage sans erreur, 12 avertissements préexistants; 120 tests dans la
  passe complète puis 10 tests ciblés réussis, incluant un nouveau contrat documentaire
  (121 tests distincts). Aucun avertissement ajouté sur les composants modifiés.
- Build web de production réussi (`adapter-static`); contrôle Prettier des fichiers
  de code modifiés dans ce lot et `git diff --check` réussis.
- Chromium : 3 parcours ciblés réussis (documentation/tutoriel, connexions/mobile,
  retours successifs). Le dernier rejoué avec captures ordinateur/mobile inspectées;
  réponse perdue puis rechargement/reprise, solde exact et absence de débordement.
- Pas de recette navigateur exhaustive de tous les modules. Aucun push, nouvelle PR
  ou déploiement; API locale relancée sur la base de recette, `.env` préservé.

## Contrats transversaux

- Tenant depuis le principal; droits et activation de chaque module revérifiés.
- Machines à états, verrou/version et idempotence des writers métier conservés.
- Factures et quantités historiques figées; corrections par écritures compensatoires.
- Tout stock passe par `InventoryService.postMovement` en transaction.
- Toute mutation AI passe par le registre et `ProposedAction`; aucune décision RH
  ou financière autonome ajoutée par ce programme.
- Pas de nouveau bouton permanent de tutoriel; première entrée par utilisateur,
  parcours spécifique au module, relance volontaire dans l'aide.
- Pas de fusion aveugle des référentiels : correspondances explicites et droits
  croisés; pas de données partielles présentées comme un dossier complet.

## Vérifications externes restant nécessaires

VPS : accès/configuration Nginx, DNS/TLS, restrictions réseau, copie hors serveur,
restauration réelle et stockage persistant. Matériel : vrais Zebra et lecteurs
USB/Bluetooth. IA : provider configuré dans le tenant de recette, budget explicite.
Ces vérifications ne sont pas remplacées par un test local ou une simulation.
