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

// Schemas — contratos
export {
  CreateContractSchema,
  UpdateContractSchema,
  ContractFilterSchema,
  CreateGuaranteeSchema,
  CreateIndexDataSchema,
  IndexDataFilterSchema,
  ContractPersonSchema,
} from './schemas/contract.schema';

// Schemas — plantillas de contrato
export {
  CreateContractTemplateSchema,
  UpdateContractTemplateSchema,
  ContractTemplateFilterSchema,
  GenerateDocumentSchema,
} from './schemas/contract-template.schema';

// Schemas — liquidaciones
export {
  GenerateLiquidacionesSchema,
  CreateLiquidacionLineItemSchema,
  UpdateLiquidacionLineItemSchema,
  TransitionLiquidacionSchema,
  CreatePaymentSchema,
  LiquidacionFilterSchema,
} from './schemas/liquidacion.schema';

// Schemas — servicios
export {
  CreateServiceSchema,
  UpdateServiceSchema,
  ServiceFilterSchema,
  CreateServicePaymentSchema,
} from './schemas/service.schema';

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

import {
  CreateContractSchema as _CreateContractSchema,
  UpdateContractSchema as _UpdateContractSchema,
  ContractFilterSchema as _ContractFilterSchema,
  CreateGuaranteeSchema as _CreateGuaranteeSchema,
  CreateIndexDataSchema as _CreateIndexDataSchema,
  IndexDataFilterSchema as _IndexDataFilterSchema,
  ContractPersonSchema as _ContractPersonSchema,
} from './schemas/contract.schema';
export type CreateContractInput = z.infer<typeof _CreateContractSchema>;
export type UpdateContractInput = z.infer<typeof _UpdateContractSchema>;
export type ContractFilterInput = z.infer<typeof _ContractFilterSchema>;
export type CreateGuaranteeInput = z.infer<typeof _CreateGuaranteeSchema>;
export type CreateIndexDataInput = z.infer<typeof _CreateIndexDataSchema>;
export type IndexDataFilterInput = z.infer<typeof _IndexDataFilterSchema>;
export type ContractPersonInput = z.infer<typeof _ContractPersonSchema>;

import {
  CreateContractTemplateSchema as _CreateContractTemplateSchema,
  UpdateContractTemplateSchema as _UpdateContractTemplateSchema,
  ContractTemplateFilterSchema as _ContractTemplateFilterSchema,
  GenerateDocumentSchema as _GenerateDocumentSchema,
} from './schemas/contract-template.schema';
export type CreateContractTemplateInput = z.infer<
  typeof _CreateContractTemplateSchema
>;
export type UpdateContractTemplateInput = z.infer<
  typeof _UpdateContractTemplateSchema
>;
export type ContractTemplateFilterInput = z.infer<
  typeof _ContractTemplateFilterSchema
>;
export type GenerateDocumentInput = z.infer<typeof _GenerateDocumentSchema>;

import {
  GenerateLiquidacionesSchema as _GenerateLiquidacionesSchema,
  CreateLiquidacionLineItemSchema as _CreateLiquidacionLineItemSchema,
  UpdateLiquidacionLineItemSchema as _UpdateLiquidacionLineItemSchema,
  TransitionLiquidacionSchema as _TransitionLiquidacionSchema,
  CreatePaymentSchema as _CreatePaymentSchema,
  LiquidacionFilterSchema as _LiquidacionFilterSchema,
} from './schemas/liquidacion.schema';
export type GenerateLiquidacionesInput = z.infer<
  typeof _GenerateLiquidacionesSchema
>;
export type CreateLiquidacionLineItemInput = z.infer<
  typeof _CreateLiquidacionLineItemSchema
>;
export type UpdateLiquidacionLineItemInput = z.infer<
  typeof _UpdateLiquidacionLineItemSchema
>;
export type TransitionLiquidacionInput = z.infer<
  typeof _TransitionLiquidacionSchema
>;
export type CreatePaymentInput = z.infer<typeof _CreatePaymentSchema>;
export type LiquidacionFilterInput = z.infer<typeof _LiquidacionFilterSchema>;

import {
  CreateServiceSchema as _CreateServiceSchema,
  UpdateServiceSchema as _UpdateServiceSchema,
  ServiceFilterSchema as _ServiceFilterSchema,
  CreateServicePaymentSchema as _CreateServicePaymentSchema,
} from './schemas/service.schema';
export type CreateServiceInput = z.infer<typeof _CreateServiceSchema>;
export type UpdateServiceInput = z.infer<typeof _UpdateServiceSchema>;
export type ServiceFilterInput = z.infer<typeof _ServiceFilterSchema>;
export type CreateServicePaymentInput = z.infer<
  typeof _CreateServicePaymentSchema
>;

// Schema de formulario de propiedades (frontend)
export { propertyFormSchema } from './schemas/property.form';
export type { PropertyFormInput } from './schemas/property.form';

// Schema de formulario de personas (frontend)
export { personFormSchema } from './schemas/person.form';
export type { PersonFormInput } from './schemas/person.form';

// Schema de formulario de contratos (frontend)
export { contractFormSchema } from './schemas/contract.form';

// State machine
export {
  PROPERTY_TRANSITIONS,
  validateTransition,
  getValidTransitions,
} from './state-machine/property-state-machine';

export {
  validateLiquidacionTransition,
  getValidLiquidacionTransitions,
} from './state-machine/liquidacion-state-machine';

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

// Template engine
export {
  renderTemplate,
  renderTemplatePlain,
  extractVariableNames,
  escapeHtml,
} from './template-engine';

// Adjustment engine
export {
  calculateIPC,
  calculateICL,
  calculateCCP,
  calculateFixedPercent,
  calculateCustom,
  calculateAdjustment,
} from './adjustment-engine';
export type { AdjustmentResult, AdjustmentParams } from './adjustment-engine';

// Liquidacion engine
export {
  calculateLineItemsTotal,
  calculateRemainingBalance,
  isFullyPaid,
} from './liquidacion-engine';
export type { LineItemInput, LineItemsTotalResult, PaymentInput } from './liquidacion-engine';

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
