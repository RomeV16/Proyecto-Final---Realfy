import { Module } from '@nestjs/common';
import { ContractsModule } from '../contracts/contracts.module';
import { TenantsModule } from '../tenants/tenants.module';
import { ContractExpirationsController, FollowUpsController } from './follow-ups.controller';
import { FollowUpsScheduler } from './follow-ups.scheduler';
import { FollowUpsService } from './follow-ups.service';
import { OralExtensionService } from './oral-extension.service';

/** Vencimientos: semáforo, seguimientos con checklist y prórroga de palabra. */
@Module({
  imports: [ContractsModule, TenantsModule],
  controllers: [FollowUpsController, ContractExpirationsController],
  providers: [FollowUpsService, FollowUpsScheduler, OralExtensionService],
  exports: [FollowUpsService],
})
export class FollowUpsModule {}
