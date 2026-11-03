import 'reflect-metadata';
import { UserRole } from '@realfy/shared';
import { ROLES_KEY } from '../../common/auth/roles.decorator';
import { MANAGEMENT_ROLES, SALES_ROLES } from '../../common/auth/role-groups';
import { PropertySalesController, SalesController } from './sales.controller';

const rolesOf = (method: string) => Reflect.getMetadata(ROLES_KEY, (SalesController.prototype as any)[method] as object) as string[];

describe('SalesController', () => {
  const sales = {
    findAll: jest.fn().mockResolvedValue('list'),
    findOne: jest.fn().mockResolvedValue('one'),
    findByProperty: jest.fn().mockResolvedValue('byProperty'),
    create: jest.fn().mockResolvedValue('create'),
    update: jest.fn().mockResolvedValue('update'),
    setParties: jest.fn().mockResolvedValue('parties'),
    updateDoc: jest.fn().mockResolvedValue('doc'),
    transition: jest.fn().mockResolvedValue('transition'),
  };
  const deposits = {
    pending: jest.fn().mockResolvedValue('pending'),
    create: jest.fn().mockResolvedValue('dcreate'),
    update: jest.fn().mockResolvedValue('dupdate'),
    receive: jest.fn().mockResolvedValue('receive'),
    refund: jest.fn().mockResolvedValue('refund'),
    forfeit: jest.fn().mockResolvedValue('forfeit'),
  };
  const fees = { preview: jest.fn().mockResolvedValue('proposal'), create: jest.fn().mockResolvedValue('fee') };
  const controller = new SalesController(sales as any, deposits as any, fees as any);

  it('delega cada ruta en su servicio', async () => {
    await expect(controller.findAll({ open: 'true' })).resolves.toBe('list');
    await expect(controller.pendingDeposits({})).resolves.toBe('pending');
    await expect(controller.findOne('o1')).resolves.toBe('one');
    await expect(controller.create({})).resolves.toBe('create');
    await expect(controller.update('o1', {})).resolves.toBe('update');
    await expect(controller.setParties('o1', {})).resolves.toBe('parties');
    await expect(controller.updateDoc('o1', 'informe_dominio', {})).resolves.toBe('doc');
    await expect(controller.transition('o1', {})).resolves.toBe('transition');
    await expect(controller.createDeposit('o1', {})).resolves.toBe('dcreate');
    await expect(controller.updateDeposit('o1', 'd1', {})).resolves.toBe('dupdate');
    await expect(controller.receive('o1', 'd1', {})).resolves.toBe('receive');
    await expect(controller.refund('o1', 'd1', {})).resolves.toBe('refund');
    await expect(controller.forfeit('o1', 'd1', {})).resolves.toBe('forfeit');
    await expect(controller.feeProposal('o1')).resolves.toBe('proposal');
    await expect(controller.createFee('o1', {})).resolves.toBe('fee');
    await expect(new PropertySalesController(sales as any).list('p1')).resolves.toBe('byProperty');
    expect(sales.updateDoc).toHaveBeenCalledWith('o1', 'informe_dominio', {});
    expect(deposits.forfeit).toHaveBeenCalledWith('o1', 'd1', {});
  });

  it('escribe Ventas y la administración; el dinero de las señas y el honorario, solo la administración', () => {
    for (const m of ['create', 'update', 'setParties', 'updateDoc', 'transition', 'createDeposit', 'updateDeposit', 'receive']) {
      expect([...rolesOf(m)].sort()).toEqual([...SALES_ROLES].sort());
    }
    for (const m of ['refund', 'forfeit', 'feeProposal', 'createFee']) {
      expect([...rolesOf(m)].sort()).toEqual([...MANAGEMENT_ROLES].sort());
    }
    expect(rolesOf('findAll')).toContain(UserRole.Lectura);
    expect(rolesOf('findAll')).not.toContain(UserRole.Liquidaciones);
  });
});
