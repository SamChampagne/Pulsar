# Plan — Agent Operations Center v1

## Scope

Améliorer `/agents` pour en faire un vrai poste de supervision des employés IA, sans entrer dans la zone Fleet.

## Étapes

1. Ajouter un helper pur `computeAgentAttention` dans `@pulsar/shared` avec tests RED/GREEN.
2. Exporter le helper depuis `packages/shared/src/index.ts`.
3. Consommer le helper dans `apps/web/src/routes/(app)/agents/+page.svelte`.
4. Remplacer le roster simple par :
   - hero/rollup plus opérationnel ;
   - bandeau attention ;
   - cartes agent avec mode, next step, KPI.
5. Vérifier :
   - shared test ;
   - shared build ;
   - web typecheck ;
   - git diff sans fichiers Fleet/assets/Prisma/modules.

## Contraintes

- Ne pas toucher `packages/database/prisma/schema.prisma`.
- Ne pas ajouter migration.
- Ne pas toucher `packages/shared/src/modules.ts` ni `packages/shared/src/permissions.ts`.
- Ne pas modifier `DocumentsService`, endpoints assets, fleet, maintenance ou compliance.
