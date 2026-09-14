/**
 * Composition root: assembles all per-domain tool arrays into a single TOOL_REGISTRY.
 * Types and the DI token live in ./tool-types; tool definitions live in ./tools/<domain>.tools.ts.
 *
 * Everything previously importable from this module remains importable here (re-exported below).
 */

// Re-export the shared contract so existing importers need no changes.
export { AGENT_TOOL_SERVICES } from './tool-types';
export type { ToolServices, ToolContext, ToolDef } from './tool-types';

import type { ToolDef } from './tool-types';
import { tmsTools } from './tools/tms.tools';
import { dispatchTools } from './tools/dispatch.tools';
import { coreTools } from './tools/core.tools';
import { billingTools } from './tools/billing.tools';
import { fleetTools } from './tools/fleet.tools';
import { yardTools } from './tools/yard.tools';
import { wmsTools } from './tools/wms.tools';
import { analyticsTools } from './tools/analytics.tools';
import { crmTools } from './tools/crm.tools';
import { crmSequenceTools } from './tools/crm-sequences.tools';
import { emailTools } from './tools/email.tools';
import { manufacturingTools } from './tools/manufacturing.tools';

/** All agent tools, in their canonical order (preserved from the original monolithic registry). */
export const TOOL_REGISTRY: ToolDef[] = [
  ...tmsTools,
  ...dispatchTools,
  ...coreTools,
  ...billingTools,
  ...fleetTools,
  ...yardTools,
  ...wmsTools,
  ...analyticsTools,
  ...crmTools,
  ...crmSequenceTools,
  ...emailTools,
  ...manufacturingTools,
];

export const TOOL_BY_NAME = new Map<string, ToolDef>(TOOL_REGISTRY.map((t) => [t.name, t]));
