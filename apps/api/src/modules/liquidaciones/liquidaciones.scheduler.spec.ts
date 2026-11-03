import { AR_TIME_ZONE } from '@realfy/shared';
import { LiquidacionesScheduler } from './liquidaciones.scheduler';
import { AdjustmentsScheduler } from '../index-data/adjustments.scheduler';
import { IndexScraperScheduler } from '../index-data/index-scraper.scheduler';

jest.mock('./pdf.service', () => ({ PdfService: jest.fn() }));

/** Metadato que deja `@Cron` en el método (clave de `@nestjs/schedule`). */
const CRON_OPTIONS = 'SCHEDULE_CRON_OPTIONS';

/** Minuto del día en que corre un cron diario `m h * * *`, y su zona horaria. */
function dailyAt(method: (...args: any[]) => unknown): { minute: number; timeZone: string } {
  const options = Reflect.getMetadata(CRON_OPTIONS, method) as { cronTime: string; timeZone?: string };
  const [m, h, dom, mon, dow] = options.cronTime.split(' ');
  expect([dom, mon, dow]).toEqual(['*', '*', '*']);
  return { minute: Number(h) * 60 + Number(m), timeZone: options.timeZone ?? '' };
}

describe('Orden de los procesos diarios (DEF-131)', () => {
  it('CP-1262 — la generación de liquidaciones corre después de la lectura de índices y de los ajustes del día', () => {
    const scrape = dailyAt(IndexScraperScheduler.prototype.handleDailyScrape);
    const adjustments = dailyAt(AdjustmentsScheduler.prototype.handleDailyAdjustments);
    const generation = dailyAt(LiquidacionesScheduler.prototype.handleDailyGeneration);

    // Los tres en hora de Buenos Aires, para que el orden valga.
    expect([scrape.timeZone, adjustments.timeZone, generation.timeZone]).toEqual([
      AR_TIME_ZONE,
      AR_TIME_ZONE,
      AR_TIME_ZONE,
    ]);
    expect(adjustments.minute).toBeGreaterThan(scrape.minute);
    expect(generation.minute).toBeGreaterThan(adjustments.minute);
  });
});
