import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@pulsar/database';
import { ListQueryDto } from '../../../common/dto/list-query.dto';
import { paginated, paginationArgs } from '../../../common/pagination';
import { PrismaService } from '../../../prisma/prisma.service';
import { CreateCustomerDto, UpdateCustomerDto } from './dto/customer.dto';
import { addressData } from '../../../common/dto/postal-address.dto';

@Injectable()
export class CustomersService {
  constructor(private readonly prisma: PrismaService) {}

  async list(tenantId: string, query: ListQueryDto) {
    const { page, pageSize, skip, take } = paginationArgs(query);
    const where: Prisma.CustomerWhereInput = {
      tenantId,
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' } },
              { code: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.customer.findMany({ where, skip, take, orderBy: { name: 'asc' } }),
      this.prisma.customer.count({ where }),
    ]);
    return paginated(items, total, page, pageSize);
  }

  async get(tenantId: string, id: string) {
    const customer = await this.prisma.customer.findFirst({
      where: { id, tenantId },
      include: { locations: true },
    });
    if (!customer) throw new NotFoundException('Customer not found');
    return customer;
  }

  async create(tenantId: string, dto: CreateCustomerDto) {
    const existing = await this.prisma.customer.findUnique({
      where: { tenantId_code: { tenantId, code: dto.code } },
    });
    if (existing) throw new ConflictException(`Customer code "${dto.code}" already exists`);
    return this.prisma.customer.create({ data: { ...dto, ...addressData(dto), tenantId } });
  }

  async update(tenantId: string, id: string, dto: UpdateCustomerDto) {
    const old = await this.get(tenantId, id);
    const { code: _code, expectedUpdatedAt, ...data } = dto; // code is immutable once created
    const res = await this.prisma.customer.updateMany({
      where: {
        id,
        tenantId,
        ...(expectedUpdatedAt ? { updatedAt: new Date(expectedUpdatedAt) } : {}),
      },
      data: {
        ...data,
        ...addressData(dto),
        updatedAt: new Date(Math.max(Date.now(), old.updatedAt.getTime() + 1)),
      },
    });
    if (res.count === 0)
      throw new ConflictException(
        'Fiche modifiée depuis votre lecture. Rechargez avant de modifier.',
      );
    return this.prisma.customer.findFirstOrThrow({ where: { id, tenantId } });
  }
}
