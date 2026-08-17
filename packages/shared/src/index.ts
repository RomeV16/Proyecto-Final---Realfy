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

// Schemas — comision por contrato
export {
  CreateCommissionSchema,
  UpdateCommissionSchema,
} from './schemas/commission.schema';

// Schemas — rendiciones a propietarios
export {
  GenerateRendicionSchema,
  TransitionRendicionSchema,
  RendicionFilterSchema,
  CreateRendicionLineItemSchema,
  UpdateRendicionNotesSchema,
} from './schemas/rendicion.schema';

// Schemas — servicios
export {
  CreateServiceSchema,
  UpdateServiceSchema,
  ServiceFilterSchema,
  CreateServicePaymentSchema,
} from './schemas/service.schema';

// Schemas — pipelines de venta/alquiler
export {
  CreatePipelineSchema,
  UpdatePipelineSchema,
  CreatePipelineStageSchema,
  UpdatePipelineStageSchema,
  ReorderPipelineStagesSchema,
} from './schemas/pipeline.schema';

// Schemas — leads
export {
  CreateLeadSchema,
  UpdateLeadSchema,
  MoveLeadStageSchema,
  AssignLeadSchema,
  ConvertLeadSchema,
  LoseLeadSchema,
  LeadFilterSchema,
} from './schemas/lead.schema';

// Schemas — interacciones y visitas
export {
  CreateInteractionSchema,
  CreateVisitSchema,
  UpdateVisitSchema,
  InteractionFilterSchema,
} from './schemas/interaction.schema';

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
  CreateCommissionSchema as _CreateCommissionSchema,
  UpdateCommissionSchema as _UpdateCommissionSchema,
} from './schemas/commission.schema';
export type CreateCommissionInput = z.infer<typeof _CreateCommissionSchema>;
export type UpdateCommissionInput = z.infer<typeof _UpdateCommissionSchema>;

import {
  GenerateRendicionSchema as _GenerateRendicionSchema,
  TransitionRendicionSchema as _TransitionRendicionSchema,
  RendicionFilterSchema as _RendicionFilterSchema,
  CreateRendicionLineItemSchema as _CreateRendicionLineItemSchema,
  UpdateRendicionNotesSchema as _UpdateRendicionNotesSchema,
} from './schemas/rendicion.schema';
export type GenerateRendicionInput = z.infer<typeof _GenerateRendicionSchema>;
export type TransitionRendicionInput = z.infer<
  typeof _TransitionRendicionSchema
>;
export type RendicionFilterInput = z.infer<typeof _RendicionFilterSchema>;
export type CreateRendicionLineItemInput = z.infer<
  typeof _CreateRendicionLineItemSchema
>;
export type UpdateRendicionNotesInput = z.infer<
  typeof _UpdateRendicionNotesSchema
>;

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

import {
  CreatePipelineSchema as _CreatePipelineSchema,
  UpdatePipelineSchema as _UpdatePipelineSchema,
  CreatePipelineStageSchema as _CreatePipelineStageSchema,
  UpdatePipelineStageSchema as _UpdatePipelineStageSchema,
  ReorderPipelineStagesSchema as _ReorderPipelineStagesSchema,
} from './schemas/pipeline.schema';
export type CreatePipelineInput = z.infer<typeof _CreatePipelineSchema>;
export type UpdatePipelineInput = z.infer<typeof _UpdatePipelineSchema>;
export type CreatePipelineStageInput = z.infer<typeof _CreatePipelineStageSchema>;
export type UpdatePipelineStageInput = z.infer<typeof _UpdatePipelineStageSchema>;
export type ReorderPipelineStagesInput = z.infer<typeof _ReorderPipelineStagesSchema>;

import {
  CreateLeadSchema as _CreateLeadSchema,
  UpdateLeadSchema as _UpdateLeadSchema,
  MoveLeadStageSchema as _MoveLeadStageSchema,
  AssignLeadSchema as _AssignLeadSchema,
  ConvertLeadSchema as _ConvertLeadSchema,
  LoseLeadSchema as _LoseLeadSchema,
  LeadFilterSchema as _LeadFilterSchema,
} from './schemas/lead.schema';
export type CreateLeadInput = z.infer<typeof _CreateLeadSchema>;
export type UpdateLeadInput = z.infer<typeof _UpdateLeadSchema>;
export type MoveLeadStageInput = z.infer<typeof _MoveLeadStageSchema>;
export type AssignLeadInput = z.infer<typeof _AssignLeadSchema>;
export type ConvertLeadInput = z.infer<typeof _ConvertLeadSchema>;
export type LoseLeadInput = z.infer<typeof _LoseLeadSchema>;
export type LeadFilterInput = z.infer<typeof _LeadFilterSchema>;

import {
  CreateInteractionSchema as _CreateInteractionSchema,
  CreateVisitSchema as _CreateVisitSchema,
  UpdateVisitSchema as _UpdateVisitSchema,
  InteractionFilterSchema as _InteractionFilterSchema,
} from './schemas/interaction.schema';
export type CreateInteractionInput = z.infer<typeof _CreateInteractionSchema>;
export type CreateVisitInput = z.infer<typeof _CreateVisitSchema>;
export type UpdateVisitInput = z.infer<typeof _UpdateVisitSchema>;
export type InteractionFilterInput = z.infer<typeof _InteractionFilterSchema>;

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

export {
  validateRendicionTransition,
  getValidRendicionTransitions,
} from './state-machine/rendicion-state-machine';

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

// Commission engine
export { calculateCommission } from './commission-engine';
export type { CommissionConfig, CommissionResult } from './commission-engine';

// Rendicion engine
export { buildRendicionFromPayments } from './rendicion-engine';
export type {
  RendicionPaymentInput,
  RendicionDeductionInput,
  RendicionLineItem,
  RendicionResult,
} from './rendicion-engine';

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

export {
  penaltyConfigFormSchema,
  penaltyConfigStringFormSchema,
  PenaltyModeEnum,
} from './schemas/penalty-config.form';
export type {
  PenaltyConfigFormInput,
  PenaltyConfigStringFormInput,
} from './schemas/penalty-config.form';

export { NotificationFilterSchema } from './schemas/notification.schema';
export {
  CreateEmailTemplateSchema,
  UpdateEmailTemplateSchema,
  EmailTemplateFilterSchema,
  PreviewEmailTemplateSchema,
  SendEmailSchema,
} from './schemas/email-template.schema';
import {
  SendEmailSchema as _SendEmailSchema,
} from './schemas/email-template.schema';
export type SendEmailInput = z.infer<typeof _SendEmailSchema>;

// ── Schema value exports ────────────────────────────────
export {
  CreateTicketSchema,
  UpdateTicketSchema,
  TicketFilterSchema,
  TransitionTicketStatusSchema,
  CreateTicketCategorySchema,
  UpdateTicketCategorySchema,
  CreateTicketCommentSchema,
  UpdateTicketCostSchema,
  CreatePortalTicketSchema,
  CreatePortalTicketCommentSchema,
} from './schemas/ticket.schema';

export {
  CreateProviderProfileSchema,
  UpdateProviderProfileSchema,
  ProviderFilterSchema,
  AssignProviderSchema,
} from './schemas/provider.schema';

// ── Inferred input types ────────────────────────────────
// (follows the base index.ts alias-import pattern used for other schemas)
import {
  CreateTicketSchema as _CreateTicketSchema,
  UpdateTicketSchema as _UpdateTicketSchema,
  TicketFilterSchema as _TicketFilterSchema,
  TransitionTicketStatusSchema as _TransitionTicketStatusSchema,
  CreateTicketCategorySchema as _CreateTicketCategorySchema,
  UpdateTicketCategorySchema as _UpdateTicketCategorySchema,
  CreateTicketCommentSchema as _CreateTicketCommentSchema,
  UpdateTicketCostSchema as _UpdateTicketCostSchema,
} from './schemas/ticket.schema';
import {
  CreateProviderProfileSchema as _CreateProviderProfileSchema,
  UpdateProviderProfileSchema as _UpdateProviderProfileSchema,
  ProviderFilterSchema as _ProviderFilterSchema,
  AssignProviderSchema as _AssignProviderSchema,
} from './schemas/provider.schema';

export type CreateTicketInput = z.infer<typeof _CreateTicketSchema>;
export type UpdateTicketInput = z.infer<typeof _UpdateTicketSchema>;
export type TicketFilterInput = z.infer<typeof _TicketFilterSchema>;
export type TransitionTicketStatusInput = z.infer<typeof _TransitionTicketStatusSchema>;
export type CreateTicketCategoryInput = z.infer<typeof _CreateTicketCategorySchema>;
export type UpdateTicketCategoryInput = z.infer<typeof _UpdateTicketCategorySchema>;
export type CreateTicketCommentInput = z.infer<typeof _CreateTicketCommentSchema>;
export type UpdateTicketCostInput = z.infer<typeof _UpdateTicketCostSchema>;
export type CreateProviderProfileInput = z.infer<typeof _CreateProviderProfileSchema>;
export type UpdateProviderProfileInput = z.infer<typeof _UpdateProviderProfileSchema>;
export type ProviderFilterInput = z.infer<typeof _ProviderFilterSchema>;
export type AssignProviderInput = z.infer<typeof _AssignProviderSchema>;

// ── State machine ───────────────────────────────────────
export {
  validateTicketTransition,
  getValidTicketTransitions,
} from './state-machine/ticket-state-machine';

// ── Web form schema ─────────────────────────────────────
export { ticketFormSchema } from './schemas/ticket.form';
export type { TicketFormInput } from './schemas/ticket.form';

// Schemas — portal de inquilinos
export {
  PortalLoginRequestSchema,
  PortalSetPasswordRequestSchema,
  PortalRefreshTokenRequestSchema,
} from './schemas/portal-auth.schema';
import {
  PortalLoginRequestSchema as _PortalLoginRequestSchema,
  PortalSetPasswordRequestSchema as _PortalSetPasswordRequestSchema,
  PortalRefreshTokenRequestSchema as _PortalRefreshTokenRequestSchema,
} from './schemas/portal-auth.schema';
export type PortalLoginRequestInput = z.infer<typeof _PortalLoginRequestSchema>;
export type PortalSetPasswordInput = z.infer<typeof _PortalSetPasswordRequestSchema>;
export type PortalRefreshTokenRequestInput = z.infer<typeof _PortalRefreshTokenRequestSchema>;
export interface PortalAuthResponse {
  person: { id: string; email: string; firstName: string; lastName: string; tenantId: string };
  tokens: AuthTokens;
}

// Schemas — portal publico por inmobiliaria
export {
  PublicPropertyFilterSchema,
  CreatePublicInquirySchema,
} from './schemas/public-portal.schema';
import {
  PublicPropertyFilterSchema as _PublicPropertyFilterSchema,
  CreatePublicInquirySchema as _CreatePublicInquirySchema,
} from './schemas/public-portal.schema';
export type PublicPropertyFilterInput = z.infer<typeof _PublicPropertyFilterSchema>;
export type CreatePublicInquiryInput = z.infer<typeof _CreatePublicInquirySchema>;

// Schemas — comprobantes electronicos
export {
  EmitComprobanteSchema,
  EmitNotaCreditoSchema,
  ComprobanteFilterSchema,
} from './schemas/comprobante.schema';
import {
  EmitComprobanteSchema as _EmitComprobanteSchema,
  EmitNotaCreditoSchema as _EmitNotaCreditoSchema,
  ComprobanteFilterSchema as _ComprobanteFilterSchema,
} from './schemas/comprobante.schema';
export type EmitComprobanteInput = z.infer<typeof _EmitComprobanteSchema>;
export type EmitNotaCreditoInput = z.infer<typeof _EmitNotaCreditoSchema>;
export type ComprobanteFilterInput = z.infer<typeof _ComprobanteFilterSchema>;

// Motor de resolucion de tipo de comprobante (A/B/C segun condiciones fiscales)
export {
  resolveComprobanteType,
  canIssueFiscalInvoice,
  getIvaTreatment,
} from './comprobante-engine';
export type { ComprobanteLetra, ComprobanteResolution } from './comprobante-engine';

// DTOs — emision de comprobantes, emisores y puntos de venta
export {
  IvaArrayItemSchema,
  TributoSchema,
  OpcionalSchema,
  CbteAsocSchema,
  ReceptorSchema,
  EmitInvoiceDtoSchema,
  EmitNotaCreditoDtoSchema,
  IssuerCreateDtoSchema,
  IssuerUpdateDtoSchema,
  PuntoDeVentaCreateDtoSchema,
} from './dto/invoices';
export type {
  IvaArrayItem,
  Tributo,
  Opcional,
  CbteAsoc,
  Receptor,
  EmitInvoiceDto,
  EmitNotaCreditoDto,
  IssuerCreateDto,
  IssuerUpdateDto,
  PuntoDeVentaCreateDto,
} from './dto/invoices';

// Schemas — scoring de inquilinos
export {
  UpdateScoreConfigSchema,
  UpsertTenantScoreSchema,
} from './schemas/scoring.schema';
import {
  UpdateScoreConfigSchema as _UpdateScoreConfigSchema,
  UpsertTenantScoreSchema as _UpsertTenantScoreSchema,
} from './schemas/scoring.schema';
export type UpdateScoreConfigInput = z.infer<typeof _UpdateScoreConfigSchema>;
export type UpsertTenantScoreInput = z.infer<typeof _UpsertTenantScoreSchema>;

// Schemas — tasaciones de propiedades
export {
  CreateValuationSchema,
  UpdateValuationSchema,
  ValuationFilterSchema,
} from './schemas/valuation.schema';
import {
  CreateValuationSchema as _CreateValuationSchema,
  UpdateValuationSchema as _UpdateValuationSchema,
  ValuationFilterSchema as _ValuationFilterSchema,
} from './schemas/valuation.schema';
export type CreateValuationInput = z.infer<typeof _CreateValuationSchema>;
export type UpdateValuationInput = z.infer<typeof _UpdateValuationSchema>;
export type ValuationFilterInput = z.infer<typeof _ValuationFilterSchema>;
// Schemas — importacion y exportacion
export {
  ImportEntityType,
  ColumnMappingSchema,
  ImportConfigSchema,
  ImportValidateRequestSchema,
  ImportExecuteRequestSchema,
  ImportRowErrorSchema,
  ImportValidationResultSchema,
  ImportExecuteResultSchema,
  ImportUploadResultSchema,
  PROPERTY_IMPORT_FIELDS,
  PERSON_IMPORT_FIELDS,
  CONTRACT_IMPORT_FIELDS,
  LIQUIDACION_IMPORT_FIELDS,
} from './schemas/import.schema';
import {
  ColumnMappingSchema as _ColumnMappingSchema,
  ImportConfigSchema as _ImportConfigSchema,
  ImportValidateRequestSchema as _ImportValidateRequestSchema,
  ImportExecuteRequestSchema as _ImportExecuteRequestSchema,
  ImportRowErrorSchema as _ImportRowErrorSchema,
  ImportValidationResultSchema as _ImportValidationResultSchema,
  ImportExecuteResultSchema as _ImportExecuteResultSchema,
  ImportUploadResultSchema as _ImportUploadResultSchema,
} from './schemas/import.schema';
export type ColumnMappingInput = z.infer<typeof _ColumnMappingSchema>;
export type ImportConfigInput = z.infer<typeof _ImportConfigSchema>;
export type ImportValidateRequestInput = z.infer<typeof _ImportValidateRequestSchema>;
export type ImportExecuteRequestInput = z.infer<typeof _ImportExecuteRequestSchema>;
export type ImportRowError = z.infer<typeof _ImportRowErrorSchema>;
export type ImportValidationResult = z.infer<typeof _ImportValidationResultSchema>;
export type ImportExecuteResult = z.infer<typeof _ImportExecuteResultSchema>;
export type ImportUploadResult = z.infer<typeof _ImportUploadResultSchema>;

export {
  PropertyImportRowSchema,
  PersonImportRowSchema,
  ContractImportRowSchema,
  LiquidacionImportRowSchema,
} from './schemas/import-row.schema';

export {
  ReportType,
  ReportFilterSchema,
  OwnerStatementFilterSchema,
  PropertyProfitabilityFilterSchema,
  CashFlowFilterSchema,
  CommissionSummaryFilterSchema,
  PipelineAnalyticsFilterSchema,
  MorosidadFilterSchema,
  ReportScheduleFrequency,
  CreateReportScheduleSchema,
  UpdateReportScheduleSchema,
} from './schemas/report.schema';
import {
  ReportType as _ReportType,
  ReportFilterSchema as _ReportFilterSchema,
  ReportScheduleFrequency as _ReportScheduleFrequency,
  CreateReportScheduleSchema as _CreateReportScheduleSchema,
  UpdateReportScheduleSchema as _UpdateReportScheduleSchema,
} from './schemas/report.schema';
export type ReportTypeValue = z.infer<typeof _ReportType>;
export type ReportFilterInput = z.infer<typeof _ReportFilterSchema>;
export type ReportScheduleFrequencyValue = z.infer<
  typeof _ReportScheduleFrequency
>;
export type CreateReportScheduleInput = z.infer<
  typeof _CreateReportScheduleSchema
>;
export type UpdateReportScheduleInput = z.infer<
  typeof _UpdateReportScheduleSchema
>;

export {
  OccupancyTrendQuerySchema,
  DashboardRangeQuerySchema,
  DashboardCashFlowQuerySchema,
} from './schemas/dashboard.schema';
import {
  OccupancyTrendQuerySchema as _OccupancyTrendQuerySchema,
  DashboardRangeQuerySchema as _DashboardRangeQuerySchema,
  DashboardCashFlowQuerySchema as _DashboardCashFlowQuerySchema,
} from './schemas/dashboard.schema';
export type OccupancyTrendQueryInput = z.infer<
  typeof _OccupancyTrendQuerySchema
>;
export type DashboardRangeQueryInput = z.infer<
  typeof _DashboardRangeQuerySchema
>;
export type DashboardCashFlowQueryInput = z.infer<
  typeof _DashboardCashFlowQuerySchema
>;
