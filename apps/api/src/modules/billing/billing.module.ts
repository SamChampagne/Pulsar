import { Module } from '@nestjs/common';
import { AuditLogsModule } from '../../core/audit-logs/audit-logs.module';
import { EmailModule } from '../../core/email/email.module';
import { TransportationModule } from '../transportation/transportation.module';
import { CustomerInvoicesController } from './customer-invoices.controller';
import { CustomerInvoicesService } from './customer-invoices.service';
import { InvoicesController } from './invoices.controller';
import { InvoicesService } from './invoices.service';

/**
 * Billing — third business module, activable per tenant.
 * v1 scope: buy-side carrier settlement (estimated load costs → draft
 * invoices → approval). Customer invoicing (sell-side) added in phase 7.3.
 */
@Module({
  imports: [AuditLogsModule, EmailModule, TransportationModule],
  controllers: [InvoicesController, CustomerInvoicesController],
  providers: [InvoicesService, CustomerInvoicesService],
})
export class BillingModule {}
