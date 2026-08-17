import { Module } from '@nestjs/common';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { DashboardCacheService } from './dashboard-cache.service';

@Module({
  controllers: [DashboardController],
  providers: [DashboardService, DashboardCacheService],
  exports: [DashboardService, DashboardCacheService],
})
export class DashboardModule {}
