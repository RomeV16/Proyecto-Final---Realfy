import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { LiquidacionStatus } from '@realfy/shared';

const PENDING = [LiquidacionStatus.Aprobada, LiquidacionStatus.Enviada];

@Injectable()
export class PaymentsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const [items, total] = await Promise.all([
      this.prisma.client.payment.findMany({
        skip,
        take: limit,
        orderBy: { paidAt: 'desc' },
        include: {
          liquidacion: {
            select: {
              id: true,
              period: true,
              contract: { select: { id: true } },
            },
          },
        },
      }),
      this.prisma.client.payment.count(),
    ]);
    return { items, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async debtSummary() {
    const pendientes = await this.prisma.client.liquidacion.findMany({
      where: { status: { in: PENDING } },
      select: { id: true, period: true, total: true, status: true, contractId: true },
      orderBy: { period: 'asc' },
    });
    const vencidas = await this.prisma.client.liquidacion.findMany({
      where: { status: 'Vencida' },
      select: { id: true, period: true, total: true, status: true, contractId: true },
    });
    const sum = (arr: { total: unknown }[]) =>
      arr.reduce((a, l) => a + Number(l.total), 0);
    return {
      pendiente: { count: pendientes.length, monto: Math.round(sum(pendientes)) },
      vencida: { count: vencidas.length, monto: Math.round(sum(vencidas)) },
      items: [...vencidas, ...pendientes],
    };
  }
}
