import { Module } from '@nestjs/common';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { TenantContextModule } from '../../common/tenant/tenant-context.module';
import { TenantsModule } from '../tenants/tenants.module';
import { PenaltiesService } from './penalties.service';
import { PenaltiesScheduler } from './penalties.scheduler';
import { PenaltiesController } from './penalties.controller';

@Module({
  imports: [
    PrismaModule,
    TenantContextModule,
    TenantsModule,
  ],
  providers: [PenaltiesService, PenaltiesScheduler],
  controllers: [PenaltiesController],
  exports: [PenaltiesService],
})
export class PenaltiesModule {}
