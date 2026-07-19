import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { CronBaseService } from '../../common/scheduler/cron.service';
import { IndexScraperService } from './index-scraper.service';

/**
 * Fires daily at 06:00 ART (America/Argentina/Buenos_Aires) and delegates to
 * IndexScraperService.upsertAll().  Uses runGuarded so the job is a no-op
 * when NODE_ENV=test.
 */
@Injectable()
export class IndexScraperScheduler extends CronBaseService {
  protected readonly logger = new Logger(IndexScraperScheduler.name);

  constructor(private readonly scraperService: IndexScraperService) {
    super();
  }

  @Cron('0 6 * * *', { timeZone: 'America/Argentina/Buenos_Aires' })
  async handleDailyScrape(): Promise<void> {
    await this.runGuarded(async () => {
      const counts = await this.scraperService.upsertAll();
      this.logger.log(
        `Daily index scrape complete — ICL: ${counts.icl}, UVA: ${counts.uva}, IPC: ${counts.ipc}`,
      );
    }, 'daily-index-scrape');
  }
}
