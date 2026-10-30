import { describe, expect, it } from 'vitest';
import { createIssuerSchema } from './invoices';

const base = {
  businessName: 'Inmobiliaria de prueba SA',
  fiscalCondition: 'ResponsableInscripto' as const,
};

describe('createIssuerSchema (validación de CUIT)', () => {
  it('acepta un CUIT con verificador correcto, con o sin guiones', () => {
    expect(createIssuerSchema.safeParse({ ...base, cuit: '20123456786' }).success).toBe(true);
    expect(createIssuerSchema.safeParse({ ...base, cuit: '20-12345678-6' }).success).toBe(true);
  });

  it('rechaza un verificador incorrecto', () => {
    expect(createIssuerSchema.safeParse({ ...base, cuit: '20123456785' }).success).toBe(false);
  });

  it('rechaza largos distintos de 11 dígitos y caracteres no numéricos', () => {
    expect(createIssuerSchema.safeParse({ ...base, cuit: '2012345678' }).success).toBe(false);
    expect(createIssuerSchema.safeParse({ ...base, cuit: '2012345678a' }).success).toBe(false);
  });

  it('exige razón social y una condición fiscal conocida', () => {
    expect(createIssuerSchema.safeParse({ ...base, cuit: '20123456786', businessName: '' }).success).toBe(false);
    expect(
      createIssuerSchema.safeParse({ ...base, cuit: '20123456786', fiscalCondition: 'Otra' }).success,
    ).toBe(false);
  });
});
