import 'reflect-metadata';
import { ListingsController } from './listings.controller';
import { ROLES_KEY } from '../../common/auth/roles.decorator';
import { MANAGEMENT_ROLES, SALES_MARKETING_ROLES } from '../../common/auth/role-groups';

const ID = '11111111-1111-4111-8111-111111111111';

describe('ListingsController', () => {
  const service = {
    overview: jest.fn().mockResolvedValue('overview'),
    pauseUnavailable: jest.fn().mockResolvedValue('paused'),
    getPortals: jest.fn().mockResolvedValue('portals'),
    updatePortals: jest.fn().mockResolvedValue('updated'),
    findForProperty: jest.fn().mockResolvedValue('listings'),
    upsertForProperty: jest.fn().mockResolvedValue('saved'),
    adCopy: jest.fn().mockResolvedValue('copy'),
  };
  const controller = new ListingsController(service as never);

  it('delega cada ruta en el servicio', async () => {
    await expect(controller.overview()).resolves.toBe('overview');
    await expect(controller.pauseUnavailable()).resolves.toBe('paused');
    await expect(controller.getPortals()).resolves.toBe('portals');
    await expect(controller.updatePortals({ a: 1 })).resolves.toBe('updated');
    await expect(controller.findForProperty(ID)).resolves.toBe('listings');
    await expect(controller.upsertForProperty(ID, { listings: [] })).resolves.toBe('saved');
    await expect(controller.adCopy(ID, { portal: 'zonaprop' })).resolves.toBe('copy');
    expect(service.updatePortals).toHaveBeenCalledWith({ a: 1 });
    expect(service.adCopy).toHaveBeenCalledWith(ID, { portal: 'zonaprop' });
  });

  it('las lecturas no tienen rol; escribir avisos es comercial y marketing; configurar es administración', () => {
    const roles = (name: keyof ListingsController) =>
      Reflect.getMetadata(ROLES_KEY, ListingsController.prototype[name]) as string[] | undefined;
    expect(roles('overview')).toBeUndefined();
    expect(roles('findForProperty')).toBeUndefined();
    expect(roles('adCopy')).toBeUndefined();
    expect(roles('getPortals')).toBeUndefined();
    expect(roles('upsertForProperty')).toEqual([...SALES_MARKETING_ROLES]);
    expect(roles('pauseUnavailable')).toEqual([...SALES_MARKETING_ROLES]);
    expect(roles('updatePortals')).toEqual([...MANAGEMENT_ROLES]);
  });
});
