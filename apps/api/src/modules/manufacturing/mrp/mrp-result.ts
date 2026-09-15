import { ServiceUnavailableException } from '@nestjs/common';
import { z } from 'zod';
import type { MrpResult, MrpSnapshot } from '@pulsar/shared';
import { MrpSourcingMethod } from '@pulsar/shared';

const quantity = z
  .string()
  .regex(/^\d+(\.\d+)?$/)
  .max(60);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const method = z.nativeEnum(MrpSourcingMethod);
const schema = z.object({
  tenant_id: z.string(),
  version: z.literal('pulsar.mrp.v1'),
  engine_revision: z.literal('planiadvance-d26a8cd.pulsar-mrp1'),
  as_of: day,
  horizon_end: day,
  proposals: z
    .array(
      z.object({
        id: z.string(),
        item_id: z.string(),
        method,
        quantity,
        net_requirement: quantity,
        receipt_date: day,
        release_date: day,
        expedite: z.boolean(),
        level: z.number().int().min(0).max(50),
        safety_stock: quantity,
        reasons: z
          .array(z.object({ source: z.string(), reference: z.string(), date: day, quantity }))
          .max(20000),
      }),
    )
    .max(20000),
  items: z
    .array(
      z.object({
        item_id: z.string(),
        sku: z.string(),
        name: z.string(),
        unit: z.string(),
        method,
        level: z.number().int().min(0).max(50),
        on_hand: quantity,
        gross_requirement: quantity,
        planned_receipts: quantity,
        projected_end: quantity,
        timeline: z
          .array(
            z.object({
              date: day,
              gross: quantity,
              scheduled_receipts: quantity,
              planned_receipts: quantity,
              projected: quantity,
              sources: z
                .array(z.object({ id: z.string(), reference: z.string(), quantity }))
                .max(20000),
            }),
          )
          .max(731),
      }),
    )
    .max(2000),
  exceptions: z
    .array(
      z.object({
        code: z.enum(['OVERDUE_SUPPLY', 'LATE_RELEASE']),
        item_id: z.string(),
        source: z.string(),
        date: day,
        quantity,
      }),
    )
    .max(30000),
  assumptions: z.array(z.string()).max(20),
});

export function validateMrpResult(value: unknown, tenantId: string, input: MrpSnapshot): MrpResult {
  const parsed = schema.safeParse(value);
  const invalid = () =>
    new ServiceUnavailableException('Réponse MRP invalide. Aucun calcul enregistré.');
  if (!parsed.success) throw invalid();
  const result = parsed.data;
  const items = new Map(input.items.map((i) => [i.id, i]));
  if (
    result.tenant_id !== tenantId ||
    result.as_of !== input.as_of ||
    result.horizon_end !== input.horizon_end ||
    result.items.length !== items.size ||
    new Set(result.items.map((i) => i.item_id)).size !== items.size ||
    new Set(result.proposals.map((p) => p.id)).size !== result.proposals.length
  )
    throw invalid();
  for (const row of result.items) {
    const source = items.get(row.item_id);
    if (
      !source ||
      row.sku !== source.sku ||
      row.unit !== source.unit ||
      row.method !== source.method
    )
      throw invalid();
  }
  if (
    result.proposals.some(
      (p) => !items.has(p.item_id) || p.method !== items.get(p.item_id)!.method,
    ) ||
    result.exceptions.some((e) => !items.has(e.item_id))
  )
    throw invalid();
  return result;
}
