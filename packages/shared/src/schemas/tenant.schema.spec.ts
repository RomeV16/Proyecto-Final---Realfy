import { CreateTenantSchema, UpdateTenantSchema } from './tenant.schema';
import { GenerateDocumentSchema } from './contract-template.schema';

describe('UpdateTenantSchema: matrícula y domicilio', () => {
  it('los guarda sin espacios sobrantes', () => {
    expect(UpdateTenantSchema.parse({ licenseNumber: ' Mat. 1234 ', address: ' Calle Demo 100 ' })).toEqual({
      licenseNumber: 'Mat. 1234',
      address: 'Calle Demo 100',
    });
  });

  it('un valor vacío o nulo borra el dato; si no viene, no se toca', () => {
    expect(UpdateTenantSchema.parse({ licenseNumber: '', address: null })).toEqual({ licenseNumber: null, address: null });
    expect(UpdateTenantSchema.parse({ licenseNumber: '   ' })).toEqual({ licenseNumber: null });
    expect(UpdateTenantSchema.parse({ name: 'Inmobiliaria Demo' })).toEqual({ name: 'Inmobiliaria Demo' });
  });

  it('rechaza lo demasiado largo', () => {
    expect(() => UpdateTenantSchema.parse({ licenseNumber: 'x'.repeat(61) })).toThrow();
    expect(() => UpdateTenantSchema.parse({ address: 'x'.repeat(301) })).toThrow();
  });

  it('el alta los acepta opcionales', () => {
    const base = { name: 'Inmobiliaria Demo', cuit: '30-11111111-1', province: 'Córdoba' };
    expect(CreateTenantSchema.safeParse({ ...base, licenseNumber: 'M-1', address: 'Calle 1' }).success).toBe(true);
    expect(CreateTenantSchema.safeParse({ ...base, licenseNumber: '' }).success).toBe(false);
  });
});

describe('GenerateDocumentSchema: fecha de firma', () => {
  const templateId = '0d9bdf7e-8f4c-4a52-9d8e-5b3b4a6b3c11';

  it('es opcional y se valida como fecha', () => {
    expect(GenerateDocumentSchema.parse({ templateId, format: 'pdf' }).signingDate).toBeUndefined();
    expect(GenerateDocumentSchema.parse({ templateId, format: 'docx', signingDate: '2026-07-01' }).signingDate).toBe('2026-07-01');
    expect(GenerateDocumentSchema.safeParse({ templateId, format: 'pdf', signingDate: '01/07/2026' }).success).toBe(false);
    expect(GenerateDocumentSchema.safeParse({ templateId, format: 'pdf', signingDate: '2026-02-31' }).success).toBe(false);
  });
});
