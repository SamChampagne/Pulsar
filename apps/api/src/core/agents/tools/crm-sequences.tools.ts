import { z } from 'zod';
import { MODULE_KEYS, PERMISSIONS, RiskTier } from '@pulsar/shared';
import type { ToolDef } from '../tool-types';

export const crmSequenceTools: ToolDef[] = [
  {
    name: 'send_crm_sequence_email',
    description:
      'Send one frozen CRM sequence step. Rechecks consent, reply, pause, recipient and agent permissions. The step ID determines all content; cannot send arbitrary messages. SENSITIVE: governed approval/policy.',
    tier: RiskTier.SENSITIVE,
    permission: PERMISSIONS.EMAIL.SEND,
    additionalPermissions: [PERMISSIONS.CRM.MANAGE],
    module: MODULE_KEYS.CRM,
    inputSchema: z.object({
      stepId: z.string().min(1),
      to: z.string().email(),
      subject: z.string().min(1).max(200),
      body: z.string().min(1).max(10000),
    }),
    run: (args, ctx) =>
      ctx.services.crm.sendSequenceStep(
        ctx.principal.user.tenantId,
        args.stepId as string,
        ctx.principal.agentId,
        { to: args.to as string, subject: args.subject as string, body: args.body as string },
      ),
  },
];
