import { Module } from '@nestjs/common';
import { ScoringController } from './scoring.controller';
import { ScoringService } from './scoring.service';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { TenantContextModule } from '../../common/tenant/tenant-context.module';

@Module({
  imports: [PrismaModule, TenantContextModule],
  controllers: [ScoringController],
  providers: [ScoringService],
})
export class ScoringModule {}
