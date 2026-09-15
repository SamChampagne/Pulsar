export const MRP_REVIEW_CATEGORY = 'MRP_REVIEW';
export const MRP_REVIEW_TOOLS = ['get_task', 'get_mrp_run', 'submit_mrp_review'] as const;
export function mrpWorkerEligible(
  agent: { permissions?: readonly string[]; caps?: unknown },
  enabledModules: ReadonlySet<string>,
  requiresCrm: boolean,
): boolean {
  const caps = (agent.caps ?? {}) as {
    alwaysOn?: boolean;
    handlesCategories?: string[];
    toolAllowlist?: string[];
  };
  const permissions = [
    'manufacturing.read',
    'wms.read',
    'core.operating.tasks.read',
    'core.operating.tasks.manage',
    ...(requiresCrm ? ['crm.read'] : []),
  ];
  const modules = ['manufacturing', 'wms', ...(requiresCrm ? ['crm'] : [])];
  return (
    caps.alwaysOn === true &&
    Boolean(caps.handlesCategories?.includes(MRP_REVIEW_CATEGORY)) &&
    permissions.every((p) => agent.permissions?.includes(p)) &&
    modules.every((m) => enabledModules.has(m)) &&
    (!caps.toolAllowlist || MRP_REVIEW_TOOLS.every((name) => caps.toolAllowlist!.includes(name)))
  );
}
