import { Global, Module } from '@nestjs/common';
import { CronBaseService } from './cron.service';
import { TenantCron } from './tenant-cron';

/**
 * Pieza común de los procesos programados: `TenantCron` recorre las
 * inmobiliarias activas dentro de su contexto. Los servicios programados
 * extienden `CronBaseService` directamente y reciben `TenantCron` por
 * inyección, sin importar este módulo (es global).
 */
@Global()
@Module({
  providers: [TenantCron],
  exports: [TenantCron],
})
export class SchedulerModule {}

export { CronBaseService };
