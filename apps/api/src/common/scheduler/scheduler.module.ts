import { Module } from '@nestjs/common';
import { CronBaseService } from './cron.service';

/**
 * SchedulerModule makes `CronBaseService` available for export.
 * Domain scheduler services extend `CronBaseService` directly —
 * they do not need to import this module. It exists solely as a
 * conventional NestJS home for the base class so it can be wired
 * into AppModule and referenced cleanly by path.
 */
@Module({})
export class SchedulerModule {}

export { CronBaseService };
