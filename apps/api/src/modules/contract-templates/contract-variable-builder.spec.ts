import {
  extractTemplateVariables,
  isKnownTemplateVariable,
  renderTemplatePlain,
  TEMPLATE_LIST_NAMES,
} from '@realfy/shared';
import { buildContractTemplateData, buildContractVariables } from './contract-variable-builder';
import { DEFAULT_TEMPLATES } from './default-templates';

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

const FULL = {
  ...base,
  depositAmount: '590000',
  depositCurrency: 'ARS',
  notes: 'Nota de prueba',
  property: {
    title: 'Depto de prueba',
    street: 'Calle Ficticia',
    number: '123',
    floor: '6',
    apartment: 'B',
    city: 'Ciudad Demo',
    province: 'Provincia Demo',
    zipCode: '5000',
    type: 'Departamento',
    description: '  Consta de living, cocina y dos dormitorios.  ',
    cadastralId: '01-02-003-004',
    area: 60,
    rooms: 3,
    bedrooms: 2,
    bathrooms: 1,
  },
  persons: [
    { role: 'Inquilino', person: person('Ines', 'Cuatro', { dni: '30123456', cuit: '27301234569', phone: '3510000001', maritalStatus: 'Soltera', nationality: 'Argentina' }) },
    { role: 'Inquilino', person: person('Nico', 'Seis', { dni: 'AB123456' }) },
    { role: 'Garante', person: person('Gus', 'Cinco', { dni: '10000005', address: 'Calle Uno 10', email: 'gus@inmobiliariademo.com.ar' }) },
    { role: 'Garante', person: person('Gina', 'Siete', { dni: '10000007' }) },
    { role: 'Comprador', person: person('Cora', 'Ocho') },
  ],
  lessors: [
    { capacity: 'Propietario', payoutPct: '60.0000', person: person('Ana', 'Uno', { dni: '10000001' }) },
    { capacity: 'Propietario', payoutPct: '40.0000', person: person('Beto', 'Dos') },
  ],
  apoderados: [
    { scopes: ['Cobrar'], signatureMode: 'Indistinta', agent: person('Carla', 'Tres'), principal: person('Ana', 'Uno') },
  ],
  guarantees: [
    { type: 'Garante', description: 'Propiedad', amount: '100000', issuer: 'Emisor', policyNumber: 'P-1' },
    { type: 'SeguroCaucion', policyNumber: 'P-2' },
  ],
};

const FULL_TENANT = { ...TENANT, province: 'Provincia Demo', licenseNumber: ' Mat. 1234 ', address: ' Calle Demo 100, Ciudad Demo ' };

describe('buildContractTemplateData — contrato, inmueble e inmobiliaria', () => {
  const context = {
    services: [
      { serviceType: 'Electricidad', accountNumber: '111' },
      { serviceType: 'ImpuestoInmobiliario', accountNumber: null },
      { serviceType: 'ImpuestoInmobiliario', accountNumber: ' 0100-200 ' },
      { serviceType: 'Agua', accountNumber: 'U-55' },
    ],
    initialRent: '590000',
    signedAt: '2026-06-20',
  };
  const { variables: vars } = buildContractTemplateData(
    { ...FULL, rentAmount: '720000.5', adjustmentPeriod: 'Trimestral' },
    FULL_TENANT,
    context,
  );

  it('da el canon vigente y el inicial, cada uno con su texto en letras', () => {
    expect(vars['contrato.monto']).toBe('720.000,50');
    expect(vars['contrato.montoEnLetras']).toBe('Setecientos veinte mil pesos con cincuenta centavos');
    expect(vars['contrato.montoInicial']).toBe('590.000,00');
    expect(vars['contrato.montoInicialEnLetras']).toBe('Quinientos noventa mil pesos');
    expect(vars['contrato.deposito']).toBe('590.000,00');
    expect(vars['contrato.depositoEnLetras']).toBe('Quinientos noventa mil pesos');
  });

  it('las fechas del contrato salen en tres formas, leídas en UTC', () => {
    expect(vars['contrato.fechaInicio']).toBe('01/01/2026');
    expect(vars['contrato.fechaInicioLarga']).toBe('1 de enero de 2026');
    expect(vars['contrato.fechaInicioEnLetras']).toBe('primero de enero de dos mil veintiséis');
    expect(vars['contrato.fechaFinEnLetras']).toBe('primero de enero de dos mil veintiocho');
    expect(vars['fecha.hoyEnLetras']).toMatch(/ de dos mil veinti.+$/);
  });

  it('la fecha de firma sale de la del contrato y la indicada al generar la reemplaza', () => {
    expect(vars['contrato.fechaFirma']).toBe('20/06/2026');
    expect(vars['contrato.fechaFirmaLarga']).toBe('20 de junio de 2026');
    expect(vars['contrato.fechaFirmaEnLetras']).toBe('veinte de junio de dos mil veintiséis');

    const given = buildContractVariables(FULL, FULL_TENANT, { ...context, signingDate: '2026-07-01' });
    expect(given['contrato.fechaFirma']).toBe('01/07/2026');
    expect(given['contrato.fechaFirmaEnLetras']).toBe('primero de julio de dos mil veintiséis');

    const none = buildContractVariables(FULL, FULL_TENANT);
    expect(none['contrato.fechaFirma']).toBeUndefined();
    expect(none['contrato.montoInicial']).toBeUndefined();
  });

  it('sin depósito no define las variables del depósito', () => {
    const none = buildContractVariables({ ...FULL, depositAmount: null }, FULL_TENANT);
    expect(none['contrato.deposito']).toBeUndefined();
    expect(none['contrato.depositoEnLetras']).toBeUndefined();
  });

  it('una moneda sin texto en letras deja el importe sin esa variable', () => {
    const v = buildContractVariables({ ...FULL, rentCurrency: 'BRL' }, FULL_TENANT);
    expect(v['contrato.monto']).toBe('100.000,00');
    expect(v['contrato.montoEnLetras']).toBeUndefined();
  });

  it('el inmueble trae descripción, catastro y las cuentas de Rentas y de Aguas', () => {
    expect(vars['propiedad.descripcion']).toBe('Consta de living, cocina y dos dormitorios.');
    expect(vars['propiedad.catastro']).toBe('01-02-003-004');
    expect(vars['propiedad.cuentaRentas']).toBe('0100-200');
    expect(vars['propiedad.unidadAguas']).toBe('U-55');
    expect(vars['propiedad.direccionCompleta']).toBe('Calle Ficticia, 123, Piso 6, Dto B, Ciudad Demo, Provincia Demo');
  });

  it('sin esos datos no define las variables', () => {
    const v = buildContractVariables({ ...FULL, property: { title: 'X', type: 'Casa' } }, FULL_TENANT, { services: [] });
    for (const name of ['descripcion', 'catastro', 'cuentaRentas', 'unidadAguas']) {
      expect(v[`propiedad.${name}`]).toBeUndefined();
    }
  });

  it('la inmobiliaria suma matrícula y domicilio, sin espacios sobrantes', () => {
    expect(vars['inmobiliaria.matricula']).toBe('Mat. 1234');
    expect(vars['inmobiliaria.domicilio']).toBe('Calle Demo 100, Ciudad Demo');
    const none = buildContractVariables(FULL, { ...TENANT, licenseNumber: null, address: '  ' });
    expect(none['inmobiliaria.matricula']).toBeUndefined();
    expect(none['inmobiliaria.domicilio']).toBeUndefined();
  });
});

describe('buildContractTemplateData — personas y listas', () => {
  const { variables: vars, lists } = buildContractTemplateData(FULL, FULL_TENANT);

  it('inquilino.* es el primer locatario, sin mezclar campos del segundo', () => {
    expect(vars['inquilino.nombreCompleto']).toBe('Ines Cuatro');
    expect(vars['inquilino.documento']).toBe('30123456');
    expect(vars['inquilino.cuit']).toBe('27301234569');
    expect(vars['inquilino.estadoCivil']).toBe('Soltera');
    expect(vars['inquilino.nacionalidad']).toBe('Argentina');
  });

  it('inquilinos: cantidad, resumen, indexadas y lista', () => {
    expect(vars['inquilinos.cantidad']).toBe('2');
    expect(vars['inquilinos.nombres']).toBe('Ines Cuatro y Nico Seis');
    expect(vars['inquilinos.lista']).toBe('Ines Cuatro, DNI 30.123.456 y Nico Seis, DNI AB123456');
    expect(vars['inquilinos.2.nombreCompleto']).toBe('Nico Seis');
    expect(vars['inquilinos.2.cuit']).toBeUndefined();
    expect(lists.inquilinos).toHaveLength(2);
    expect(lists.inquilinos[0].dniConPuntos).toBe('30.123.456');
  });

  it('garantes: los garante/garante2 de siempre más cantidad, indexadas y lista con los datos de la ficha', () => {
    expect(vars['garante.nombreCompleto']).toBe('Gus Cinco');
    expect(vars['garante2.nombreCompleto']).toBe('Gina Siete');
    expect(vars['garantes.cantidad']).toBe('2');
    expect(vars['garantes.nombres']).toBe('Gus Cinco y Gina Siete');
    expect(vars['garantes.1.domicilio']).toBe('Calle Uno 10');
    expect(vars['garantes.1.dniConPuntos']).toBe('10.000.005');
    expect(lists.garantes).toEqual([
      expect.objectContaining({ nombreCompleto: 'Gus Cinco', documento: '10000005', domicilio: 'Calle Uno 10' }),
      expect.objectContaining({ nombreCompleto: 'Gina Siete' }),
    ]);
  });

  it('locadores con su porcentaje y apoderados como listas, y las variables de siempre intactas', () => {
    expect(lists.locadores.map((l) => [l.nombreCompleto, l.porcentaje])).toEqual([
      ['Ana Uno', '60 %'],
      ['Beto Dos', '40 %'],
    ]);
    expect(lists.apoderados[0]).toEqual(expect.objectContaining({ nombreCompleto: 'Carla Tres', poderdante: 'Ana Uno', firma: 'Indistinta' }));
    expect(vars['locadores.1.dniConPuntos']).toBe('10.000.001');
    expect(vars['locador.nombreCompleto']).toBe('Ana Uno');
    expect(vars['comprador.nombreCompleto']).toBe('Cora Ocho');
    expect(vars['garantia2.poliza']).toBe('P-2');
  });

  it('sin partes las listas salen vacías y no se define ninguna variable de persona', () => {
    const empty = buildContractTemplateData(base, TENANT);
    expect(empty.lists.inquilinos).toEqual([]);
    expect(empty.lists.garantes).toEqual([]);
    expect(empty.variables['inquilinos.cantidad']).toBe('0');
    expect(empty.variables['inquilinos.nombres']).toBeUndefined();
    expect(empty.variables['inquilino.nombreCompleto']).toBeUndefined();
  });

  it('un contrato con 2 locatarios y 2 garantes se escribe con listas y condicionales', () => {
    const body = [
      '{{#si inquilinos.cantidad > 1}}Los locatarios{{#sino}}El locatario{{/si}}:',
      '{{#cada inquilinos como i}}',
      '- {{i.nombreCompleto}}, DNI {{i.dniConPuntos}}{{#si i.cuit}}, CUIT {{i.cuit}}{{/si}}{{#si i.ultimo}}.{{#sino}};{{/si}}',
      '{{/cada}}',
      '{{#cada garantes como g}}',
      'Garante {{g.n}} de {{g.total}}: {{g.nombreCompleto}}{{#si g.domicilio}}, con domicilio en {{g.domicilio}}{{/si}}.',
      '{{/cada}}',
    ].join('\n');
    expect(renderTemplatePlain(body, vars, lists, { lists: TEMPLATE_LIST_NAMES })).toBe(
      [
        'Los locatarios:',
        '- Ines Cuatro, DNI 30.123.456, CUIT 27301234569;',
        '- Nico Seis, DNI AB123456.',
        'Garante 1 de 2: Gus Cinco, con domicilio en Calle Uno 10.',
        'Garante 2 de 2: Gina Siete.',
        '',
      ].join('\n'),
    );
  });
});

describe('catálogo y plantillas por defecto', () => {
  it('toda variable que arma el constructor está en el catálogo', () => {
    const { variables } = buildContractTemplateData(FULL, FULL_TENANT, {
      services: [{ serviceType: 'Agua', accountNumber: '1' }, { serviceType: 'ImpuestoInmobiliario', accountNumber: '2' }],
      initialRent: '1',
      signingDate: '2026-07-01',
    });
    const unknown = Object.keys(variables).filter((name) => !isKnownTemplateVariable(name));
    expect(unknown).toEqual([]);
  });

  it('las plantillas por defecto salen igual que con el motor anterior (solo variables)', () => {
    const { variables, lists } = buildContractTemplateData(FULL, FULL_TENANT);
    const legacy = (t: string) =>
      t.replace(/\{\{\s*([a-zA-Z_][a-zA-Z0-9_.]*)\s*\}\}/g, (full, name: string) => (name in variables ? variables[name] : full));
    for (const tmpl of DEFAULT_TEMPLATES) {
      expect(renderTemplatePlain(tmpl.body, variables, lists, { lists: TEMPLATE_LIST_NAMES })).toBe(legacy(tmpl.body));
      expect(() => extractTemplateVariables(tmpl.body, { lists: TEMPLATE_LIST_NAMES })).not.toThrow();
    }
  });
});
