import { BadRequestException } from '@nestjs/common';
import { ContractTemplatesService } from './contract-templates.service';

const TENANT = { id: 't1', name: 'Inmobiliaria Demo', cuit: '30-11111111-1', province: 'Provincia Demo', licenseNumber: 'Mat. 1', address: 'Calle 1' };
const person = (firstName: string, lastName: string, dni: string) => ({ firstName, lastName, dni });
const CONTRACT = {
  id: 'c1',
  propertyId: 'p1',
  contractType: 'Alquiler',
  status: 'Activo',
  startDate: new Date('2026-07-01T00:00:00Z'),
  endDate: new Date('2028-06-30T00:00:00Z'),
  rentAmount: '720000',
  rentCurrency: 'ARS',
  adjustmentType: 'IPC',
  adjustmentPeriod: 'Trimestral',
  adjustments: [],
  property: { title: 'Depto', type: 'Departamento', cadastralId: '01-02' },
  persons: [
    { role: 'Inquilino', person: person('Ines', 'Uno', '30123456') },
    { role: 'Inquilino', person: person('Nico', 'Dos', '30123457') },
    { role: 'Garante', person: person('Gus', 'Tres', '10000003') },
  ],
};

function build(over: { body?: string; period?: unknown; terms?: unknown[] } = {}) {
  const template = { id: 'tpl1', name: 'Plantilla', contractType: 'Alquiler', body: over.body ?? 'x' };
  const client = {
    contractTemplate: {
      create: jest.fn(async ({ data }: any) => ({ id: 'tpl1', ...data })),
      update: jest.fn(async ({ data }: any) => ({ id: 'tpl1', name: 'Plantilla', ...data })),
      findFirst: jest.fn().mockResolvedValue(template),
      count: jest.fn().mockResolvedValue(0),
    },
    tenant: { findUnique: jest.fn().mockResolvedValue(TENANT) },
    service: { findMany: jest.fn().mockResolvedValue([{ serviceType: 'ImpuestoInmobiliario', accountNumber: '0100' }]) },
    contractPeriod: { findFirst: jest.fn().mockResolvedValue(over.period === undefined ? { initialRent: '590000', signedAt: null } : over.period) },
    contractTermsVersion: { findMany: jest.fn().mockResolvedValue(over.terms ?? []) },
  };
  const pdf = { generatePdf: jest.fn().mockResolvedValue(Buffer.from('pdf')) };
  const docx = { generateDocx: jest.fn().mockResolvedValue(Buffer.from('docx')) };
  const contracts = { findOne: jest.fn().mockResolvedValue(CONTRACT) };
  const service = new ContractTemplatesService(
    { client } as any,
    { getTenantId: () => 't1' } as any,
    contracts as any,
    pdf as any,
    docx as any,
  );
  return { service, client, pdf, docx };
}

async function rejection(promise: Promise<unknown>): Promise<BadRequestException> {
  try {
    await promise;
  } catch (e) {
    expect(e).toBeInstanceOf(BadRequestException);
    return e as BadRequestException;
  }
  throw new Error('no falló');
}

describe('ContractTemplatesService — sintaxis de la plantilla', () => {
  const base = { name: 'P', contractType: 'Alquiler' };

  it('crea una plantilla con listas y condicionales y detecta sus variables sin las del elemento', async () => {
    const { service, client } = build();
    const body = '{{#cada garantes como g}}{{g.nombreCompleto}} {{contrato.monto}}{{/cada}}{{#si contrato.deposito}}d{{/si}}';
    await service.create({ ...base, body });
    expect(client.contractTemplate.create.mock.calls[0][0].data.variables).toEqual(['contrato.monto', 'contrato.deposito']);
  });

  it('rechaza al crear una plantilla mal formada con TEMPLATE_SYNTAX_ERROR, línea y columna', async () => {
    const { service, client } = build();
    const e = await rejection(service.create({ ...base, body: 'Hola\n{{#si contrato.deposito}}sin cerrar' }));
    expect(e.getResponse()).toMatchObject({
      error: 'TEMPLATE_SYNTAX_ERROR',
      details: { code: 'UNCLOSED_BLOCK', line: 2, column: 1 },
    });
    expect(client.contractTemplate.create).not.toHaveBeenCalled();
  });

  it('rechaza una lista que no existe, y lo mismo al editar', async () => {
    const { service, client } = build();
    const body = '{{#cada fiadores}}x{{/cada}}';
    const created = await rejection(service.create({ ...base, body }));
    expect(created.getResponse()).toMatchObject({ details: { code: 'UNKNOWN_LIST' } });
    const updated = await rejection(service.update('tpl1', { body }));
    expect(updated.getResponse()).toMatchObject({ error: 'TEMPLATE_SYNTAX_ERROR' });
    expect(client.contractTemplate.update).not.toHaveBeenCalled();
  });

  it('al editar el cuerpo vuelve a extraer las variables, salvo que vengan indicadas', async () => {
    const { service, client } = build();
    await service.update('tpl1', { body: '{{a.b}}' });
    expect(client.contractTemplate.update.mock.calls[0][0].data.variables).toEqual(['a.b']);
    await service.update('tpl1', { body: '{{a.b}}', variables: ['x'] });
    expect(client.contractTemplate.update.mock.calls[1][0].data.variables).toEqual(['x']);
    await service.update('tpl1', { name: 'Otro' });
    expect(client.contractTemplate.update.mock.calls[2][0].data).toEqual({ name: 'Otro' });
  });
});

describe('ContractTemplatesService — generar el documento', () => {
  const body = [
    '{{#si inquilinos.cantidad > 1}}Locatarios{{#sino}}Locatario{{/si}}: {{inquilinos.nombres}}.',
    'Canon inicial {{contrato.montoInicial}} ({{contrato.montoInicialEnLetras}}), vigente {{contrato.monto}}.',
    'Rentas {{propiedad.cuentaRentas}}. Firma {{contrato.fechaFirmaEnLetras}}.',
  ].join('\n');

  it('arma el texto con las listas, el canon inicial del período original, las cuentas del inmueble y la firma indicada', async () => {
    const { service, pdf } = build({ body });
    const result = await service.generateDocument('c1', { templateId: '0d9bdf7e-8f4c-4a52-9d8e-5b3b4a6b3c11', format: 'pdf', signingDate: '2026-07-01' });

    expect(pdf.generatePdf.mock.calls[0][0]).toBe(
      [
        'Locatarios: Ines Uno y Nico Dos.',
        'Canon inicial 590.000,00 (Quinientos noventa mil pesos), vigente 720.000,00.',
        'Rentas 0100. Firma primero de julio de dos mil veintiséis.',
      ].join('\n'),
    );
    expect(result.extension).toBe('pdf');
  });

  it('sin período original toma el canon inicial de las reglas o del contrato, y la firma del período si la tiene', async () => {
    const withTerms = build({ body: '{{contrato.montoInicial}}', period: null, terms: [{ validFrom: new Date('2026-07-01T00:00:00Z'), rentOverride: '500000' }] });
    await withTerms.service.generateDocument('c1', { templateId: '0d9bdf7e-8f4c-4a52-9d8e-5b3b4a6b3c11', format: 'docx' });
    expect(withTerms.docx.generateDocx.mock.calls[0][0]).toBe('500.000,00');

    const plain = build({ body: '{{contrato.montoInicial}}|{{contrato.fechaFirma}}', period: null });
    await plain.service.generateDocument('c1', { templateId: '0d9bdf7e-8f4c-4a52-9d8e-5b3b4a6b3c11', format: 'docx' });
    expect(plain.docx.generateDocx.mock.calls[0][0]).toBe('720.000,00|{{contrato.fechaFirma}}');

    const signed = build({ body: '{{contrato.fechaFirma}}', period: { initialRent: '1', signedAt: new Date('2026-06-20T00:00:00Z') } });
    await signed.service.generateDocument('c1', { templateId: '0d9bdf7e-8f4c-4a52-9d8e-5b3b4a6b3c11', format: 'pdf' });
    expect(signed.pdf.generatePdf.mock.calls[0][0]).toBe('20/06/2026');
  });

  it('una plantilla guardada mal formada responde 400 TEMPLATE_SYNTAX_ERROR', async () => {
    const { service, pdf } = build({ body: '{{/si}}' });
    const e = await rejection(service.generateDocument('c1', { templateId: '0d9bdf7e-8f4c-4a52-9d8e-5b3b4a6b3c11', format: 'pdf' }));
    expect(e.getResponse()).toMatchObject({ error: 'TEMPLATE_SYNTAX_ERROR', details: { code: 'UNEXPECTED_CLOSE' } });
    expect(pdf.generatePdf).not.toHaveBeenCalled();
  });

  it('las variables para la vista previa incluyen lo que suma el servicio', async () => {
    const { service } = build();
    const vars = await service.getTemplateVariables('c1');
    expect(vars['contrato.montoInicial']).toBe('590.000,00');
    expect(vars['propiedad.cuentaRentas']).toBe('0100');
    expect(vars['inmobiliaria.matricula']).toBe('Mat. 1');
    expect(vars['inquilinos.cantidad']).toBe('2');
  });

  it('rechaza una fecha de firma que no es una fecha', async () => {
    const { service } = build();
    const e = await rejection(service.generateDocument('c1', { templateId: '0d9bdf7e-8f4c-4a52-9d8e-5b3b4a6b3c11', format: 'pdf', signingDate: '2026-13-45' }));
    expect(e.getResponse()).toMatchObject({ error: 'VALIDATION_ERROR' });
  });
});
