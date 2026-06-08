import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { TenantContextService } from '../tenant/tenant-context.service';
import { createTenantExtension } from '../tenant/prisma-tenant.extension';

@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  private readonly _baseClient: PrismaClient;
  private readonly _extendedClient: ReturnType<
    typeof PrismaService.prototype._createExtendedClient
  >;

  constructor(private readonly tenantContext: TenantContextService) {
    this._baseClient = new PrismaClient();
    this._extendedClient = this._createExtendedClient();
  }

  private _createExtendedClient() {
    return this._baseClient.$extends(
      createTenantExtension(this.tenantContext),
    );
  }

  /** Tenant-filtered client — use for all application queries. */
  get client() {
    return this._extendedClient;
  }

  /**
   * Unfiltered base client — use ONLY for system-level operations
   * that must bypass tenant isolation (e.g. migrations, seeding).
   * Prefer tenantContext.setBypassTenantFilter(true) + client when possible.
   */
  get baseClient(): PrismaClient {
    return this._baseClient;
  }

  async onModuleInit() {
    await this._baseClient.$connect();
  }

  async onModuleDestroy() {
    await this._baseClient.$disconnect();
  }
}
