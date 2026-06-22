import { z } from 'zod';
import { PERMISSIONS, MODULE_KEYS, RiskTier } from '@pulsar/shared';
import type { ToolDef } from '../tool-types';

export const yardTools: ToolDef[] = [
  // ── Yard ───────────────────────────────────────────────────────────────────
  {
    name: 'list_yard_visits',
    description: 'List yard visits, optionally filtered by status and/or location.',
    tier: RiskTier.READ,
    permission: PERMISSIONS.YARD.READ,
    module: MODULE_KEYS.YARD,
    inputSchema: z.object({
      status: z.string().optional(),
      locationId: z.string().min(1).optional(),
    }),
    run: (args, ctx) =>
      ctx.services.yardVisits.list(ctx.principal.user.tenantId, {
        status: args.status,
        locationId: args.locationId,
      }),
  },
  {
    name: 'get_yard_board',
    description:
      'Get the live yard board: all spots with their occupying visit, and unassigned visits. Optionally filter by locationId.',
    tier: RiskTier.READ,
    permission: PERMISSIONS.YARD.READ,
    module: MODULE_KEYS.YARD,
    inputSchema: z.object({ locationId: z.string().min(1).optional() }),
    run: (args, ctx) =>
      ctx.services.yardOverview.board(
        ctx.principal.user.tenantId,
        args.locationId as string | undefined,
      ),
  },
  {
    name: 'flag_detention',
    description:
      'Return yard detention summary: number of active visits in detention and late appointments.',
    tier: RiskTier.READ,
    permission: PERMISSIONS.YARD.READ,
    module: MODULE_KEYS.YARD,
    inputSchema: z.object({}),
    run: async (_args, ctx) => {
      const overview = await ctx.services.yardOverview.overview(ctx.principal.user.tenantId) as {
        detentionCount: number;
        lateAppointments: number;
        trucksInYard: number;
      };
      return {
        detentionCount: overview.detentionCount,
        lateAppointments: overview.lateAppointments,
        trucksInYard: overview.trucksInYard,
      };
    },
  },
  {
    name: 'assign_yard_spot',
    description: 'Assign an active yard visit to a spot. PROPOSED — requires human approval.',
    tier: RiskTier.MUTATING,
    permission: PERMISSIONS.YARD.MANAGE,
    module: MODULE_KEYS.YARD,
    inputSchema: z.object({
      visitId: z.string().min(1),
      spotId: z.string().min(1),
      note: z.string().optional(),
    }),
    run: (args, ctx) =>
      ctx.services.yardVisits.assign(
        ctx.principal.user.tenantId,
        ctx.principal.user.id,
        args.visitId as string,
        { spotId: args.spotId as string, note: args.note as string | undefined },
      ),
  },
  {
    name: 'move_trailer',
    description: 'Move an assigned yard visit to a different spot. PROPOSED — requires human approval.',
    tier: RiskTier.MUTATING,
    permission: PERMISSIONS.YARD.MANAGE,
    module: MODULE_KEYS.YARD,
    inputSchema: z.object({
      visitId: z.string().min(1),
      spotId: z.string().min(1),
      note: z.string().optional(),
    }),
    run: (args, ctx) =>
      ctx.services.yardVisits.move(
        ctx.principal.user.tenantId,
        ctx.principal.user.id,
        args.visitId as string,
        { spotId: args.spotId as string, note: args.note as string | undefined },
      ),
  },
  {
    name: 'create_dock_appointment',
    description:
      'Create a dock appointment for a carrier. PROPOSED — requires human approval.',
    tier: RiskTier.MUTATING,
    permission: PERMISSIONS.YARD.MANAGE,
    module: MODULE_KEYS.YARD,
    inputSchema: z.object({
      locationId: z.string().min(1),
      windowStart: z.string().min(1).describe('ISO 8601 datetime'),
      windowEnd: z.string().min(1).describe('ISO 8601 datetime'),
      carrierId: z.string().min(1).optional(),
      spotId: z.string().min(1).optional(),
      direction: z.string().optional(),
      reference: z.string().optional(),
      notes: z.string().optional(),
    }),
    run: (args, ctx) =>
      ctx.services.yardAppointments.create(
        ctx.principal.user.tenantId,
        ctx.principal.user.id,
        {
          locationId: args.locationId as string,
          windowStart: new Date(args.windowStart as string),
          windowEnd: new Date(args.windowEnd as string),
          carrierId: args.carrierId as string | undefined,
          spotId: args.spotId as string | undefined,
          direction: args.direction as string | undefined,
          reference: args.reference as string | undefined,
          notes: args.notes as string | undefined,
        },
      ),
  },
  {
    name: 'mark_arrived',
    description:
      'Mark a dock appointment as ARRIVED (carrier showed up). PROPOSED — requires human approval.',
    tier: RiskTier.MUTATING,
    permission: PERMISSIONS.YARD.MANAGE,
    module: MODULE_KEYS.YARD,
    inputSchema: z.object({ appointmentId: z.string().min(1) }),
    run: (args, ctx) =>
      ctx.services.yardAppointments.arrive(
        ctx.principal.user.tenantId,
        ctx.principal.user.id,
        args.appointmentId as string,
      ),
  },
  {
    name: 'mark_departed',
    description: 'Check out an active yard visit (mark as DEPARTED). PROPOSED — requires human approval.',
    tier: RiskTier.MUTATING,
    permission: PERMISSIONS.YARD.MANAGE,
    module: MODULE_KEYS.YARD,
    inputSchema: z.object({ visitId: z.string().min(1) }),
    run: (args, ctx) =>
      ctx.services.yardVisits.checkOut(
        ctx.principal.user.tenantId,
        ctx.principal.user.id,
        args.visitId as string,
      ),
  },
];
