import { z } from 'zod';
import { PERMISSIONS, RiskTier } from '@pulsar/shared';
import type { ToolDef } from '../tool-types';

export const emailTools: ToolDef[] = [
  // ── Email — core (no module requirement) ─────────────────────────────────────
  {
    name: 'draft_email',
    description:
      'Draft a business email (subject + HTML body) using the tenant LLM. Returns the draft — no message is persisted or sent. Provide a prompt and optional context.',
    tier: RiskTier.LOW,
    permission: PERMISSIONS.EMAIL.SEND,
    // module: undefined — core tool, always available regardless of enabled modules
    inputSchema: z.object({
      prompt: z.string().min(1),
      context: z.string().optional(),
    }),
    run: (args, ctx) =>
      ctx.services.email.draft(ctx.principal.user.tenantId, {
        prompt: args.prompt as string,
        context: args.context as string | undefined,
      }),
  },
  {
    name: 'send_email',
    description:
      'Queue an email for delivery. SENSITIVE — requires human approval (goes through the proposal queue). The email is not sent immediately; a ProposedAction is created.',
    tier: RiskTier.SENSITIVE,
    permission: PERMISSIONS.EMAIL.SEND,
    // module: undefined — core tool, always available regardless of enabled modules
    inputSchema: z.object({
      to: z.union([z.string().email(), z.array(z.string().email())]),
      subject: z.string().min(1),
      html: z.string().min(1),
      relatedType: z.string().optional(),
      relatedId: z.string().optional(),
      attachments: z
        .array(
          z.object({
            documentId: z.string().min(1),
            filename: z.string().min(1),
          }),
        )
        .optional(),
    }),
    run: (args, ctx) => {
      const toAddresses = Array.isArray(args.to)
        ? (args.to as string[])
        : [args.to as string];
      return ctx.services.email.send(
        ctx.principal.user.tenantId,
        {
          toAddresses,
          subject: args.subject as string,
          html: args.html as string,
          relatedType: args.relatedType as string | undefined,
          relatedId: args.relatedId as string | undefined,
          attachments: args.attachments as { documentId: string; filename: string }[] | undefined,
        },
        { agentId: ctx.principal.agentId },
      );
    },
  },
];
