import { Injectable } from '@nestjs/common';
import type { BillFetcher } from './providers';

/**
 * Conectores de consulta registrados (ADR-0018). Esta base no trae ninguno: cada
 * conector se registra al arrancar su módulo (`registry.register(...)`), y el proceso
 * diario sólo consulta a los proveedores que tienen uno.
 */
@Injectable()
export class BillFetcherRegistry {
  private readonly fetchers = new Map<string, BillFetcher>();

  register(fetcher: BillFetcher): void {
    this.fetchers.set(fetcher.providerKey, fetcher);
  }

  unregister(providerKey: string): void {
    this.fetchers.delete(providerKey);
  }

  get(providerKey: string): BillFetcher | undefined {
    return this.fetchers.get(providerKey);
  }

  keys(): string[] {
    return [...this.fetchers.keys()];
  }
}
