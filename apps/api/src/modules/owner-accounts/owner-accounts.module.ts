import { Module } from '@nestjs/common';
import { CashModule } from '../cash/cash.module';
import { TenantsModule } from '../tenants/tenants.module';
import { OwnersController, OwnerStatementsController } from './owner-accounts.controller';
import { OwnerLedgerService } from './owner-ledger.service';
import { OwnerStatementPdfService } from './owner-statement-pdf.service';
import { OwnerStatementsService } from './owner-statements.service';

/** Cuenta corriente y estado de cuenta del locador (ADR-0009). */
@Module({
  imports: [TenantsModule, CashModule],
  controllers: [OwnersController, OwnerStatementsController],
  providers: [OwnerLedgerService, OwnerStatementsService, OwnerStatementPdfService],
  exports: [OwnerStatementsService],
})
export class OwnerAccountsModule {}
