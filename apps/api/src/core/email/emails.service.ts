import { Injectable, NotFoundException } from '@nestjs/common';
import { paginated, paginationArgs } from '../../common/pagination';
import { PrismaService } from '../../prisma/prisma.service';
import type { ListEmailsQueryDto } from './dto/list-emails-query.dto';

@Injectable()
export class EmailsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(tenantId: string, query: ListEmailsQueryDto) {
    const { page, pageSize, skip, take } = paginationArgs(query);

    const where = {
      tenantId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.relatedType ? { relatedType: query.relatedType } : {}),
      ...(query.search
        ? {
            OR: [
              { subject: { contains: query.search, mode: 'insensitive' as const } },
              { toAddresses: { has: query.search } },
            ],
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.emailMessage.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        include: { attachments: true },
      }),
      this.prisma.emailMessage.count({ where }),
    ]);

    return paginated(items, total, page, pageSize);
  }

  async get(tenantId: string, id: string) {
    const msg = await this.prisma.emailMessage.findFirst({
      where: { id, tenantId },
      include: { attachments: true },
    });
    if (!msg) throw new NotFoundException(`Email message ${id} not found`);
    return msg;
  }
}
