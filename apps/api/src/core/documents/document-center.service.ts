import { Injectable } from '@nestjs/common';
import type { Paginated } from '@pulsar/shared';
import { computeComplianceStatus } from '@pulsar/shared';
import type { Prisma } from '@pulsar/database';
import { PrismaService } from '../../prisma/prisma.service';
import { paginated } from '../../common/pagination';
import { DocumentCenterQueryDto } from './dto/document-center-query.dto';

const WALLPAPER_ENTITY_TYPE = 'desk-wallpaper';
const COMPLIANCE_CAP = 100;

/** Known entityType → readable FR label. Fallback = raw entityType. */
const ENTITY_TYPE_LABELS: Record<string, string> = {
  'bill-of-lading': 'Connaissement (BOL)',
  'proof-of-delivery': 'Preuve de livraison (POD)',
  'compliance-document': 'Conformité',
  'desk-wallpaper': 'Fond de bureau',
};

function labelFor(entityType: string): string {
  return ENTITY_TYPE_LABELS[entityType] ?? entityType;
}

export interface DocCenterItem {
  id: string;
  entityType: string;
  entityId: string;
  category: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  uploadedByName?: string;
  createdAt: Date;
}

export interface DocumentCategoryFacet {
  entityType: string;
  label: string;
  count: number;
}

export interface ComplianceAlertItem {
  id: string;
  subjectType: string;
  subjectId: string;
  docType: string;
  reference?: string;
  expiresAt: Date;
  status: 'EXPIRING' | 'EXPIRED';
  documentId?: string;
}

export interface DocumentCenterDto {
  documents: Paginated<DocCenterItem>;
  categories: DocumentCategoryFacet[];
  compliance: ComplianceAlertItem[];
}

@Injectable()
export class DocumentCenterService {
  constructor(private readonly prisma: PrismaService) {}

  async overview(tenantId: string, query: DocumentCenterQueryDto): Promise<DocumentCenterDto> {
    const excludeWallpaper = query.excludeWallpaper ?? true;
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 25;

    const where: Prisma.DocumentWhereInput = { tenantId };
    if (query.category) {
      where.entityType = query.category;
    } else if (excludeWallpaper) {
      where.entityType = { not: WALLPAPER_ENTITY_TYPE };
    }
    if (query.search) {
      where.fileName = { contains: query.search, mode: 'insensitive' };
    }
    if (query.from || query.to) {
      where.createdAt = {
        ...(query.from ? { gte: new Date(query.from) } : {}),
        ...(query.to ? { lte: new Date(query.to) } : {}),
      };
    }

    // Facet counts are scoped to the tenant and (optionally) exclude wallpaper,
    // independent of the documents-list filters.
    const facetWhere: Prisma.DocumentWhereInput = { tenantId };
    if (excludeWallpaper) {
      facetWhere.entityType = { not: WALLPAPER_ENTITY_TYPE };
    }

    const [rows, total, grouped, complianceRows] = await Promise.all([
      this.prisma.document.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          uploadedBy: { select: { firstName: true, lastName: true, email: true } },
        },
      }),
      this.prisma.document.count({ where }),
      this.prisma.document.groupBy({
        by: ['entityType'],
        where: facetWhere,
        _count: { _all: true },
      }),
      this.prisma.complianceDocument.findMany({
        where: { tenantId },
        orderBy: { expiresAt: 'asc' },
        take: COMPLIANCE_CAP,
      }),
    ]);

    const items: DocCenterItem[] = rows.map((doc) => ({
      id: doc.id,
      entityType: doc.entityType,
      entityId: doc.entityId,
      category: labelFor(doc.entityType),
      fileName: doc.fileName,
      mimeType: doc.mimeType,
      sizeBytes: doc.sizeBytes,
      uploadedByName: doc.uploadedBy
        ? `${doc.uploadedBy.firstName} ${doc.uploadedBy.lastName}`.trim() || doc.uploadedBy.email
        : undefined,
      createdAt: doc.createdAt,
    }));

    const categories: DocumentCategoryFacet[] = grouped
      .map((g) => ({
        entityType: g.entityType,
        label: labelFor(g.entityType),
        count: g._count._all,
      }))
      .sort((a, b) => b.count - a.count);

    const now = Date.now();
    const compliance: ComplianceAlertItem[] = [];
    for (const c of complianceRows) {
      const status = computeComplianceStatus(c.expiresAt, now);
      if (status !== 'EXPIRING' && status !== 'EXPIRED') continue;
      compliance.push({
        id: c.id,
        subjectType: c.subjectType,
        subjectId: c.subjectId,
        docType: c.docType,
        reference: c.reference ?? undefined,
        expiresAt: c.expiresAt,
        status,
        documentId: c.documentId ?? undefined,
      });
    }

    return {
      documents: paginated(items, total, page, pageSize),
      categories,
      compliance,
    };
  }
}
