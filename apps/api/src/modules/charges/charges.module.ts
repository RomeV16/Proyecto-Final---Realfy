import { Module } from '@nestjs/common';
import { TenantsModule } from '../tenants/tenants.module';
import { ChargesController } from './charges.controller';
import { ChargesService } from './charges.service';

@Module({
  imports: [TenantsModule],
  controllers: [ChargesController],
  providers: [ChargesService],
  exports: [ChargesService],
})
export class ChargesModule {}
