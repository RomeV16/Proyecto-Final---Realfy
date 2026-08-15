import { FiscalCondition } from '../enums';

// ─── Types ──────────────────────────────────────────────

/**
 * ARCA comprobante letter: determines IVA treatment.
 * A = IVA discriminado (separate neto + IVA)
 * B = IVA included in total
 * C = no IVA
 */
export type ComprobanteLetra = 'A' | 'B' | 'C';

/**
 * Result of comprobante type resolution.
 * Maps emisor × receptor fiscal conditions → ARCA comprobante codes.
 */
export interface ComprobanteResolution {
  /** ARCA cbte_tipo code for Factura (1=A, 6=B, 11=C) */
  cbteTipo: number;
  /** Letter A, B, or C */
  letra: ComprobanteLetra;
  /** ARCA cbte_tipo code for Nota de Crédito (3=A, 8=B, 13=C) */
  ncTipo: number;
  /** ARCA cbte_tipo code for Nota de Débito (2=A, 7=B, 12=C) */
  ndTipo: number;
}

// ─── Resolution Tables ──────────────────────────────────

const LETRA_A: ComprobanteResolution = {
  cbteTipo: 1,
  letra: 'A',
  ncTipo: 3,
  ndTipo: 2,
};

const LETRA_B: ComprobanteResolution = {
  cbteTipo: 6,
  letra: 'B',
  ncTipo: 8,
  ndTipo: 7,
};

const LETRA_C: ComprobanteResolution = {
  cbteTipo: 11,
  letra: 'C',
  ncTipo: 13,
  ndTipo: 12,
};

/**
 * Resolution matrix: emisor fiscal condition → receptor fiscal condition → resolution.
 *
 * Legal rules (ARCA / ex-AFIP):
 * - RI → RI = A
 * - RI → Monotributo|CF|Exento|NoResponsable = B
 * - Monotributo → any = C
 * - Exento → any = C
 *
 * ConsumidorFinal and NoResponsable cannot be emisors (cannot issue invoices).
 */
const RESOLUTION_MATRIX: Record<string, Record<string, ComprobanteResolution>> = {
  [FiscalCondition.ResponsableInscripto]: {
    [FiscalCondition.ResponsableInscripto]: LETRA_A,
    [FiscalCondition.Monotributista]: LETRA_B,
    [FiscalCondition.ConsumidorFinal]: LETRA_B,
    [FiscalCondition.Exento]: LETRA_B,
    [FiscalCondition.NoResponsable]: LETRA_B,
  },
  [FiscalCondition.Monotributista]: {
    [FiscalCondition.ResponsableInscripto]: LETRA_C,
    [FiscalCondition.Monotributista]: LETRA_C,
    [FiscalCondition.ConsumidorFinal]: LETRA_C,
    [FiscalCondition.Exento]: LETRA_C,
    [FiscalCondition.NoResponsable]: LETRA_C,
  },
  [FiscalCondition.Exento]: {
    [FiscalCondition.ResponsableInscripto]: LETRA_C,
    [FiscalCondition.Monotributista]: LETRA_C,
    [FiscalCondition.ConsumidorFinal]: LETRA_C,
    [FiscalCondition.Exento]: LETRA_C,
    [FiscalCondition.NoResponsable]: LETRA_C,
  },
};

// ─── Valid emisor conditions (can issue invoices) ───────

const VALID_EMISOR_CONDITIONS = new Set<FiscalCondition>([
  FiscalCondition.ResponsableInscripto,
  FiscalCondition.Monotributista,
  FiscalCondition.Exento,
]);

// ─── Public API ─────────────────────────────────────────

/**
 * Resolve the ARCA comprobante type based on emisor and receptor fiscal conditions.
 *
 * @param emisorFC - Fiscal condition of the invoice issuer (tenant/company)
 * @param receptorFC - Fiscal condition of the invoice recipient (customer)
 * @returns Resolution with cbte_tipo codes for factura, nota de crédito, and nota de débito
 * @throws Error if emisor fiscal condition cannot issue invoices (ConsumidorFinal, NoResponsable)
 */
export function resolveComprobanteType(
  emisorFC: FiscalCondition,
  receptorFC: FiscalCondition,
): ComprobanteResolution {
  if (!VALID_EMISOR_CONDITIONS.has(emisorFC)) {
    throw new Error(
      `Fiscal condition "${emisorFC}" cannot issue invoices. Valid emisor conditions: ${[...VALID_EMISOR_CONDITIONS].join(', ')}`,
    );
  }

  const emisorRow = RESOLUTION_MATRIX[emisorFC];
  if (!emisorRow) {
    throw new Error(`Unknown emisor fiscal condition: "${emisorFC}"`);
  }

  const resolution = emisorRow[receptorFC];
  if (!resolution) {
    throw new Error(`Unknown receptor fiscal condition: "${receptorFC}"`);
  }

  return resolution;
}

/**
 * Check whether a fiscal condition is allowed to issue invoices.
 */
export function canIssueFiscalInvoice(fc: FiscalCondition): boolean {
  return VALID_EMISOR_CONDITIONS.has(fc);
}

/**
 * Get the IVA treatment for a comprobante letter.
 * - A: IVA discriminado — neto and IVA are separate
 * - B: IVA included — total includes IVA
 * - C: No IVA — exempt
 */
export function getIvaTreatment(letra: ComprobanteLetra): 'discriminado' | 'included' | 'none' {
  switch (letra) {
    case 'A':
      return 'discriminado';
    case 'B':
      return 'included';
    case 'C':
      return 'none';
  }
}
