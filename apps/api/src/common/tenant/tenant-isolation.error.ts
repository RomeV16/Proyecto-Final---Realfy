/**
 * Thrown when a query on a tenant-scoped model reaches Prisma without a tenant
 * in the request context.
 *
 * The tenant extension used to let these queries through unfiltered, which meant
 * a missing guard or a forgotten context turned into a silent read across every
 * inmobiliaria. Failing closed turns that same mistake into a loud error.
 *
 * Legitimate system-level work (crons, slug resolution, login) must go through
 * `PrismaService.baseClient` with its own explicit `tenantId` filter, or wrap the
 * call in `TenantContextService.setBypassTenantFilter(true)`.
 */
export class TenantIsolationError extends Error {
  readonly model: string;
  readonly operation: string;

  constructor(model: string, operation: string) {
    super(
      `Tenant isolation violation: ${model}.${operation} ran without a tenant in ` +
        `context. Use PrismaService.baseClient with an explicit tenantId filter for ` +
        `system-level access, or run the call behind a guard that sets the tenant ` +
        `context.`,
    );
    this.name = 'TenantIsolationError';
    this.model = model;
    this.operation = operation;
  }
}
