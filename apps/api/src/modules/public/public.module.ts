import { Module } from '@nestjs/common';
import { PublicController } from './public.controller';
import { PublicService } from './public.service';
import { PublicTenantGuard } from './public-tenant.guard';

@Module({
  controllers: [PublicController],
  providers: [PublicService, PublicTenantGuard],
})
export class PublicModule {}
