import 'reflect-metadata';
import { ROLES_KEY } from '../../common/auth/roles.decorator';
import { BILLING_ROLES } from '../../common/auth/role-groups';
import { ChargesController } from './charges.controller';

const rolesOf = (method: keyof ChargesController) =>
  Reflect.getMetadata(ROLES_KEY, ChargesController.prototype[method] as object) as string[] | undefined;

describe('ChargesController', () => {
  const charges = {
    findAll: jest.fn().mockResolvedValue('list'),
    findOne: jest.fn().mockResolvedValue('one'),
    create: jest.fn().mockResolvedValue('create'),
    bulk: jest.fn().mockResolvedValue('bulk'),
    update: jest.fn().mockResolvedValue('update'),
    cancel: jest.fn().mockResolvedValue('cancel'),
    markPaidUpfront: jest.fn().mockResolvedValue('paid'),
    release: jest.fn().mockResolvedValue('release'),
  };
  const controller = new ChargesController(charges as any);

  it('delega cada ruta en el servicio', async () => {
    await expect(controller.findAll({ status: 'Pendiente' })).resolves.toBe('list');
    await expect(controller.findOne('c1')).resolves.toBe('one');
    await expect(controller.create({})).resolves.toBe('create');
    await expect(controller.bulk({ rows: [] })).resolves.toBe('bulk');
    await expect(controller.update('c1', { notes: 'x' })).resolves.toBe('update');
    await expect(controller.cancel('c1')).resolves.toBe('cancel');
    await expect(controller.markPaidUpfront('c1')).resolves.toBe('paid');
    await expect(controller.release('c1')).resolves.toBe('release');
    expect(charges.update).toHaveBeenCalledWith('c1', { notes: 'x' });
  });

  it('solo la facturación escribe; leer no tiene restricción de rol', () => {
    for (const method of ['create', 'bulk', 'update', 'cancel', 'markPaidUpfront', 'release'] as const) {
      expect(rolesOf(method)).toEqual([...BILLING_ROLES]);
    }
    expect(rolesOf('findAll')).toBeUndefined();
    expect(rolesOf('findOne')).toBeUndefined();
  });
});
