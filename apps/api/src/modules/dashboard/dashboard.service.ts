import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async getStats() {
    const now = new Date();
    const in30 = new Date(now.getTime() + 30 * 86400000);
    const in60 = new Date(now.getTime() + 60 * 86400000);
    const in90 = new Date(now.getTime() + 90 * 86400000);

    const [
      totalProperties,
      ocupadas,
      activeContracts,
      totalServices,
      pendingLiquidaciones,
      exp30,
      exp60,
      exp90,
      liquidaciones,
    ] = await Promise.all([
      this.prisma.client.property.count(),
      this.prisma.client.propertyOperation.count({
        where: { state: { in: ['Alquilado', 'Ocupado'] } },
      }),
      this.prisma.client.contract.count({ where: { status: 'Activo' } }),
      this.prisma.client.service.count(),
      this.prisma.client.liquidacion.count({
        where: { status: { in: ['Aprobada', 'Enviada', 'Pendiente', 'Vencida'] } },
      }),
      this.prisma.client.contract.count({
        where: { status: 'Activo', endDate: { gte: now, lte: in30 } },
      }),
      this.prisma.client.contract.count({
        where: { status: 'Activo', endDate: { gt: in30, lte: in60 } },
      }),
      this.prisma.client.contract.count({
        where: { status: 'Activo', endDate: { gt: in60, lte: in90 } },
      }),
      this.prisma.client.liquidacion.findMany({
        select: { total: true, status: true },
      }),
    ]);

    const occupancyRate =
      totalProperties > 0 ? Math.round((ocupadas / totalProperties) * 100) : 0;

    let pagada = 0;
    let pendiente = 0;
    let vencida = 0;
    for (const l of liquidaciones) {
      const amount = Number(l.total);
      if (l.status === 'Pagada') pagada += amount;
      else if (l.status === 'Vencida') vencida += amount;
      else if (['Aprobada', 'Enviada', 'Pendiente'].includes(l.status))
        pendiente += amount;
    }
    const collectionsTotal = pagada + pendiente + vencida;

    return {
      totalProperties,
      occupancyRate,
      activeContracts,
      pendingLiquidaciones,
      totalServices,
      expiringContracts: { within30: exp30, within60: exp60, within90: exp90 },
      collections: {
        total: Math.round(collectionsTotal),
        pagada: Math.round(pagada),
        pendiente: Math.round(pendiente),
        vencida: Math.round(vencida),
      },
    };
  }
}
