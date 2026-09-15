import { canTransitionDeal, CrmDealStage, isDealOpen } from './crm.workflow';

export const DEFAULT_CRM_STAGES = [
  { name: 'Prospect', kind: CrmDealStage.LEAD },
  { name: 'Qualifié', kind: CrmDealStage.QUALIFIED },
  { name: 'Proposition', kind: CrmDealStage.PROPOSAL },
  { name: 'Gagné', kind: CrmDealStage.WON },
  { name: 'Perdu', kind: CrmDealStage.LOST },
] as const;

/** Custom columns may share a business phase. Terminal outcomes remain terminal. */
export function canMoveCrmStage(
  from: { id: string; kind: CrmDealStage },
  to: { id: string; kind: CrmDealStage },
): boolean {
  return (
    from.id !== to.id &&
    (canTransitionDeal(from.kind, to.kind) || (from.kind === to.kind && isDealOpen(from.kind)))
  );
}

export function validateCrmPipelineStages(
  stages: { name: string; kind: CrmDealStage }[],
): string | null {
  if (stages.length < 3 || stages.length > 30)
    return 'Un pipeline doit contenir de 3 à 30 colonnes.';
  if (stages.some((s) => !s.name.trim() || s.name.trim().length > 80))
    return 'Chaque colonne doit avoir un nom de 1 à 80 caractères.';
  if (new Set(stages.map((s) => s.name.trim().toLocaleLowerCase())).size !== stages.length)
    return 'Les noms des colonnes doivent être uniques.';
  if (
    !stages.some((s) => isDealOpen(s.kind)) ||
    !stages.some((s) => s.kind === CrmDealStage.WON) ||
    !stages.some((s) => s.kind === CrmDealStage.LOST)
  )
    return 'Conservez au moins une colonne ouverte, une gagnée et une perdue.';
  return null;
}
