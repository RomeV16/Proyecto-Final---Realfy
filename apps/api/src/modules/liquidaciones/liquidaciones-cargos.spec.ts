import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContextService } from '../../common/tenant/tenant-context.service';
import { LiquidacionesService } from './liquidaciones.service';

function build(status = 'Borrador') {
  const client: any = {
    liquidacion: {
      findFirst: jest.fn().mockResolvedValue({ id: 'liq-1', status }),
      delete: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
    },
    liquidacionLineItem: {
      findFirst: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      delete: jest.fn().mockResolvedValue({}),
      deleteMany: jest.fn().mockResolvedValue({}),
    },
  };
  client.$transaction = jest.fn((fn: (tx: any) => unknown) => fn(client));
  client.liquidacionLineItem.findMany.mockResolvedValue([
    { type: 'Cargo', amount: '1', sourceType: 'ContractAdjustment', sourceId: 'adj-1' },
    { type: 'Cargo', amount: '1', sourceType: 'ContractAdjustment', sourceId: null },
  ]);
  const charges = { releaseFromLiquidation: jest.fn().mockResolvedValue(1) };
  const serviceBills = { release: jest.fn().mockResolvedValue(2) };
  const adjustments = { releaseTrueUps: jest.fn().mockResolvedValue(1) };
  const penalties = { release: jest.fn().mockResolvedValue(3) };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const service = new LiquidacionesService(
    { client } as unknown as PrismaService,
    { getTenantId: jest.fn().mockReturnValue('tenant-1'), getUserId: jest.fn() } as unknown as TenantContextService,
    {} as any,
    {} as any,
    {} as any,
    audit as any,
    adjustments as any,
    serviceBills as any,
    penalties as any,
    charges as any,
  );
  jest.spyOn(service as any, 'findOne').mockResolvedValue({ id: 'liq-1' });
  return { service, client, charges, serviceBills, adjustments, audit, penalties };
}

describe('LiquidacionesService: los cargos del centro de carga vuelven a Pendiente', () => {
  it('al borrar una liquidación en borrador libera sus cargos en la misma transacción', async () => {
    const { service, client, charges } = build('Borrador');
    await service.remove('liq-1');
    expect(charges.releaseFromLiquidation).toHaveBeenCalledWith(client, { liquidacionId: 'liq-1' });
    expect(client.liquidacion.delete).toHaveBeenCalledWith({ where: { id: 'liq-1' } });
  });

  it('al borrar un borrador libera también las partes de boletas y las correcciones, y audita', async () => {
    const { service, client, serviceBills, adjustments, audit } = build('Borrador');
    await service.remove('liq-1');
    expect(serviceBills.release).toHaveBeenCalledWith(client, { liquidacionId: 'liq-1' });
    expect(adjustments.releaseTrueUps).toHaveBeenCalledWith(['adj-1'], client);
    expect(audit.record).toHaveBeenCalledWith(
      client,
      expect.objectContaining({
        entity: 'Liquidacion',
        entityId: 'liq-1',
        metadata: { operation: 'release-on-deleted', fromStatus: 'Borrador', released: { trueUps: 1, billParts: 2, charges: 1, penalties: 3 } },
      }),
    );
  });

  it('al anular una liquidación aprobada (remove) libera las tres cosas en la misma transacción y la deja Anulada', async () => {
    const { service, client, charges, serviceBills, adjustments, audit, penalties } = build('Aprobada');
    await service.remove('liq-1');
    expect(penalties.release).toHaveBeenCalledWith(client, 'liq-1');
    expect(audit.record).toHaveBeenCalledTimes(1);
    expect(client.liquidacion.update).toHaveBeenCalledWith({ where: { id: 'liq-1' }, data: { status: 'Anulada' } });
    expect(charges.releaseFromLiquidation).toHaveBeenCalledWith(client, { liquidacionId: 'liq-1' });
    expect(serviceBills.release).toHaveBeenCalled();
    expect(adjustments.releaseTrueUps).toHaveBeenCalledWith(['adj-1'], client);
    expect(audit.record).toHaveBeenCalledWith(
      client,
      expect.objectContaining({ metadata: expect.objectContaining({ operation: 'release-on-annulled', fromStatus: 'Aprobada' }) }),
    );
    expect(client.liquidacion.delete).not.toHaveBeenCalled();
  });

  it('al anular con la transición a Anulada libera lo mismo; otra transición no libera nada', async () => {
    const annul = build('Aprobada');
    annul.client.liquidacion.findFirst.mockResolvedValue({ id: 'liq-1', status: 'Aprobada', receiptSeq: 1, payments: [] });
    await annul.service.transition('liq-1', { status: 'Anulada' });
    expect(annul.client.liquidacion.update).toHaveBeenCalledWith({ where: { id: 'liq-1' }, data: { status: 'Anulada' } });
    expect(annul.charges.releaseFromLiquidation).toHaveBeenCalledWith(annul.client, { liquidacionId: 'liq-1' });
    expect(annul.adjustments.releaseTrueUps).toHaveBeenCalled();

    const other = build('Borrador');
    other.client.liquidacion.findFirst.mockResolvedValue({ id: 'liq-1', status: 'Borrador', receiptSeq: null, payments: [] });
    await other.service.transition('liq-1', { status: 'Revision' });
    expect(other.charges.releaseFromLiquidation).not.toHaveBeenCalled();
    expect(other.audit.record).not.toHaveBeenCalled();
  });

  it('al quitar el renglón de una corrección de ajuste la libera', async () => {
    const { service, client, adjustments } = build();
    client.liquidacionLineItem.findFirst.mockResolvedValue({
      id: 'li-3',
      liquidacionId: 'liq-1',
      sourceType: 'ContractAdjustment',
      sourceId: 'adj-9',
    });
    await service.removeLineItem('li-3');
    expect(adjustments.releaseTrueUps).toHaveBeenCalledWith(['adj-9'], client);
  });

  it('al quitar el renglón de un cargo lo libera', async () => {
    const { service, client, charges } = build();
    client.liquidacionLineItem.findFirst.mockResolvedValue({
      id: 'li-1',
      liquidacionId: 'liq-1',
      sourceType: 'PendingCharge',
      sourceId: 'pc-1',
    });
    await service.removeLineItem('li-1');
    expect(charges.releaseFromLiquidation).toHaveBeenCalledWith(client, { ids: ['pc-1'] });
  });

  it('un renglón de otro origen no toca los cargos', async () => {
    const { service, client, charges } = build();
    client.liquidacionLineItem.findFirst.mockResolvedValue({
      id: 'li-2',
      liquidacionId: 'liq-1',
      sourceType: null,
      sourceId: null,
    });
    await service.removeLineItem('li-2');
    expect(charges.releaseFromLiquidation).not.toHaveBeenCalled();
  });
});
