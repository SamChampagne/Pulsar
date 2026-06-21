import { BadRequestException, Injectable } from '@nestjs/common';
import {
  CustomFieldEntity,
  CustomFieldType,
  validateCustomFields,
  validateDefinitions,
  type CustomFieldDefinition,
  type CustomFieldValues,
} from '@pulsar/shared';
import { Prisma } from '@pulsar/database';
import { PrismaService } from '../../../prisma/prisma.service';


const MODULE = 'transportation';

@Injectable()
export class CustomFieldsService {
  constructor(private readonly prisma: PrismaService) {}

  async listDefinitions(tenantId: string, entityType: CustomFieldEntity): Promise<CustomFieldDefinition[]> {
    const rows = await this.prisma.customFieldDefinition.findMany({
      where: { tenantId, module: MODULE, entityType },
      orderBy: { sortOrder: 'asc' },
    });
    return rows.map((r) => ({
      key: r.key,
      label: r.label,
      type: r.type as CustomFieldType,
      options: (r.options as { value: string; label: string }[] | null) ?? undefined,
      required: r.required,
      showInList: r.showInList,
      sortOrder: r.sortOrder,
    }));
  }

  async replaceDefinitions(
    tenantId: string,
    entityType: CustomFieldEntity,
    defs: CustomFieldDefinition[],
  ): Promise<CustomFieldDefinition[]> {
    const check = validateDefinitions(defs);
    if (!check.ok) throw new BadRequestException(check.errors.join('; '));
    await this.prisma.$transaction([
      this.prisma.customFieldDefinition.deleteMany({ where: { tenantId, module: MODULE, entityType } }),
      this.prisma.customFieldDefinition.createMany({
        data: defs.map((d, i) => ({
          tenantId,
          module: MODULE,
          entityType,
          key: d.key,
          label: d.label,
          type: d.type,
          options: d.options != null ? (d.options as Prisma.InputJsonValue) : Prisma.DbNull,
          required: d.required ?? false,
          showInList: d.showInList ?? false,
          sortOrder: d.sortOrder ?? i,
        })),
      }),
    ]);
    return this.listDefinitions(tenantId, entityType);
  }

  /** Validates a values payload; throws 400 on any error. Returns the cleaned values (or undefined if no data). */
  async validateValues(
    tenantId: string,
    entityType: CustomFieldEntity,
    data: unknown,
    opts: { partial?: boolean } = {},
  ): Promise<CustomFieldValues | undefined> {
    const defs = await this.listDefinitions(tenantId, entityType);
    if (defs.length === 0 && (data === undefined || data === null)) return undefined;
    const res = validateCustomFields(defs, data ?? {}, opts);
    if (!res.ok) throw new BadRequestException(res.errors.join('; '));
    return res.value;
  }
}
