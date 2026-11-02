import { NotFoundException } from '@nestjs/common';
import { CommissionType } from '@realfy/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContextService } from '../../common/tenant/tenant-context.service';

// El servicio de PDF carga pdfmake al importarse; acá no se usa.
jest.mock('./rendition-pdf.service', () => ({
  RenditionPdfService: jest.fn(),
}));

import { RenditionsService } from './renditions.service';

const CONTRACT_ID = 'c0000000-0000-0000-0000-000000000001';

function build() {
  const client: any = {
    contract: { findFirst: jest.fn().mockResolvedValue({ id: CONTRACT_ID, rentCurrency: 'ARS' }) },
    contractCommission: {
      upsert: jest.fn().mockImplementation(async ({ create }: any) => ({ id: 'com-1', ...create })),
      findFirst: jest.fn(),
    },
    ownerRendicion: { findFirst: jest.fn().mockResolvedValue(null) },
    tenant: { findFirst: jest.fn().mockResolvedValue({ name: 'Inmobiliaria', cuit: null }) },
  };
  const pdf = { generateRenditionPdf: jest.fn().mockResolvedValue(Buffer.from('pdf')) };
  const service = new RenditionsService(
    { client } as unknown as PrismaService,
    { getTenantId: jest.fn().mockReturnValue('tenant-1') } as unknown as TenantContextService,
    pdf as any,
  );
  return { service, client, pdf };
}

describe('RenditionsService (histórico de solo lectura)', () => {
  it('ya no genera, no cambia de estado, no edita ni envía rendiciones', () => {
    const { service } = build();
    for (const method of ['generate', 'transition', 'updateNotes', 'addLineItem', 'removeLineItem', 'sendEmail']) {
      expect((service as any)[method]).toBeUndefined();
    }
  });

  it('el detalle de una rendición inexistente es 404', async () => {
    const { service } = build();
    await expect(service.findOne('nope')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('el PDF de una rendición histórica se sigue generando', async () => {
    const { service, client, pdf } = build();
    client.ownerRendicion.findFirst.mockResolvedValue({ id: 'r1', lineItems: [] });
    const buffer = await service.generatePdf('r1');
    expect(buffer.toString()).toBe('pdf');
    expect(pdf.generateRenditionPdf).toHaveBeenCalledWith({ id: 'r1', lineItems: [] }, { name: 'Inmobiliaria', cuit: null });
  });
});

describe('comisión del contrato', () => {
  it('guarda el honorario por gestión de reparaciones; sin él queda nulo', async () => {
    const { service, client } = build();
    await service.createCommission(CONTRACT_ID, { type: CommissionType.FixedPercent, percentage: '7', repairMgmtFeePct: '10' });
    const args = client.contractCommission.upsert.mock.calls[0][0];
    expect(args.create.repairMgmtFeePct).toBe('10');
    expect(args.update.repairMgmtFeePct).toBe('10');

    await service.createCommission(CONTRACT_ID, { type: CommissionType.FixedPercent, percentage: '7' });
    expect(client.contractCommission.upsert.mock.calls[1][0].create.repairMgmtFeePct).toBeNull();
  });
});
