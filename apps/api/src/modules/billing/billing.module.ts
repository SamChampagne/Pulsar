import { forwardRef, Module } from '@nestjs/common';
import { AuditLogsModule } from '../../core/audit-logs/audit-logs.module';
import { CustomFieldsModule } from '../../core/custom-fields/custom-fields.module';
import { EmailModule } from '../../core/email/email.module';
import { ModuleRegistryModule } from '../../core/module-registry/module-registry.module';
import { OperatingModule } from '../../core/operating/operating.module';
import { TransportationModule } from '../transportation/transportation.module';
import { BillingCustomFieldsController } from './custom-fields/billing-custom-fields.controller';
import { CustomerInvoicesController } from './customer-invoices.controller';
import { CustomerInvoicesService } from './customer-invoices.service';
import { FreightAuditController } from './freight-audit/freight-audit.controller';
import { FreightAuditService } from './freight-audit/freight-audit.service';
import { InvoicesController } from './invoices.controller';
import { InvoicesService } from './invoices.service';
import { LedgerController } from './ledger/ledger.controller';
import { LedgerService } from './ledger/ledger.service';
import { ModesOfPaymentController } from './modes-of-payment.controller';
import { ModesOfPaymentService } from './modes-of-payment.service';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { TaxTemplatesController } from './tax-templates.controller';
import { TaxTemplatesService } from './tax-templates.service';

/**
 * Billing — third business module, activable per tenant.
 * v1 scope: buy-side carrier settlement (estimated load costs → draft
 * invoices → approval). Customer invoicing (sell-side) added in phase 7.3.
 * Phase 16: freight-audit (incoming carrier invoices) added.
 */
@Module({
  imports: [AuditLogsModule, CustomFieldsModule, EmailModule, ModuleRegistryModule, TransportationModule, forwardRef(() => OperatingModule)],
  controllers: [InvoicesController, CustomerInvoicesController, FreightAuditController, BillingCustomFieldsController, LedgerController, ModesOfPaymentController, PaymentsController, TaxTemplatesController],
  providers: [InvoicesService, CustomerInvoicesService, FreightAuditService, LedgerService, ModesOfPaymentService, PaymentsService, TaxTemplatesService],
  exports: [FreightAuditService, CustomerInvoicesService, LedgerService, ModesOfPaymentService, PaymentsService, TaxTemplatesService],
})
export class BillingModule {}
