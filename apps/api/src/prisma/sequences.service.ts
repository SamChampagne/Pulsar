import { Injectable } from '@nestjs/common';
import { PrismaService } from './prisma.service';

export type SequenceKey = 'transport-order' | 'shipment' | 'load' | 'invoice' | 'customer-invoice' | 'bol';

const PREFIXES: Record<SequenceKey, string> = {
  'transport-order': 'TO',
  shipment: 'SH',
  load: 'LD',
  invoice: 'INV',
  'customer-invoice': 'CINV',
  bol: 'BOL',
};

/**
 * Per-tenant atomic document numbering backed by the number_sequences table.
 * The upsert-returning statement is a single atomic operation, so concurrent
 * callers always get distinct values (unlike the count-based v0 approach).
 */
@Injectable()
export class SequencesService {
  constructor(private readonly prisma: PrismaService) {}

  async next(tenantId: string, key: SequenceKey): Promise<number> {
    const rows = await this.prisma.$queryRaw<{ value: number }[]>`
      INSERT INTO number_sequences (tenant_id, key, value)
      VALUES (${tenantId}, ${key}, 1)
      ON CONFLICT (tenant_id, key)
      DO UPDATE SET value = number_sequences.value + 1
      RETURNING value`;
    return rows[0].value;
  }

  async nextNumber(tenantId: string, key: SequenceKey): Promise<string> {
    const value = await this.next(tenantId, key);
    return `${PREFIXES[key]}-${String(value).padStart(6, '0')}`;
  }
}
