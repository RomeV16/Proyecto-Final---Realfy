/** El comprobante que se acredita, como lo devuelve `GET /invoices/:id`. */
export interface OriginalVoucher {
  id: string;
  type: string;
  puntoDeVenta: number;
  numero: number;
  cbteTipo: number;
  concepto?: number | null;
  issuerId: string;
  impTotal: string | number;
  impNeto?: string | number | null;
  impIva?: string | number | null;
  impTotConc?: string | number | null;
  impOpEx?: string | number | null;
  impTrib?: string | number | null;
  monId?: string | null;
  monCotiz?: string | number | null;
  ivaArray?: { Id: number; BaseImp: number | string; Importe: number | string }[] | null;
  receptorName?: string | null;
  receptorFiscalCondition?: string | null;
  docNro: string;
  docTipo: number;
  condicionIVAReceptorId?: number | null;
  fchServDesde?: string | null;
  fchServHasta?: string | null;
  fchVtoPago?: string | null;
  emittedAt?: string | null;
  createdAt?: string | null;
  /** Notas de crédito ya vinculadas a este comprobante. */
  creditNotes?: { impTotal?: string | number | null }[] | null;
}

export interface CreditNoteInput {
  amount: number;
  description: string;
  serviceFrom?: string;
  serviceTo?: string;
  clientRequestId?: string;
  /** Fecha de emisión `AAAA-MM-DD`; por defecto, hoy. */
  today?: string;
}

/** Tipo de nota de crédito que corresponde a cada factura o nota de débito: A -> 3, B -> 8, C -> 13. */
export function creditNoteType(invoiceType: number): number {
  const map: Record<number, number> = { 1: 3, 2: 3, 6: 8, 7: 8, 11: 13, 12: 13 };
  return map[invoiceType] ?? 3;
}

/** Lo que todavía se puede acreditar de un comprobante: su total menos las notas de crédito que ya tiene. */
export function creditableAmount(
  original: Pick<OriginalVoucher, 'impTotal' | 'creditNotes'>,
): number {
  const credited = (original.creditNotes ?? []).reduce((sum, nc) => sum + num(nc.impTotal), 0);
  return Math.max(0, round2(num(original.impTotal) - credited));
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const num = (value: string | number | null | undefined) => {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
};
const day = (iso?: string | null) => (iso ? iso.slice(0, 10) : null);

export function localToday(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/**
 * Cuerpo de `POST /invoices/emit-nc` para acreditar todo o parte de un comprobante. Los importes guardan la proporción
 * del original (una factura C no lleva IVA, una A o B lo discrimina) y el neto absorbe el redondeo para que la suma dé
 * exactamente el total.
 */
export function buildCreditNotePayload(original: OriginalVoucher, input: CreditNoteInput): Record<string, unknown> {
  const total = round2(input.amount);
  const originalTotal = num(original.impTotal);
  const ratio = originalTotal > 0 ? total / originalTotal : 1;
  const impIVA = round2(num(original.impIva) * ratio);
  const impTotConc = round2(num(original.impTotConc) * ratio);
  const impOpEx = round2(num(original.impOpEx) * ratio);
  const impTrib = round2(num(original.impTrib) * ratio);
  const impNeto = round2(total - impIVA - impTotConc - impOpEx - impTrib);
  const concepto = original.concepto === 1 || original.concepto === 3 ? original.concepto : 2;
  const today = input.today ?? localToday();

  const rates = original.ivaArray ?? [];
  // Cada alícuota guarda su proporción y la última absorbe el redondeo, para que las bases sumen el neto y los importes
  // el IVA. Se mandan también las de 0 %: sin ellas la API discrimina 21 % sobre el total.
  let baseLeft = impNeto;
  let ivaLeft = impIVA;
  const iva =
    rates.length > 0
      ? rates.map((rate, index) => {
          const last = index === rates.length - 1;
          const baseImp = last ? round2(baseLeft) : round2(num(rate.BaseImp) * ratio);
          const importe = last ? round2(ivaLeft) : round2(num(rate.Importe) * ratio);
          baseLeft -= baseImp;
          ivaLeft -= importe;
          return { id: rate.Id, baseImp: baseImp.toFixed(2), importe: importe.toFixed(2) };
        })
      : undefined;

  return {
    clientRequestId: input.clientRequestId,
    issuerId: original.issuerId,
    ptoVta: original.puntoDeVenta,
    cbteTipo: creditNoteType(original.cbteTipo),
    concepto,
    cbteFch: today,
    receptor: {
      docTipo: original.docTipo,
      docNro: original.docNro,
      businessName: original.receptorName ?? '',
      fiscalCondition: original.receptorFiscalCondition ?? 'ConsumidorFinal',
      condicionIVAReceptorId: original.condicionIVAReceptorId ?? 5,
    },
    impTotal: total.toFixed(2),
    impNeto: impNeto.toFixed(2),
    impIVA: impIVA.toFixed(2),
    impTotConc: impTotConc.toFixed(2),
    impOpEx: impOpEx.toFixed(2),
    impTrib: impTrib.toFixed(2),
    monId: original.monId ?? 'PES',
    monCotiz: String(num(original.monCotiz) || 1),
    ...(iva && { iva }),
    cbtesAsoc: [{ tipo: original.cbteTipo, ptoVta: original.puntoDeVenta, nro: original.numero }],
    ...(concepto !== 1 && {
      fchServDesde: input.serviceFrom || day(original.fchServDesde) || today,
      fchServHasta: input.serviceTo || day(original.fchServHasta) || today,
      fchVtoPago: today,
    }),
    description: input.description.slice(0, 500),
  };
}
