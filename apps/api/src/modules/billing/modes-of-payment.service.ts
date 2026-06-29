import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateModeOfPaymentDto, UpdateModeOfPaymentDto } from './dto/mode-of-payment.dto';

@Injectable()
export class ModesOfPaymentService {
  constructor(private readonly prisma: PrismaService) {}

  list(tenantId: string) {
    return this.prisma.modeOfPayment.findMany({ where: { tenantId }, orderBy: { name: 'asc' } });
  }

  create(tenantId: string, dto: CreateModeOfPaymentDto) {
    return this.prisma.modeOfPayment.create({ data: { tenantId, ...dto } });
  }

  async update(tenantId: string, id: string, dto: UpdateModeOfPaymentDto) {
    const found = await this.prisma.modeOfPayment.findFirst({ where: { id, tenantId }, select: { id: true } });
    if (!found) throw new NotFoundException('Mode of payment not found');
    return this.prisma.modeOfPayment.update({ where: { id }, data: dto });
  }

  async remove(tenantId: string, id: string) {
    const found = await this.prisma.modeOfPayment.findFirst({ where: { id, tenantId }, select: { id: true } });
    if (!found) throw new NotFoundException('Mode of payment not found');
    await this.prisma.modeOfPayment.delete({ where: { id } });
    return { deleted: true };
  }

  async resolveAccountCode(tenantId: string, modeId: string): Promise<string> {
    const mode = await this.prisma.modeOfPayment.findFirst({ where: { id: modeId, tenantId }, select: { accountCode: true } });
    if (!mode) throw new NotFoundException('Mode of payment not found');
    return mode.accountCode;
  }
}
