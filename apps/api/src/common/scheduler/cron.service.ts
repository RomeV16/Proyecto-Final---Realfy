import { Logger } from '@nestjs/common';

/**
 * Abstract base class for all cron scheduler services.
 *
 * Provides `runGuarded` — a wrapper that no-ops when `NODE_ENV=test`
 * so e2e test suites never accidentally fire real scheduled jobs.
 * Child classes should call `runGuarded` inside every `@Cron` handler.
 *
 * Example usage in a subclass:
 * ```ts
 * @Cron('0 11 * * *', { name: 'my-job' })
 * async handleMyJob() {
 *   await this.runGuarded(() => this.doWork(), 'my-job');
 * }
 * ```
 */
export abstract class CronBaseService {
  protected abstract readonly logger: Logger;

  /**
   * Executes `fn` unless `NODE_ENV === 'test'`.
   *
   * - In test env: logs a skip message and returns immediately.
   * - In all other envs: awaits `fn()` and catches + logs any error
   *   without re-throwing, so a single job failure never crashes the process.
   */
  protected async runGuarded(
    fn: () => Promise<void>,
    jobName: string,
  ): Promise<void> {
    if (process.env.NODE_ENV === 'test') {
      this.logger.log(`cron skipped in test env: ${jobName}`);
      return;
    }

    try {
      await fn();
    } catch (err) {
      this.logger.error(
        `Cron job "${jobName}" threw an unhandled error`,
        (err as Error).stack,
      );
    }
  }
}
