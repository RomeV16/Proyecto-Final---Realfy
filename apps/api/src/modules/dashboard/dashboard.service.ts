import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';

/**
 * Servicio de metricas del dashboard.
 *
 * En esta etapa expone metricas de propiedades (las entidades ya disponibles).
 * Los indicadores de contratos, liquidaciones y servicios se completan a medida
 * que esos modulos se incorporan al sistema (items siguientes del roadmap).
 */
@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async getStats() {
    const [total, ocupadas] = await Promise.all([
      this.prisma.client.property.count(),
      this.prisma.client.propertyOperation.count({
        where: { state: { in: ['Alquilado', 'Ocupado'] } },
      }),
    ]);

    const occupancyRate =
      total > 0 ? Math.round((ocupadas / total) * 100) : 0;

    return {
      totalProperties: total,
      occupancyRate,
      // Indicadores de modulos aun no incorporados (se completan mas adelante).
      activeContracts: 0,
      pendingLiquidaciones: 0,
      totalServices: 0,
      expiringContracts: { within30: 0, within60: 0, within90: 0 },
      collections: { total: 0, pagada: 0, pendiente: 0, vencida: 0 },
    };
  }
}
