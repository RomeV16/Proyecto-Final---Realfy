import { Logger } from '@nestjs/common';
import { IndexScraperScheduler } from './index-scraper.scheduler';

// ─── Mock IndexScraperService ────────────────────────────────────────────────

const mockUpsertAll = jest.fn();
const mockScraperService = {
  upsertAll: mockUpsertAll,
} as any;

describe('IndexScraperScheduler', () => {
  let scheduler: IndexScraperScheduler;
  const originalEnv = process.env.NODE_ENV;

  beforeEach(() => {
    jest.clearAllMocks();
    scheduler = new IndexScraperScheduler(mockScraperService);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
  });

  it('no-ops when NODE_ENV=test (runGuarded skips)', async () => {
    process.env.NODE_ENV = 'test';

    await scheduler.handleDailyScrape();

    expect(mockUpsertAll).not.toHaveBeenCalled();
  });

  it('calls upsertAll when NODE_ENV is not test', async () => {
    process.env.NODE_ENV = 'production';
    mockUpsertAll.mockResolvedValueOnce({ icl: 2, uva: 2, ipc: 1 });

    await scheduler.handleDailyScrape();

    expect(mockUpsertAll).toHaveBeenCalledTimes(1);
  });

  it('logs an error but does not throw when upsertAll rejects', async () => {
    process.env.NODE_ENV = 'production';
    mockUpsertAll.mockRejectedValueOnce(new Error('scrape failed'));

    await expect(scheduler.handleDailyScrape()).resolves.toBeUndefined();
  });
});
