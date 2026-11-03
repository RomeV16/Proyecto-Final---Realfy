import { ImportEntity, ImportRowAction } from '@realfy/shared';
import { buildWorkItems, countResults, ENTITY_IMPORTERS, RowResult, rowsToCsv, toRowErrors } from './import-batch.service';
import { ImportRowError } from './import-types';

describe('toRowErrors', () => {
  it('conserva el código y el campo de un error de fila', () => {
    expect(toRowErrors(new ImportRowError('RENT_MISMATCH', 'm', 'rentAmount'))).toEqual([
      { code: 'RENT_MISMATCH', message: 'm', field: 'rentAmount' },
    ]);
  });

  it('un choque de índice único de la base es DUPLICATE_KEY', () => {
    const [e] = toRowErrors({ code: 'P2002', meta: { target: ['tenantId', 'cuit'] } });
    expect(e.code).toBe('DUPLICATE_KEY');
    expect(e.message).toContain('tenantId, cuit');
  });

  it('cualquier otro error es INTERNAL_ERROR', () => {
    expect(toRowErrors(new Error('boom'))).toEqual([{ code: 'INTERNAL_ERROR', message: 'boom' }]);
  });
});

describe('buildWorkItems', () => {
  it('ordena personas, propiedades (edificios antes que unidades) y contratos, con el número de fila de cada arreglo', () => {
    const items = buildWorkItems({
      persons: [{ externalRef: 'P1' }, { externalRef: 'P2' }],
      properties: [
        { externalRef: 'U1', parentExternalRef: 'E1' },
        { externalRef: 'E1' },
      ],
      contracts: [{ externalRef: 'C1' }],
    });
    expect(items.map((i) => `${i.importer.entity}:${i.externalRef}:${i.rowNumber}`)).toEqual([
      'Persona:P1:1',
      'Persona:P2:2',
      'Propiedad:E1:2',
      'Propiedad:U1:1',
      'Contrato:C1:1',
    ]);
  });

  it('los servicios y las reglas van después de los contratos; la regla se registra por contrato, servicio y fecha', () => {
    const items = buildWorkItems({
      persons: [],
      properties: [],
      contracts: [{ externalRef: 'C1' }],
      chargeRules: [{ contractRef: 'C1', serviceRef: 'S1', validFrom: '2025-01-01' }],
      services: [{ externalRef: 'S1' }],
    });
    expect(items.map((i) => `${i.importer.entity}:${i.externalRef}`)).toEqual([
      'Contrato:C1',
      'Servicio:S1',
      'ReglaDeCargo:C1|S1|2025-01-01',
    ]);
  });

  it('una fila sin referencia legible se registra igual, con externalRef nulo', () => {
    const items = buildWorkItems({ persons: [null, 'x', { externalRef: 5 }, { externalRef: ' P ' }], properties: [], contracts: [] });
    expect(items.map((i) => i.externalRef)).toEqual([null, null, null, 'P']);
  });

  it('el registro tiene un importador por entidad', () => {
    expect(ENTITY_IMPORTERS.map((i) => i.entity)).toEqual([
      ImportEntity.Persona,
      ImportEntity.Propiedad,
      ImportEntity.Contrato,
      ImportEntity.Servicio,
      ImportEntity.ReglaDeCargo,
    ]);
  });
});

describe('countResults', () => {
  const r = (entity: ImportEntity, action: ImportRowAction): RowResult => ({
    entity,
    action,
    externalRef: 'x',
    rowNumber: 1,
    entityId: null,
    errors: null,
  });

  it('cuenta por entidad y acción y totaliza los errores', () => {
    const counts = countResults([
      r(ImportEntity.Persona, ImportRowAction.Creado),
      r(ImportEntity.Persona, ImportRowAction.Creado),
      r(ImportEntity.Persona, ImportRowAction.SinCambios),
      r(ImportEntity.Contrato, ImportRowAction.Error),
      r(ImportEntity.Contrato, ImportRowAction.Actualizado),
    ]);
    expect(counts.total).toBe(5);
    expect(counts.errors).toBe(1);
    expect(counts.byEntity.Persona).toEqual({ Creado: 2, Actualizado: 0, SinCambios: 1, Error: 0 });
    expect(counts.byEntity.Contrato).toEqual({ Creado: 0, Actualizado: 1, SinCambios: 0, Error: 1 });
    expect(counts.byEntity.Propiedad).toBeUndefined();
  });

  it('un lote vacío da ceros', () => {
    expect(countResults([])).toEqual({ total: 0, errors: 0, byEntity: {} });
  });
});

describe('rowsToCsv', () => {
  it('una línea por error, con código, campo y mensaje; las filas sin error van con las columnas vacías', () => {
    const csv = rowsToCsv([
      {
        entity: 'Contrato',
        rowNumber: 3,
        externalRef: 'C-1',
        action: 'Error',
        errors: [
          { code: 'REFERENCE_NOT_FOUND', field: 'tenants[0]', message: 'Person with externalRef "X, Y" not found' },
          { code: 'RENT_MISMATCH', message: 'm' },
        ],
      },
      { entity: 'Persona', rowNumber: 1, externalRef: 'P-1', action: 'Creado', errors: null },
    ]).replace('\ufeff', '');
    const lines = csv.split('\r\n');
    expect(lines[0]).toBe('Entidad,Fila,Referencia externa,Acción,Código,Campo,Mensaje');
    expect(lines[1]).toBe('Contrato,3,C-1,Error,REFERENCE_NOT_FOUND,tenants[0],"Person with externalRef ""X, Y"" not found"');
    expect(lines[2]).toBe('Contrato,3,C-1,Error,RENT_MISMATCH,,m');
    expect(lines[3]).toBe('Persona,1,P-1,Creado,,,');
  });

  it('un texto que empieza como fórmula se neutraliza', () => {
    const csv = rowsToCsv([{ entity: 'Persona', rowNumber: 1, externalRef: '=HYPERLINK("x")', action: 'Error', errors: [] }]);
    expect(csv).toContain("'=HYPERLINK");
  });
});
