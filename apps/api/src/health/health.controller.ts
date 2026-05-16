import { Controller, Get } from '@nestjs/common';

/**
 * Endpoint de health check publico. Usado por Railway y monitoreo.
 * En esta etapa devuelve solo el estado del proceso; la verificacion
 * de base de datos se incorpora cuando se agrega Prisma (item 06).
 */
@Controller('health')
export class HealthController {
  @Get()
  check() {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
    };
  }
}
