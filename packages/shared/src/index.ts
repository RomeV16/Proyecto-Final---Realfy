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

// Schemas — inmobiliarias (tenants)
export {
  CreateTenantSchema,
  UpdateTenantSchema,
} from './schemas/tenant.schema';

// Schemas — propiedades
export {
  CreatePropertySchema,
  UpdatePropertySchema,
  PropertyFilterSchema,
  CreatePropertyOperationSchema,
  TransitionPropertyStateSchema,
} from './schemas/property.schema';

// Schemas — personas
export {
  CreatePersonSchema,
  UpdatePersonSchema,
  PersonFilterSchema,
  AssignPersonRoleSchema,
  validateCuit,
} from './schemas/person.schema';

// Types
import type { z } from 'zod';
import {
  CreateTenantSchema as _CreateTenantSchema,
  UpdateTenantSchema as _UpdateTenantSchema,
} from './schemas/tenant.schema';
export type CreateTenantInput = z.infer<typeof _CreateTenantSchema>;
export type UpdateTenantInput = z.infer<typeof _UpdateTenantSchema>;

import {
  CreatePropertySchema as _CreatePropertySchema,
  UpdatePropertySchema as _UpdatePropertySchema,
  PropertyFilterSchema as _PropertyFilterSchema,
  CreatePropertyOperationSchema as _CreatePropertyOperationSchema,
  TransitionPropertyStateSchema as _TransitionPropertyStateSchema,
} from './schemas/property.schema';
export type CreatePropertyInput = z.infer<typeof _CreatePropertySchema>;
export type UpdatePropertyInput = z.infer<typeof _UpdatePropertySchema>;
export type PropertyFilterInput = z.infer<typeof _PropertyFilterSchema>;
export type CreatePropertyOperationInput = z.infer<
  typeof _CreatePropertyOperationSchema
>;
export type TransitionPropertyStateInput = z.infer<
  typeof _TransitionPropertyStateSchema
>;

import {
  CreatePersonSchema as _CreatePersonSchema,
  UpdatePersonSchema as _UpdatePersonSchema,
  PersonFilterSchema as _PersonFilterSchema,
  AssignPersonRoleSchema as _AssignPersonRoleSchema,
} from './schemas/person.schema';
export type CreatePersonInput = z.infer<typeof _CreatePersonSchema>;
export type UpdatePersonInput = z.infer<typeof _UpdatePersonSchema>;
export type PersonFilterInput = z.infer<typeof _PersonFilterSchema>;
export type AssignPersonRoleInput = z.infer<typeof _AssignPersonRoleSchema>;

// Schema de formulario de propiedades (frontend)
export { propertyFormSchema } from './schemas/property.form';
export type { PropertyFormInput } from './schemas/property.form';

// State machine
export {
  PROPERTY_TRANSITIONS,
  validateTransition,
  getValidTransitions,
} from './state-machine/property-state-machine';

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

// Schemas de formularios de auth (login/register del frontend)
export { loginSchema } from './schemas/login';
export type { LoginFormInput } from './schemas/login';
export { registerSchema } from './schemas/register';
export type { RegisterFormInput } from './schemas/register';

// Respuesta de autenticacion
export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}
export interface AuthResponse {
  user: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    role: string;
    tenantId: string;
  };
  tokens: AuthTokens;
}
