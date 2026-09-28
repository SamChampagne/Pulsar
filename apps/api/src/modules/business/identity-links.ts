import { ConflictException } from '@nestjs/common';
import type { Prisma } from '@pulsar/database';

/** Called under lockBusinessTenant by every CRM customer-link writer. No inferred mapping. */
export async function assertCompanyCustomerLink(
  tx: Prisma.TransactionClient,
  tenantId: string,
  companyId: string,
  customerId: string | null,
) {
  const partner = await tx.businessPartner.findFirst({
    where: { tenantId, crmCompanyId: companyId },
    select: { billingCustomerId: true },
  });
  if (partner?.billingCustomerId && partner.billingCustomerId !== customerId)
    throw new ConflictException(
      'Le partenaire possède déjà un autre lien client. Revoyez explicitement les connexions avant de poursuivre.',
    );
}
