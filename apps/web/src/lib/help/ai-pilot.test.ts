import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  AGENT_ROLE_PRESETS,
  AgentAutonomy,
  ALL_PERMISSION_KEYS,
  MODULE_CATALOG,
} from '@pulsar/shared';
import { tmsTools } from '../../../../api/src/core/agents/tools/tms.tools';
import { dispatchTools } from '../../../../api/src/core/agents/tools/dispatch.tools';
import { mrpTools } from '../../../../api/src/core/agents/tools/mrp.tools';
import { coreTools } from '../../../../api/src/core/agents/tools/core.tools';
import { AI_PILOTS, visibleAiPilots, type AiPilot, type AiPilotAccess } from './ai-pilot';

const root = resolve(process.cwd(), '../..');
const registry = new Map(
  [...tmsTools, ...dispatchTools, ...mrpTools, ...coreTools].map((tool) => [tool.name, tool]),
);
const pilot = (key: string) => AI_PILOTS.find((entry) => entry.key === key)!;
const access = (entry: AiPilot): AiPilotAccess => ({
  modules: entry.modules,
  can: (permission) => entry.operatorPermissions.includes(permission),
});

describe('AI business pilots: documented, not executed', () => {
  it('declares exactly two distinct, fully explained pilots with non-executing next actions', () => {
    expect(AI_PILOTS).toHaveLength(2);
    expect(new Set(AI_PILOTS.map((entry) => entry.key)).size).toBe(2);
    for (const entry of AI_PILOTS) {
      expect(entry.steps.length).toBeGreaterThanOrEqual(5);
      for (const step of entry.steps) {
        expect(step.title.trim()).not.toBe('');
        expect(step.body.length).toBeGreaterThan(80);
      }
      expect(entry.expectedEvidence.length).toBeGreaterThanOrEqual(4);
      expect(entry.blockers.length).toBeGreaterThanOrEqual(4);
      expect(entry.nextAction.href).toMatch(/^\/(loads|manufacturing\/mrp)$/);
      expect(
        existsSync(
          resolve(
            root,
            'apps/web/src/routes/(app)',
            entry.nextAction.href.slice(1),
            '+page.svelte',
          ),
        ),
      ).toBe(true);
    }
  });

  it('matches every documented tool tier, permission and module to the implemented registry definitions', () => {
    for (const entry of AI_PILOTS) {
      for (const documented of entry.tools) {
        const implemented = registry.get(documented.name);
        expect(implemented, documented.name).toBeDefined();
        expect(implemented!.tier).toBe(documented.tier);
        expect(implemented!.permission).toBe(documented.permission);
        expect(implemented!.module).toBe(documented.module);
        expect(implemented!.additionalPermissions ?? []).toEqual(
          documented.additionalPermissions ?? [],
        );
        expect(implemented!.additionalModules ?? []).toEqual(documented.additionalModules ?? []);
      }
      expect(new Set(entry.tools.map((tool) => tool.name)).size).toBe(entry.tools.length);
      const permissions = [
        ...new Set(
          entry.tools.flatMap((tool) => [tool.permission, ...(tool.additionalPermissions ?? [])]),
        ),
      ];
      expect([...entry.permissions].sort()).toEqual(permissions.sort());
      const modules = [
        ...new Set(
          entry.tools.flatMap((tool) => [
            ...(tool.module ? [tool.module] : []),
            ...(tool.additionalModules ?? []),
          ]),
        ),
      ];
      expect([...entry.modules].sort()).toEqual(modules.sort());
    }
  });

  it('uses existing PROPOSE presets and does not silently expand their permissions/allowlists', () => {
    for (const entry of AI_PILOTS) {
      const preset = AGENT_ROLE_PRESETS.find((value) => value.id === entry.presetId)!;
      expect(preset).toBeDefined();
      expect(preset.suggestedAutonomy).toBe(AgentAutonomy.PROPOSE);
      for (const permission of entry.permissions)
        expect(preset.suggestedPermissions).toContain(permission);
      if (preset.suggestedToolAllowlist)
        for (const tool of entry.tools) expect(preset.suggestedToolAllowlist).toContain(tool.name);
      expect(entry.blockers.join(' ')).toContain('caps.autoApprove');
      expect(entry.steps.map((step) => step.body).join(' ')).toContain(
        'core.agents.actions.approve',
      );
      for (const permission of [...entry.permissions, ...entry.operatorPermissions])
        expect(ALL_PERMISSION_KEYS).toContain(permission);
      for (const module of entry.modules)
        expect(MODULE_CATALOG.map((value) => value.key)).toContain(module);
    }
  });

  it('requires every enabled module and human inspection permission, never agent permissions alone', () => {
    expect(visibleAiPilots({ modules: [], can: () => true })).toEqual([]);
    expect(
      visibleAiPilots({ modules: ['transportation', 'manufacturing', 'wms'], can: () => false }),
    ).toEqual([]);
    for (const entry of AI_PILOTS) {
      const allowed = access(entry);
      expect(visibleAiPilots(allowed)).toEqual([entry]);
      expect(
        visibleAiPilots({
          modules: entry.modules,
          can: (permission) => entry.permissions.includes(permission),
        }),
      ).toEqual([]);
      for (const missing of entry.modules)
        expect(
          visibleAiPilots({
            ...allowed,
            modules: entry.modules.filter((module) => module !== missing),
          }),
        ).toEqual([]);
      for (const missing of entry.operatorPermissions)
        expect(
          visibleAiPilots({
            ...allowed,
            can: (permission) => permission !== missing && allowed.can(permission),
          }),
        ).toEqual([]);
    }
  });

  it('keeps transport independent from WMS and limits its mutation to an explicit approved assignment', () => {
    const entry = pilot('transport-predeparture');
    expect(entry.modules).toEqual(['transportation']);
    expect(entry.context).toBe('CHAT');
    expect(entry.tools.filter((tool) => tool.tier !== 'READ').map((tool) => tool.name)).toEqual([
      'assign_shipment',
    ]);
    expect(entry.promptTemplate).toContain('{{loadId}}');
    expect(entry.promptTemplate).toContain('{{shipmentId}}');
    expect(entry.promptTemplate).toContain('{{capacityChecked}}');
    expect(entry.promptTemplate).toContain('ne simule pas');
    expect(entry.promptTemplate).toContain('une seule proposition');
    expect(entry.expectedEvidence.join(' ')).toContain('PENDING');
    expect(entry.blockers.join(' ').toLowerCase()).toContain('contrôles physiques');
  });

  it('requires the actual assigned MRP worker session rather than a prompt pretending to be one', () => {
    const entry = pilot('mrp-assigned-review');
    expect(entry.context).toBe('ASSIGNED_TASK');
    expect(entry.tools.filter((tool) => tool.tier !== 'READ').map((tool) => tool.name)).toEqual([
      'submit_mrp_review',
    ]);
    expect(
      entry.tools.some((tool) => ['resolve_task', 'recalculate_mrp'].includes(tool.name)),
    ).toBe(false);
    expect(entry.promptTemplate).toContain('ne tente PAS submit_mrp_review');
    expect(entry.promptTemplate).toContain('triggeredByRef=task:<id>');
    expect(entry.promptTemplate).toContain('ne suffit jamais');
    expect(entry.blockers.join(' ')).toContain('crm.read');
    expect(entry.steps.map((step) => step.body).join(' ')).toContain('plus ancienne tâche OPEN');
    expect(entry.expectedEvidence.join(' ')).toContain('MrpReview');
    expect(entry.expectedEvidence.join(' ')).toContain('AgentRun');
    const source = readFileSync(
      resolve(root, 'apps/api/src/modules/manufacturing/mrp/mrp-assistance.service.ts'),
      'utf8',
    );
    expect(source).toContain('triggeredByRef !== `task:${input.taskId}`');
    expect(source).toContain('assigneeAgentId: agentId');
    expect(source).toContain("status: { in: ['OPEN', 'IN_PROGRESS'] }");
  });

  it('references real implementation files and never imports an execution service into the browser catalogue', () => {
    for (const entry of AI_PILOTS)
      for (const source of entry.sources)
        expect(existsSync(resolve(root, source)), source).toBe(true);
    const source = readFileSync(resolve(root, 'apps/web/src/lib/help/ai-pilot.ts'), 'utf8');
    expect(source.match(/^import .+ from .+;$/gm)).toEqual([
      "import { MODULE_KEYS as M, PERMISSIONS as P } from '@pulsar/shared';",
    ]);
    expect(source).not.toMatch(/\b(fetch|localStorage|sessionStorage|setInterval)\s*[.(]/);
    expect(source).not.toMatch(/(?:https?:\/\/|Bearer )/);
  });
});
