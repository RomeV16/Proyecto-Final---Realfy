// Enums
export {
  UserRole,
  TenantTier,
  Currency,
  AuditAction,
  Province,
  PropertyType,
  PropertyOperationType,
  PropertyState,
  PersonRole,
  FiscalCondition,
  ContractStatus,
  ContractType,
  AdjustmentType,
  AdjustmentPeriod,
  GuaranteeType,
  GuaranteeStatus,
  IndexType,
  ScheduleStatus,
  LiquidacionStatus,
  PaymentMethod,
  LineItemType,
  ServiceType,
  NotificationType,
  PipelineType,
  LeadSource,
  LeadStatus,
  InteractionType,
  VisitStatus,
  VisitOutcome,
  ComprobanteType,
  ComprobanteStatus,
  CommissionType,
  RendicionStatus,
  RendicionLineItemType,
  ValuationMethod,
  InventoryType,
  InventoryItemStatus,
  TicketStatus,
  TicketPriority,
} from './enums';

// Schemas — usuarios y autenticacion
export {
  CreateUserSchema,
  InviteUserSchema,
  LoginSchema,
  RegisterSchema,
} from './schemas/user.schema';

// Constants & utilities
export {
  ROLE_PERMISSIONS,
  DEFAULT_TIMEZONE,
  DEFAULT_CURRENCY,
  hasPermission,
  DEFAULT_ALQUILER_STAGES,
  DEFAULT_VENTA_STAGES,
  DEFAULT_PIPELINE_STAGES,
  TICKET_SLA_HOURS,
} from './constants';

export type { Permission, DefaultStageDefinition } from './constants';
