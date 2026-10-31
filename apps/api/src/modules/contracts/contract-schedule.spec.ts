import { AdjustmentPeriod } from '@realfy/shared';
import { ContractsService } from './contracts.service';

/**
 * CP-130 (DEF-10): el cronograma de ajustes se calcula desde el inicio del
 * contrato (inicio + k períodos) con recorte a fin de mes; no encadena cada
 * fecha a la anterior, que arrastraba el desvío de los meses cortos.
 */
describe('cronograma de ajustes de ContractsService', () => {
  const service = Object.create(ContractsService.prototype) as any;
  const iso = (entries: { date: Date }[]) => entries.map((e) => e.date.toISOString().slice(0, 10));

  it('contrato trimestral desde el 31 de enero: 30 abr, 31 jul, 31 oct', () => {
    const entries = service.generateScheduleEntries(
      new Date('2025-01-31T00:00:00.000Z'),
      new Date('2025-12-31T00:00:00.000Z'),
      AdjustmentPeriod.Trimestral,
    );
    expect(iso(entries)).toEqual(['2025-04-30', '2025-07-31', '2025-10-31']);
    expect(entries.map((e: any) => e.periodNumber)).toEqual([1, 2, 3]);
  });

  it('contrato mensual desde el 31 de enero no se queda en el 28', () => {
    const entries = service.generateScheduleEntries(
      new Date('2025-01-31T00:00:00.000Z'),
      new Date('2025-05-31T00:00:00.000Z'),
      AdjustmentPeriod.Mensual,
    );
    expect(iso(entries)).toEqual(['2025-02-28', '2025-03-31', '2025-04-30', '2025-05-31']);
  });

  it('un período desconocido falla en vez de asumir trimestral', () => {
    expect(() =>
      service.generateScheduleEntries(
        new Date('2025-01-01T00:00:00.000Z'),
        new Date('2025-12-31T00:00:00.000Z'),
        'Quincenal' as AdjustmentPeriod,
      ),
    ).toThrow();
  });
});
