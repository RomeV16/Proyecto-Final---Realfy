import { resolveProviderFields } from './provider-account';

describe('resolveProviderFields', () => {
  it('sin proveedor no toca la cuenta', () => {
    expect(resolveProviderFields({ accountNumber: '10-01', serviceType: 'Agua' })).toEqual({ ok: true });
    expect(resolveProviderFields({ providerKey: null, accountNumber: '10-01' })).toEqual({ ok: true });
  });

  it('normaliza la cuenta con el esquema de cada proveedor', () => {
    const norm = (providerKey: string, serviceType: string, accountNumber: string) =>
      resolveProviderFields({ providerKey, serviceType, accountNumber });
    expect(norm('rentas-cordoba', 'ImpuestoInmobiliario', '1100-0000-0001')).toEqual({ ok: true, accountNumber: '110000000001' });
    expect(norm('aguas-cordobesas', 'Agua', '123')).toEqual({ ok: true, accountNumber: '000123' });
    expect(norm('epec', 'Electricidad', '12 345-67')).toEqual({ ok: true, accountNumber: '1234567' });
    expect(norm('ecogas', 'Gas', '12.345.678')).toEqual({ ok: true, accountNumber: '12345678' });
    expect(norm('muni-cordoba', 'Municipal', ' i0000001 ')).toEqual({ ok: true, accountNumber: 'I0000001' });
    expect(norm('generico', 'Otros', 'ab-12.3 4')).toEqual({ ok: true, accountNumber: 'AB1234' });
  });

  it('códigos de error: proveedor desconocido, tipo ajeno y cuenta inválida', () => {
    expect(resolveProviderFields({ providerKey: 'x', accountNumber: '1234' })).toMatchObject({ ok: false, code: 'UNKNOWN_PROVIDER_KEY' });
    expect(resolveProviderFields({ providerKey: 'epec', serviceType: 'Gas', accountNumber: '1234' })).toMatchObject({
      ok: false,
      code: 'PROVIDER_SERVICE_TYPE_MISMATCH',
    });
    expect(resolveProviderFields({ providerKey: 'epec', serviceType: 'Electricidad', accountNumber: '12' })).toMatchObject({
      ok: false,
      code: 'INVALID_PROVIDER_ACCOUNT',
    });
  });

  it('toma de lo guardado lo que la edición no informa, y no revalida si no toca proveedor ni cuenta', () => {
    const current = { providerKey: 'epec', accountNumber: 'cuenta-vieja', serviceType: 'Electricidad' };
    expect(resolveProviderFields({ accountNumber: '12-34-56' }, current)).toEqual({ ok: true, accountNumber: '123456' });
    expect(resolveProviderFields({ providerKey: 'epec' }, current)).toMatchObject({ ok: false, code: 'INVALID_PROVIDER_ACCOUNT' });
    expect(resolveProviderFields({ serviceType: 'Electricidad' }, current)).toEqual({ ok: true });
    expect(resolveProviderFields({ serviceType: 'Gas' }, current)).toMatchObject({ code: 'PROVIDER_SERVICE_TYPE_MISMATCH' });
    expect(resolveProviderFields({ accountNumber: '' }, current)).toEqual({ ok: true, accountNumber: null });
  });
});
