import { Module } from '@nestjs/common';
import { ServicesController } from './services.controller';
import { ServicesService } from './services.service';
import { ServiceBillsController } from './service-bills.controller';
import { ServiceBillsService } from './service-bills.service';
import { ChargeRulesController } from './charge-rules.controller';
import { ChargeRulesService } from './charge-rules.service';

@Module({
  controllers: [ServicesController, ServiceBillsController, ChargeRulesController],
  providers: [ServicesService, ServiceBillsService, ChargeRulesService],
  exports: [ServicesService, ServiceBillsService],
})
export class ServicesModule {}
