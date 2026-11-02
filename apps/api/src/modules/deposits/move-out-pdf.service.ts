import { Injectable } from '@nestjs/common';
import {
  computeMoveOut,
  formatDateAR,
  formatMoneyAR,
  personName,
  propertyLabel,
  refundSchedule,
  refundDueDate,
} from '@realfy/shared';
import type { MoveOutItem } from '@realfy/shared';
import { PdfRendererService, pageFooter } from '../../common/pdf/pdf-renderer.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContextService } from '../../common/tenant/tenant-context.service';
import { getParties } from '../contracts/contract-parties';
import { MoveOutService } from './move-out.service';

const KIND_LABEL: Record<string, string> = {
  AlquilerPendiente: 'Alquiler pendiente',
  Servicio: 'Servicio',
  Cargo: 'Cargo',
  Reparacion: 'Reparación',
  Punitorio: 'Punitorio',
  Deduccion: 'Descuento',
};

const names = (rows: any[]): string => rows.map((r) => personName(r.person)).join(', ') || '—';

/** PDF de la liquidación de egreso: renglones, depósito y resultado, con lugar para las firmas. */
@Injectable()
export class MoveOutPdfService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly renderer: PdfRendererService,
    private readonly moveOut: MoveOutService,
  ) {}

  async pdf(id: string): Promise<{ buffer: Buffer; filename: string }> {
    const { settlement, contract, deposit } = await this.moveOut.detailForPdf(id);
    const tenant: any = await this.prisma.client.tenant.findFirst({ where: { id: this.tenantContext.getTenantId()! } });
    const currency: string = settlement.currency;
    const items = (settlement.items as unknown as MoveOutItem[]).filter((i) => i.included);
    const money = (v: unknown) => `${currency} ${formatMoneyAR(String(v))}`;
    const result = computeMoveOut({ items, refundable: String(settlement.depositAvailable) });
    const confirmed = settlement.status === 'Confirmada';

    const rows = items.length
      ? items.map((i) => [KIND_LABEL[i.kind] ?? i.kind, i.description, { text: money(i.amount), alignment: 'right' }])
      : [[{ text: 'Sin renglones.', colSpan: 3 }, '', '']];

    const refundLines: any[] = [];
    if (deposit && result.refundToTenant.gt(0)) {
      const due = refundDueDate(settlement.date, deposit.refundDueDays);
      const parts = refundSchedule(result.refundToTenant.toFixed(2), deposit.refundInstallments, due);
      refundLines.push({
        text:
          parts.length === 1
            ? `Se devuelve ${money(result.refundToTenant.toFixed(2))} hasta el ${formatDateAR(due)}.`
            : `Se devuelve ${money(result.refundToTenant.toFixed(2))} en ${parts.length} cuotas: ${parts
                .map((p) => `${money(p.amount)} el ${formatDateAR(p.dueDate)}`)
                .join('; ')}.`,
        margin: [0, 8, 0, 0],
      });
    }
    if (result.owedByTenant.gt(0)) {
      refundLines.push({ text: `Queda un saldo a cargo del inquilino de ${money(result.owedByTenant.toFixed(2))}.`, margin: [0, 8, 0, 0] });
    }

    const buffer = await this.renderer.render({
      content: [
        { text: tenant?.name ?? 'Inmobiliaria', style: 'header', alignment: 'center' },
        tenant?.cuit ? { text: `CUIT: ${tenant.cuit}`, alignment: 'center' } : { text: '' },
        { text: 'LIQUIDACIÓN DE EGRESO', style: 'title', alignment: 'center', margin: [0, 15, 0, 5] },
        { text: confirmed ? 'Confirmada' : 'Borrador', alignment: 'center', margin: [0, 0, 0, 10] },
        {
          text: `Inmueble: ${propertyLabel((contract as any).property) || '—'}\nLocador: ${names((contract as any).lessors)}\nInquilino: ${names(getParties<any>(contract as any, 'Inquilino'))}\nFecha de egreso: ${formatDateAR(settlement.date)}`,
          margin: [0, 0, 0, 10],
        },
        {
          table: {
            headerRows: 1,
            widths: ['auto', '*', 'auto'],
            body: [[{ text: 'Concepto', bold: true }, { text: 'Detalle', bold: true }, { text: 'Importe', bold: true, alignment: 'right' }], ...rows],
          },
          layout: 'lightHorizontalLines',
        },
        {
          table: {
            widths: ['*', 'auto'],
            body: [
              ['Total adeudado', { text: money(result.totalOwed.toFixed(2)), alignment: 'right' }],
              ['Depósito a devolver según la regla', { text: money(String(settlement.depositAvailable)), alignment: 'right' }],
              [{ text: 'Resultado', bold: true }, { text: money(result.net.toFixed(2)), bold: true, alignment: 'right' }],
            ],
          },
          layout: 'noBorders',
          margin: [0, 10, 0, 0],
        },
        ...refundLines,
        settlement.notes ? { text: `Observaciones: ${settlement.notes}`, margin: [0, 8, 0, 0] } : { text: '' },
        {
          columns: [
            { text: '\n\n______________________\nLa inmobiliaria', alignment: 'center' },
            { text: '\n\n______________________\nEl inquilino', alignment: 'center' },
          ],
          margin: [0, 30, 0, 0],
        },
      ],
      footer: pageFooter(tenant?.cuit ? `CUIT: ${tenant.cuit}` : null),
    });
    return { buffer, filename: `liquidacion-egreso-${String(settlement.id).slice(0, 8)}.pdf` };
  }
}
