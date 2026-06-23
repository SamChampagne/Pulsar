import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { interpolateTemplate } from '@pulsar/shared';
import { PrismaService } from '../../prisma/prisma.service';
import type { CreateEmailTemplateDto, UpdateEmailTemplateDto } from './dto/email-templates.dto';

@Injectable()
export class EmailTemplatesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(tenantId: string) {
    return this.prisma.emailTemplate.findMany({
      where: { tenantId },
      orderBy: { key: 'asc' },
    });
  }

  async get(tenantId: string, id: string) {
    const tpl = await this.prisma.emailTemplate.findFirst({ where: { id, tenantId } });
    if (!tpl) throw new NotFoundException(`Email template ${id} not found`);
    return tpl;
  }

  async create(tenantId: string, dto: CreateEmailTemplateDto) {
    const existing = await this.prisma.emailTemplate.findFirst({
      where: { tenantId, key: dto.key },
      select: { id: true },
    });
    if (existing) throw new ConflictException(`Template key "${dto.key}" already exists for this tenant`);

    return this.prisma.emailTemplate.create({
      data: {
        tenantId,
        key: dto.key,
        name: dto.name,
        subject: dto.subject,
        html: dto.html,
        category: dto.category ?? null,
      },
    });
  }

  async update(tenantId: string, id: string, dto: UpdateEmailTemplateDto) {
    const tpl = await this.prisma.emailTemplate.findFirst({ where: { id, tenantId } });
    if (!tpl) throw new NotFoundException(`Email template ${id} not found`);

    return this.prisma.emailTemplate.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.subject !== undefined ? { subject: dto.subject } : {}),
        ...(dto.html !== undefined ? { html: dto.html } : {}),
        ...(dto.category !== undefined ? { category: dto.category } : {}),
      },
    });
  }

  async remove(tenantId: string, id: string) {
    const tpl = await this.prisma.emailTemplate.findFirst({ where: { id, tenantId } });
    if (!tpl) throw new NotFoundException(`Email template ${id} not found`);
    await this.prisma.emailTemplate.delete({ where: { id } });
  }

  /**
   * Renders a template by key, substituting `{variable}` tokens from payload.
   * Returns `{ subject, html }` ready to be passed to MailService.queue.
   */
  async render(tenantId: string, key: string, payload: Record<string, unknown> = {}) {
    const tpl = await this.prisma.emailTemplate.findFirst({ where: { tenantId, key } });
    if (!tpl) throw new NotFoundException(`Email template with key "${key}" not found`);

    return {
      subject: interpolateTemplate(tpl.subject, payload),
      html: interpolateTemplate(tpl.html, payload),
    };
  }
}
