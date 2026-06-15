# Integration Operating Layer — Direction

> Branche: `hermes/agent-operations-center`  
> Scope: préparer le futur module intégrations sans toucher aux migrations Prisma, Fleet, dispatch, modules catalog ou permissions.

## But

Pulsar ne doit pas traiter les intégrations comme une simple liste de webhooks/API keys. Pour que Hermes devienne un agent opérationnel interne, les intégrations doivent devenir une **couche de vérité et d'action gouvernée**.

Objectif produit:

```text
Logiciels externes → Pulsar Integration Layer → Evidence / Policies / Agents → ProposedAction / Audit
```

## Ce qui est livré maintenant

- Un helper shared `packages/shared/src/integrations/operations.ts` pour classifier et prioriser les connecteurs.
- Une page web `/integrations` qui transforme les intégrations existantes en vue opérationnelle.
- Une roadmap de branchement en trois phases.
- Aucun changement DB, aucune migration, aucun module Fleet.

## États opérationnels

- `not_configured`: connecteur présent mais pas prêt.
- `ready`: activé/configuré, prêt pour un premier échange contrôlé.
- `live`: au moins une livraison réussie.
- `degraded`: statut erreur ou taux d'échec élevé.
- `blocked`: activé mais capacités métier requises manquantes.

## Phases d'intégration

### 1. Foundation — système de vérité

Connecteurs prioritaires:

- ERP: Odoo, SAP, Netsuite, Dynamics.
- Accounting: QuickBooks, Xero, Sage.

Outcome:

- clients;
- commandes;
- factures;
- paiements;
- coûts.

Sans cette base, les agents peuvent proposer mais ne devraient pas agir automatiquement.

### 2. Visibility — visibilité opérationnelle

Connecteurs:

- Telematics: Samsara, Geotab, GPS/ELD.
- EDI: 204, 990, 214, 210.
- Webhooks transporteurs/clients.

Outcome:

- statuts temps réel;
- positions;
- confirmations;
- exceptions automatiquement détectées.

### 3. Automation — automatisation gouvernée

Connecteurs:

- WMS;
- portails clients;
- connecteurs custom;
- outils internes.

Outcome:

- actions low-risk automatisables;
- preuves attachées;
- rollback/documentation;
- audit complet.

## Règle de gouvernance AI

Aucun agent Hermes ne devrait exécuter une action externe si l'intégration n'a pas:

- owner clair;
- capacités déclarées;
- evidence/log de test;
- taux d'échec acceptable;
- policy d'autonomie;
- chemin de rollback ou désactivation.

## Suite logique

1. Ajouter un vrai champ capabilities côté config intégration.
2. Créer une table future `IntegrationCapability` ou garder JSON si on veut aller vite.
3. Relier `ProposedAction` à une intégration cible.
4. Ajouter des policies du genre:
   - `erp.write.invoice` demande approbation;
   - `webhook.deliver.status` peut être autonome;
   - `accounting.payment.import` lecture seulement.
5. Ajouter des KPIs:
   - fraîcheur données;
   - taux échec 24h;
   - dernier succès;
   - actions agent bloquées par intégration.
