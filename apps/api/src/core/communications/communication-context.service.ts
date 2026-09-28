import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Prisma } from '@pulsar/database';
import {
  AuthUser,
  COMMUNICATION_ACCESS,
  CommunicationChannel,
  DirectoryEntryData,
  normalizeCommunicationRecipient,
  PartyKind,
} from '@pulsar/shared';
import { TenantModulesCacheService } from '../../prisma/tenant-modules-cache.service';
import { partyParent, partyWhere } from '../reference-data/party-profile.service';

@Injectable()
export class CommunicationContextService {
  constructor(private readonly modules: TenantModulesCacheService) {}

  async resolve(tx: Prisma.TransactionClient, actor: AuthUser, path: string, id: string) {
    const access = COMMUNICATION_ACCESS.find((a) => a.path === path);
    if (
      !access ||
      !actor.permissions.includes(access.read) ||
      !(await this.modules.getEnabledKeys(actor.tenantId)).has(access.module)
    )
      throw new ForbiddenException('Ce dossier n’est pas accessible.');
    const tenantId = actor.tenantId;
    let kind: string = access.kind;
    let title = '',
      client = '',
      partyId = id,
      partyKind: PartyKind;
    let revision: unknown;
    if (kind === 'job') {
      const row = await tx.serviceJob.findFirst({
        where: { tenantId, id },
        select: { number: true, title: true, updatedAt: true, projectId: true },
      });
      if (!row) throw new NotFoundException('Intervention introuvable.');
      const project = await tx.serviceProject.findFirst({
        where: { tenantId, id: row.projectId },
        select: { partnerId: true, updatedAt: true },
      });
      if (!project) throw new NotFoundException('Projet introuvable.');
      title = `${row.number} · ${row.title}`;
      revision = [row, project];
      partyId = project.partnerId;
      partyKind = 'client';
    } else if (kind === 'deal') {
      const row = await tx.crmDeal.findFirst({
        where: { tenantId, id },
        select: { title: true, updatedAt: true, companyId: true },
      });
      if (!row) throw new NotFoundException('Opportunité introuvable.');
      title = row.title;
      revision = row;
      partyId = row.companyId;
      partyKind = 'crm-company';
    } else if (kind === 'shipment') {
      const row = await tx.shipment.findFirst({
        where: { tenantId, id },
        select: { shipmentNumber: true, updatedAt: true, transportOrderId: true },
      });
      if (!row) throw new NotFoundException('Expédition introuvable.');
      const order = await tx.transportOrder.findFirst({
        where: { tenantId, id: row.transportOrderId },
        select: { customerId: true, updatedAt: true },
      });
      if (!order) throw new NotFoundException('Commande introuvable.');
      title = row.shipmentNumber;
      revision = [row, order];
      partyId = order.customerId;
      partyKind = 'customer';
    } else {
      partyKind = access.kind as PartyKind;
      kind = ['client', 'supplier', 'partner'].includes(kind) ? 'partner' : kind;
    }
    // Explicit parent only. No CRM/customer/partner transitive identity matching.
    const parent = await partyParent(tx, tenantId, partyKind, partyId);
    client = parent.name;
    title ||= parent.name;
    const recipients: { label: string; channel: CommunicationChannel; value: string }[] = [];
    const add = (label: string, email?: string | null, phone?: string | null) => {
      for (const [channel, raw] of [
        [CommunicationChannel.EMAIL, email],
        [CommunicationChannel.SMS, phone],
      ] as const) {
        const value = raw && normalizeCommunicationRecipient(channel, raw);
        if (value && !recipients.some((r) => r.channel === channel && r.value === value))
          recipients.push({ label, channel, value });
      }
    };
    if (partyKind === 'customer') {
      const p = await tx.customer.findFirstOrThrow({
        where: { tenantId, id: partyId },
        select: { email: true, phone: true, isActive: true },
      });
      if (p.isActive) add(parent.name, p.email, p.phone);
    } else if (partyKind === 'crm-company') {
      const contacts = await tx.crmContact.findMany({
        where: { tenantId, companyId: partyId },
        select: { name: true, email: true, phone: true },
        orderBy: { id: 'asc' },
        take: 100,
      });
      for (const contact of contacts) add(contact.name, contact.email, contact.phone);
    } else {
      const p = await tx.businessPartner.findFirstOrThrow({
        where: { tenantId, id: partyId },
        select: { email: true, phone: true, active: true },
      });
      if (p.active) add(parent.name, p.email, p.phone);
    }
    const entries = await tx.partyDirectoryEntry.findMany({
      where: { tenantId, ...partyWhere(partyKind, partyId), kind: 'CONTACT' },
      select: { data: true },
      orderBy: { id: 'asc' },
      take: 100,
    });
    const today = new Date().toISOString().slice(0, 10);
    for (const entry of entries) {
      const data = entry.data as unknown as DirectoryEntryData;
      if (
        data.active &&
        (!data.validFrom || data.validFrom <= today) &&
        (!data.validUntil || data.validUntil > today)
      )
        add(data.label, data.email, data.phone);
    }
    const reviewToken = createHash('sha256')
      .update(JSON.stringify({ kind, id, parent, revision, title, recipients }))
      .digest('hex');
    return {
      kind,
      id,
      title,
      client,
      recipients,
      reviewToken,
      canManageSource: actor.permissions.includes(access.manage),
    };
  }
}
