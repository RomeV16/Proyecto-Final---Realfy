import { buildContractVariables } from './contract-variable-builder';

const TENANT = { name: 'Inmobiliaria Demo', cuit: '30-11111111-1' };
const base = {
  id: 'c1',
  contractType: 'Alquiler',
  status: 'Activo',
  startDate: new Date('2026-07-01T00:00:00.000Z'),
  endDate: new Date('2028-06-30T00:00:00.000Z'),
  rentAmount: '100000',
  rentCurrency: 'ARS',
  adjustmentType: 'IPC',
  adjustmentPeriod: 'Trimestral',
};
const person = (firstName: string, lastName: string, extra: Record<string, unknown> = {}) => ({ firstName, lastName, ...extra });

describe('CP-1166 (DEF-110): con varios locatarios, inquilino.* es el primero y no mezcla datos del otro', () => {
  it('el segundo locatario no pisa el nombre ni deja el CUIT o el teléfono del primero con otra persona', () => {
    const vars = buildContractVariables(
      {
        ...base,
        persons: [
          { role: 'Inquilino', person: person('Ines', 'Uno', { cuit: '27301234568', phone: '3510000001', dni: '30123456' }) },
          { role: 'Inquilino', person: person('Nico', 'Dos') },
        ],
      },
      TENANT,
    );

    expect(vars['inquilino.nombreCompleto']).toBe('Ines Uno');
    expect(vars['inquilino.cuit']).toBe('27301234568');
    expect(vars['inquilino.telefono']).toBe('3510000001');
    expect(vars['inquilino.documento']).toBe('30123456');
  });
});

describe('CP-1167 (DEF-111): un locador que dejó de serlo no figura entre los locadores del contrato', () => {
  it('lista solo a los vigentes y deja el resto en el historial', () => {
    const lessors = [
      { capacity: 'Propietario', payoutPct: '100', validTo: new Date('2026-09-01T00:00:00.000Z'), person: person('Vieja', 'Dueña') },
      { capacity: 'Propietario', payoutPct: '100', validTo: null, person: person('Nueva', 'Dueña') },
    ];
    const vars = buildContractVariables({ ...base, lessors }, TENANT);

    expect(vars['locadores.cantidad']).toBe('1');
    expect(vars['locador.nombreCompleto']).toBe('Nueva Dueña');
    expect(vars['locadores.nombres']).toBe('Nueva Dueña');
  });

  it('si ninguno sigue vigente, los lista a todos en vez de dejar el contrato sin locador', () => {
    const lessors = [
      { capacity: 'Propietario', payoutPct: '100', validTo: new Date('2026-09-01T00:00:00.000Z'), person: person('Unica', 'Dueña') },
    ];
    const vars = buildContractVariables({ ...base, lessors }, TENANT);

    expect(vars['locadores.cantidad']).toBe('1');
    expect(vars['locador.nombreCompleto']).toBe('Unica Dueña');
  });
});
