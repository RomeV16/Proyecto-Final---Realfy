import type { ContractClosureMetrics } from '@realfy/shared';
import {
  CLOSED_CONTRACT_STATUSES,
  findUnknownFigure,
  isClosedStatus,
  toClosureFacts,
} from './contract-closure';
import { renderClosureSummary } from './closure-summary-template';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

/** Un contrato con de todo: atrasos, deuda, punitorios, reclamos y ajustes. */
const METRICS: ContractClosureMetrics = {
  contractType: 'Alquiler',
  closureStatus: 'Rescindido',
  startDate: '2024-03-01T12:00:00.000Z',
  endDate: '2026-03-01T12:00:00.000Z',
  closedOn: '2025-12-01T12:00:00.000Z',
  durationDays: 640,
  durationMonths: 21,
  endedEarly: true,
  currency: 'ARS',

  billedCount: 5,
  paidCount: 4,
  onTimeCount: 2,
  lateCount: 2,
  unpaidCount: 1,
  onTimeRate: 50,
  averageDelayDays: 14,
  maxDelayDays: 22,
  billedAmount: 1170000,
  collectedAmount: 850000,
  outstandingAmount: 320000,

  penaltyCount: 2,
  penaltyAmount: 24000,
  penaltyWaivedCount: 1,

  ticketCount: 4,
  ticketsResolved: 2,
  ticketsCancelled: 1,
  ticketsOpen: 1,
  averageResolutionDays: 4,
  ticketCostAmount: 42000,

  adjustmentCount: 2,
  firstRent: 180000,
  lastRent: 320000,
  rentIncreasePct: 77.8,

  rendicionCount: 2,
  rendicionNetAmount: 310000,
};

/** Un contrato que llegó al final sin un solo atraso. */
const CLEAN_METRICS: ContractClosureMetrics = {
  ...METRICS,
  closureStatus: 'Vencido',
  closedOn: '2026-03-01T12:00:00.000Z',
  durationMonths: 24,
  endedEarly: false,
  billedCount: 24,
  paidCount: 24,
  onTimeCount: 24,
  lateCount: 0,
  unpaidCount: 0,
  onTimeRate: 100,
  averageDelayDays: 0,
  maxDelayDays: 0,
  collectedAmount: 1170000,
  outstandingAmount: 0,
  penaltyCount: 0,
  penaltyAmount: 0,
  penaltyWaivedCount: 0,
  ticketCount: 0,
  ticketsResolved: 0,
  ticketsCancelled: 0,
  ticketsOpen: 0,
  averageResolutionDays: null,
  ticketCostAmount: 0,
};

/** Un contrato que se cerró sin haber facturado nada. */
const EMPTY_METRICS: ContractClosureMetrics = {
  ...CLEAN_METRICS,
  closureStatus: 'Archivado',
  billedCount: 0,
  paidCount: 0,
  onTimeCount: 0,
  onTimeRate: 0,
  billedAmount: 0,
  collectedAmount: 0,
  adjustmentCount: 0,
  firstRent: 320000,
  lastRent: 320000,
  rentIncreasePct: 0,
  rendicionCount: 0,
  rendicionNetAmount: 0,
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('isClosedStatus', () => {
  it('reconoce los estados de cierre del contrato', () => {
    for (const status of CLOSED_CONTRACT_STATUSES) {
      expect(isClosedStatus(status)).toBe(true);
    }
  });

  it('no toma por cerrado un contrato vigente ni un borrador', () => {
    expect(isClosedStatus('Activo')).toBe(false);
    expect(isClosedStatus('Borrador')).toBe(false);
  });
});

describe('findUnknownFigure', () => {
  const facts = toClosureFacts(METRICS);

  it('acepta las cifras que salen de las metricas', () => {
    const text =
      'El contrato duró 21 meses, con 2 pagos con atraso, un promedio de 14 días y un máximo de 22.';

    expect(findUnknownFigure(text, facts)).toBeNull();
  });

  it('acepta los importes escritos con separador de miles', () => {
    expect(findUnknownFigure('Se facturaron $ 1.170.000 en total.', facts)).toBeNull();
    expect(findUnknownFigure('Quedó una deuda de $ 320.000.', facts)).toBeNull();
  });

  it('acepta el porcentaje redondeado y con coma decimal', () => {
    expect(findUnknownFigure('El alquiler subió 77,8 %.', facts)).toBeNull();
    expect(findUnknownFigure('El alquiler subió 78 %.', facts)).toBeNull();
  });

  it('acepta las fechas de vigencia porque estan en la grilla', () => {
    expect(
      findUnknownFigure('Estuvo vigente entre marzo de 2024 y diciembre de 2025.', facts),
    ).toBeNull();
  });

  it('detecta una cifra que el modelo derivo por su cuenta', () => {
    // 850000 / 1170000 no está en la grilla, aunque los dos operandos sí.
    expect(findUnknownFigure('Se cobró el 73 % de lo facturado.', facts)).toBe('73');
  });

  it('detecta un importe inventado', () => {
    expect(findUnknownFigure('La deuda al cierre fue de $ 415.000.', facts)).toBe('415000');
  });

  it('no se queja de un texto sin cifras', () => {
    expect(findUnknownFigure('El comportamiento de pago fue irregular.', facts)).toBeNull();
  });
});

describe('renderClosureSummary', () => {
  it('arma un resumen en prosa con varios parrafos', () => {
    const { summary } = renderClosureSummary(toClosureFacts(METRICS));

    expect(summary.split('\n\n').length).toBeGreaterThanOrEqual(4);
    expect(summary.length).toBeGreaterThan(400);
  });

  it('cuenta la vigencia, el cierre anticipado y el estado', () => {
    const { summary } = renderClosureSummary(toClosureFacts(METRICS));

    expect(summary).toContain('21 meses');
    expect(summary).toContain('cerró en estado Rescindido');
    expect(summary).toContain('El cierre se adelantó');
  });

  it('cuenta el comportamiento de pago con atrasos, deuda y punitorios', () => {
    const { summary } = renderClosureSummary(toClosureFacts(METRICS));

    expect(summary).toContain('2 pagos entraron en término y 2 con atraso');
    expect(summary).toContain('50 %');
    expect(summary).toContain('14 días');
    expect(summary).toContain('22 días');
    expect(summary).toContain('liquidación sin cobrar');
    expect(summary).toContain('2 punitorios');
    expect(summary).toContain('Se condonó 1 punitorio');
  });

  it('cuenta los reclamos y como se resolvieron', () => {
    const { summary } = renderClosureSummary(toClosureFacts(METRICS));

    expect(summary).toContain('4 reclamos de mantenimiento');
    expect(summary).toContain('2 se resolvieron');
    expect(summary).toContain('1 sigue sin cerrar');
    expect(summary).toContain('1 se dio de baja');
  });

  it('cuenta los ajustes y las rendiciones emitidas', () => {
    const { summary } = renderClosureSummary(toClosureFacts(METRICS));

    expect(summary).toContain('2 ajustes de alquiler');
    expect(summary).toContain('77,8 %');
    expect(summary).toContain('2 rendiciones');
  });

  it('agrega una lectura cualitativa y no solo cifras', () => {
    const problematic = renderClosureSummary(toClosureFacts(METRICS));
    const clean = renderClosureSummary(toClosureFacts(CLEAN_METRICS));

    expect(problematic.summary).toContain('Quedó deuda sin regularizar al cierre');
    expect(clean.summary).toContain('El comportamiento de pago fue muy bueno');
    expect(clean.summary).toContain('La propiedad no generó reclamos');
  });

  it('no cita ni una cifra que no salga de las metricas', () => {
    for (const metrics of [METRICS, CLEAN_METRICS, EMPTY_METRICS]) {
      const facts = toClosureFacts(metrics);
      const { summary, highlights } = renderClosureSummary(facts);

      expect(findUnknownFigure(summary, facts)).toBeNull();
      for (const highlight of highlights) {
        expect(findUnknownFigure(highlight, facts)).toBeNull();
      }
    }
  });

  it('destaca entre dos y cinco puntos, empezando por la vigencia', () => {
    const { highlights } = renderClosureSummary(toClosureFacts(METRICS));

    expect(highlights.length).toBeGreaterThanOrEqual(2);
    expect(highlights.length).toBeLessThanOrEqual(5);
    expect(highlights[0]).toContain('Vigencia efectiva de 21 meses');
    expect(highlights.some((h) => h.includes('Deuda al cierre'))).toBe(true);
    expect(highlights.some((h) => h.includes('reclamos'))).toBe(true);
  });

  it('un contrato sin historial igual se lee como un resumen', () => {
    const { summary, highlights } = renderClosureSummary(toClosureFacts(EMPTY_METRICS));

    expect(summary).toContain('No se emitieron liquidaciones');
    expect(summary).toContain('no generó reclamos');
    expect(highlights.length).toBeGreaterThanOrEqual(2);
  });

  it('es determinista: los mismos hechos devuelven el mismo texto', () => {
    const facts = toClosureFacts(METRICS);

    expect(renderClosureSummary(facts)).toEqual(renderClosureSummary(facts));
  });
});
