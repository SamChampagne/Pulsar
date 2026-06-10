import { Module } from '@nestjs/common';
import { AuditLogsModule } from '../../core/audit-logs/audit-logs.module';
import { InvoicesController } from './invoices.controller';
import { InvoicesService } from './invoices.service';

/**
 * Billing — third business module, activable per tenant.
 * v1 scope: buy-side carrier settlement (estimated load costs → draft
 * invoices → approval). Customer invoicing and payments come later.
 */
@Module({
  imports: [AuditLogsModule],
  controllers: [InvoicesController],
  providers: [InvoicesService],
})
export class BillingModule {}
