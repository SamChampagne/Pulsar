# Recette Pulsar après déploiement et prochaines priorités

Revue du 30 septembre 2026, heure de Toronto, après déploiement par le propriétaire.
Conclusion : socle compilé et navigation fonctionnels sur les surfaces examinées.
Cela ne valide pas tous les workflows, la reprise après panne ni une exploitation
client en production. La prochaine étape recommandée est un parcours d'entreprise
complet, en conservant le bureau d'applications et les modules autonomes.

## Version et preuves automatiques

La [PR 82](https://github.com/SamChampagne/Pulsar/pull/82) est fusionnée depuis le
28 septembre. Aucun changement résiduel de sa branche n'était à publier. Revue
depuis `main`, commit `7f78699cc0d51dc59e3756df14b84d111825b4b7`, sur la branche
`codex/post-deployment-validation`. Aucun déploiement effectué par cette revue.

| Contrôle                       | Preuve                                                                                                                                              | Limite                                                      |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| CI finale PR 82                | [Run 36480581864](https://github.com/SamChampagne/Pulsar/actions/runs/36480581864), six jobs réussis sur `bc4663e021c624c243e3a97d808f3b0d7690bab9` | Environnement CI, pas VPS                                   |
| CI après fusion                | [Run 36480597942](https://github.com/SamChampagne/Pulsar/actions/runs/36480597942), succès sur `7f78699`                                            | Ne prouve pas l'image déployée                              |
| Navigateur CI finale           | 346 réussites, 114 ignorés, aucun cas instable signalé                                                                                              | Ignorés ≠ réussites                                         |
| Tests relancés le 30 septembre | 1 127 Shared + 768 API unitaires + 237 Web = 2 132 réussites                                                                                        | Pas de base HTTP locale relancée; Docker local indisponible |
| Manifestes runtime hors ligne  | 4 tests réussis                                                                                                                                     | Pas d'inférence réelle                                      |
| Types relancés                 | `pnpm typecheck` réussi, 0 erreur Svelte, 12 avertissements dans 5 fichiers                                                                         | Avertissements existants encore ouverts                     |

Jest signale un processus de test ne terminant pas proprement malgré les assertions
réussies. À diagnostiquer avec `--detectOpenHandles`; ce n'est ni un échec de test
ni une preuve de fuite en production.

Les 114 scénarios navigateur conditionnels demandent des fixtures HTTP dédiées
(`*_TENANT`, `PULSAR_AUTONOMY_TENANT_PREFIX`, etc.). Les jobs API et navigateur ont
des bases distinctes : réussir le job HTTP ne prépare pas l'autre job. Domaines
concernés notamment : autonomie, carnet/adresses, lots, factures fournisseur,
devises, acceptation et communications. Voir `.github/workflows/ci.yml` et
`apps/web/e2e/`, notamment `module-autonomy.spec.ts`, `services-acceptance.spec.ts`
et `dossier-communications.spec.ts`. Ne pas lever les skips sans fixtures ni
remplacer ces parcours par des mocks.

## Recette distante effectuée

Cible confirmée : `https://pulsar.intebec.ca`. Connexion effectuée par le
propriétaire; profil de l'entreprise **test**, 19 modules activés. Aucun mot de
passe récupéré ni autre tenant inspecté. Contrôles en lecture, ouverture/annulation
de formulaires et résolution d'un code article. Aucun enregistrement métier,
stock, facture, permission ou connexion modifié; aucun SMS, courriel, appel LLM
ni calcul APS lancé.

| Surface                           | Observation serveur                                                                                               | Non qualifié par cette visite                               |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Accès et bureau                   | Connexion, tableau de bord et bureau accessibles; fuseau affiché                                                  | MFA plateforme, rôles limités, deux tenants                 |
| Transport                         | Dispatch, liste et détail d'un chargement; modification des notes accessible; ressources/tournée/documents reliés | Enregistrement, dispatch, livraison/POD, facture/correction |
| Carte du chargement               | Carte et avertissement de liaisons indicatives; départ/arrivée identiques sur le dossier examiné, distance 0      | Trajet entre lieux distincts et routage réel                |
| Entrepôt                          | Poste avec zones et stock; SKU résolu vers son article; liens réception/rangement/préparation                     | Matériel USB/Bluetooth/Zebra, mutations de stock et reprise |
| Responsive WMS                    | Contrôle visuel 1280 × 800 et 390 × 844; largeur du document égale à la fenêtre                                   | Autres modules/formulaires non couverts par ce contrôle     |
| Cour et Flotte                    | Entrées et liens rendez-vous/maintenance accessibles                                                              | Occupation concurrente, mouvements et maintenance VPS       |
| Fabrication                       | Accueil, MRP et planification accessibles; premier plan matières non configuré                                    | Calcul, publication, atelier et reprise                     |
| Services                          | Projets/interventions accessibles; création ouverte puis annulée, client et acceptation visibles                  | Parcours devis → travaux → facture → correction             |
| Finance                           | Accueil/profil comptable; aucune cible configurée; limite documentaire affichée                                   | Posting, paiement, rapprochement et comptabilité officielle |
| CRM                               | Accueil et liens pipeline/relances                                                                                | Séquences et automatisations réelles                        |
| RH et Qualité                     | Accueils, habilitations/absences et plans/non-conformités accessibles                                             | Décisions à droits séparés et effets intermodules           |
| SAV                               | Files par responsable/échéance et création proposées; liste vide                                                  | Traitement complet et retour facturé                        |
| Catalogue et Achats fournisseurs  | Entrées et files accessibles; catalogue vide                                                                      | Réception partielle, retour et rapprochement financier      |
| Achats transport                  | Appel d'offres brouillon visible                                                                                  | Publication et réponses transporteurs                       |
| Agents                            | Aucun agent; Hermes « Non installé », aucun modèle connecté                                                       | Aucune mission IA démontrée                                 |
| Connexions et courriel            | SMS inactif; courriel en simulation; pas d'IMAP réel; aperçus accessibles                                         | Livraison, webhook, STOP et rattachement des réponses       |
| Analyses et Flux                  | Tableaux accessibles; nombreux événements WMS répétés avec zéro tâche/action liée                                 | Lisibilité à volume réel et prochaine action exploitable    |
| Documents et Portail              | Registre et demandes accessibles, sans données pour ce parcours                                                   | Fichier après redémarrage et session client externe         |
| Sites                             | Page brouillon visible                                                                                            | Publication, capture et lien CRM                            |
| Documentation et personnalisation | Guides/règles/connexions accessibles; bureau conservé                                                             | Première visite non rejouée; aucune préférence changée      |
| Réglages                          | Liste utilisateurs ouverte                                                                                        | Invitation reçue et rôle effectif après refresh             |

Le journal navigateur consulté après la traversée ne rapportait ni erreur ni
avertissement. Il ne remplace pas les logs serveur ni une recette transactionnelle.
Plusieurs modules sont vides : afficher une liste vide ne démontre pas son
fonctionnement avec des dossiers complets. Les pages d'entrée ne représentent
pas chaque écran de chaque module.

## Constats avant ouverture à des clients

1. **Santé du cœur distincte des moteurs.** GET `/api/v1/health/live` et `/ready`
   répondent HTTP 200, PostgreSQL OK, `agentRuntime.installed=false` et
   `aps.installed=false`. `HealthService` ne bloque que sur PostgreSQL; le contrôle
   APS vérifie une installation locale, pas un calcul. L'UI confirme Hermes absent.
   Vérifier APS séparément avant un pilote Fabrication. Ne pas installer Hermes
   dans l'API non-root/read-only comme raccourci : runner isolé A2c.2 toujours ouvert.
2. **Preuves d'exploitation manquantes.** SHA de l'image VPS, migrations comparées,
   MFA plateforme et restauration base/documents/clés non attestés par la session
   tenant. Obtenir l'export du précontrôle Exploitation et une preuve opérateur,
   sans secrets. SSH non établi; aucun service redémarré pendant cette revue.
3. **Durcissement HTTP.** HTTPS accessible sans avertissement navigateur, mais
   HSTS, CSP, X-Frame-Options, X-Content-Type-Options et Referrer-Policy absents sur
   `/login` observé. Les exemples Nginx du dépôt ne les définissent pas non plus.
   Qualifier la politique avec cartes/aperçus/pages publiques; ni CSP restrictive
   non testée ni HSTS sur des sous-domaines non vérifiés.
4. **Navigation métier.** Français/anglais mélangés dans les chargements; « Achats »
   désigne les appels d'offres transport, « Achats fournisseurs » les commandes.
   Catalogue et articles WMS restent distincts. Expliquer les rôles, liens
   explicites et suites possibles; ne pas fusionner par nom ou imposer un module.
5. **Jeu de recette incomplet.** Pas de projet Services ni dossier financier pour
   éprouver le parcours prioritaire dans ce tenant. Construire des fixtures
   fictives reproductibles et des rôles dédiés, puis traiter les dossiers jusqu'aux
   pièces et corrections finales. Une simulation ne valide pas un fournisseur.

## Suite recommandée avec critères de sortie

Précisions aux cinq axes approuvés dans [le plan pilote](../plans/pilot-next-stage.md),
pas une autorisation d'envoi réel, d'installation VPS ou d'autonomie IA.

| Ordre | Lot borné                                                           | Critère de sortie                                                                                                                                                           |
| ----- | ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | Finir P1b : version, migrations, MFA, restauration et en-têtes HTTP | Export daté + image/SHA vérifié + document lisible après restauration isolée + rôles limités/refus cross-tenant                                                             |
| 2     | Fermer la lacune CI du pilote Services                              | Fixtures dans la base navigateur; acceptation, autonomie et dossier 360 exécutés, pas ignorés; refus/reprise verts                                                          |
| 3     | P2/P3 comme parcours Services complet                               | Client → devis → projet → deux interventions → temps/pièces → acceptation → facture → SAV/retour partiel/avoir; sources et audit exacts, aucun doublon après réponse perdue |
| 4     | Première IA utile, préparation technique en parallèle               | Runner isolé; synthèse/triage SAV en PROPOSE, sources citables, droits/caps/interruption; fournisseur et budget autorisés avant mesure réelle                               |
| 5     | Communications et comptabilité reliées au pilote                    | Réponses rattachées, livraison/STOP avec destinataires autorisés; logiciel externe et maître par objet choisis avant connecteur, ou contrat natif de périodes/corrections   |

Dans Services, améliorer les panneaux existants : « ce qui manque », « qui doit
agir », « suite possible », liens vers les preuves. Réduire le bruit de la timeline
et harmoniser les libellés. Options avancées repliées, référentiels accessibles
depuis le module utilisé. Le bureau d'applications reste le point d'entrée.

Transport garde une recette livraison partielle/POD/remanifeste, avec route réelle
entre lieux distincts. Fabrication commence par le moteur disponible puis
achat/réception → MRP → OF → atelier → qualité/correction. Aucun de ces parcours
n'est validé par la traversée des écrans ci-dessus.

## Périmètre de cette livraison

Recette et plan actualisé uniquement : aucun changement métier ni migration.
Les incidents CI antérieurs restent documentés mais leur état final est vert.
Le VPS n'est pas déclaré prêt production; les 271 exigences enterprise restent
à qualifier individuellement.

Prochaine implémentation recommandée : **qualification Services reproductible
et scénarios CI**, pendant que l'opérateur fournit les preuves P1b. Runner IA
dans un lot technique distinct; aucune clé fournisseur nécessaire pour préparer
les contrats hors ligne. POS, restauration, location et e-commerce restent au
backlog jusqu'à l'acceptation du pilote.
