# Agent Operations Center v1 — design

Date: 2026-06-15
Branch: `hermes/agent-operations-center`

## Intention

Transformer `/agents` d'un roster de cartes en **centre de supervision opérationnelle** : un manager doit voir en 10 secondes quels employés IA sont actifs, lesquels nécessitent une décision, et pourquoi Pulsar peut leur faire confiance.

## Non-objectifs / zone anti-conflit

Cette tranche ne touche pas Fleet v1 :

- aucune migration Prisma ;
- aucun changement `modules.ts` / `permissions.ts` ;
- aucun endpoint assets/fleet/maintenance/compliance ;
- aucune modification de navigation globale requise.

## Sources existantes réutilisées

- `GET /agents/control-tower` : rollup + KPI par agent.
- `GET /agents/:id/kpis`, `/timeline`, `/runs`, `/activity`, `/trust` : détail agent déjà livré.
- Règles d'autonomie / caps existantes : pas de nouvelle gouvernance.

## Comportement livré

1. **Attention lane** en haut de `/agents` : liste priorisée des agents à regarder maintenant.
2. **Mode opérationnel lisible** par agent : status + autonomie + caps en une ligne.
3. **Priorisation déterministe** via helper pur `@pulsar/shared/agents/operations` :
   - breaker actif = critique ;
   - agent en pause = warning ;
   - approbations pendantes = warning ;
   - erreur élevée = warning ;
   - agent silencieux/sain = info/ok.
4. **Roster plus manager** : les cartes indiquent prochaine action, taux d'approbation, erreur, backlog approbations et breaker.

## Tests

- Test pur `packages/shared/src/agents/operations.spec.ts` : priorisation, attention et résumé du mode.
- Vérification web : `pnpm --filter @pulsar/web typecheck`.
- Vérification partagée : `pnpm --filter @pulsar/shared test -- operations.spec.ts` puis `pnpm --filter @pulsar/shared build`.
