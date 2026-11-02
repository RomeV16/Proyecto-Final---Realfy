import 'reflect-metadata';
import { ROLES_KEY } from '../../common/auth/roles.decorator';
import { BILLING_ROLES } from '../../common/auth/role-groups';
import { ChargeRulesController } from './charge-rules.controller';
import { ServiceBillsController } from './service-bills.controller';

const rolesOf = (proto: object, method: string) =>
  Reflect.getMetadata(ROLES_KEY, (proto as Record<string, unknown>)[method] as object) as string[] | undefined;

describe('ServiceBillsController', () => {
  const bills = {
    findAll: jest.fn().mockResolvedValue('list'),
    sheet: jest.fn().mockResolvedValue('sheet'),
    findOne: jest.fn().mockResolvedValue('one'),
    allocations: jest.fn().mockResolvedValue('alloc'),
    bulk: jest.fn().mockResolvedValue('bulk'),
    update: jest.fn().mockResolvedValue('update'),
  };
  const controller = new ServiceBillsController(bills as any);

  it('delega cada ruta en el servicio', async () => {
    await expect(controller.findAll({ period: '2026-11' })).resolves.toBe('list');
    await expect(controller.sheet('2026-11', 'p1')).resolves.toBe('sheet');
    await expect(controller.findOne('b1')).resolves.toBe('one');
    await expect(controller.allocations('b1')).resolves.toBe('alloc');
    await expect(controller.bulk([])).resolves.toBe('bulk');
    await expect(controller.update('b1', { amount: '1' })).resolves.toBe('update');
    expect(bills.sheet).toHaveBeenCalledWith('2026-11', 'p1');
  });

  it('solo la facturación escribe; leer no tiene restricción de rol', () => {
    expect(rolesOf(ServiceBillsController.prototype, 'bulk')).toEqual([...BILLING_ROLES]);
    expect(rolesOf(ServiceBillsController.prototype, 'update')).toEqual([...BILLING_ROLES]);
    expect(rolesOf(ServiceBillsController.prototype, 'findAll')).toBeUndefined();
  });
});

describe('ChargeRulesController', () => {
  const rules = {
    list: jest.fn().mockResolvedValue('list'),
    create: jest.fn().mockResolvedValue('create'),
    update: jest.fn().mockResolvedValue('update'),
  };
  const controller = new ChargeRulesController(rules as any);

  it('delega cada ruta en el servicio', async () => {
    await expect(controller.list('c1', { at: '2026-01-01' })).resolves.toBe('list');
    await expect(controller.create('c1', {})).resolves.toBe('create');
    await expect(controller.update('c1', 'r1', {})).resolves.toBe('update');
    expect(rules.update).toHaveBeenCalledWith('c1', 'r1', {});
  });

  it('solo la facturación escribe', () => {
    expect(rolesOf(ChargeRulesController.prototype, 'create')).toEqual([...BILLING_ROLES]);
    expect(rolesOf(ChargeRulesController.prototype, 'update')).toEqual([...BILLING_ROLES]);
    expect(rolesOf(ChargeRulesController.prototype, 'list')).toBeUndefined();
  });
});
