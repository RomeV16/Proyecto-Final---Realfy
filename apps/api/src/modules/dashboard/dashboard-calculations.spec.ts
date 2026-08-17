import {
  buildMonthRange,
  computeOccupancyPct,
  isoWeekLabel,
  buildBuckets,
  dateToBucket,
  aggregateIntoBuckets,
} from './dashboard-calculations';

describe('dashboard-calculations', () => {
  describe('buildMonthRange', () => {
    it('devuelve los ultimos N meses terminando en el mes actual', () => {
      const months = buildMonthRange(3, new Date(Date.UTC(2026, 2, 17)));

      expect(months.map((m) => m.label)).toEqual(['2026-01', '2026-02', '2026-03']);
    });

    it('cierra cada mes en su ultimo milisegundo UTC', () => {
      const [enero] = buildMonthRange(2, new Date(Date.UTC(2026, 1, 5)));

      expect(enero.eom.toISOString()).toBe('2026-01-31T23:59:59.999Z');
    });

    it('cruza el fin de año hacia atras', () => {
      const months = buildMonthRange(3, new Date(Date.UTC(2026, 0, 10)));

      expect(months.map((m) => m.label)).toEqual(['2025-11', '2025-12', '2026-01']);
    });
  });

  describe('computeOccupancyPct', () => {
    it('redondea a dos decimales', () => {
      expect(computeOccupancyPct(1, 3)).toBe(33.33);
    });

    it('devuelve 0 cuando no hay unidades', () => {
      expect(computeOccupancyPct(0, 0)).toBe(0);
    });
  });

  describe('isoWeekLabel', () => {
    it('usa semanas ISO arrancando en lunes', () => {
      expect(isoWeekLabel(new Date(Date.UTC(2026, 0, 6)))).toBe('2026-W02');
    });

    it('asigna los primeros dias de enero a la semana del año que corresponde', () => {
      expect(isoWeekLabel(new Date(Date.UTC(2027, 0, 1)))).toBe('2026-W53');
    });
  });

  describe('buildBuckets', () => {
    it('arma un bucket por mes del rango, sin repetir', () => {
      const buckets = buildBuckets(
        { from: new Date(Date.UTC(2026, 0, 15)), to: new Date(Date.UTC(2026, 2, 2)) },
        'month',
      );

      expect(buckets).toEqual(['2026-01', '2026-02', '2026-03']);
    });

    it('arma un bucket por semana ISO del rango', () => {
      const buckets = buildBuckets(
        { from: new Date(Date.UTC(2026, 0, 5)), to: new Date(Date.UTC(2026, 0, 20)) },
        'week',
      );

      expect(buckets).toEqual(['2026-W02', '2026-W03', '2026-W04']);
    });
  });

  describe('dateToBucket', () => {
    it('etiqueta por mes', () => {
      expect(dateToBucket(new Date(Date.UTC(2026, 8, 9)), 'month')).toBe('2026-09');
    });

    it('etiqueta por semana', () => {
      expect(dateToBucket(new Date(Date.UTC(2026, 0, 6)), 'week')).toBe('2026-W02');
    });
  });

  describe('aggregateIntoBuckets', () => {
    it('acumula los montos que caen en el mismo bucket', () => {
      const totals = aggregateIntoBuckets(
        [
          { date: new Date(Date.UTC(2026, 0, 3)), amount: 1000 },
          { date: new Date(Date.UTC(2026, 0, 25)), amount: 500 },
          { date: new Date(Date.UTC(2026, 1, 1)), amount: 250 },
        ],
        'month',
      );

      expect(totals.get('2026-01')).toBe(1500);
      expect(totals.get('2026-02')).toBe(250);
    });

    it('devuelve un mapa vacio cuando no hay registros', () => {
      expect(aggregateIntoBuckets([], 'week').size).toBe(0);
    });
  });
});
