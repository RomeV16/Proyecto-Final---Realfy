/**
 * AfipSDK test shim — deterministic fake for unit tests and e2e CI.
 *
 * Usage A (Jest module mock, automatic via __mocks__ directory convention):
 *   jest.mock('@afipsdk/afip.js', () => require('./src/modules/invoices/arca/__mocks__/afip-mock').MockAfipConstructor);
 *
 * Usage B (env flag in ArcaClientFactory):
 *   Set ARCA_MOCK=1 in the environment. ArcaClientFactory checks this flag
 *   before requiring the real AfipSDK and substitutes this shim instead.
 *
 * Usage C (Playwright / e2e):
 *   The test server is started with ARCA_MOCK=1. All AFIP calls are intercepted
 *   at the ArcaClientFactory level, returning deterministic data without network access.
 *
 * Deterministic responses:
 *   - createVoucher  → CAE = '12345678901234', CAEFchVto = today + 10 days
 *   - getLastVoucher → 0 (so first emission is #1)
 *   - getSalesPoints → [{ Nro: 1, EmisionTipo: 'Web Services', Bloqueado: 'N' }]
 *   - getServerStatus → { AppServer: 'OK', AuthServer: 'OK', DbServer: 'OK' }
 *   - getTaxpayerDetails → minimal CUIT info struct
 *
 * All methods are implemented as async functions returning Promises so they
 * match the real AfipSDK interface.
 *
 * IMPORTANT: This file is NOT for production. It is committed only as a test
 * utility and must never be loaded in a production build.
 */

// ─── Deterministic date helper ─────────────────────────────────────────────────

function futureDateString(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0]; // yyyy-mm-dd
}

// ─── Counter to give each call a unique voucher number ────────────────────────

class VoucherCounter {
  private counters = new Map<string, number>();

  next(cuit: string, ptoVta: number, cbteTipo: number): number {
    const key = `${cuit}:${ptoVta}:${cbteTipo}`;
    const last = this.counters.get(key) ?? 0;
    const next = last + 1;
    this.counters.set(key, next);
    return next;
  }

  getLast(cuit: string, ptoVta: number, cbteTipo: number): number {
    const key = `${cuit}:${ptoVta}:${cbteTipo}`;
    return this.counters.get(key) ?? 0;
  }

  reset(): void {
    this.counters.clear();
  }
}

// Shared counter across all mock instances in a process
const _counter = new VoucherCounter();

// ─── Mock ElectronicBilling service ───────────────────────────────────────────

class MockElectronicBilling {
  private cuit: string;

  constructor(cuit: string) {
    this.cuit = String(cuit).replace(/-/g, '');
  }

  async createVoucher(data: any): Promise<any> {
    const ptoVta = Number(data.PtoVta ?? 1);
    const cbteTipo = Number(data.CbteTipo ?? 1);
    const numero = _counter.next(this.cuit, ptoVta, cbteTipo);

    return {
      CAE: '12345678901234',
      CAEFchVto: futureDateString(10),
      CbteDesde: numero,
      CbteHasta: numero,
      Resultado: 'A',
      Reproceso: 'N',
      FeCabResp: {
        Cuit: this.cuit,
        PtoVta: ptoVta,
        CbteTipo: cbteTipo,
        CbteDesde: numero,
        CbteHasta: numero,
        Resultado: 'A',
      },
    };
  }

  async getLastVoucher(ptoVta: number, cbteTipo: number): Promise<number> {
    return _counter.getLast(this.cuit, ptoVta, cbteTipo);
  }

  async getSalesPoints(): Promise<any[]> {
    return [
      { Nro: 1, EmisionTipo: 'Web Services', Bloqueado: 'N', FchBaja: null },
    ];
  }

  async getServerStatus(): Promise<any> {
    return {
      AppServer: 'OK',
      AuthServer: 'OK',
      DbServer: 'OK',
    };
  }

  async getTaxpayerDetails(cuit: string): Promise<any> {
    return {
      idPersona: cuit.replace(/-/g, ''),
      tipoClave: 'CUIT',
      estadoClave: 'ACTIVO',
      nombre: 'MOCK PERSONA TEST',
      domicilio: [],
      actividades: [],
      impuestos: [{ idImpuesto: 32, descripcion: 'IVA' }],
    };
  }

  async getVoucherTypes(): Promise<any[]> {
    return [{ Id: 1, Desc: 'Factura A' }, { Id: 11, Desc: 'Factura C' }];
  }

  async getDocumentTypes(): Promise<any[]> {
    return [{ Id: 80, Desc: 'CUIT' }, { Id: 99, Desc: 'Sin identificar' }];
  }

  async getAliquotTypes(): Promise<any[]> {
    return [{ Id: 3, Desc: '0%' }, { Id: 5, Desc: '21%' }];
  }

  async getConceptTypes(): Promise<any[]> {
    return [{ Id: 1, Desc: 'Productos' }, { Id: 2, Desc: 'Servicios' }];
  }

  async getCondicionIvaReceptor(): Promise<any[]> {
    return [
      { Id: 1, Desc: 'IVA Responsable Inscripto' },
      { Id: 5, Desc: 'Consumidor Final' },
      { Id: 6, Desc: 'Responsable Monotributo' },
    ];
  }
}

// ─── Mock AfipSDK constructor ──────────────────────────────────────────────────

export class MockAfip {
  readonly CUIT: string;
  readonly options: Record<string, any>;
  readonly ElectronicBilling: MockElectronicBilling;

  // Expose PEM fields so _zeroClient() in ArcaClientFactory can null them out
  CERT: string | null;
  PRIVATEKEY: string | null;

  constructor(options: { CUIT: string | number; cert?: string; key?: string; [k: string]: any }) {
    this.CUIT = String(options.CUIT);
    this.options = options;
    this.CERT = options.cert ?? null;
    this.PRIVATEKEY = options.key ?? null;
    this.ElectronicBilling = new MockElectronicBilling(this.CUIT);
  }

  /**
   * Reset the shared voucher counters. Call this in beforeEach to ensure test isolation.
   */
  static resetCounters(): void {
    _counter.reset();
  }
}

/**
 * Drop-in replacement for `require('@afipsdk/afip.js')`.
 * Use as the mock factory function in jest.mock().
 */
export const MockAfipConstructor = jest.fn().mockImplementation((opts: any) => new MockAfip(opts));

/**
 * Reset everything between tests.
 */
export function resetAfipMock(): void {
  MockAfip.resetCounters();
  MockAfipConstructor.mockClear();
}

// Default export matches the require() shape of the real module
export default MockAfipConstructor;
