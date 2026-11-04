import { createHmac } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { BillChannel, BillDocumentStatus, BillFetchResult, PropertyType, ServiceBillSource, UserRole } from '@realfy/shared';
import { AppModule } from '../../src/app.module';
import { S3Service } from '../../src/common/media/s3.service';
import { PrismaService } from '../../src/common/prisma/prisma.service';
import { BillFetchScheduler } from '../../src/modules/bills-intake/bill-fetch.scheduler';
import { BillFetcherRegistry } from '../../src/modules/bills-intake/bill-fetcher.registry';
import { NodePdfTextService, simplePdf } from '../../src/modules/bills-intake/bill-pdf.testing';
import { PdfTextService } from '../../src/modules/bills-intake/pdf-text.service';
import { muniCurrentLines, rentasCurrentLines } from '../../src/modules/bills-intake/providers/bill-text.testing';
import { cleanDatabase, createUserDirect, loginUser, registerUser } from '../helpers/test-utils';

const PASSWORD = 'Password123!';
const SECRET = 'secreto-casilla-de-boletas';

/** Mes de hoy y el siguiente, para que la boleta caiga dentro de la ventana de plausibilidad. */
function currentCedulon(over: { amount?: string; objeto?: string } = {}) {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() + 1;
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  const venc = `14/${String(nextMonth).padStart(2, '0')}/${nextYear}`;
  return {
    period: `${year}-${String(month).padStart(2, '0')}`,
    pdf: simplePdf(muniCurrentLines({ objeto: over.objeto ?? 'I0000001', year, cuota: month, venc: [{ date: venc, amount: over.amount ?? '$12.345,67' }] })),
  };
}

/**
 * Obtención automática de boletas (ADR-0018): subida de PDF, ingreso por mail firmado, cola
 * de revisión y consulta diaria a los proveedores. El almacenamiento de objetos es uno en
 * memoria y el texto del PDF se lee con unpdf en un proceso de Node aparte.
 */
describe('Obtención automática de boletas (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const stored = new Map<string, Buffer>();
  let savedSecret: string | undefined;

  beforeAll(async () => {
    savedSecret = process.env.INBOX_EMAIL_INGEST_SECRET;
    const fakeS3 = {
      upload: jest.fn(async (key: string, body: Buffer) => void stored.set(key, body)),
      getPresignedUrl: jest.fn(async (key: string) => `https://storage.test/${key}?sig=abc`),
    };
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(S3Service)
      .useValue(fakeS3)
      .overrideProvider(PdfTextService)
      .useValue(new NodePdfTextService())
      .compile();
    app = moduleRef.createNestApplication({ rawBody: true });
    app.setGlobalPrefix('api');
    await app.init();
    prisma = moduleRef.get(PrismaService);
  });

  afterAll(async () => {
    if (savedSecret === undefined) delete process.env.INBOX_EMAIL_INGEST_SECRET;
    else process.env.INBOX_EMAIL_INGEST_SECRET = savedSecret;
    await cleanDatabase(prisma);
    await app.close();
  });

  beforeEach(async () => {
    process.env.INBOX_EMAIL_INGEST_SECRET = SECRET;
    stored.clear();
    await cleanDatabase(prisma);
  });

  const http = () => request(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const get = (token: string, path: string) => http().get(`/api${path}`).set(auth(token));
  const post = (token: string, path: string, body: object = {}) => http().post(`/api${path}`).set(auth(token)).send(body);
  const upload = (token: string, files: { name: string; content: Buffer; type?: string }[]) => {
    const req = http().post('/api/bills-intake/documents').set(auth(token));
    for (const f of files) req.attach('files', f.content, { filename: f.name, contentType: f.type ?? 'application/pdf' });
    return req;
  };

  async function agency(tag: string) {
    const admin = await registerUser(app, { email: `admin@${tag}.test`, password: PASSWORD, firstName: 'Admin', lastName: 'Prueba' });
    const tenantId = admin.user.tenantId as string;
    const slug = `inmo-${tag}`;
    await http().patch(`/api/tenants/${tenantId}`).set(auth(admin.accessToken)).send({ slug }).expect(200);
    const tokens = { [UserRole.Admin]: admin.accessToken } as Record<UserRole, string>;
    for (const role of Object.values(UserRole).filter((r) => r !== UserRole.Admin)) {
      const email = `${role.toLowerCase()}@${tag}.test`;
      await createUserDirect(prisma, tenantId, { email, password: PASSWORD, role });
      tokens[role] = (await loginUser(app, email, PASSWORD)).accessToken;
    }
    return { tenantId, slug, tokens, token: tokens[UserRole.Admin] };
  }

  async function createService(token: string, extra: Record<string, unknown> = {}) {
    const property = (await post(token, '/properties', { title: 'Unidad de prueba', type: PropertyType.Departamento }).expect(201)).body.id;
    const res = await post(token, '/services', {
      propertyId: property,
      serviceType: 'Municipal',
      providerKey: 'muni-cordoba',
      accountNumber: 'I0000001',
      amount: 1000,
      dueDay: 10,
      ...extra,
    }).expect(201);
    return res.body as { id: string; accountNumber: string; providerKey: string };
  }

  describe('servicio con proveedor del catálogo', () => {
    it('guarda el identificador normalizado y rechaza uno fuera de formato o de otro tipo de servicio', async () => {
      const { token } = await agency('a');
      const ok = await createService(token, { providerKey: 'rentas-cordoba', serviceType: 'ImpuestoInmobiliario', accountNumber: '1100-00000001' });
      expect(ok).toMatchObject({ providerKey: 'rentas-cordoba', accountNumber: '110000000001' });

      const property = (await post(token, '/properties', { title: 'Otra', type: PropertyType.Departamento }).expect(201)).body.id;
      const bad = await post(token, '/services', { propertyId: property, serviceType: 'ImpuestoInmobiliario', providerKey: 'rentas-cordoba', accountNumber: '123', amount: 1, dueDay: 1 });
      expect(bad.status).toBe(400);
      expect(bad.body.error).toBe('INVALID_PROVIDER_ACCOUNT');
      const mismatch = await post(token, '/services', { propertyId: property, serviceType: 'Gas', providerKey: 'rentas-cordoba', accountNumber: '110000000001', amount: 1, dueDay: 1 });
      expect(mismatch.body.error).toBe('PROVIDER_SERVICE_TYPE_MISMATCH');
      const unknown = await post(token, '/services', { propertyId: property, serviceType: 'Gas', providerKey: 'inexistente', amount: 1, dueDay: 1 });
      expect(unknown.status).toBe(400);
    });

    it('CP-1322 al cambiar el proveedor o la cuenta se valida contra lo que ya había', async () => {
      const { token } = await agency('a');
      const svc = await createService(token, { accountNumber: undefined });
      const res = await http().patch(`/api/services/${svc.id}`).set(auth(token)).send({ accountNumber: '12-14-009-028' }).expect(200);
      expect(res.body.accountNumber).toBe('121400902800000');
      const bad = await http().patch(`/api/services/${svc.id}`).set(auth(token)).send({ accountNumber: '12' });
      expect(bad.body.error).toBe('INVALID_PROVIDER_ACCOUNT');
    });
  });

  describe('archivo: POST /bills-intake/documents', () => {
    it('da de alta la boleta, la deja Automatica ligada al documento, guarda el PDF y es idempotente', async () => {
      const { token } = await agency('a');
      const svc = await createService(token);
      const { period, pdf } = currentCedulon();

      const first = await upload(token, [{ name: 'cedulon.pdf', content: pdf }]).expect(200);
      expect(first.body.results[0]).toMatchObject({ fileName: 'cedulon.pdf', duplicate: false, status: BillDocumentStatus.Procesada, reason: null });
      const documentId = first.body.results[0].id;
      expect(stored.size).toBe(1);

      const bills = (await get(token, `/service-bills?serviceId=${svc.id}`).expect(200)).body.items;
      expect(bills).toHaveLength(1);
      expect(bills[0]).toMatchObject({ status: 'Pendiente', amount: '12345.67' });
      const bill = (await get(token, `/service-bills/${bills[0].id}`).expect(200)).body;
      expect(bill).toMatchObject({ source: ServiceBillSource.Automatica, documentId });
      expect(bill.period.startsWith(period)).toBe(true);

      const again = await upload(token, [{ name: 'otra-copia.pdf', content: pdf }]).expect(200);
      expect(again.body.results[0]).toMatchObject({ duplicate: true, id: documentId, status: BillDocumentStatus.Procesada });
      expect((await get(token, `/service-bills?serviceId=${svc.id}`)).body.total).toBe(1);

      const detail = (await get(token, `/bills-intake/documents/${documentId}`).expect(200)).body;
      expect(detail).toMatchObject({ channel: BillChannel.Archivo, providerKey: 'muni-cordoba', accountNumber: 'I0000001', serviceId: svc.id, hasFile: true });
      expect(detail.bills).toHaveLength(1);
      expect(detail.storageKey).toBeUndefined();
      expect(detail.data.lines).toHaveLength(1);
      const file = await get(token, `/bills-intake/documents/${documentId}/file`).expect(200);
      expect(file.body.url).toContain('https://storage.test/bill-documents/');
    });

    it('CP-1327 un servicio importado con la cuenta en otro formato encuentra la boleta cuyo PDF la trae distinto', async () => {
      const { token } = await agency('a');
      const batch = {
        dryRun: false,
        properties: [{ externalRef: 'U-1', type: 'Departamento', street: 'Calle Falsa', number: '123', city: 'Cordoba' }],
        services: [
          { externalRef: 'SRV-muni', propertyRef: 'U-1', serviceType: 'Municipal', providerKey: 'muni-cordoba', accountNumber: ' 0123456789-01200 ', amount: 1000, dueDay: 10 },
        ],
      };
      const imported = await post(token, '/import/batches', batch).expect(201);
      expect(imported.body.counts.errors).toBe(0);
      const svc = await prisma.baseClient.service.findFirstOrThrow({ where: { externalRef: 'SRV-muni' } });
      expect(svc.accountNumber).toBe('012345678901200');

      const { pdf } = currentCedulon({ objeto: 'I0000777' });
      const res = await upload(token, [{ name: 'cedulon.pdf', content: pdf }]).expect(200);
      expect(res.body.results[0]).toMatchObject({ status: BillDocumentStatus.Procesada, reason: null });
      expect((await get(token, `/service-bills?serviceId=${svc.id}`)).body.total).toBe(1);
    });

    it('una boleta sin servicio coincidente queda en revisión y se acepta con el servicio elegido y correcciones', async () => {
      const { token } = await agency('a');
      const svc = await createService(token, { accountNumber: 'I0000999' });
      const { pdf } = currentCedulon();

      const res = await upload(token, [{ name: 'cedulon.pdf', content: pdf }]).expect(200);
      expect(res.body.results[0]).toMatchObject({ status: BillDocumentStatus.RequiereRevision, reason: 'NO_MATCHING_SERVICE' });
      const id = res.body.results[0].id;

      const queue = (await get(token, '/bills-intake/documents?status=RequiereRevision').expect(200)).body;
      expect(queue).toMatchObject({ total: 1, page: 1 });
      expect(queue.items[0]).toMatchObject({ id, reason: 'NO_MATCHING_SERVICE', providerKey: 'muni-cordoba' });

      expect((await post(token, `/bills-intake/documents/${id}/accept`, {}).expect(400)).body.error).toBe('SERVICE_REQUIRED');
      expect((await post(token, `/bills-intake/documents/${id}/accept`, { serviceId: svc.id, amount: '0' }).expect(400)).body.error).toBe('INVALID_AMOUNT');
      const accepted = await post(token, `/bills-intake/documents/${id}/accept`, { serviceId: svc.id, amount: '12000.50', installmentLabel: 'Cuota corregida' }).expect(200);
      expect(accepted.body).toMatchObject({ status: BillDocumentStatus.Procesada, reason: null, serviceId: svc.id });
      expect(accepted.body.reviewedById).toEqual(expect.any(String));
      expect(accepted.body.bills).toHaveLength(1);
      expect(accepted.body.bills[0]).toMatchObject({ amount: '12000.5', installmentLabel: 'Cuota corregida' });

      expect((await post(token, `/bills-intake/documents/${id}/accept`, { serviceId: svc.id }).expect(409)).body.error).toBe('DOCUMENT_NOT_REVIEWABLE');
      expect((await post(token, `/bills-intake/documents/${id}/reject`, { reason: 'x' }).expect(409)).body.error).toBe('DOCUMENT_NOT_REVIEWABLE');
    });

    it('una boleta existente con otro importe nunca se pisa: va a revisión y aceptarla da 409', async () => {
      const { token } = await agency('a');
      const svc = await createService(token);
      const { period, pdf } = currentCedulon();
      await post(token, '/service-bills/bulk', [{ serviceId: svc.id, period, amount: '999.00' }]).expect(200);

      const res = await upload(token, [{ name: 'cedulon.pdf', content: pdf }]).expect(200);
      expect(res.body.results[0]).toMatchObject({ status: BillDocumentStatus.RequiereRevision, reason: 'BILL_EXISTS_DIFFERENT_AMOUNT' });
      const bills = (await get(token, `/service-bills?serviceId=${svc.id}`)).body.items;
      expect(bills).toHaveLength(1);
      expect(bills[0].amount).toBe('999');

      const conflict = await post(token, `/bills-intake/documents/${res.body.results[0].id}/accept`, {}).expect(409);
      expect(conflict.body.error).toBe('BILL_ALREADY_EXISTS');
    });

    it('la misma boleta con el mismo importe en otro archivo queda Duplicada', async () => {
      const { token } = await agency('a');
      const svc = await createService(token);
      const { period, pdf } = currentCedulon();
      await post(token, '/service-bills/bulk', [{ serviceId: svc.id, period, amount: '12345.67' }]).expect(200);
      const res = await upload(token, [{ name: 'cedulon.pdf', content: pdf }]).expect(200);
      expect(res.body.results[0]).toMatchObject({ status: BillDocumentStatus.Duplicada, reason: null });
      expect((await get(token, `/service-bills?serviceId=${svc.id}`)).body.total).toBe(1);
    });

    it('rechaza un documento en revisión con el motivo y deja los filtros y la paginación', async () => {
      const { token } = await agency('a');
      const a = await upload(token, [{ name: 'a.pdf', content: simplePdf(['Texto cualquiera A']) }]).expect(200);
      await upload(token, [{ name: 'b.pdf', content: simplePdf(['Texto cualquiera B']) }]).expect(200);
      expect(a.body.results[0]).toMatchObject({ status: BillDocumentStatus.RequiereRevision, reason: 'UNKNOWN_PROVIDER' });

      expect((await post(token, `/bills-intake/documents/${a.body.results[0].id}/reject`, {}).expect(400)).body.error).toBeDefined();
      const rejected = await post(token, `/bills-intake/documents/${a.body.results[0].id}/reject`, { reason: 'No es una boleta' }).expect(200);
      expect(rejected.body).toMatchObject({ status: BillDocumentStatus.Rechazada, reason: 'No es una boleta' });

      expect((await get(token, '/bills-intake/documents?status=Rechazada')).body.total).toBe(1);
      expect((await get(token, '/bills-intake/documents?channel=Archivo')).body.total).toBe(2);
      expect((await get(token, '/bills-intake/documents?channel=Mail')).body.total).toBe(0);
      const page = await get(token, '/bills-intake/documents?limit=1&page=2').expect(200);
      expect(page.body).toMatchObject({ total: 2, totalPages: 2, page: 2 });
      expect(page.body.items).toHaveLength(1);
      expect((await get(token, '/bills-intake/documents?status=Inexistente')).status).toBe(400);
    });

    it('varios PDF en un pedido, y los archivos que no son PDF se informan sin frenar a los demás', async () => {
      const { token } = await agency('a');
      await createService(token);
      const res = await upload(token, [
        { name: 'cedulon.pdf', content: currentCedulon().pdf },
        { name: 'falso.pdf', content: Buffer.from('no soy un pdf') },
        { name: 'rentas.pdf', content: simplePdf(rentasCurrentLines()) },
      ]).expect(200);
      expect(res.body.total).toBe(3);
      expect(res.body.results[0].status).toBe(BillDocumentStatus.Procesada);
      expect(res.body.results[1]).toEqual({ fileName: 'falso.pdf', error: { code: 'NOT_A_PDF', message: expect.any(String) } });
      expect(res.body.results[2].status).toBe(BillDocumentStatus.RequiereRevision);
    });

    it('sin archivos es 400 y un id inexistente es 404', async () => {
      const { token } = await agency('a');
      expect((await http().post('/api/bills-intake/documents').set(auth(token)).expect(400)).body.error).toBe('FILE_REQUIRED');
      expect((await get(token, '/bills-intake/documents/00000000-0000-4000-8000-000000000000').expect(404)).body.error).toBe('DOCUMENT_NOT_FOUND');
      await get(token, '/bills-intake/documents/no-es-uuid').expect(400);
    });

    it('un mensaje sin PDF no tiene archivo que descargar', async () => {
      const { token, slug } = await agency('a');
      const res = await mail({ tenantSlug: slug, messageId: '<sin-adjunto@demo.test>', from: 'proveedor@demo.test', attachments: [] }).expect(200);
      expect((await get(token, `/bills-intake/documents/${res.body.documents[0].id}/file`).expect(404)).body.error).toBe('DOCUMENT_FILE_NOT_FOUND');
    });
  });

  describe('RBAC', () => {
    it('suben, aceptan y rechazan Admin, Gerente y Liquidaciones; leen además Lectura; el resto no entra', async () => {
      const { tokens } = await agency('a');
      const writers = [UserRole.Admin, UserRole.Gerente, UserRole.Liquidaciones];
      const readers = [...writers, UserRole.Lectura];
      for (const role of Object.values(UserRole)) {
        const canWrite = writers.includes(role);
        const canRead = readers.includes(role);
        const pdf = simplePdf([`Texto de ${role}`]);
        const up = await upload(tokens[role], [{ name: 'x.pdf', content: pdf }]);
        expect([role, up.status]).toEqual([role, canWrite ? 200 : 403]);
        expect([role, (await get(tokens[role], '/bills-intake/documents')).status]).toEqual([role, canRead ? 200 : 403]);
        expect([role, (await post(tokens[role], '/bills-intake/documents/00000000-0000-4000-8000-000000000000/reject', { reason: 'x' })).status]).toEqual([
          role,
          canWrite ? 404 : 403,
        ]);
      }
      await http().get('/api/bills-intake/documents').expect(401);
    });
  });

  describe('aislamiento entre inmobiliarias', () => {
    it('otra inmobiliaria no ve, acepta ni rechaza el documento; el mismo PDF en cada una es un documento propio', async () => {
      const a = await agency('a');
      const b = await agency('b');
      await createService(a.token);
      const { pdf } = currentCedulon();
      const inA = (await upload(a.token, [{ name: 'c.pdf', content: pdf }]).expect(200)).body.results[0];

      expect((await get(b.token, `/bills-intake/documents/${inA.id}`)).status).toBe(404);
      expect((await get(b.token, `/bills-intake/documents/${inA.id}/file`)).status).toBe(404);
      expect((await post(b.token, `/bills-intake/documents/${inA.id}/reject`, { reason: 'x' })).status).toBe(404);
      expect((await get(b.token, '/bills-intake/documents')).body.total).toBe(0);

      // B no tiene el servicio: su documento es otro, no un duplicado del de A, y no toca las boletas de A.
      const inB = (await upload(b.token, [{ name: 'c.pdf', content: pdf }]).expect(200)).body.results[0];
      expect(inB).toMatchObject({ duplicate: false, status: BillDocumentStatus.RequiereRevision, reason: 'NO_MATCHING_SERVICE' });
      expect(inB.id).not.toBe(inA.id);
      const serviceOfA = (await get(a.token, '/services').expect(200)).body.items[0];
      expect((await post(b.token, `/bills-intake/documents/${inB.id}/accept`, { serviceId: serviceOfA.id })).status).toBe(404);
      expect((await get(a.token, '/service-bills')).body.total).toBe(1);
    });

    it('la cuenta de un servicio de otra inmobiliaria no se usa para dar de alta la boleta', async () => {
      const a = await agency('a');
      const b = await agency('b');
      await createService(a.token);
      const res = (await upload(b.token, [{ name: 'c.pdf', content: currentCedulon().pdf }]).expect(200)).body.results[0];
      expect(res.reason).toBe('NO_MATCHING_SERVICE');
      expect((await get(a.token, '/service-bills')).body.total).toBe(0);
    });
  });

  describe('mail: POST /bills-intake/email-ingest', () => {
    it('con la firma válida procesa el PDF adjunto con canal Mail; el reenvío no duplica', async () => {
      const { token, slug } = await agency('a');
      const svc = await createService(token);
      const body = {
        tenantSlug: slug,
        messageId: '<m1@proveedor.test>',
        from: 'facturas@proveedor.test',
        subject: 'Su cedulón',
        attachments: [{ filename: 'cedulon.pdf', contentType: 'application/pdf', contentBase64: currentCedulon().pdf.toString('base64') }],
      };
      const res = await mail(body).expect(200);
      expect(res.body.received).toBe(true);
      expect(res.body.documents[0]).toMatchObject({ status: BillDocumentStatus.Procesada });
      const doc = (await get(token, `/bills-intake/documents/${res.body.documents[0].id}`).expect(200)).body;
      expect(doc).toMatchObject({ channel: BillChannel.Mail, origin: 'facturas@proveedor.test' });

      await mail(body).expect(200);
      expect((await get(token, `/service-bills?serviceId=${svc.id}`)).body.total).toBe(1);
      expect((await get(token, '/bills-intake/documents')).body.total).toBe(1);
    });

    it('la inmobiliaria también sale de la dirección boletas+slug@', async () => {
      const { token, slug } = await agency('a');
      await mail({ to: `boletas+${slug}@realfy.test`, messageId: '<m2@proveedor.test>', from: 'facturas@proveedor.test', attachments: [] }).expect(200);
      expect((await get(token, '/bills-intake/documents?status=RequiereRevision')).body.total).toBe(1);
    });

    it('sin PDF adjunto queda en revisión como NO_ATTACHMENT, una sola vez por mensaje', async () => {
      const { token, slug } = await agency('a');
      const body = { tenantSlug: slug, messageId: '<m3@proveedor.test>', from: 'facturas@proveedor.test', subject: 'Mire el link', attachments: [{ filename: 'foto.png', contentBase64: Buffer.from('png').toString('base64') }] };
      await mail(body).expect(200);
      await mail(body).expect(200);
      const queue = (await get(token, '/bills-intake/documents?status=RequiereRevision')).body;
      expect(queue.total).toBe(1);
      expect(queue.items[0]).toMatchObject({ reason: 'NO_ATTACHMENT', channel: BillChannel.Mail });
    });

    it('rechaza con 401 la firma ajena, alterada o ausente, y todo si no hay secreto configurado', async () => {
      const { slug } = await agency('a');
      const body = { tenantSlug: slug, messageId: '<m4@proveedor.test>', from: 'facturas@proveedor.test', attachments: [] };
      await mail(body, 'otro-secreto').expect(401);
      await mail(body, undefined, { tamper: true }).expect(401);
      await http().post('/api/bills-intake/email-ingest').send(body).expect(401);
      delete process.env.INBOX_EMAIL_INGEST_SECRET;
      await mail(body, '').expect(401);
      const { body: docs } = await get((await agency('z')).token, '/bills-intake/documents');
      expect(docs.total).toBe(0);
    });

    it('inmobiliaria desconocida 404 y cuerpo inválido 400', async () => {
      const { slug, token } = await agency('a');
      await mail({ tenantSlug: 'no-existe', messageId: '<m5>', from: 'a@b.test', attachments: [] }).expect(404);
      await mail({ tenantSlug: slug }).expect(400);
      expect((await get(token, '/bills-intake/documents')).body.total).toBe(0);
    });

    it('CP-1434 el PDF de un remitente no-reply entra al circuito aunque venga marcado automatic', async () => {
      const { slug, token } = await agency('a');
      const pdf = currentCedulon().pdf.toString('base64');
      const res = await mail({ tenantSlug: slug, messageId: '<m6>', from: 'no-reply@proveedor.test', automatic: true, attachments: [{ filename: 'c.pdf', contentBase64: pdf }] }).expect(200);
      expect(res.body.ignored).toBeUndefined();
      expect(res.body.documents).toHaveLength(1);
      const docs = (await get(token, '/bills-intake/documents')).body;
      expect(docs.total).toBe(1);
      expect(docs.items[0].origin).toBe('no-reply@proveedor.test');
    });

    it('el aislamiento se mantiene: el PDF cae en la inmobiliaria de la casilla', async () => {
      const a = await agency('a');
      const b = await agency('b');
      await createService(a.token);
      await mail({ tenantSlug: b.slug, messageId: '<m7>', from: 'facturas@proveedor.test', attachments: [{ filename: 'c.pdf', contentBase64: currentCedulon().pdf.toString('base64') }] }).expect(200);
      expect((await get(a.token, '/bills-intake/documents')).body.total).toBe(0);
      expect((await get(b.token, '/bills-intake/documents')).body.total).toBe(1);
      expect((await get(a.token, '/service-bills')).body.total).toBe(0);
    });
  });

  describe('consulta diaria a los proveedores', () => {
    const fakeFetcher = (pdfs: Buffer[] | Error) => ({
      providerKey: 'muni-cordoba' as const,
      fetch: jest.fn(async () => {
        if (pdfs instanceof Error) throw pdfs;
        return pdfs.map((content, i) => ({ fileName: `consulta-${i}.pdf`, content }));
      }),
    });

    afterEach(() => app.get(BillFetcherRegistry).unregister('muni-cordoba'));

    it('apagada de fábrica no consulta ni registra corridas', async () => {
      const { token } = await agency('a');
      await createService(token);
      const fetcher = fakeFetcher([currentCedulon().pdf]);
      app.get(BillFetcherRegistry).register(fetcher);
      expect((await get(token, '/tenants/me/operational-defaults').expect(200)).body.billFetching).toEqual({ enabled: false, providers: [] });
      await expect(app.get(BillFetchScheduler).runAllTenants()).resolves.toMatchObject({ attempts: 0, documents: 0 });
      expect(fetcher.fetch).not.toHaveBeenCalled();
      expect(await prisma.baseClient.billFetchRun.count()).toBe(0);
    });

    it('habilitada: consulta los servicios del proveedor, el documento entra al circuito y se registra la corrida', async () => {
      const { token, tenantId } = await agency('a');
      const svc = await createService(token);
      const body = (await get(token, '/tenants/me/operational-defaults').expect(200)).body;
      await http().put('/api/tenants/me/operational-defaults').set(auth(token)).send({ ...body, billFetching: { enabled: true, providers: ['muni-cordoba'] } }).expect(200);
      const fetcher = fakeFetcher([currentCedulon().pdf]);
      app.get(BillFetcherRegistry).register(fetcher);

      const first = await app.get(BillFetchScheduler).runAllTenants();
      expect(first).toMatchObject({ tenantsProcessed: 1, attempts: 1, documents: 1 });
      expect((await get(token, `/service-bills?serviceId=${svc.id}`)).body.total).toBe(1);
      const docs = (await get(token, '/bills-intake/documents?channel=Consulta')).body;
      expect(docs.total).toBe(1);

      await app.get(BillFetchScheduler).runAllTenants();
      const runs = await prisma.baseClient.billFetchRun.findMany({ where: { tenantId }, orderBy: { startedAt: 'asc' } });
      expect(runs.map((r) => r.result)).toEqual([BillFetchResult.Ok, BillFetchResult.SinNovedad]);
      expect(runs[0]).toMatchObject({ serviceId: svc.id, providerKey: 'muni-cordoba', channel: BillChannel.Consulta, documents: 1, errorCode: null });
      expect(runs[0].finishedAt).not.toBeNull();
    });

    it('un fallo del conector queda registrado como Error y no corta la vuelta', async () => {
      const { token, tenantId } = await agency('a');
      await createService(token);
      const body = (await get(token, '/tenants/me/operational-defaults')).body;
      await http().put('/api/tenants/me/operational-defaults').set(auth(token)).send({ ...body, billFetching: { enabled: true, providers: ['muni-cordoba'] } }).expect(200);
      app.get(BillFetcherRegistry).register(fakeFetcher(new Error('sin conexión')));
      await expect(app.get(BillFetchScheduler).runAllTenants()).resolves.toMatchObject({ attempts: 1, documents: 0 });
      const run = await prisma.baseClient.billFetchRun.findFirstOrThrow({ where: { tenantId } });
      expect(run).toMatchObject({ result: BillFetchResult.Error, errorCode: 'FETCH_FAILED', errorMessage: 'sin conexión' });
    });

    it('la configuración se valida y el formulario de valores por defecto no la borra', async () => {
      const { token } = await agency('a');
      const body = (await get(token, '/tenants/me/operational-defaults')).body;
      await http().put('/api/tenants/me/operational-defaults').set(auth(token)).send({ ...body, billFetching: { enabled: true, providers: ['generico'] } }).expect(400);
      await http().put('/api/tenants/me/operational-defaults').set(auth(token)).send({ ...body, billFetching: { enabled: true, providers: ['epec', 'epec'] } }).expect(400);
      await http().put('/api/tenants/me/operational-defaults').set(auth(token)).send({ ...body, billFetching: { enabled: true, providers: ['epec'] } }).expect(200);
      const { billFetching, ...withoutIt } = body;
      expect(billFetching).toEqual({ enabled: false, providers: [] });
      await http().put('/api/tenants/me/operational-defaults').set(auth(token)).send({ ...withoutIt, dueDay: 7 }).expect(200);
      const after = (await get(token, '/tenants/me/operational-defaults')).body;
      expect(after).toMatchObject({ dueDay: 7, billFetching: { enabled: true, providers: ['epec'] } });
    });
  });

  /** POST /bills-intake/email-ingest con la firma del secreto compartido con la bandeja. */
  function mail(body: object, secret: string | undefined = SECRET, opts: { tamper?: boolean } = {}) {
    const raw = JSON.stringify(body);
    const signature = `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`;
    return http()
      .post('/api/bills-intake/email-ingest')
      .set('Content-Type', 'application/json')
      .set('X-Realfy-Signature', opts.tamper ? `${signature.slice(0, -1)}0` : signature)
      .send(raw);
  }
});
