import { Controller, Get } from '@nestjs/common';
import { Public } from '../common/auth/public.decorator';
import { PrismaService } from '../common/prisma/prisma.service';

/**
 * Public health check endpoint — no auth required.
 * Used by Railway, load balancers, and monitoring.
 */
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @Get()
  async check() {
    let db = 'disconnected';
    try {
      await this.prisma.baseClient.$queryRaw`SELECT 1`;
      db = 'connected';
    } catch {
      // DB unreachable — report it but don't crash
    }
    return {
      status: db === 'connected' ? 'ok' : 'degraded',
      db,
      timestamp: new Date().toISOString(),
    };
  }
}
