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
2. **Planning Services/RH** : durée réelle, fuseau stable d'entreprise, planning jour/semaine,
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

- [ ] Chantiers 1–4 implémentés et revue de leurs interactions.
- [ ] Migrations additives testées sur la base isolée, pas sur la base utilisateur.
- [ ] Tests unitaires, HTTP multi-tenant/droits/concurrence/reprise et navigateur.
- [ ] Builds, typechecks, documentation intégrée et guide de recette serveur.
- [ ] Revue des fichiers publiés, commit(s), push et une seule PR attachée à la tâche.
- [ ] Vérification des contrôles CI; aucune fusion ni installation serveur automatique.

Les limites effectivement restantes et les résultats seront inscrits ici après vérification.
