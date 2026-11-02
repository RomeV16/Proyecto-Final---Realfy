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
  const charges = { releaseFromLiquidation: jest.fn().mockResolvedValue(1) };
  const serviceBills = { release: jest.fn().mockResolvedValue(0) };
  const service = new LiquidacionesService(
    { client } as unknown as PrismaService,
    { getTenantId: jest.fn().mockReturnValue('tenant-1'), getUserId: jest.fn() } as unknown as TenantContextService,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    serviceBills as any,
    charges as any,
  );
  jest.spyOn(service as any, 'findOne').mockResolvedValue({ id: 'liq-1' });
  return { service, client, charges, serviceBills };
}

describe('LiquidacionesService: los cargos del centro de carga vuelven a Pendiente', () => {
  it('al borrar una liquidación en borrador libera sus cargos en la misma transacción', async () => {
    const { service, client, charges } = build('Borrador');
    await service.remove('liq-1');
    expect(charges.releaseFromLiquidation).toHaveBeenCalledWith(client, { liquidacionId: 'liq-1' });
    expect(client.liquidacion.delete).toHaveBeenCalledWith({ where: { id: 'liq-1' } });
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
