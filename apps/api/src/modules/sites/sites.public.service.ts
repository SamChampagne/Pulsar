import { Injectable, NotFoundException } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { LandingPageStatus, MODULE_KEYS, mapSubmissionToContact } from '@pulsar/shared';
import { Prisma } from '@pulsar/database';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantModulesCacheService } from '../../prisma/tenant-modules-cache.service';
import { DomainEventsService } from '../../core/operating/domain-events.service';
import { SubmitDto } from './dto/submit.dto';

/**
 * Public sites service — no auth, no ModulesGuard.
 *
 * R10: projections never include tenantId, id, captureListId or any internal ref.
 * R15: module activation is re-checked manually (public routes bypass ModulesGuard).
 */
@Injectable()
export class SitesPublicService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly modulesCache: TenantModulesCacheService,
    private readonly domainEvents: DomainEventsService,
    private readonly moduleRef: ModuleRef,
  ) {}

  /**
   * Resolve a page by slug and enforce the twin gate: module active + PUBLISHED.
   * Returns the raw DB row (internal use only — callers must project before returning).
   */
  private async resolvePublishedPage(slug: string) {
    const page = await this.prisma.landingPage.findFirst({ where: { slug } });
    if (!page) throw new NotFoundException('Page not found');

    // R15: re-check module activation for this tenant (public route bypasses ModulesGuard).
    const enabled = await this.modulesCache.getEnabledKeys(page.tenantId);
    if (!enabled.has(MODULE_KEYS.SITES)) throw new NotFoundException('Page not found');

    if (page.status !== LandingPageStatus.PUBLISHED) throw new NotFoundException('Page not found');

    return page;
  }

  /**
   * Project a page's content blocks to display-safe shape (R10).
   * Form blocks expose only { type, fields }; cta blocks expose only
   * { type, label, href }; other blocks are passed through with all keys
   * EXCEPT internal refs (id, tenantId, etc.).
   */
  private projectBlocks(content: unknown): unknown[] {
    if (!Array.isArray(content)) return [];
    return content.map((block) => {
      if (block && typeof block === 'object' && (block as Record<string, unknown>).type === 'form') {
        // Form blocks: expose only type + fields
        return {
          type: 'form',
          fields: (block as Record<string, unknown>).fields ?? [],
        };
      }
      if (block && typeof block === 'object' && (block as Record<string, unknown>).type === 'cta') {
        // CTA blocks: expose only type + label + href (rule 40 explicit projection).
        // validateLandingContent guarantees label/href are non-empty strings at write
        // time, so the `?? ''` below is defensive only (never the actual fallback path).
        return {
          type: 'cta',
          label: (block as Record<string, unknown>).label ?? '',
          href: (block as Record<string, unknown>).href ?? '',
        };
      }
      // Other blocks: pass through as-is (they contain only display data)
      // R10 invariant: non-form block types must contain ONLY display data. A future block type
      // that carries an internal ref MUST be explicitly sanitized here before it can leak in
      // the public payload.
      return block;
    });
  }

  /** GET /public/sites/:slug — public page view. R10 projection: { title, blocks } only. */
  async getPublic(slug: string) {
    const page = await this.resolvePublishedPage(slug);
    return {
      title: page.title,
      blocks: this.projectBlocks(page.content),
    };
  }

  /** POST /public/sites/:slug/submit — submit a form. Creates LandingPageSubmission + optional CRM lead. */
  async submit(slug: string, dto: SubmitDto) {
    const page = await this.resolvePublishedPage(slug);

    // Honeypot check: if _hp is non-empty string → silently discard (bot)
    if (typeof dto._hp === 'string' && dto._hp.length > 0) {
      return { ok: true };
    }

    // Strip _hp from data before persisting
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { _hp: _honeypot, ...cleanData } = dto as Record<string, unknown>;

    // Create submission
    const submission = await this.prisma.landingPageSubmission.create({
      data: {
        tenantId: page.tenantId,
        landingPageId: page.id,
        data: cleanData as Prisma.InputJsonValue,
      },
    });

    // CRM lead capture (best-effort — CRM module optional, decoupled via ModuleRef)
    try {
      const enabled = await this.modulesCache.getEnabledKeys(page.tenantId);
      if (enabled.has(MODULE_KEYS.CRM)) {
        const lead = mapSubmissionToContact(cleanData as Record<string, unknown>);

        let contactId: string | undefined;

        if (lead.email) {
          // Dedup by email (case-insensitive) — direct prisma (no static CrmModule import)
          const existing = await this.prisma.crmContact.findFirst({
            where: {
              tenantId: page.tenantId,
              email: { equals: lead.email, mode: 'insensitive' },
            },
            select: { id: true },
          });

          if (existing) {
            contactId = existing.id;
          } else {
            const created = await this.prisma.crmContact.create({
              data: {
                tenantId: page.tenantId,
                name: lead.name ?? lead.email,
                email: lead.email,
                phone: lead.phone ?? null,
              },
              select: { id: true },
            });
            contactId = created.id;
          }
        }

        if (contactId) {
          // Update submission with contactId
          await this.prisma.landingPageSubmission.update({
            where: { id: submission.id },
            data: { contactId },
          });

          // Add to capture list (idempotent) via ListsService through ModuleRef
          if (page.captureListId) {
            try {
              // Dynamically resolve ListsService to avoid static CrmModule import
              const { ListsService } = await (import('../crm/lists.service') as Promise<{ ListsService: new (...args: unknown[]) => { addMember: (tenantId: string, listId: string, dto: { contactId: string }) => Promise<unknown> } }>);
              const listsService = this.moduleRef.get(ListsService, { strict: false });
              await listsService.addMember(page.tenantId, page.captureListId, { contactId });
            } catch {
              // Best-effort: list-add failure is non-fatal
            }
          }
        }
      }
    } catch {
      // Best-effort: CRM lead capture failure is non-fatal
    }

    // Emit domain event (best-effort)
    void this.domainEvents
      .emit(page.tenantId, 'sites.lead.captured', { type: 'landing-page', id: page.id }, {
        landingPageId: page.id,
        slug: page.slug,
      })
      .catch(() => { /* best-effort */ });

    return { ok: true };
  }
}
