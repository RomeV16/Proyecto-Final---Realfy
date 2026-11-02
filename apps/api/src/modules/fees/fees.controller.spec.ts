import 'reflect-metadata';
import { ROLES_KEY } from '../../common/auth/roles.decorator';
import { BILLING_ROLES, BILLING_VIEW_ROLES, MANAGEMENT_ROLES } from '../../common/auth/role-groups';
import { FeesController, StaffCommissionsController } from './fees.controller';

const rolesOf = (target: { prototype: object }, method: string) =>
  Reflect.getMetadata(ROLES_KEY, (target.prototype as any)[method] as object) as string[] | undefined;

describe('FeesController', () => {
  const fees = {
    findAll: jest.fn().mockResolvedValue('list'),
    findInstallments: jest.fn().mockResolvedValue('installments'),
    findOne: jest.fn().mockResolvedValue('one'),
    create: jest.fn().mockResolvedValue('create'),
    update: jest.fn().mockResolvedValue('update'),
    cancel: jest.fn().mockResolvedValue('cancel'),
    addShare: jest.fn().mockResolvedValue('share'),
    removeShare: jest.fn().mockResolvedValue('unshare'),
    addStaffCommission: jest.fn().mockResolvedValue('staff'),
    removeStaffCommission: jest.fn().mockResolvedValue('unstaff'),
  };
  const proposal = { preview: jest.fn().mockResolvedValue('preview') };
  const payments = {
    payInstallment: jest.fn().mockResolvedValue('paid'),
    listStaffCommissions: jest.fn().mockResolvedValue('commissions'),
    payStaffCommission: jest.fn().mockResolvedValue('commission-paid'),
  };
  const controller = new FeesController(fees as any, proposal as any, payments as any);
  const staff = new StaffCommissionsController(payments as any);

  it('delega cada ruta en su servicio', async () => {
    await expect(controller.findAll({ kind: 'Venta' })).resolves.toBe('list');
    await expect(controller.preview({ kind: 'Venta' })).resolves.toBe('preview');
    await expect(controller.installments({ period: '2026-04' })).resolves.toBe('installments');
    await expect(controller.findOne('f1')).resolves.toBe('one');
    await expect(controller.create({})).resolves.toBe('create');
    await expect(controller.update('f1', { notes: 'x' })).resolves.toBe('update');
    await expect(controller.cancel('f1', { reason: 'x' })).resolves.toBe('cancel');
    await expect(controller.pay('f1', 2, { date: '2026-04-01' })).resolves.toBe('paid');
    await expect(controller.addShare('f1', {})).resolves.toBe('share');
    await expect(controller.removeShare('f1', 's1')).resolves.toBe('unshare');
    await expect(controller.addStaffCommission('f1', {})).resolves.toBe('staff');
    await expect(controller.removeStaffCommission('f1', 'c1')).resolves.toBe('unstaff');
    await expect(staff.findAll({ paid: 'false' })).resolves.toBe('commissions');
    await expect(staff.pay('c1', {})).resolves.toBe('commission-paid');
    expect(payments.payInstallment).toHaveBeenCalledWith('f1', 2, { date: '2026-04-01' });
  });

  it('la gerencia escribe, la facturación cobra cuotas y las comisiones son solo de la gerencia', () => {
    for (const method of ['preview', 'create', 'update', 'cancel', 'addShare', 'removeShare', 'addStaffCommission', 'removeStaffCommission']) {
      expect(rolesOf(FeesController, method)).toEqual([...MANAGEMENT_ROLES]);
    }
    expect(rolesOf(FeesController, 'pay')).toEqual([...BILLING_ROLES]);
    for (const method of ['findAll', 'installments', 'findOne']) {
      expect(rolesOf(FeesController, method)).toEqual([...BILLING_VIEW_ROLES]);
    }
    expect(rolesOf(StaffCommissionsController, 'findAll')).toEqual([...MANAGEMENT_ROLES]);
    expect(rolesOf(StaffCommissionsController, 'pay')).toEqual([...MANAGEMENT_ROLES]);
  });
});
