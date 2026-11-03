import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { PenaltiesModule } from '../penalties/penalties.module';
import { TenantsModule } from '../tenants/tenants.module';
import { CollectionDebtService } from './collection-debt.service';
import { CollectionLetterService } from './collection-letter.service';
import { CollectionStateService } from './collection-state.service';
import { CollectionsProcessService } from './collections-process.service';
import { CollectionsScheduler } from './collections.scheduler';
import { CollectionsController } from './collections.controller';
import { CollectionsService } from './collections.service';

/** Cobranza escalonada: casos de mora, recordatorios por la bandeja de salida y carta documento (ADR-0013). */
@Module({
  imports: [PenaltiesModule, TenantsModule, NotificationsModule],
  controllers: [CollectionsController],
  providers: [
    CollectionDebtService,
    CollectionStateService,
    CollectionsService,
    CollectionsProcessService,
    CollectionLetterService,
    CollectionsScheduler,
  ],
})
export class CollectionsModule {}
