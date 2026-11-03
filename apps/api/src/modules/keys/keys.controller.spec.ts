import 'reflect-metadata';
import { UserRole } from '@realfy/shared';
import { ROLES_KEY } from '../../common/auth/roles.decorator';
import { SALES_ROLES } from '../../common/auth/role-groups';
import { KeysController, PropertyKeysController } from './keys.controller';

const rolesOf = (target: { prototype: object }, method: string) =>
  Reflect.getMetadata(ROLES_KEY, (target.prototype as any)[method] as object) as string[];

describe('controladores de llaves', () => {
  const keys = {
    listByProperty: jest.fn().mockResolvedValue('list'),
    create: jest.fn().mockResolvedValue('create'),
    listOut: jest.fn().mockResolvedValue('out'),
    findOne: jest.fn().mockResolvedValue('one'),
    update: jest.fn().mockResolvedValue('update'),
    checkOut: jest.fn().mockResolvedValue('checkOut'),
    checkIn: jest.fn().mockResolvedValue('checkIn'),
  };
  const byProperty = new PropertyKeysController(keys as any);
  const controller = new KeysController(keys as any);

  it('delega cada ruta en su servicio', async () => {
    await expect(byProperty.list('p1')).resolves.toBe('list');
    await expect(byProperty.create('p1', {})).resolves.toBe('create');
    await expect(controller.out({ overdue: 'true' })).resolves.toBe('out');
    await expect(controller.findOne('k1')).resolves.toBe('one');
    await expect(controller.update('k1', {})).resolves.toBe('update');
    await expect(controller.checkOut('k1', {})).resolves.toBe('checkOut');
    await expect(controller.checkIn('k1', {})).resolves.toBe('checkIn');
    expect(keys.listOut).toHaveBeenCalledWith({ overdue: 'true' });
  });

  it('cargan Ventas y la administración; ven también Soporte y Lectura', () => {
    for (const m of ['create']) expect([...rolesOf(PropertyKeysController, m)].sort()).toEqual([...SALES_ROLES].sort());
    for (const m of ['update', 'checkOut', 'checkIn']) expect([...rolesOf(KeysController, m)].sort()).toEqual([...SALES_ROLES].sort());
    for (const m of ['out', 'findOne']) {
      expect(rolesOf(KeysController, m)).toEqual(expect.arrayContaining([UserRole.Soporte, UserRole.Lectura, UserRole.Ventas]));
      expect(rolesOf(KeysController, m)).not.toContain(UserRole.Liquidaciones);
    }
  });
});
