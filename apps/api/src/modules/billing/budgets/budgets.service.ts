import { Injectable, NotFoundException } from '@nestjs/common';
import { computeBudgetVariance, naturalBalance } from '@pulsar/shared';
import { PrismaService } from '../../../prisma/prisma.service';
import { CreateBudgetDto, UpdateBudgetDto } from './dto/budget.dto';

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

@Injectable()
export class BudgetsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(tenantId: string) {
    return this.prisma.budget.findMany({
      where: { tenantId },
      include: { lines: true },
      orderBy: [{ fiscalYear: 'desc' }, { name: 'asc' }],
    });
  }

  async get(tenantId: string, id: string) {
    const budget = await this.prisma.budget.findFirst({
      where: { id, tenantId },
      include: { lines: true },
    });
    if (!budget) throw new NotFoundException('Budget not found');
    return budget;
  }

  async create(tenantId: string, dto: CreateBudgetDto) {
    return this.prisma.budget.create({
      data: {
        tenantId,
        name: dto.name,
        fiscalYear: dto.fiscalYear,
        isActive: dto.isActive ?? true,
        lines: {
          create: dto.lines.map((l) => ({
            tenantId,
            accountCode: l.accountCode,
            amount: l.amount,
          })),
        },
      },
      include: { lines: true },
    });
  }

  async update(tenantId: string, id: string, dto: UpdateBudgetDto) {
    const existing = await this.prisma.budget.findFirst({ where: { id, tenantId } });
    if (!existing) throw new NotFoundException('Budget not found');

    if (dto.lines !== undefined) {
      const newLines = dto.lines;
      return this.prisma.$transaction(async (tx) => {
        await tx.budgetLine.deleteMany({ where: { budgetId: id } });
        return tx.budget.update({
          where: { id },
          data: {
            ...(dto.name !== undefined ? { name: dto.name } : {}),
            ...(dto.fiscalYear !== undefined ? { fiscalYear: dto.fiscalYear } : {}),
            ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
            lines: {
              createMany: {
                data: newLines.map((l) => ({
                  tenantId,
                  accountCode: l.accountCode,
                  amount: l.amount,
                })),
              },
            },
          },
          include: { lines: true },
        });
      });
    }

    return this.prisma.budget.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.fiscalYear !== undefined ? { fiscalYear: dto.fiscalYear } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      },
      include: { lines: true },
    });
  }

  async remove(tenantId: string, id: string) {
    const existing = await this.prisma.budget.findFirst({ where: { id, tenantId } });
    if (!existing) throw new NotFoundException('Budget not found');
    await this.prisma.budget.delete({ where: { id } });
    return { deleted: true };
  }

  async variance(tenantId: string, id: string) {
    const budget = await this.prisma.budget.findFirst({
      where: { id, tenantId },
      include: { lines: true },
    });
    if (!budget) throw new NotFoundException('Budget not found');

    const fy = budget.fiscalYear;
    const from = new Date(Date.UTC(fy, 0, 1));
    const to = new Date(Date.UTC(fy, 11, 31, 23, 59, 59, 999));

    const lineCodes = budget.lines.map((l) => l.accountCode);

    // Aggregate GL lines for this tenant+fiscal year scoped to budget account codes
    const glLines = await this.prisma.journalLine.findMany({
      where: {
        tenantId,
        account: { code: { in: lineCodes } },
        entry: { date: { gte: from, lte: to } },
      },
      select: {
        debit: true,
        credit: true,
        account: { select: { code: true, name: true, type: true } },
      },
    });

    // Group by account code, summing debit/credit
    const glByCode = new Map<string, { code: string; name: string; type: string; debit: number; credit: number }>();
    for (const line of glLines) {
      const key = line.account.code;
      const existing = glByCode.get(key);
      if (existing) {
        existing.debit = round2(existing.debit + Number(line.debit));
        existing.credit = round2(existing.credit + Number(line.credit));
      } else {
        glByCode.set(key, {
          code: key,
          name: line.account.name,
          type: line.account.type,
          debit: round2(Number(line.debit)),
          credit: round2(Number(line.credit)),
        });
      }
    }

    // For zero-activity accounts, look up name+type from the chart of accounts
    const missingCodes = lineCodes.filter((c) => !glByCode.has(c));
    let chartLookup: Map<string, { name: string; type: string }> = new Map();
    if (missingCodes.length > 0) {
      const chartAccounts = await this.prisma.chartOfAccount.findMany({
        where: { tenantId, code: { in: missingCodes } },
        select: { code: true, name: true, type: true },
      });
      chartLookup = new Map(chartAccounts.map((a) => [a.code, { name: a.name, type: a.type }]));
    }

    // Build BudgetVarianceInput for each budget line
    const inputs = budget.lines.map((line) => {
      const gl = glByCode.get(line.accountCode);
      let actual = 0;
      let name = '';
      if (gl) {
        actual = naturalBalance({ code: gl.code, name: gl.name, type: gl.type, debit: gl.debit, credit: gl.credit });
        name = gl.name;
      } else {
        const chart = chartLookup.get(line.accountCode);
        name = chart?.name ?? '';
      }
      return {
        accountCode: line.accountCode,
        name,
        budget: Number(line.amount),
        actual,
      };
    });

    return computeBudgetVariance(inputs);
  }
}
