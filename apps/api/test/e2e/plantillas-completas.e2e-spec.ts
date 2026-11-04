import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { setupTestApp, cleanDatabase, teardownTestApp, registerUser } from '../helpers/test-utils';
import { PrismaService } from '../../src/common/prisma/prisma.service';
import { docxParagraphs } from '../../src/modules/contract-templates/docx.testing';
import { PersonRole, PropertyType, ServiceType } from '@realfy/shared';

/**
 * Plantillas de contrato con listas, condicionales y las variables nuevas.
 * Contrato sintético: 2 locatarios, 2 garantes, 2 locadores, depósito, canon ajustado.
 */
describe('Plantillas de contrato completas (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    const setup = await setupTestApp();
    app = setup.app;
    prisma = setup.prisma;
  });

  afterAll(async () => {
    await cleanDatabase(prisma);
    await teardownTestApp();
  });

  beforeEach(async () => {
    await cleanDatabase(prisma);
  });

  const api = (token: string) => ({
    post: (url: string) => request(app.getHttpServer()).post(`/api${url}`).set('Authorization', `Bearer ${token}`),
    patch: (url: string) => request(app.getHttpServer()).patch(`/api${url}`).set('Authorization', `Bearer ${token}`),
    get: (url: string) => request(app.getHttpServer()).get(`/api${url}`).set('Authorization', `Bearer ${token}`),
  });

  async function setup(prefix: string) {
    const admin = await registerUser(app, {
      email: `${prefix}-${Date.now()}@test.com`,
      password: 'Password123!',
      firstName: 'Admin',
      lastName: 'Demo',
    });
    const http = api(admin.accessToken);

    const person = async (firstName: string, lastName: string, role: PersonRole, extra: Record<string, unknown>) => {
      const id = (await http.post('/persons').send({ firstName, lastName, ...extra }).expect(201)).body.id as string;
      await http.post(`/persons/${id}/roles`).send({ role }).expect(201);
      return id;
    };

    const property = (
      await http
        .post('/properties')
        .send({
          title: 'Depto Demo',
          type: PropertyType.Departamento,
          street: 'Calle Ficticia',
          number: '123',
          city: 'Ciudad Demo',
          province: 'Córdoba',
          description: 'Consta de living, cocina y dos dormitorios.',
          cadastralId: '01-02-003-004',
        })
        .expect(201)
    ).body;
    await http
      .post('/services')
      .send({ propertyId: property.id, serviceType: ServiceType.ImpuestoInmobiliario, accountNumber: '0100-200', amount: 1000, dueDay: 10 })
      .expect(201);
    await http
      .post('/services')
      .send({ propertyId: property.id, serviceType: ServiceType.Agua, accountNumber: 'U-55', amount: 1000, dueDay: 10 })
      .expect(201);

    const locadorA = await person('Ana', 'Locadora', PersonRole.Propietario, { dni: '10000001', cuit: '27-10000001-1' });
    const locadorB = await person('Beto', 'Locador', PersonRole.Propietario, { dni: '10000002' });
    const locatarioA = await person('Ines', 'Locataria', PersonRole.Inquilino, { dni: '30123456', cuit: '27-30123456-8', address: 'Calle Uno 1' });
    const locatarioB = await person('Nico', 'Locatario', PersonRole.Inquilino, { dni: '30123457' });
    const garanteA = await person('Gus', 'Garante', PersonRole.Garante, { dni: '6678901', cuit: '20-06678901-3', address: 'Calle Dos 2' });
    const garanteB = await person('Gina', 'Garante', PersonRole.Garante, { dni: '10000003' });

    const contract = (
      await http
        .post('/contracts')
        .send({
          propertyId: property.id,
          contractType: 'Alquiler',
          status: 'Activo',
          startDate: '2026-07-01T00:00:00.000Z',
          endDate: '2028-06-30T00:00:00.000Z',
          rentAmount: '590000.00',
          rentCurrency: 'ARS',
          depositAmount: '590000.00',
          depositCurrency: 'ARS',
          adjustmentType: 'IPC',
          adjustmentPeriod: 'Trimestral',
          lessors: [
            { personId: locadorA, capacity: 'Propietario', payoutPct: '60' },
            { personId: locadorB, capacity: 'Propietario', payoutPct: '40' },
          ],
          persons: [
            { personId: locatarioA, role: 'Inquilino' },
            { personId: locatarioB, role: 'Inquilino' },
            { personId: garanteA, role: 'Garante' },
            { personId: garanteB, role: 'Garante' },
          ],
        })
        .expect(201)
    ).body;

    const tenantId = (await http.get('/tenants/me').expect(200)).body.id as string;
    return { http, contract, tenantId };
  }

  const create = async (http: ReturnType<typeof api>, name: string, body: string) =>
    (await http.post('/contract-templates').send({ name, contractType: 'Alquiler', body }).expect(201)).body;

  const generate = async (http: ReturnType<typeof api>, contractId: string, templateId: string, extra: Record<string, unknown> = {}) => {
    const res = await http
      .post(`/contracts/${contractId}/generate-document`)
      .send({ templateId, format: 'docx', ...extra })
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      })
      .expect(200);
    return docxParagraphs(res.body as Buffer);
  };

  it('CP-1160: un contrato con 2 locatarios, 2 garantes y 2 locadores se genera con listas y condicionales', async () => {
    const { http, contract } = await setup('cp1160');
    const body = [
      'LOCADORES:',
      '{{#cada locadores como l}}',
      '{{l.nombreCompleto}}, DNI {{l.dniConPuntos}} ({{l.porcentaje}}){{#si l.ultimo}}.{{#sino}};{{/si}}',
      '{{/cada}}',
      '{{#si inquilinos.cantidad > 1}}LOS LOCATARIOS{{#sino}}EL LOCATARIO{{/si}}: {{inquilinos.nombres}}.',
      '{{#cada inquilinos como i}}',
      '{{i.n}}) {{i.nombreCompleto}}, DNI {{i.dniConPuntos}}{{#si i.cuit}}, CUIT {{i.cuit}}{{/si}}{{#si i.domicilio}}, domicilio {{i.domicilio}}{{/si}}',
      '{{/cada}}',
      '{{#cada garantes como g}}',
      'Garante {{g.n}} de {{g.total}}: {{g.nombreCompleto}}, DNI {{g.dniConPuntos}}{{#si g.cuit}}, CUIT {{g.cuit}}{{/si}}{{#si g.domicilio}}, domicilio {{g.domicilio}}{{/si}}',
      '{{/cada}}',
      '{{#si contrato.deposito}}Depósito: {{contrato.deposito}} ({{contrato.depositoEnLetras}}).{{#sino}}Sin depósito.{{/si}}',
    ].join('\n');
    const template = await create(http, 'Completa', body);

    expect(template.variables).toEqual(expect.arrayContaining(['inquilinos.cantidad', 'inquilinos.nombres', 'contrato.deposito']));
    expect(template.variables).not.toContain('g.nombreCompleto');

    const lines = (await generate(http, contract.id, template.id)).filter(Boolean);
    expect(lines).toEqual(expect.arrayContaining([
      'LOCADORES:',
      'Ana Locadora, DNI 10.000.001 (60 %);',
      'Beto Locador, DNI 10.000.002 (40 %).',
      'LOS LOCATARIOS: Ines Locataria y Nico Locatario.',
      '1) Ines Locataria, DNI 30.123.456, CUIT 27-30123456-8, domicilio Calle Uno 1',
      '2) Nico Locatario, DNI 30.123.457',
      'Garante 1 de 2: Gus Garante, DNI 6.678.901, CUIT 20-06678901-3, domicilio Calle Dos 2',
      'Garante 2 de 2: Gina Garante, DNI 10.000.003',
      'Depósito: 590.000,00 (Quinientos noventa mil pesos).',
    ]));
  });

  it('CP-1161: variables del inmueble, la inmobiliaria, el canon inicial y los importes y fechas en letras', async () => {
    const { http, contract, tenantId } = await setup('cp1161');
    await http.patch(`/tenants/${tenantId}`).send({ licenseNumber: 'Mat. 1234', address: 'Calle Demo 100, Ciudad Demo' }).expect(200);
    // El contrato se ajustó: el canon vigente ya no es el inicial.
    await prisma.baseClient.contract.update({ where: { id: contract.id }, data: { rentAmount: '720000.00' } });

    const template = await create(
      http,
      'Variables',
      [
        'Inmueble: {{propiedad.direccionCompleta}}. {{propiedad.descripcion}}',
        'Catastro {{propiedad.catastro}}, Rentas {{propiedad.cuentaRentas}}, Aguas {{propiedad.unidadAguas}}.',
        'Administra {{inmobiliaria.nombre}}, matrícula {{inmobiliaria.matricula}}, domicilio {{inmobiliaria.domicilio}}.',
        'Canon inicial {{contrato.montoInicial}} ({{contrato.montoInicialEnLetras}}); vigente {{contrato.monto}} ({{contrato.montoEnLetras}}).',
        'Desde el {{contrato.fechaInicioEnLetras}} hasta el {{contrato.fechaFinEnLetras}}.',
        'Firmado el {{contrato.fechaFirma}}, {{contrato.fechaFirmaEnLetras}}.',
      ].join('\n'),
    );

    const lines = await generate(http, contract.id, template.id, { signingDate: '2026-06-20' });
    expect(lines).toEqual(expect.arrayContaining([
      'Inmueble: Calle Ficticia, 123, Ciudad Demo, Córdoba. Consta de living, cocina y dos dormitorios.',
      'Catastro 01-02-003-004, Rentas 0100-200, Aguas U-55.',
      expect.stringMatching(/^Administra .*, matrícula Mat\. 1234, domicilio Calle Demo 100, Ciudad Demo\.$/),
      'Canon inicial 590.000,00 (Quinientos noventa mil pesos); vigente 720.000,00 (Setecientos veinte mil pesos).',
      'Desde el primero de julio de dos mil veintiséis hasta el treinta de junio de dos mil veintiocho.',
      'Firmado el 20/06/2026, veinte de junio de dos mil veintiséis.',
    ]));

    const vars = (await http.get(`/contracts/${contract.id}/template-variables`).expect(200)).body;
    expect(vars['contrato.montoInicial']).toBe('590.000,00');
    expect(vars['inquilinos.cantidad']).toBe('2');
  });

  it('CP-1162: la fecha de firma que no se indica queda como etiqueta y una fecha inválida da 400', async () => {
    const { http, contract } = await setup('cp1162');
    const template = await create(http, 'Firma', 'Firma: {{contrato.fechaFirma}}');
    expect(await generate(http, contract.id, template.id)).toContain('Firma: {{contrato.fechaFirma}}');

    const res = await http.post(`/contracts/${contract.id}/generate-document`).send({ templateId: template.id, format: 'pdf', signingDate: '2026-02-31' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VALIDATION_ERROR');
  });

  it('CP-1163: una plantilla mal formada se rechaza al guardar con el error, la línea y la columna', async () => {
    const { http } = await setup('cp1163');
    const bad = async (body: string) =>
      http.post('/contract-templates').send({ name: `Mala-${Math.random()}`, contractType: 'Alquiler', body });

    const open = await bad('Hola\n  {{#si contrato.deposito}}sin cerrar');
    expect(open.status).toBe(400);
    expect(open.body.error).toBe('TEMPLATE_SYNTAX_ERROR');
    expect(open.body.details).toEqual({ code: 'UNCLOSED_BLOCK', line: 2, column: 3 });

    expect((await bad('{{/cada}}')).body.details.code).toBe('UNEXPECTED_CLOSE');
    expect((await bad('{{#cada fiadores}}x{{/cada}}')).body.details.code).toBe('UNKNOWN_LIST');
    expect((await bad('{{#si a > b}}x{{/si}}')).body.details.code).toBe('BAD_CONDITION');

    const ok = await create(http, 'Buena', 'x');
    const edit = await http.patch(`/contract-templates/${ok.id}`).send({ body: '{{#sino}}' });
    expect(edit.status).toBe(400);
    expect(edit.body.error).toBe('TEMPLATE_SYNTAX_ERROR');
    expect((await http.get(`/contract-templates/${ok.id}`).expect(200)).body.body).toBe('x');
  });

  it('CP-1164: las plantillas de antes siguen saliendo igual (solo variables) con varios locatarios', async () => {
    const { http, contract } = await setup('cp1164');
    const template = await create(http, 'Vieja', 'Locatario {{inquilino.nombreCompleto}} y garante {{garante.nombreCompleto}} y {{garante2.nombreCompleto}} {{contrato.noExiste}}');
    expect(await generate(http, contract.id, template.id)).toContain(
      'Locatario Ines Locataria y garante Gus Garante y Gina Garante {{contrato.noExiste}}',
    );
  });

  it('CP-1165: matrícula y domicilio de la inmobiliaria se guardan, se corrigen y se borran', async () => {
    const { http, tenantId } = await setup('cp1165');
    const saved = await http.patch(`/tenants/${tenantId}`).send({ licenseNumber: ' Mat. 9 ', address: 'Calle 1' }).expect(200);
    expect(saved.body.licenseNumber).toBe('Mat. 9');
    expect(saved.body.address).toBe('Calle 1');

    const untouched = await http.patch(`/tenants/${tenantId}`).send({ name: 'Inmobiliaria Demo 2' }).expect(200);
    expect(untouched.body.licenseNumber).toBe('Mat. 9');

    const cleared = await http.patch(`/tenants/${tenantId}`).send({ licenseNumber: '', address: null }).expect(200);
    expect(cleared.body.licenseNumber).toBeNull();
    expect(cleared.body.address).toBeNull();
    expect((await http.get('/tenants/me').expect(200)).body.address).toBeNull();
  });
});
