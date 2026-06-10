import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@pulsar/database';
import { PrismaService } from '../../prisma/prisma.service';

export interface UpsertIntegrationInput {
  key: string;
  name: string;
  config?: Record<string, unknown>;
  status?: 'DISABLED' | 'ENABLED' | 'ERROR';
}

/**
 * Integration *configuration* registry (EDI, telematics, ERP connectors...).
 * Actual connector runtimes are a later phase — this stores per-tenant config.
 * TODO(phase-3): encrypt secrets inside config at rest.
 */
@Injectable()
export class IntegrationsService {
  constructor(private readonly prisma: PrismaService) {}

  list(tenantId: string) {
    return this.prisma.integration.findMany({ where: { tenantId }, orderBy: { name: 'asc' } });
  }

  async create(tenantId: string, input: UpsertIntegrationInput) {
    const existing = await this.prisma.integration.findUnique({
      where: { tenantId_key: { tenantId, key: input.key } },
    });
    if (existing) throw new ConflictException(`Integration "${input.key}" already exists`);
    return this.prisma.integration.create({
      data: {
        tenantId,
        key: input.key,
        name: input.name,
        status: input.status ?? 'DISABLED',
        config: (input.config ?? {}) as Prisma.InputJsonValue,
      },
    });
  }

  async update(tenantId: string, id: string, input: Partial<UpsertIntegrationInput>) {
    const integration = await this.prisma.integration.findFirst({ where: { id, tenantId } });
    if (!integration) throw new NotFoundException('Integration not found');
    return this.prisma.integration.update({
      where: { id },
      data: {
        name: input.name,
        status: input.status,
        ...(input.config ? { config: input.config as Prisma.InputJsonValue } : {}),
      },
    });
  }
}
