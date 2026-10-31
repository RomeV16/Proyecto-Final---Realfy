import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RECEIVABLE_STATUSES, todayInAR } from '@realfy/shared';
import {
  outstandingBalance,
  splitReceivables,
  sumOutstanding,
} from '../liquidaciones/receivables';

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
    const receivables = await this.prisma.client.liquidacion.findMany({
      where: { status: { in: [...RECEIVABLE_STATUSES] } },
      select: {
        id: true,
        period: true,
        dueDate: true,
        total: true,
        status: true,
        contractId: true,
        payments: { select: { amount: true } },
      },
      orderBy: { period: 'asc' },
    });
    const { overdue, pending } = splitReceivables(receivables, todayInAR());
    const withBalance = (rows: typeof receivables) =>
      rows.map(({ payments, ...liq }) => ({
        ...liq,
        saldo: outstandingBalance({ total: liq.total, payments }).toFixed(2),
      }));
    return {
      pendiente: { count: pending.length, monto: Math.round(sumOutstanding(pending).toNumber()) },
      vencida: { count: overdue.length, monto: Math.round(sumOutstanding(overdue).toNumber()) },
      items: [...withBalance(overdue), ...withBalance(pending)],
    };
  }
}
