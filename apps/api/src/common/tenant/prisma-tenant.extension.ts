import { Prisma } from '@prisma/client';
import { TenantContextService } from './tenant-context.service';

/**
 * Models that are tenant-scoped (have a tenantId column).
 * RefreshToken is NOT tenant-scoped — it belongs to a user, not a tenant directly.
 */
const TENANT_SCOPED_MODELS = new Set([
  'Tenant',      // Tenant itself — filtered by id matching tenantId
  'User',
  'AuditLog',
  'UserInvitation',
  'Property',
  'PropertyOperation',
  'PropertyMedia',
  'PriceHistory',
  'Person',
  'PersonRoleAssignment',
  'PersonDocument',
  'Contract',
  'ContractPerson',
  'ContractGuarantee',
  'ContractAdjustment',
  'ContractCommission',
  'ContractTemplate',
  'AdjustmentSchedule',
  'IndexData',
  'Liquidacion',
  'LiquidacionLineItem',
  'Payment',
  'Service',
  'ServicePayment',
  'Notification',
  'Lead',
  'LeadInteraction',
  'LeadVisit',
  'EmailTemplate',
  'TenantScoreConfig',
  'TenantScore',
  'Pipeline',
  'Comprobante',
  'TenantArcaConfig',
  'ArcaCertificate',
  'ArcaCertificateAccessLog',
  'ArcaIssuer',
  'ArcaPuntoDeVenta',
  'ArcaRequestLog',
  'OwnerRendicion',
  'RendicionLineItem',
  'Ticket',
  'TicketCategory',
  'TicketComment',
  'TicketAttachment',
  'ProviderProfile',
  'InquilinoCredential',
  'PortalInvitation',
  'PortalRefreshToken',
  'PropertyValuation',
  'PropertyInventory',
  'InventoryItem',
  'InventoryItemPhoto',
  'ReportSchedule',
  'Penalty',
  // Note: RefreshToken and PipelineStage do NOT have tenantId — they're
  // isolated via parent relations (User and Pipeline respectively).
]);

/**
 * For the Tenant model, the "tenantId" filter is actually the `id` column.
 * For all others, it's the `tenantId` column.
 */
function getTenantField(model: string): string {
  return model === 'Tenant' ? 'id' : 'tenantId';
}

/**
 * Operations that read data — need WHERE clause injection.
 */
const READ_OPERATIONS = new Set([
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'findUnique',
  'findUniqueOrThrow',
  'count',
  'aggregate',
  'groupBy',
]);

/**
 * Operations that mutate a single record — need WHERE clause injection.
 */
const SINGLE_MUTATE_OPERATIONS = new Set([
  'update',
  'delete',
  'upsert',
]);

/**
 * Operations that mutate many records — need WHERE clause injection.
 */
const MANY_MUTATE_OPERATIONS = new Set([
  'updateMany',
  'deleteMany',
]);

/**
 * Creates a Prisma Client Extension that automatically injects tenant_id filtering
 * on all CRUD operations for tenant-scoped models.
 *
 * Uses nestjs-cls TenantContextService to read the current tenant from AsyncLocalStorage.
 * When bypassTenantFilter is set (e.g. during login), filtering is skipped.
 */
export function createTenantExtension(tenantContext: TenantContextService) {
  return Prisma.defineExtension({
    name: 'tenant-isolation',
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }: any) {
          // Skip non-tenant-scoped models
          if (!model || !TENANT_SCOPED_MODELS.has(model)) {
            return query(args);
          }

          // Skip if tenant filtering is bypassed (e.g. login flow)
          if (tenantContext.isTenantFilterBypassed()) {
            return query(args);
          }

          const tenantId = tenantContext.getTenantId();

          // If no tenantId in context, allow the query through unfiltered
          // only for system-level operations. In production, guarded endpoints
          // will already have tenantId set by the JWT strategy.
          if (!tenantId) {
            return query(args);
          }

          const tenantField = getTenantField(model);
          // Cast to any for dynamic property access on Prisma-generated args types
          const a = args as any;

          // CREATE: inject tenantId into data
          if (operation === 'create') {
            if (tenantField !== 'id' && a.data) {
              a.data = {
                ...a.data,
                [tenantField]: a.data[tenantField] ?? tenantId,
              };
            }
            return query(a);
          }

          // CREATE MANY: inject tenantId into each record
          if (operation === 'createMany') {
            if (tenantField !== 'id' && a.data) {
              const records = Array.isArray(a.data) ? a.data : [a.data];
              a.data = records.map((record: any) => ({
                ...record,
                [tenantField]: record[tenantField] ?? tenantId,
              }));
            }
            return query(a);
          }

          // UPSERT: inject into both where and create
          if (operation === 'upsert') {
            a.where = { ...a.where, [tenantField]: tenantId };
            if (tenantField !== 'id' && a.create) {
              a.create = {
                ...a.create,
                [tenantField]: a.create[tenantField] ?? tenantId,
              };
            }
            return query(a);
          }

          // READ operations: inject WHERE
          if (READ_OPERATIONS.has(operation)) {
            a.where = { ...a.where, [tenantField]: tenantId };
            return query(a);
          }

          // SINGLE MUTATE (update, delete): inject WHERE
          if (SINGLE_MUTATE_OPERATIONS.has(operation)) {
            a.where = { ...a.where, [tenantField]: tenantId };
            return query(a);
          }

          // MANY MUTATE (updateMany, deleteMany): inject WHERE
          if (MANY_MUTATE_OPERATIONS.has(operation)) {
            a.where = { ...a.where, [tenantField]: tenantId };
            return query(a);
          }

          // Fallback — unknown operation, pass through
          return query(args);
        },
      },
    },
  });
}
