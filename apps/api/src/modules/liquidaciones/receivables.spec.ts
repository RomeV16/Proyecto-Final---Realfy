import {
  isOverdue,
  isReceivable,
  outstandingBalance,
  splitReceivables,
  sumOutstanding,
} from './receivables';

const today = new Date('2026-08-17T00:00:00.000Z');
const due = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe('receivables', () => {
  describe('outstandingBalance', () => {
    it('sin pagos es el total', () => {
      expect(outstandingBalance({ total: '1000.50' }).toString()).toBe('1000.5');
      expect(outstandingBalance({ total: '1000.50', payments: [] }).toString()).toBe('1000.5');
    });

    it('resta los pagos en forma exacta', () => {
      const balance = outstandingBalance({
        total: '0.30',
        payments: [{ amount: '0.10' }, { amount: '0.10' }],
      });
      expect(balance.toString()).toBe('0.1');
    });

    it('nunca es negativo', () => {
      expect(outstandingBalance({ total: '100', payments: [{ amount: '150' }] }).toString()).toBe('0');
    });
  });

  describe('isReceivable', () => {
    it.each([
      ['Aprobada', true],
      ['Enviada', true],
      ['Pendiente', true],
      ['Vencida', true],
      ['Borrador', false],
      ['Revision', false],
      ['Pagada', false],
      ['Anulada', false],
    ])('%s -> %s', (status, expected) => {
      expect(isReceivable(status)).toBe(expected);
    });
  });

  describe('isOverdue', () => {
    it('Vencida siempre está vencida', () => {
      expect(isOverdue({ status: 'Vencida', dueDate: due('2026-09-01') }, today)).toBe(true);
    });

    it('Enviada vence al día siguiente de su fecha, no el mismo día', () => {
      expect(isOverdue({ status: 'Enviada', dueDate: due('2026-08-16') }, today)).toBe(true);
      expect(isOverdue({ status: 'Enviada', dueDate: due('2026-08-17') }, today)).toBe(false);
    });

    it('Aprobada no vence', () => {
      expect(isOverdue({ status: 'Aprobada', dueDate: due('2026-01-01') }, today)).toBe(false);
    });
  });

  describe('splitReceivables / sumOutstanding', () => {
    const rows = [
      { status: 'Vencida', dueDate: due('2026-07-10'), total: '250000.00', payments: [{ amount: '100000.00' }] },
      { status: 'Enviada', dueDate: due('2026-08-25'), total: '90000.00', payments: [] },
      { status: 'Enviada', dueDate: due('2026-08-05'), total: '60000.50', payments: [{ amount: '10000.25' }] },
      { status: 'Pagada', dueDate: due('2026-08-10'), total: '70000.00', payments: [{ amount: '70000.00' }] },
      { status: 'Enviada', dueDate: due('2026-08-01'), total: '500.00', payments: [{ amount: '500.00' }] },
    ];

    it('separa vencidas y pendientes y descarta lo que no tiene saldo', () => {
      const { overdue, pending } = splitReceivables(rows, today);
      expect(overdue).toEqual([rows[0], rows[2]]);
      expect(pending).toEqual([rows[1]]);
    });

    it('suma saldos sin error de coma flotante', () => {
      expect(sumOutstanding(splitReceivables(rows, today).overdue).toFixed(2)).toBe('200000.25');
    });
  });
});
