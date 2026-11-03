import { BillChannel, BillFetchResult } from '@realfy/shared';
import { makeTenantCron } from '../../common/scheduler/tenant-cron.testing';
import { BillFetchScheduler } from './bill-fetch.scheduler';
import { BillFetchService } from './bill-fetch.service';
import { BillFetcherRegistry } from './bill-fetcher.registry';
import { BillFetchBlockedError, type BillFetcher } from './providers';

const NOW = new Date('2026-11-03T09:00:00Z');
const pdf = (name: string) => ({ fileName: name, content: Buffer.from(`%PDF-${name}`) });

function build(opts: { settings?: { enabled: boolean; providers: string[] }; services?: unknown[]; tenants?: { id: string; name: string }[] } = {}) {
  const runs: any[] = [];
  const client = {
    service: { findMany: jest.fn().mockResolvedValue(opts.services ?? [{ id: 'svc-1', propertyId: 'p-1', providerKey: 'muni-cordoba', accountNumber: 'I0000001' }]) },
    billFetchRun: { create: jest.fn(async ({ data }: any) => runs.push(data)) },
  };
  const defaults = { get: jest.fn().mockResolvedValue({ billFetching: opts.settings ?? { enabled: true, providers: ['muni-cordoba'] } }) };
  const intake = { intake: jest.fn().mockResolvedValue({ duplicate: false, document: { id: 'd' } }) };
  const registry = new BillFetcherRegistry();
  const service = new BillFetchService({ client } as never, defaults as never, registry, intake as never);
  return { service, registry, client, defaults, intake, runs, tenants: opts.tenants };
}

const fetcher = (fetch: BillFetcher['fetch']): BillFetcher => ({ providerKey: 'muni-cordoba', fetch });

describe('BillFetchService', () => {
  it('apagado (de fábrica) no consulta nada ni registra corridas', async () => {
    const { service, registry, client, runs } = build({ settings: { enabled: false, providers: ['muni-cordoba'] } });
    const spy = jest.fn().mockResolvedValue([]);
    registry.register(fetcher(spy));
    await expect(service.runForTenant('t-1', NOW)).resolves.toEqual({ disabled: true, attempts: 0, documents: 0 });
    expect(spy).not.toHaveBeenCalled();
    expect(client.service.findMany).not.toHaveBeenCalled();
    expect(runs).toEqual([]);
  });

  it('habilitado: consulta cada servicio del proveedor, pasa los documentos por el circuito y registra una corrida Ok', async () => {
    const { service, registry, intake, runs } = build();
    const spy = jest.fn().mockResolvedValue([pdf('a.pdf'), pdf('b.pdf')]);
    registry.register(fetcher(spy));
    const summary = await service.runForTenant('t-1', NOW);

    expect(spy).toHaveBeenCalledWith({ id: 'svc-1', propertyId: 'p-1', providerKey: 'muni-cordoba', accountNumber: 'I0000001' }, { tenantId: 't-1', now: NOW });
    expect(intake.intake).toHaveBeenCalledTimes(2);
    expect(intake.intake.mock.calls[0][0]).toMatchObject({ channel: BillChannel.Consulta, origin: 'muni-cordoba', fileName: 'a.pdf' });
    expect(summary).toEqual({ disabled: false, attempts: 1, documents: 2 });
    expect(runs).toEqual([
      expect.objectContaining({ tenantId: 't-1', serviceId: 'svc-1', providerKey: 'muni-cordoba', channel: BillChannel.Consulta, result: BillFetchResult.Ok, documents: 2, errorCode: null }),
    ]);
  });

  it('sin novedad: no trae nada o sólo documentos ya conocidos', async () => {
    const { service, registry, intake, runs } = build();
    intake.intake.mockResolvedValue({ duplicate: true, document: { id: 'd' } });
    registry.register(fetcher(jest.fn().mockResolvedValue([pdf('a.pdf')])));
    await service.runForTenant('t-1', NOW);
    registry.register(fetcher(jest.fn().mockResolvedValue([])));
    await service.runForTenant('t-1', NOW);
    expect(runs.map((r) => [r.result, r.documents])).toEqual([[BillFetchResult.SinNovedad, 0], [BillFetchResult.SinNovedad, 0]]);
  });

  it('un bloqueo del proveedor queda como Bloqueado con su código y no frena los demás servicios', async () => {
    const services = [
      { id: 'svc-1', propertyId: 'p-1', providerKey: 'muni-cordoba', accountNumber: 'A' },
      { id: 'svc-2', propertyId: 'p-2', providerKey: 'muni-cordoba', accountNumber: 'B' },
    ];
    const { service, registry, runs } = build({ services });
    registry.register(
      fetcher(jest.fn().mockRejectedValueOnce(new BillFetchBlockedError('captcha', 'CAPTCHA')).mockResolvedValueOnce([pdf('a.pdf')])),
    );
    const summary = await service.runForTenant('t-1', NOW);
    expect(runs[0]).toMatchObject({ serviceId: 'svc-1', result: BillFetchResult.Bloqueado, errorCode: 'CAPTCHA', errorMessage: 'captcha', documents: 0 });
    expect(runs[1]).toMatchObject({ serviceId: 'svc-2', result: BillFetchResult.Ok });
    expect(summary.attempts).toBe(2);
  });

  it('un error cualquiera del conector queda como Error y el intento se registra igual', async () => {
    const { service, registry, runs } = build();
    registry.register(fetcher(jest.fn().mockRejectedValue(new Error('timeout'))));
    await service.runForTenant('t-1', NOW);
    expect(runs[0]).toMatchObject({ result: BillFetchResult.Error, errorCode: 'FETCH_FAILED', errorMessage: 'timeout' });
  });

  it('un proveedor habilitado sin conector se omite; uno con conector que la inmobiliaria no habilitó no se consulta', async () => {
    const { service, registry, client } = build({ settings: { enabled: true, providers: ['epec'] } });
    const spy = jest.fn().mockResolvedValue([]);
    registry.register(fetcher(spy));
    await expect(service.runForTenant('t-1', NOW)).resolves.toMatchObject({ attempts: 0 });
    expect(spy).not.toHaveBeenCalled();
    expect(client.service.findMany).not.toHaveBeenCalled();
  });
});

describe('BillFetchScheduler', () => {
  it('recorre las inmobiliarias activas y suma los intentos; un error en una no corta a las demás', async () => {
    const { tenantCron } = makeTenantCron([
      { id: 't-1', name: 'Inmobiliaria Demo' },
      { id: 't-2', name: 'Otra Demo' },
      { id: 't-3', name: 'Tercera Demo' },
    ]);
    const fetch = {
      runForTenant: jest
        .fn()
        .mockResolvedValueOnce({ disabled: false, attempts: 2, documents: 1 })
        .mockRejectedValueOnce(new Error('falló'))
        .mockResolvedValueOnce({ disabled: true, attempts: 0, documents: 0 }),
    };
    const scheduler = new BillFetchScheduler(tenantCron, fetch as never);
    await expect(scheduler.runAllTenants(NOW)).resolves.toEqual({ tenantsProcessed: 2, tenantsFailed: 1, attempts: 2, documents: 1 });
    expect(fetch.runForTenant.mock.calls.map((c) => [c[0], c[1]])).toEqual([['t-1', NOW], ['t-2', NOW], ['t-3', NOW]]);
  });

  it('el proceso diario no corre en el ambiente de pruebas', async () => {
    const { tenantCron } = makeTenantCron([{ id: 't-1', name: 'Inmobiliaria Demo' }]);
    const fetch = { runForTenant: jest.fn() };
    await new BillFetchScheduler(tenantCron, fetch as never).handleDaily();
    expect(fetch.runForTenant).not.toHaveBeenCalled();
  });
});

describe('BillFetcherRegistry', () => {
  it('registra, busca, lista y quita conectores por proveedor', () => {
    const registry = new BillFetcherRegistry();
    const f = fetcher(jest.fn());
    registry.register(f);
    expect(registry.get('muni-cordoba')).toBe(f);
    expect(registry.keys()).toEqual(['muni-cordoba']);
    registry.unregister('muni-cordoba');
    expect(registry.get('muni-cordoba')).toBeUndefined();
  });
});
