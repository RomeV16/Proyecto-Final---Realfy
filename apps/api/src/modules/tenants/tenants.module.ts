import { Module } from '@nestjs/common';
import { TenantsService } from './tenants.service';
import { TenantsController } from './tenants.controller';
import { OperationalDefaultsService } from './operational-defaults.service';

@Module({
  controllers: [TenantsController],
  providers: [TenantsService, OperationalDefaultsService],
  exports: [TenantsService, OperationalDefaultsService],
})
export class TenantsModule {}
