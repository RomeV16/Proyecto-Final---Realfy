import { Injectable } from '@nestjs/common';
import { OwnerLedgerEntryType, formatDateAR, formatMoneyAR, formatPeriodAR } from '@realfy/shared';
import Decimal from 'decimal.js';
import { PdfRendererService, dateCell, headerCell, moneyCell, pageFooter } from '../../common/pdf/pdf-renderer.service';

/** Lo que el PDF necesita del detalle del estado (`OwnerStatementsService.findOne`). */
export interface StatementPdfInput {
  status: string;
  period: Date;
  from: Date;
  to: Date;
  currency: string;
  person: { name: string; cuit: string | null; dni: string | null };
  totals: { opening: string; initial: string; credits: string; debits: string; payouts: string; closing: string };
  custody: string;
  groups: {
    label: string | null;
    net: string;
    entries: { date: Date; type: string; description: string; amount: string; provisional?: boolean }[];
  }[];
}

const TYPE_LABEL: Record<string, string> = {
  [OwnerLedgerEntryType.SaldoInicial]: 'Saldo inicial',
  [OwnerLedgerEntryType.Alquiler]: 'Alquiler',
  [OwnerLedgerEntryType.Punitorio]: 'Punitorios',
  [OwnerLedgerEntryType.ReintegroImpuesto]: 'Impuestos y servicios',
  [OwnerLedgerEntryType.Comision]: 'Comisión',
  [OwnerLedgerEntryType.Honorario]: 'Honorarios',
  [OwnerLedgerEntryType.Cargo]: 'Gasto',
  [OwnerLedgerEntryType.PagoEnte]: 'Pago a ente',
  [OwnerLedgerEntryType.Transferencia]: 'Transferencia',
  [OwnerLedgerEntryType.EntregaEfectivo]: 'Entrega de efectivo',
  [OwnerLedgerEntryType.CobroDirecto]: 'Cobrado por usted',
  [OwnerLedgerEntryType.Compensacion]: 'Compensación',
  [OwnerLedgerEntryType.Custodia]: 'Custodia',
  [OwnerLedgerEntryType.Ajuste]: 'Ajuste',
};

/** Cómo se lee el saldo de cierre, desde el punto de vista del locador. */
export function closingReading(closing: string, currency: string): string {
  const value = new Decimal(closing);
  const amount = `${currency} ${formatMoneyAR(value.abs().toFixed(2))}`;
  if (value.gt(0)) return `Saldo a su favor: la inmobiliaria le debe ${amount}.`;
  if (value.lt(0)) return `Saldo a favor de la inmobiliaria: usted le debe ${amount}.`;
  return 'Sin saldo pendiente.';
}

/**
 * PDF del estado de cuenta mensual de un locador: resumen con el saldo
 * arrastrado, movimientos por unidad y cómo se lee el saldo. Sirve para
 * imprimir o para compartir por WhatsApp o correo (el envío es otra acción).
 */
@Injectable()
export class OwnerStatementPdfService {
  constructor(private readonly renderer: PdfRendererService) {}

  render(s: StatementPdfInput, tenant: { name?: string | null; cuit?: string | null } | null): Promise<Buffer> {
    const cur = (v: string) => moneyCell(v, { symbol: false });
    const neg = (v: string) => (new Decimal(v).isZero() ? '0.00' : `-${v}`);
    const draft = s.status === 'Borrador';
    const summaryRows: unknown[][] = [
      [{ text: 'Saldo anterior' }, cur(new Decimal(s.totals.opening).minus(s.totals.initial).toFixed(2))],
      ...(new Decimal(s.totals.initial).isZero() ? [] : [[{ text: 'Saldo inicial' }, cur(s.totals.initial)]]),
      [{ text: 'Créditos (alquileres, punitorios, reintegros)' }, cur(s.totals.credits)],
      [{ text: 'Descuentos (comisión, honorarios, gastos)' }, cur(neg(s.totals.debits))],
      [{ text: 'Pagos recibidos y cobros directos' }, cur(neg(s.totals.payouts))],
      [{ text: 'Saldo al cierre', bold: true }, { ...cur(s.totals.closing), bold: true }],
    ];
    const groups = s.groups.flatMap((g) => [
      { text: g.label ?? 'Movimientos generales', style: 'subheader', margin: [0, 12, 0, 4] },
      {
        table: {
          headerRows: 1,
          widths: ['auto', 'auto', '*', 'auto'],
          body: [
            [headerCell('Fecha'), headerCell('Concepto'), headerCell('Detalle'), headerCell(`Importe (${s.currency})`, { alignment: 'right' })],
            ...g.entries.map((e) => [
              dateCell(e.date),
              { text: TYPE_LABEL[e.type] ?? e.type },
              { text: e.provisional ? `${e.description} (previsto)` : e.description, italics: !!e.provisional },
              cur(e.amount),
            ]),
            [{ text: 'Subtotal', bold: true, colSpan: 3 }, {}, {}, { ...cur(g.net), bold: true }],
          ],
        },
        layout: 'lightHorizontalLines',
      },
    ]);
    const custody = new Decimal(s.custody);
    return this.renderer.render({
      ...(draft ? { watermark: { text: 'BORRADOR', opacity: 0.08, bold: true } } : {}),
      content: [
        { text: tenant?.name ?? 'Inmobiliaria', style: 'header', alignment: 'center' },
        tenant?.cuit ? { text: `CUIT: ${tenant.cuit}`, alignment: 'center' } : { text: '' },
        {
          text: `ESTADO DE CUENTA — ${formatPeriodAR(s.period).toUpperCase()}`,
          style: 'title',
          alignment: 'center',
          margin: [0, 12, 0, 4],
        },
        { text: `Del ${formatDateAR(s.from)} al ${formatDateAR(s.to)} · Moneda: ${s.currency}`, alignment: 'center', margin: [0, 0, 0, 12] },
        {
          text: [
            { text: 'Locador: ', bold: true },
            s.person.name,
            ...(s.person.cuit ? [` · CUIT ${s.person.cuit}`] : s.person.dni ? [` · DNI ${s.person.dni}`] : []),
          ],
          margin: [0, 0, 0, 8],
        },
        { table: { widths: ['*', 'auto'], body: summaryRows }, layout: 'lightHorizontalLines' },
        { text: closingReading(s.totals.closing, s.currency), bold: true, margin: [0, 8, 0, 0] },
        ...(custody.gt(0)
          ? [{ text: `De su saldo, ${s.currency} ${formatMoneyAR(custody.toFixed(2))} están en efectivo en custodia en la oficina.`, margin: [0, 4, 0, 0] }]
          : []),
        ...(s.groups.length ? groups : [{ text: 'Sin movimientos en el período.', italics: true, margin: [0, 12, 0, 0] }]),
      ],
      footer: pageFooter(tenant?.cuit ? `CUIT: ${tenant.cuit}` : null),
    });
  }
}
