# Version candidate pilote — 28 septembre 2026

Branche : `codex/pilot-business-depth`, [PR unique #82](https://github.com/SamChampagne/Pulsar/pull/82)
vers `main`.
Cette livraison consolide les lots accumulés depuis la fusion des workflows
utilisateur; ce n'est pas seulement une mise à jour IA.

## Périmètre

- Référentiels autonomes, carnet multi-adresses/contacts et coordonnées figées
  par document, profils entreprise, liens explicites et dossier client 360°.
- Catalogue/achats enrichis, conditionnements/codes-barres, lots WMS, comptages,
  quarantaine/qualité, traçabilité, sorties et retours fournisseur documentés.
- Fabrication/Services : lots consommés/produits, contrepassations, retours
  partiels, acceptation des travaux et garde-fous des dossiers facturables.
- Finance : factures/avoirs fournisseur et client, échéanciers documentaires,
  qualification historique des devises, budgets/immobilisations et registre;
  cible comptable configurable par entreprise, sans comptabilité complète implicite.
- Communications : Telnyx, SMTP/IMAP configurables dans Pulsar, aperçus,
  statuts/STOP, historique et envois de dossier soumis aux droits et consentements.
- IA : diagnostic/runtime durci, erreurs/résultats typés, annulation, protection
  des reprises worker et qualification Linux hors ligne; pas de nouvel outil
  métier mutating ni de promotion Hermes automatique.
- Aide, tutoriels spécifiques et documentation métier intégrée; précontrôle du
  pilote, profil OVH durci et exercice de restauration séparé.

Les limites détaillées et l'ordre des prochaines étapes restent dans
[l'état du projet](../etat-du-projet.md), [la roadmap](../../ROADMAP.md) et les
plans de chaque domaine. L'audit enterprise n'est pas déclaré entièrement clos.

## Contrôles avant fusion

- Builds Docker API/Web réussis et typecheck complet réussi (12 avertissements
  Svelte antérieurs, aucune erreur).
- 768 tests API, 1 127 Shared, 237 Web, 4 tests du manifeste runtime.
- Neuf contrôles réels ACP sur Linux, fournisseurs/MCP synthétiques, zéro clé réelle.
- 142 migrations appliquées sur base neuve; bootstrap sans tenant démo, identifiants
  conservés, MFA, readiness, redémarrage, anciens fichiers root et restauration
  binaire dans un projet distinct vérifiés.
- La CI distante et la passe HTTP globale sont à consulter séparément avant fusion;
  une réussite des unités ne prouve pas tous les parcours métier/browser.
- Limite locale APS : son ancien test autonome échoue avec base APS indisponible;
  le profil OVH ne fournit ni APS ni le runtime IA de production.

## Correctif CI navigateur de la PR #82

Le premier run `36433929068` passe APS, typecheck, unités, API HTTP et build Web,
mais échoue côté navigateur : 13 échecs, 24 cas instables récupérés au retry,
114 cas non exécutés faute de fixtures isolées et 308 réussites au premier essai.

- Les mocks Finance utilisent désormais les référentiels propres à Billing,
  sans dépendre des anciennes URL Transportation; la facture factice inclut le
  montant crédité, comme le contrat API réel.
- Navigation Portail, dialogues Finance, documentation Qualité et guides métier
  testent les libellés/parcours actuels; la traversée des guides spécialisés
  vérifie chaque titre et la persistance de leur complétion.
- Le helper de connexion lit les préférences réelles avant la navigation et
  installe ensuite un snapshot GET immédiat. Il ne laisse plus de `route.fetch`
  en attente pendant les changements de document. Les écritures restent réelles,
  les faux tutoriels terminés ne sont jamais enregistrés sur le compte.
- Un test dédié utilise un nouvel utilisateur, plusieurs navigations et un
  fuseau distinct; il contrôle l'UI et les préférences réellement conservées.
  Les requêtes volontairement retardées sont libérées même si une assertion échoue.

Aucun changement du code applicatif, des retries/délais CI ou des règles métier.
Aucun nouveau `skip`; les cas nécessitant leurs fixtures HTTP dédiées restent une
limite de couverture du profil CI standard, et non des réussites navigateur.

Validation locale sur Docker jetable, 1 worker et `--retries=0` : **345 réussites,
114 ignorés, 1 échec** en 10,6 minutes. Cet échec supplémentaire est dû aux
identifiants de la fixture administrateur de cette copie (différents du seed CI),
pas au produit : après création du compte de test attendu dans cette seule base,
le scénario plateforme passe séparément. Les 346 cas exécutables passent donc
sur l'ensemble de ces deux exécutions; ce n'est pas une unique passe verte.
Le nouveau test de préférences passe aussi trois répétitions consécutives.
La CI GitHub du commit correctif reste l'autorité avant fusion/déploiement.

## Déployer en environnement de test, pas directement chez un client

1. Attendre/revoir les checks de la PR unique, fusionner puis relever le SHA exact.
2. Lire le [guide OVH](../../deploy/ovh/README.md), confirmer Nginx hôte/conteneur,
   accès restreint, DNS/TLS et espace disponible. Ne pas écraser les autres services.
3. Arrêter les écritures du projet et sauvegarder base + documents + secrets,
   notamment **la même `ENCRYPTION_KEY`**. Conserver les anciennes images.
4. Mettre `PULSAR_BUILD_VERSION` au SHA approuvé; construire, appliquer les
   migrations et bootstrap catalogues, étape par étape. **36 nouvelles migrations**
   par rapport au main de départ; ne pas lancer le seed démo. Migration non-root
   des permissions du volume existant selon le guide, après sauvegarde.
5. Démarrer, vérifier readiness/MFA, créer deux entreprises fictives et vérifier
   leurs droits séparés; déposer/télécharger un document après redémarrage.
6. Tester le parcours métier choisi et une restauration sur copie avant données
   réelles. Le rollback d'image n'annule pas le schéma : restaurer un ensemble
   cohérent base/documents/clés sur environnement séparé si nécessaire.

`EMAIL_DRIVER=log` ne neutralise pas un SMTP tenant déjà actif. Vérifier toutes les
connexions avant un essai et ne pas activer SMS/IMAP réels pour une simple recette.
L'image `pulsar-hermes:qualification` est un test jetable, **pas un service IA**.

## Non inclus

Déploiement VPS, TLS/DNS, livraison Telnyx/SMTP réelle, benchmark de modèles,
promotion Hermes 0.21.5, runner IA multi-tenant de production, worker durable,
qualification APS complète, certification comptable/fiscale ou audit sécurité global.
