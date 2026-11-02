import { Module } from '@nestjs/common';
import { TenantsModule } from '../tenants/tenants.module';
import { CashModule } from '../cash/cash.module';
import { ChargesController } from './charges.controller';
import { ChargesService } from './charges.service';

@Module({
  imports: [TenantsModule, CashModule],
  controllers: [ChargesController],
  providers: [ChargesService],
  exports: [ChargesService],
})
export class ChargesModule {}
