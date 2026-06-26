import { Injectable, NotFoundException } from '@nestjs/common';
import { maskAccountNumber } from '@pulsar/shared';
import { PrismaService } from '../../../prisma/prisma.service';
import { CreateBankAccountDto, UpdateBankAccountDto } from './dto/bank-account.dto';

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

function maskAccount<T extends { accountNumber?: string | null }>(row: T): T {
  return { ...row, accountNumber: maskAccountNumber(row.accountNumber) };
}

@Injectable()
export class BankAccountsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(tenantId: string) {
    const rows = await this.prisma.bankAccount.findMany({
      where: { tenantId },
      orderBy: { name: 'asc' },
    });
    return rows.map(maskAccount);
  }

  async get(tenantId: string, id: string) {
    const row = await this.prisma.bankAccount.findFirst({ where: { id, tenantId } });
    if (!row) throw new NotFoundException(`BankAccount ${id} not found`);
    return maskAccount(row);
  }

  async create(tenantId: string, dto: CreateBankAccountDto) {
    const data = {
      tenantId,
      name: dto.name,
      accountNumber: dto.accountNumber,
      glAccountCode: dto.glAccountCode ?? '1010',
      currency: dto.currency ?? 'CAD',
      isDefault: dto.isDefault ?? false,
    };

    if (data.isDefault) {
      const result = await this.prisma.$transaction(async (tx) => {
        await tx.bankAccount.updateMany({ where: { tenantId, isDefault: true }, data: { isDefault: false } });
        return tx.bankAccount.create({ data });
      });
      return maskAccount(result);
    }

    const result = await this.prisma.bankAccount.create({ data });
    return maskAccount(result);
  }

  async update(tenantId: string, id: string, dto: UpdateBankAccountDto) {
    const existing = await this.prisma.bankAccount.findFirst({ where: { id, tenantId } });
    if (!existing) throw new NotFoundException(`BankAccount ${id} not found`);

    if (dto.isDefault) {
      const result = await this.prisma.$transaction(async (tx) => {
        await tx.bankAccount.updateMany({
          where: { tenantId, isDefault: true, id: { not: id } },
          data: { isDefault: false },
        });
        return tx.bankAccount.update({ where: { id }, data: dto });
      });
      return maskAccount(result);
    }

    const result = await this.prisma.bankAccount.update({ where: { id }, data: dto });
    return maskAccount(result);
  }

  async remove(tenantId: string, id: string) {
    const existing = await this.prisma.bankAccount.findFirst({ where: { id, tenantId } });
    if (!existing) throw new NotFoundException(`BankAccount ${id} not found`);
    await this.prisma.bankAccount.delete({ where: { id } });
  }

  async balance(tenantId: string, id: string) {
    const account = await this.prisma.bankAccount.findFirst({ where: { id, tenantId } });
    if (!account) throw new NotFoundException(`BankAccount ${id} not found`);

    const agg = await this.prisma.bankTransaction.aggregate({
      where: { bankAccountId: id, tenantId },
      _sum: { amount: true },
      _count: true,
    });

    return {
      balance: round2(Number(agg._sum.amount ?? 0)),
      txnCount: agg._count,
    };
  }
}
