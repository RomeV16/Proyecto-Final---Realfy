import { Logger } from '@nestjs/common';
import { CronBaseService } from './cron.service';

/** Minimal concrete subclass for testing the abstract base. */
class TestCronService extends CronBaseService {
  readonly logger = new Logger(TestCronService.name);

  /** Expose runGuarded as public for test access. */
  async run(fn: () => Promise<void>, jobName: string): Promise<void> {
    return this.runGuarded(fn, jobName);
  }
}

describe('CronBaseService', () => {
  let service: TestCronService;
  let logSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    service = new TestCronService();
    logSpy = jest.spyOn(service.logger, 'log').mockImplementation(() => undefined);
    errorSpy = jest.spyOn(service.logger, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    jest.restoreAllMocks();
  });

  describe('when NODE_ENV === "test"', () => {
    it('skips execution and logs a skip message', async () => {
      process.env.NODE_ENV = 'test';
      const fn = jest.fn().mockResolvedValue(undefined);

      await service.run(fn, 'my-job');

      expect(fn).not.toHaveBeenCalled();
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('cron skipped in test env'),
      );
    });
  });

  describe('when NODE_ENV !== "test"', () => {
    beforeEach(() => {
      process.env.NODE_ENV = 'production';
    });

    it('calls through to the provided function', async () => {
      const fn = jest.fn().mockResolvedValue(undefined);

      await service.run(fn, 'my-job');

      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('catches and logs errors thrown inside fn without re-throwing', async () => {
      const boom = new Error('boom');
      const fn = jest.fn().mockRejectedValue(boom);

      await expect(service.run(fn, 'failing-job')).resolves.toBeUndefined();

      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('failing-job'),
        boom.stack,
      );
    });
  });
});
