import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { Money, RECEIVABLE_STATUSES, todayInAR } from '@realfy/shared';
import {
  outstandingBalance,
  splitReceivables,
  sumOutstanding,
} from '../liquidaciones/receivables';

/** Tope del tamaño de página del listado de cobros. */
const MAX_PAGE_SIZE = 200;

@Injectable()
export class PaymentsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(pageInput = 1, limitInput = 20) {
    // La página y el tamaño llegan del querystring: un valor que no es número
    // o queda fuera de rango vuelve al valor por defecto en lugar de romper.
    const page = Number.isInteger(pageInput) && pageInput >= 1 ? pageInput : 1;
    const limit = Number.isInteger(limitInput) && limitInput >= 1 ? Math.min(limitInput, MAX_PAGE_SIZE) : 20;
    const skip = (page - 1) * limit;
    const [items, total, sums] = await Promise.all([
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
          account: { select: { id: true, name: true, kind: true } },
          receipt: { select: { id: true, series: true, number: true } },
        },
      }),
      this.prisma.client.payment.count(),
      this.prisma.client.payment.groupBy({ by: ['currency'], _sum: { amount: true }, _count: { _all: true } }),
    ]);
    // Suma de TODOS los cobros (no solo los de esta página), por moneda.
    const totals = (sums as any[]).map((row) => ({
      currency: row.currency as string,
      count: row._count._all as number,
      amount: new Money(row._sum.amount?.toString() ?? '0').toFixed(2),
    }));
    return { items, total, totals, page, limit, totalPages: Math.ceil(total / limit) };
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
