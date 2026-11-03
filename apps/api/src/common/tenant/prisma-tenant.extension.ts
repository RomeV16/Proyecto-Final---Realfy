import { Prisma } from '@prisma/client';
import { TenantContextService } from './tenant-context.service';
import { TenantIsolationError } from './tenant-isolation.error';
import { SYSTEM_SHARED_MODELS, SYSTEM_TENANT_ID } from './system-tenant';

/**
 * Models that are tenant-scoped (have a tenantId column).
 * RefreshToken is NOT tenant-scoped — it belongs to a user, not a tenant directly.
 */
const TENANT_SCOPED_MODELS = new Set([
  'Tenant',      // Tenant itself — filtered by id matching tenantId
  'User',
  'AuditLog',
  'UserInvitation',
  'PasswordResetToken',
  'Property',
  'PropertyOperation',
  'PropertyListing',
  'Conversation',
  'ConversationMessage',
  'BillDocument',
  'BillFetchRun',
  'PropertyMedia',
  'PriceHistory',
  'Person',
  'PersonRoleAssignment',
  'PersonDocument',
  'PersonBankAccount',
  'Contract',
  'ContractPerson',
  'ContractLessor',
  'ContractPeriod',
  'ContractAgreement',
  'ContractTermsVersion',
  'PowerOfAttorney',
  'PropertyOwnership',
  'DocumentSequence',
  'ContractGuarantee',
  'ContractAdjustment',
  'ContractCommission',
  'ContractTemplate',
  'ContractClosureSummary',
  'AdjustmentSchedule',
  'IndexData',
  'Liquidacion',
  'LiquidacionLineItem',
  'Payment',
  'Receipt',
  'FinancialAccount',
  'CashMovement',
  'Compensation',
  'OwnerLedgerEntry',
  'OwnerStatement',
  'Fee',
  'FeeInstallment',
  'StaffCommission',
  'FeeShare',
  'Service',
  'ServicePayment',
  'ServiceBill',
  'ServiceBillAllocation',
  'ContractChargeRule',
  'PendingCharge',
  'ContractFollowUp',
  'FollowUpTask',
  'ContractDeposit',
  'ContractDepositInstallment',
  'MoveOutSettlement',
  'SalesOperation',
  'SalesParty',
  'SalesDeposit',
  'SalesDocCheck',
  'KeySet',
  'KeyMovement',
  'Notification',
  'Lead',
  'LeadInteraction',
  'LeadVisit',
  'EmailTemplate',
  'TenantScoreConfig',
  'TenantScore',
  'Pipeline',
  'Comprobante',
  'ArcaCertificate',
  'ArcaCertificateAccessLog',
  'ArcaIssuer',
  'LessorInvoiceJob',
  'ArcaPuntoDeVenta',
  'ArcaRequestLog',
  'OwnerRendicion',
  'RendicionLineItem',
  'Ticket',
  'TicketCategory',
  'TicketComment',
  'TicketQuote',
  'TicketAttachment',
  'ProviderProfile',
  'InquilinoCredential',
  'PortalInvitation',
  'PortalRefreshToken',
  'PropertyValuation',
  'LibroIvaExport',
  'ReportSchedule',
  'Penalty',
  'ImportBatch',
  'ImportRowLog',
  'MessageOutbox',
  'ContactConsent',
  'InboundMessage',
  'CollectionCase',
  'CollectionAction',
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
 * Filtro de inmobiliaria de una lectura. Fija la inmobiliaria actual, salvo en
 * los modelos con filas de sistema (`SYSTEM_SHARED_MODELS`) cuando la consulta
 * ya pide la propia y/o `__system__` y nada más: así los índices publicados se
 * leen también con el cliente de una transacción (DEF-115). Un filtro que
 * nombra a cualquier otra inmobiliaria se reemplaza, como siempre (ADR-0006).
 */
function readTenantFilter(model: string, where: { tenantId?: unknown } | undefined, tenantId: string): unknown {
  const requested = where?.tenantId;
  if (SYSTEM_SHARED_MODELS.has(model) && isOwnOrSystem(requested, tenantId)) {
    return requested;
  }
  return tenantId;
}

function isOwnOrSystem(filter: unknown, tenantId: string): boolean {
  const allowed = (value: unknown) => value === tenantId || value === SYSTEM_TENANT_ID;
  if (typeof filter === 'string') return allowed(filter);
  if (filter === null || typeof filter !== 'object') return false;
  const values = (filter as { in?: unknown }).in;
  return (
    Object.keys(filter).length === 1 &&
    Array.isArray(values) &&
    values.length > 0 &&
    values.every(allowed)
  );
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
 *
 * The extension fails closed: if a tenant-scoped model is queried with no tenant in
 * context and no explicit bypass, it throws TenantIsolationError instead of running
 * the query unfiltered.
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

          // Fail closed: without a tenant in context there is no safe filter to
          // inject, so the query is refused instead of running across every
          // inmobiliaria. Guarded endpoints get their tenantId from the JWT
          // strategy; system-level callers must use baseClient or the bypass.
          if (!tenantId) {
            throw new TenantIsolationError(model, operation);
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
            a.where = { ...a.where, [tenantField]: readTenantFilter(model, a.where, tenantId) };
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
