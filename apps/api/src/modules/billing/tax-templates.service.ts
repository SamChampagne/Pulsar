import { Injectable, NotFoundException } from '@nestjs/common';
import { TaxTemplateType } from '@pulsar/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateTaxTemplateDto, UpdateTaxTemplateDto } from './dto/tax-template.dto';

@Injectable()
export class TaxTemplatesService {
  constructor(private readonly prisma: PrismaService) {}

  list(tenantId: string, type?: TaxTemplateType) {
    return this.prisma.taxTemplate.findMany({ where: { tenantId, type }, include: { lines: { orderBy: { sortOrder: 'asc' } } }, orderBy: { name: 'asc' } });
  }

  async get(tenantId: string, id: string) {
    const t = await this.prisma.taxTemplate.findFirst({ where: { id, tenantId }, include: { lines: { orderBy: { sortOrder: 'asc' } } } });
    if (!t) throw new NotFoundException('Tax template not found');
    return t;
  }

  resolveDefault(tenantId: string, type: TaxTemplateType) {
    return this.prisma.taxTemplate.findFirst({ where: { tenantId, type, isDefault: true }, include: { lines: { orderBy: { sortOrder: 'asc' } } } });
  }

  async create(tenantId: string, dto: CreateTaxTemplateDto) {
    return this.prisma.$transaction(async (tx) => {
      if (dto.isDefault) await tx.taxTemplate.updateMany({ where: { tenantId, type: dto.type }, data: { isDefault: false } });
      return tx.taxTemplate.create({
        data: {
          tenantId, name: dto.name, type: dto.type, isDefault: dto.isDefault ?? false,
          lines: { create: dto.lines.map((l, i) => ({ tenantId, description: l.description, rate: l.rate, accountCode: l.accountCode, sortOrder: l.sortOrder ?? i })) },
        },
        include: { lines: { orderBy: { sortOrder: 'asc' } } },
      });
    });
  }

  async update(tenantId: string, id: string, dto: UpdateTaxTemplateDto) {
    const existing = await this.prisma.taxTemplate.findFirst({ where: { id, tenantId }, select: { id: true, type: true } });
    if (!existing) throw new NotFoundException('Tax template not found');
    const type = dto.type ?? existing.type;
    return this.prisma.$transaction(async (tx) => {
      if (dto.isDefault) await tx.taxTemplate.updateMany({ where: { tenantId, type }, data: { isDefault: false } });
      if (dto.lines) {
        await tx.taxTemplateLine.deleteMany({ where: { templateId: id } });
        await tx.taxTemplateLine.createMany({ data: dto.lines.map((l, i) => ({ tenantId, templateId: id, description: l.description, rate: l.rate, accountCode: l.accountCode, sortOrder: l.sortOrder ?? i })) });
      }
      return tx.taxTemplate.update({
        where: { id },
        data: { name: dto.name, type: dto.type, isDefault: dto.isDefault },
        include: { lines: { orderBy: { sortOrder: 'asc' } } },
      });
    });
  }

  async remove(tenantId: string, id: string) {
    const found = await this.prisma.taxTemplate.findFirst({ where: { id, tenantId }, select: { id: true } });
    if (!found) throw new NotFoundException('Tax template not found');
    await this.prisma.taxTemplate.delete({ where: { id } });
    return { deleted: true };
  }
}
