import { buildContractVariables } from './contract-variable-builder';

const TENANT = { name: 'Inmobiliaria de prueba', cuit: '30000000001' };

const person = (firstName: string, lastName: string, extra: Record<string, unknown> = {}) => ({
  firstName,
  lastName,
  ...extra,
});

const base = {
  id: 'c1',
  contractType: 'Alquiler',
  status: 'Activo',
  startDate: new Date('2026-01-01T12:00:00.000Z'),
  endDate: new Date('2028-01-01T12:00:00.000Z'),
  rentAmount: '100000',
  rentCurrency: 'ARS',
  adjustmentType: 'IPC',
  adjustmentPeriod: 'Trimestral',
};

describe('buildContractVariables — locadores y apoderados', () => {
  const lessors = [
    {
      capacity: 'Propietario',
      payoutPct: '60.0000',
      person: person('Ana', 'Uno', { cuit: '20000000011', dni: '10000001', address: 'Calle Falsa 1' }),
    },
    { capacity: 'Usufructuario', payoutPct: '40.0000', person: person('Beto', 'Dos') },
  ];

  it('expone cada locador con documento, domicilio, capacidad y porcentaje', () => {
    const vars = buildContractVariables({ ...base, lessors }, TENANT);

    expect(vars['locadores.cantidad']).toBe('2');
    expect(vars['locadores.1.nombreCompleto']).toBe('Ana Uno');
    expect(vars['locadores.1.documento']).toBe('10000001');
    expect(vars['locadores.1.domicilio']).toBe('Calle Falsa 1');
    expect(vars['locadores.1.capacidad']).toBe('Propietario');
    expect(vars['locadores.1.porcentaje']).toBe('60 %');
    expect(vars['locadores.2.nombreCompleto']).toBe('Beto Dos');
    expect(vars['locadores.2.capacidad']).toBe('Usufructuario');
    expect(vars['locadores.nombres']).toBe('Ana Uno / Beto Dos');
    expect(vars['locadores.lista']).toBe('Ana Uno, CUIT/CUIL 20000000011 y Beto Dos');
  });

  it('locador.* y propietario.* son alias del primer locador', () => {
    const vars = buildContractVariables({ ...base, lessors }, TENANT);

    expect(vars['locador.nombreCompleto']).toBe('Ana Uno');
    expect(vars['propietario.nombreCompleto']).toBe('Ana Uno');
    expect(vars['propietario.cuit']).toBe('20000000011');
    expect(vars['locador.porcentaje']).toBe('60 %');
  });

  it('un propietario cargado solo como parte del contrato ya no es locador', () => {
    const vars = buildContractVariables(
      { ...base, persons: [{ role: 'Propietario', person: person('Viejo', 'Dato') }] },
      TENANT,
    );

    expect(vars['locadores.cantidad']).toBe('0');
    expect(vars['propietario.nombreCompleto']).toBeUndefined();
  });

  it('expone los apoderados con su poderdante, alcances y modo de firma', () => {
    const vars = buildContractVariables(
      {
        ...base,
        lessors,
        apoderados: [
          {
            scopes: ['Cobrar', 'Firmar'],
            signatureMode: 'Conjunta',
            agent: person('Carla', 'Tres', { dni: '10000003' }),
            principal: person('Ana', 'Uno'),
          },
        ],
      },
      TENANT,
    );

    expect(vars['apoderados.cantidad']).toBe('1');
    expect(vars['apoderados.1.nombreCompleto']).toBe('Carla Tres');
    expect(vars['apoderados.1.documento']).toBe('10000003');
    expect(vars['apoderados.1.poderdante']).toBe('Ana Uno');
    expect(vars['apoderados.1.alcances']).toBe('Cobrar, Firmar');
    expect(vars['apoderados.1.firma']).toBe('Conjunta');
    expect(vars['apoderados.lista']).toBe('Carla Tres, apoderado/a de Ana Uno');
  });

  it('sin locadores ni apoderados solo informa que no hay', () => {
    const vars = buildContractVariables(base, TENANT);

    expect(vars['locadores.cantidad']).toBe('0');
    expect(vars['apoderados.cantidad']).toBe('0');
    expect(vars['locadores.lista']).toBeUndefined();
  });

  it('el inquilino y los garantes siguen saliendo de las partes del contrato', () => {
    const vars = buildContractVariables(
      {
        ...base,
        persons: [
          { role: 'Inquilino', person: person('Ines', 'Cuatro') },
          { role: 'Garante', person: person('Gus', 'Cinco') },
        ],
      },
      TENANT,
    );

    expect(vars['inquilino.nombreCompleto']).toBe('Ines Cuatro');
    expect(vars['garante.nombreCompleto']).toBe('Gus Cinco');
  });
});
