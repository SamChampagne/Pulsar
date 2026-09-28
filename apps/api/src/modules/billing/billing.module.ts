import { forwardRef, Module } from '@nestjs/common';
import { LedgerQualificationController } from './ledger-qualification/ledger-qualification.controller';
import { LedgerQualificationService } from './ledger-qualification/ledger-qualification.service';
import { LedgerCurrencyEvidenceService } from './ledger-qualification/ledger-currency-evidence.service';
import { AccountingProfileController } from './accounting/accounting-profile.controller';
import { AccountingProfileService } from './accounting/accounting-profile.service';
import { SupplierInvoicesController } from './supplier-invoices/supplier-invoices.controller';
import { SupplierSchedulesController } from './supplier-schedules/supplier-schedules.controller';
import { SupplierSchedulesService } from './supplier-schedules/supplier-schedules.service';
import { SupplierDossiersController } from './supplier-invoices/supplier-dossiers.controller';
import { SupplierDossiersService } from './supplier-invoices/supplier-dossiers.service';
import { SupplierCreditsController } from './supplier-credits/supplier-credits.controller';
import { SupplierCreditsService } from './supplier-credits/supplier-credits.service';
import { SupplierCreditEvidenceService } from './supplier-credits/supplier-credit-evidence.service';
import { SupplierInvoicesService } from './supplier-invoices/supplier-invoices.service';
import { SupplierInvoiceEvidenceService } from './supplier-invoices/supplier-invoice-evidence.service';
import { DocumentCoordinatesModule } from '../../core/reference-data/document-coordinates.module';
import { AuditLogsModule } from '../../core/audit-logs/audit-logs.module';
import { CustomFieldsModule } from '../../core/custom-fields/custom-fields.module';
import { EmailModule } from '../../core/email/email.module';
import { ModuleRegistryModule } from '../../core/module-registry/module-registry.module';
import { OperatingModule } from '../../core/operating/operating.module';
import { TransportationModule } from '../transportation/transportation.module';
import { BankAccountsController } from './banking/bank-accounts.controller';
import { BankAccountsService } from './banking/bank-accounts.service';
import { BankTransactionsController } from './banking/bank-transactions.controller';
import { BankTransactionsService } from './banking/bank-transactions.service';
import { BankCsvService } from './banking/bank-csv.service';
import { BudgetsController } from './budgets/budgets.controller';
import { BudgetsService } from './budgets/budgets.service';
import { FixedAssetsController } from './assets/fixed-assets.controller';
import { FixedAssetsService } from './assets/fixed-assets.service';
import { BillingCustomFieldsController } from './custom-fields/billing-custom-fields.controller';
import { SubscriptionsController } from './subscriptions/subscriptions.controller';
import { SubscriptionsService } from './subscriptions/subscriptions.service';
import { CustomerInvoicesController } from './customer-invoices.controller';
import { CustomerInvoicesService } from './customer-invoices.service';
import { CustomerInvoiceDocumentsController } from './customer-invoice-documents.controller';
import { CustomerInvoiceDocumentsService } from './customer-invoice-documents.service';
import { CustomerCreditsService } from './customer-credits.service';
import { CustomerCreditsController } from './customer-credits.controller';
import { CustomerCreditDocumentsController } from './customer-credit-documents.controller';
import { CustomerCreditDocumentsService } from './customer-credit-documents.service';
import { DocumentsModule } from '../../core/documents/documents.module';
import { FreightAuditController } from './freight-audit/freight-audit.controller';
import { FreightAuditService } from './freight-audit/freight-audit.service';
import { FreightAccountingService } from './freight-audit/freight-accounting.service';
import { InvoicesController } from './invoices.controller';
import { InvoicesService } from './invoices.service';
import { LedgerController } from './ledger/ledger.controller';
import { LedgerService } from './ledger/ledger.service';
import { FinancialReportsService } from './reports/financial-reports.service';
import { ReportsController } from './reports/reports.controller';
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
  imports: [
    DocumentCoordinatesModule,
    DocumentsModule,
    AuditLogsModule,
    CustomFieldsModule,
    EmailModule,
    ModuleRegistryModule,
    TransportationModule,
    forwardRef(() => OperatingModule),
  ],
  controllers: [
    LedgerQualificationController,
    AccountingProfileController,
    SupplierSchedulesController,
    SupplierDossiersController,
    SupplierInvoicesController,
    SupplierCreditsController,
    CustomerInvoiceDocumentsController,
    CustomerCreditDocumentsController,
    CustomerCreditsController,
    InvoicesController,
    CustomerInvoicesController,
    FreightAuditController,
    BillingCustomFieldsController,
    LedgerController,
    ModesOfPaymentController,
    PaymentsController,
    TaxTemplatesController,
    ReportsController,
    BankAccountsController,
    BankTransactionsController,
    BudgetsController,
    FixedAssetsController,
    SubscriptionsController,
  ],
  providers: [
    LedgerQualificationService,
    LedgerCurrencyEvidenceService,
    AccountingProfileService,
    SupplierSchedulesService,
    SupplierDossiersService,
    SupplierInvoicesService,
    SupplierCreditsService,
    SupplierCreditEvidenceService,
    SupplierInvoiceEvidenceService,
    CustomerInvoiceDocumentsService,
    CustomerCreditDocumentsService,
    CustomerCreditsService,
    InvoicesService,
    CustomerInvoicesService,
    FreightAuditService,
    FreightAccountingService,
    LedgerService,
    ModesOfPaymentService,
    PaymentsService,
    TaxTemplatesService,
    FinancialReportsService,
    BankAccountsService,
    BankTransactionsService,
    BankCsvService,
    BudgetsService,
    FixedAssetsService,
    SubscriptionsService,
  ],
  exports: [
    FreightAuditService,
    CustomerInvoicesService,
    LedgerService,
    ModesOfPaymentService,
    PaymentsService,
    TaxTemplatesService,
    BankAccountsService,
    BankTransactionsService,
  ],
})
export class BillingModule {}
