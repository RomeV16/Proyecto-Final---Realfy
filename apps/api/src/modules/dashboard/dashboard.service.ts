import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';

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
      activeContracts: 0,
      pendingLiquidaciones: 0,
      totalServices: 0,
      expiringContracts: { within30: 0, within60: 0, within90: 0 },
      collections: { total: 0, pagada: 0, pendiente: 0, vencida: 0 },
    };
  }
}
