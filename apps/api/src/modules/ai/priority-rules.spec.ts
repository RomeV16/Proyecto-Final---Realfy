import { rankByRules } from './priority-rules';
import type { DailyContextItem, PriorityKind } from './daily-context';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function item(
  ref: string,
  kind: PriorityKind,
  overrides: Partial<DailyContextItem> = {},
): DailyContextItem {
  return {
    ref,
    kind,
    entityId: `${ref}-id`,
    title: `Título ${ref}`,
    subtitle: null,
    amount: null,
    currency: 'ARS',
    daysOverdue: null,
    daysToDue: null,
    slaHoursOverdue: null,
    unassigned: false,
    ticketPriority: null,
    status: null,
    daysSinceContact: null,
    ...overrides,
  };
}

const BIG_OVERDUE = item('C1', 'cobranza', {
  amount: 480000,
  daysOverdue: 45,
  status: 'Vencida',
});
const SMALL_PENDING = item('C2', 'cobranza', {
  amount: 40000,
  daysOverdue: 0,
  status: 'Enviada',
});
const URGENT_CLAIM = item('R1', 'reclamo', {
  slaHoursOverdue: 24,
  unassigned: true,
  ticketPriority: 'Urgente',
  status: 'Abierto',
});
const NEAR_EXPIRY = item('V1', 'contrato', { daysToDue: 5, status: 'Activo' });
const FAR_EXPIRY = item('V2', 'contrato', { daysToDue: 85, status: 'Activo' });
const STALE_LEAD = item('L1', 'lead', { daysSinceContact: 30, status: 'Contactado' });

const ALL = [SMALL_PENDING, STALE_LEAD, FAR_EXPIRY, NEAR_EXPIRY, URGENT_CLAIM, BIG_OVERDUE];

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('rankByRules', () => {
  it('pone primero lo más urgente de cada frente', () => {
    const ranked = rankByRules(ALL);

    expect(ranked.map((r) => r.ref)).toEqual(['C1', 'R1', 'V1', 'C2', 'L1', 'V2']);
  });

  it('marca urgencia alta sólo en lo que no puede esperar', () => {
    const byRef = new Map(rankByRules(ALL).map((r) => [r.ref, r]));

    expect(byRef.get('C1')!.urgency).toBe('alta');
    expect(byRef.get('R1')!.urgency).toBe('alta');
    expect(byRef.get('V1')!.urgency).toBe('media');
    expect(byRef.get('L1')!.urgency).toBe('baja');
  });

  it('sube la cobranza más vieja por encima de una más nueva del mismo monto', () => {
    const older = item('C1', 'cobranza', { amount: 100000, daysOverdue: 30 });
    const newer = item('C2', 'cobranza', { amount: 100000, daysOverdue: 3 });

    expect(rankByRules([newer, older]).map((r) => r.ref)).toEqual(['C1', 'C2']);
  });

  it('sube la cobranza de mayor monto cuando el atraso empata', () => {
    const bigger = item('C1', 'cobranza', { amount: 900000, daysOverdue: 10 });
    const smaller = item('C2', 'cobranza', { amount: 30000, daysOverdue: 10 });

    expect(rankByRules([smaller, bigger]).map((r) => r.ref)).toEqual(['C1', 'C2']);
  });

  it('sube el reclamo sin responsable frente a uno equivalente ya asignado', () => {
    const orphan = item('R1', 'reclamo', {
      slaHoursOverdue: 6,
      unassigned: true,
      ticketPriority: 'Alta',
    });
    const assigned = item('R2', 'reclamo', {
      slaHoursOverdue: 6,
      unassigned: false,
      ticketPriority: 'Alta',
    });

    expect(rankByRules([assigned, orphan]).map((r) => r.ref)).toEqual(['R1', 'R2']);
  });

  it('explica el motivo y propone una acción para cada frente', () => {
    const byRef = new Map(rankByRules(ALL).map((r) => [r.ref, r]));

    expect(byRef.get('C1')!.reason).toContain('Vencida hace 45 días');
    expect(byRef.get('C1')!.action).toContain('pago');
    expect(byRef.get('R1')!.reason).toContain('SLA excedido en 24 h');
    expect(byRef.get('R1')!.reason).toContain('sin responsable');
    expect(byRef.get('R1')!.action).toContain('responsable');
    expect(byRef.get('V1')!.reason).toBe('El contrato vence en 5 días');
    expect(byRef.get('L1')!.reason).toBe('30 días sin contacto');
  });

  it('devuelve el mismo orden ante el mismo contexto', () => {
    expect(rankByRules(ALL)).toEqual(rankByRules(ALL));
  });

  it('no se rompe con un contexto vacío', () => {
    expect(rankByRules([])).toEqual([]);
  });
});
