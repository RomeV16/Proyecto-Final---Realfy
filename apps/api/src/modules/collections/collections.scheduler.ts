import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { AR_TIME_ZONE } from '@realfy/shared';
import { CronBaseService } from '../../common/scheduler/cron.service';
import { CollectionsProcessService } from './collections-process.service';

@Injectable()
export class CollectionsScheduler extends CronBaseService {
  protected readonly logger = new Logger(CollectionsScheduler.name);

  constructor(private readonly process: CollectionsProcessService) {
    super();
  }

  /**
   * Todos los días a las 10:00 de Buenos Aires, después de los punitorios (02:15): abre los casos
   * de cobranza, encola los recordatorios que tocan y prepara las cartas documento. Idempotente:
   * correr dos veces el mismo día no repite nada. Solo actúa en las inmobiliarias que prendieron
   * la cobranza en sus valores por defecto.
   */
  @Cron('0 10 * * *', { name: 'collections-daily', timeZone: AR_TIME_ZONE })
  async handleDaily(): Promise<void> {
    await this.runGuarded(async () => {
      await this.process.runAll();
    }, 'collections-daily');
  }
}
