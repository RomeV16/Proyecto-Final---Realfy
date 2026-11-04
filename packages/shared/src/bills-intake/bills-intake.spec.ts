import { BillChannel, BillDocumentStatus, ServiceType } from '../enums';
import { CreateServiceSchema } from '../schemas/service.schema';
import { DEFAULT_OPERATIONAL_DEFAULTS, OperationalDefaultsSchema } from '../schemas/operational-defaults.schema';
import {
  AcceptBillDocumentSchema,
  BILL_PROVIDER_KEYS,
  BILL_PROVIDER_SERVICE_TYPES,
  BillDocumentFilterSchema,
  BillFetchingSettingsSchema,
  BillMailIngestSchema,
  BillProviderKeySchema,
  RejectBillDocumentSchema,
  SPECIFIC_BILL_PROVIDER_KEYS,
} from './index';

describe('catálogo de proveedores de boletas', () => {
  it('el genérico es el último y no es un proveedor específico; cada clave tiene sus tipos de servicio', () => {
    expect(BILL_PROVIDER_KEYS[BILL_PROVIDER_KEYS.length - 1]).toBe('generico');
    expect(SPECIFIC_BILL_PROVIDER_KEYS).not.toContain('generico');
    expect(Object.keys(BILL_PROVIDER_SERVICE_TYPES).sort((a, b) => a.localeCompare(b))).toEqual(
      [...BILL_PROVIDER_KEYS].sort((a, b) => a.localeCompare(b)),
    );
    expect(BILL_PROVIDER_SERVICE_TYPES['aguas-cordobesas']).toEqual([ServiceType.Agua]);
    expect(BillProviderKeySchema.safeParse('otro').success).toBe(false);
  });
});

describe('obtención por consulta (operationalDefaults.billFetching)', () => {
  it('de fábrica está apagada y sin proveedores', () => {
    expect(DEFAULT_OPERATIONAL_DEFAULTS.billFetching).toEqual({ enabled: false, providers: [] });
    expect(BillFetchingSettingsSchema.parse({})).toEqual({ enabled: false, providers: [] });
  });

  it('acepta proveedores específicos sin repetir y rechaza el genérico, repetidos y campos de más', () => {
    expect(OperationalDefaultsSchema.parse({ billFetching: { enabled: true, providers: ['muni-cordoba', 'epec'] } }).billFetching).toEqual({
      enabled: true,
      providers: ['muni-cordoba', 'epec'],
    });
    for (const bad of [{ providers: ['generico'] }, { providers: ['epec', 'epec'] }, { providers: ['otro'] }, { otro: 1 }, { enabled: 'si' }]) {
      expect(BillFetchingSettingsSchema.safeParse(bad).success).toBe(false);
    }
  });
});

describe('esquemas de los documentos de boletas', () => {
  it('el filtro valida estado y canal y da los valores de paginación de fábrica', () => {
    expect(BillDocumentFilterSchema.parse({ status: BillDocumentStatus.RequiereRevision, channel: BillChannel.Mail })).toMatchObject({ page: 1, limit: 30 });
    expect(BillDocumentFilterSchema.safeParse({ status: 'Otro' }).success).toBe(false);
    expect(BillDocumentFilterSchema.safeParse({ limit: 101 }).success).toBe(false);
    expect(BillDocumentFilterSchema.safeParse({ extra: 1 }).success).toBe(false);
  });

  it('aceptar admite correcciones opcionales y rechaza importes o fechas mal escritos', () => {
    expect(AcceptBillDocumentSchema.parse({})).toEqual({});
    expect(AcceptBillDocumentSchema.parse({ period: '2026-11', amount: 1234.5, dueDate: null })).toMatchObject({ amount: '1234.5', dueDate: null });
    for (const bad of [{ amount: '-1' }, { amount: '1,5' }, { period: '2026-13' }, { dueDate: '12/11/2026' }, { serviceId: 'x' }]) {
      expect(AcceptBillDocumentSchema.safeParse(bad).success).toBe(false);
    }
  });

  it('CP-1435 el mail acepta la marca automatic del servicio de recepción sin exigirla', () => {
    const base = { messageId: '<m@x>', from: 'no-reply@b.test', tenantSlug: 'demo' };
    expect(BillMailIngestSchema.safeParse({ ...base, automatic: true }).success).toBe(true);
    expect(BillMailIngestSchema.safeParse(base).success).toBe(true);
    expect(BillMailIngestSchema.safeParse({ ...base, automatic: 'si' }).success).toBe(false);
  });

  it('rechazar exige un motivo', () => {
    expect(RejectBillDocumentSchema.safeParse({ reason: '  ' }).success).toBe(false);
    expect(RejectBillDocumentSchema.parse({ reason: ' No es una boleta ' })).toEqual({ reason: 'No es una boleta' });
  });

  it('el mail pide la inmobiliaria por slug o por dirección, tiene a lo sumo 10 adjuntos y da nombre de archivo de fábrica', () => {
    const base = { messageId: '<m@x>', from: 'a@b.test' };
    expect(BillMailIngestSchema.safeParse(base).success).toBe(false);
    expect(BillMailIngestSchema.parse({ ...base, to: 'boletas+demo@x.test', attachments: [{ contentBase64: 'QQ==' }] }).attachments[0].filename).toBe('boleta.pdf');
    expect(BillMailIngestSchema.safeParse({ ...base, tenantSlug: 'demo', attachments: Array.from({ length: 11 }, () => ({ contentBase64: 'QQ==' })) }).success).toBe(false);
  });

  it('un servicio puede declarar su proveedor del catálogo', () => {
    const base = { propertyId: '3f2504e0-4f89-41d3-9a0c-0305e82c3301', serviceType: ServiceType.Agua, amount: 1, dueDay: 1 };
    expect(CreateServiceSchema.parse({ ...base, providerKey: 'aguas-cordobesas' }).providerKey).toBe('aguas-cordobesas');
    expect(CreateServiceSchema.parse({ ...base, providerKey: null }).providerKey).toBeNull();
    expect(CreateServiceSchema.safeParse({ ...base, providerKey: 'otro' }).success).toBe(false);
  });
});
