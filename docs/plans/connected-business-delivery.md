# Exploitation connectée — lot de livraison

Demande du 22 septembre 2026 : quatre chantiers, puis une seule PR vers main.
Branche de travail : `codex/end-user-workflows`; conserver les lots locaux précédents.
Le déploiement OVH est effectué par le propriétaire après revue. Aucune donnée locale
de stockage, secret, base ou résultat de test ne doit entrer dans la PR.

## Contrat de livraison

1. **Mon travail** : ajouter les signaux SAV, Qualité, temps soumis, reliquats fournisseurs
   et habilitations arrivant à échéance dans l'écran existant. Lectures filtrées par droits
   ET modules, pagination, réglages d'alerte, raison/action/source explicites. Les signaux
   courants sont dérivés, pas des copies RH dans des tâches génériques. Corriger le dossier
   fait disparaître le signal à l'actualisation; aucune clôture métier cachée.
2. **Planning Services/RH** : durée prévue, fuseau stable d'entreprise, planning jour/semaine,
   personnes/équipes, contrôle de conflits et absences, exigences de compétences, replanification
   confirmée et versionnée. Les données anciennes sans durée restent signalées comme incomplètes.
   Les besoins Fabrication sont exposés comme contexte, pas comme une réservation APS inventée.
3. **Parcours commercial** : liens explicites Catalogue/CRM/client de facturation, devis
   versionnés acceptés explicitement vers projet, interventions existantes, sélection des temps
   approuvés et pièces non retournées vers une facture client brouillon existante. Origines
   uniques, prix figés, taxes configurées dans Facturation, corrections gardées et reprise réseau.
4. **AI métier** : outils READ de contexte sourcé, préparation SAV et propositions de planning
   dans le registre existant. Mutations exclusivement via ProposedAction, validations des services
   métier, relecture des versions/droits/modules à l'exécution. Aucun envoi externe implicite,
   décision RH autonome ou calcul financier délégué au modèle.

## UX et vérification

Conserver le bureau d'apps et le design Pulsar. Réutiliser les panneaux, tableaux, sélecteurs
et confirmations. Ne jamais afficher « disponible » si des contrôles sont inconnus. Documenter
chaque connexion et actualiser les guides métier sans réinitialiser la première visite.

- [x] Chantiers 1–4 implémentés et revue de leurs interactions.
- [x] Migrations additives testées sur la base isolée, pas sur la base utilisateur.
- [ ] Tests unitaires, HTTP multi-tenant/droits/concurrence/reprise et navigateur.
- [ ] Builds, typechecks, documentation intégrée et guide de recette serveur.
- [ ] Revue des fichiers publiés, commit(s), push et une seule PR attachée à la tâche.
- [ ] Vérification des contrôles CI; aucune fusion ni installation serveur automatique.

## Contrats et limites

Les lots locaux antérieurs (utilisabilité, scanners, tutoriels, Documentation, Catalogue,
Achats, Services, Qualité et RH) sont conservés dans la PR unique. `main` a été intégré
sans remplacer sa boucle MRP : protections SKU/unité, achat matières et réception
partielle conservées. Les achats généraux et achats matières MRP restent deux workflows
distincts; aucune fusion implicite de leurs tables ou commandes.

Le planning n'est pas un moteur APS de capacité : 100 personnes/500 interventions au
maximum, périodes et résultats limités signalés. Une durée absente ou un dossier RH
manquant reste non vérifié. Le créneau est contrôlé à la mutation; une nouvelle absence
approuvée après coup demande une revue humaine. Les exigences d'un poste Fabrication
sont un contexte de compétences, pas une réservation de ses machines.

Les devis acceptés figent leurs lignes et créent un projet brouillon; ils ne créent
pas automatiquement interventions, temps ou facture. Les tarifs des sources à facturer
sont saisis explicitement. Un brouillon supprimé libère les sources, mais conserve la
clé de requête consommée. Après validation d'une facture, un workflow compensatoire
Services complet (avoirs/retours partiels) reste à construire : ne pas modifier les
sources figées ou les tables directement.

Le nouveau coordinateur AI est interactif et PROPOSE par défaut. Huit outils enregistrés,
dont seulement deux mutations (planning et responsabilité/échéance SAV). Aucun nouveau
réveil always-on dérivé des signaux, envoi email/SMS, décision RH ou approbation comptable.
Le worker MRP existant conserve sa gouvernance. La qualité/coût/latence d'un fournisseur
LLM réel et le matériel Zebra ne sont pas qualifiés par les tests automatisés locaux.

## Recette

Voir la [procédure serveur](./connected-business-server-acceptance.md), avec comptes,
permissions, configuration et résultats attendus. Le profil Docker OVH existant n'inclut
ni Hermes ni APS; ils demandent un provisionnement séparé pour leur recette complète.

Vérifications après intégration de main : 106 migrations sur `pulsar_enduser_20260921`,
aucune dérive Prisma; 901 tests shared, 118 web et 591 API (dont trois tests de gouvernance
ajoutés après la suite complète de 588) réussis. 160 tests HTTP dans 12 suites réussis,
MRP/APS avec adaptateur de moteur contrôlé, pas moteur réel. Build complet réussi;
typecheck sans erreur, 12 avertissements Svelte préexistants. Recette navigateur en cours.
Jest HTTP utilise encore `--forceExit`; aucune amélioration de cet arrêt historique n'est revendiquée.
