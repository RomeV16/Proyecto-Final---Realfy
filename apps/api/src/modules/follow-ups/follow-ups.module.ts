import { Module } from '@nestjs/common';
import { ContractsModule } from '../contracts/contracts.module';
import { TenantsModule } from '../tenants/tenants.module';
import { FeesModule } from '../fees/fees.module';
import { ContractExpirationsController, FollowUpsController } from './follow-ups.controller';
import { FollowUpsScheduler } from './follow-ups.scheduler';
import { FollowUpsService } from './follow-ups.service';
import { OralExtensionService } from './oral-extension.service';
import { RenewalAddendumPdfService } from './renewal-addendum-pdf.service';
import { ContractRenewalService } from './contract-renewal.service';

/** Vencimientos: semáforo, seguimientos con checklist y prórroga de palabra y renovación. */
@Module({
  imports: [ContractsModule, TenantsModule, FeesModule],
  controllers: [FollowUpsController, ContractExpirationsController],
  providers: [
    FollowUpsService,
    FollowUpsScheduler,
    OralExtensionService,
    ContractRenewalService,
    RenewalAddendumPdfService,
  ],
  exports: [FollowUpsService],
})
export class FollowUpsModule {}
