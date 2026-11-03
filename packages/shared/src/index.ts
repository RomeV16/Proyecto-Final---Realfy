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
  LessorCapacity,
  SignatureMode,
  PowerScope,
  FiscalCondition,
  DepositHolder,
  DepositRefundRule,
  DepositStatus,
  MoveOutStatus,
  PersonType,
  PayoutMethod,
  ContractStatus,
  ContractType,
  AdjustmentType,
  AdjustmentPeriod,
  GuaranteeType,
  GuaranteeStatus,
  IndexType,
  ContractPeriodKind,
  ContractAgreementKind,
  FollowUpKind,
  FollowUpStatus,
  FollowUpOutcome,
  AdjustmentBase,
  PaymentFlow,
  ProrationMode,
  MidMonthAdjustmentMode,
  FirstDueMode,
  FixedDiscountProration,
  ScheduleStatus,
  LiquidacionStatus,
  ImportBatchStatus,
  ImportEntity,
  ImportRowAction,
  PaymentMethod,
  LineItemType,
  LineBeneficiary,
  LiquidacionKind,
  ServiceType,
  BillingFrequency,
  ChargePayer,
  ChargeSplitMode,
  ServicePaymentPlan,
  AnnualRecovery,
  AnnualDiscountBeneficiary,
  RemainingInstallmentsOnEnd,
  ServiceBillStatus,
  ChargeTarget,
  PendingChargeKind,
  PendingChargeStatus,
  UpfrontBasis,
  BillPaidBy,
  FinancialAccountKind,
  CashDirection,
  CashCategory,
  PaymentReceiver,
  OwnerLedgerEntryType,
  OwnerStatementStatus,
  FeeKind,
  FeeBasis,
  FeePayerRole,
  FeeStatus,
  FeeInstallmentStatus,
  FeeSettlement,
  FeeVatMode,
  NotificationType,
  MessageChannel,
  MessageStatus,
  CollectionStage,
  CollectionActionKind,
  CollectionActionStatus,
  ConsentStatus,
  ConsentSource,
  PipelineType,
  LeadSource,
  LeadStatus,
  InteractionType,
  VisitStatus,
  VisitOutcome,
  ComprobanteType,
  LessorInvoiceSource,
  LessorInvoiceKind,
  LessorInvoiceStatus,
  ComprobanteStatus,
  CommissionType,
  RendicionStatus,
  RendicionLineItemType,
  ValuationMethod,
  TicketStatus,
  TicketQuoteStatus,
  ApprovalChannel,
  TicketPriority,
} from './enums';

// Schemas — usuarios y autenticacion
export {
  CreateUserSchema,
  InviteUserSchema,
  UpdateUserSchema,
  AcceptInvitationSchema,
  ChangePasswordSchema,
  PasswordResetRequestSchema,
  PasswordResetConfirmSchema,
  InviteUserFormSchema,
  AcceptInvitationFormSchema,
  ChangePasswordFormSchema,
  PasswordResetFormSchema,
  USER_STATUSES,
  PASSWORD_MIN_LENGTH,
  PASSWORD_MAX_LENGTH,
} from './schemas/user.schema';
export type {
  UserStatus,
  TeamMember,
  ShareableLink,
} from './schemas/user.schema';

// Schemas — inmobiliarias (tenants)
export {
  CreateTenantSchema,
  UpdateTenantSchema,
} from './schemas/tenant.schema';

// Schemas — política de lectura por rol
export {
  READ_RESOURCES,
  DEFAULT_READ_POLICY,
  ReadPolicySchema,
  resolveReadPolicy,
  canReadResource,
} from './schemas/read-policy.schema';
export type { ReadResource, ReadPolicy } from './schemas/read-policy.schema';

// Schemas — ajustes del mes (previsualización y aplicación masiva)
export {
  PreviewAdjustmentBatchSchema,
  ApplyAdjustmentBatchSchema,
  ADJUSTMENT_ROW_STATUSES,
} from './schemas/adjustment-batch.schema';
export type {
  PreviewAdjustmentBatchInput,
  ApplyAdjustmentBatchInput,
  AdjustmentRowStatus,
  AdjustmentIndexValue,
  AdjustmentPreviewRow,
  AdjustmentPreviewBatch,
  AdjustmentApplyResult,
  AdjustmentApplyBatch,
} from './schemas/adjustment-batch.schema';

// Schemas — valores por defecto de la inmobiliaria
export {
  OperationalDefaultsSchema,
  DEFAULT_OPERATIONAL_DEFAULTS,
  resolveOperationalDefaults,
  collectionPolicyOf,
} from './schemas/operational-defaults.schema';
export type { OperationalDefaults, OperationalDefaultsInput } from './schemas/operational-defaults.schema';
export {
  operationalDefaultsFormSchema,
  operationalDefaultsToForm,
  operationalDefaultsFromForm,
} from './schemas/operational-defaults.form';
export type { OperationalDefaultsFormInput } from './schemas/operational-defaults.form';

// Schemas — reglas versionadas del contrato y acuerdos
export {
  CustomStepSchema,
  CustomStepsSchema,
  TermsPatchSchema,
  RULE_CHANGING_AGREEMENT_KINDS,
  CreateContractAgreementSchema,
  UpdateContractAgreementSchema,
} from './schemas/contract-rules.schema';
export { LiquidationConventionsSchema } from './schemas/contract-rules.schema';
export type { LiquidationConventions } from './schemas/contract-rules.schema';
export type { TermsPatch, CreateContractAgreementInput } from './schemas/contract-rules.schema';

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
  CreatePersonBankAccountSchema,
  UpdatePersonBankAccountSchema,
  validateCuit,
} from './schemas/person.schema';

// Schemas — locadores, poderes y titularidad
export {
  CreateContractLessorSchema,
  UpdateContractLessorSchema,
  ReplaceContractLessorsSchema,
  CreatePowerOfAttorneySchema,
  UpdatePowerOfAttorneySchema,
  PowerOfAttorneyFilterSchema,
  CreatePropertyOwnershipSchema,
  payoutPctSchema,
} from './schemas/party.schema';
export {
  FULL_SHARE_UNITS,
  pctToUnits,
  unitsToPct,
  splitEqualPct,
  isLessorActiveAt,
  findInvalidShareDates,
} from './parties/lessor-shares';
export type { LessorShareRow, InvalidShareDate } from './parties/lessor-shares';

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
  CreateChargeRuleSchema,
  UpdateChargeRuleSchema,
  ChargeRuleFilterSchema,
  ServiceBillRowSchema,
  UpdateServiceBillSchema,
  ServiceBillFilterSchema,
} from './schemas/service.schema';
export type {
  ServiceBillRowInput,
  CreateChargeRuleInput,
} from './schemas/service.schema';

// Schemas — centro de carga
export {
  CreatePendingChargeSchema,
  BulkPendingChargesSchema,
  UpdatePendingChargeSchema,
  PendingChargeFilterSchema,
} from './schemas/pending-charge.schema';
export type { CreatePendingChargeInput, UpdatePendingChargeInput } from './schemas/pending-charge.schema';

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
  CreatePersonBankAccountSchema as _CreatePersonBankAccountSchema,
  UpdatePersonBankAccountSchema as _UpdatePersonBankAccountSchema,
} from './schemas/person.schema';
export type CreatePersonInput = z.infer<typeof _CreatePersonSchema>;
export type UpdatePersonInput = z.infer<typeof _UpdatePersonSchema>;
export type PersonFilterInput = z.infer<typeof _PersonFilterSchema>;
export type AssignPersonRoleInput = z.infer<typeof _AssignPersonRoleSchema>;
export type CreatePersonBankAccountInput = z.infer<typeof _CreatePersonBankAccountSchema>;
export type UpdatePersonBankAccountInput = z.infer<typeof _UpdatePersonBankAccountSchema>;

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
  findTransitionPath,
  getPropertyMachine,
} from './state-machine/property-state-machine';

export {
  defineStateMachine,
  InvalidTransitionError,
  type StateMachine,
} from './state-machine/define';

export {
  contractMachine,
  validateContractTransition,
  getValidContractTransitions,
  isClosedStatus,
  CLOSED_CONTRACT_STATUSES,
  type ClosedContractStatus,
} from './state-machine/contract-state-machine';

export {
  liquidacionMachine,
  validateLiquidacionTransition,
  getValidLiquidacionTransitions,
  RECEIVABLE_STATUSES,
  OVERDUE_STATUSES,
} from './state-machine/liquidacion-state-machine';

export { collectionCaseMachine } from './state-machine/collection-case-state-machine';

export {
  rendicionMachine,
  validateRendicionTransition,
  getValidRendicionTransitions,
} from './state-machine/rendicion-state-machine';

// Constants & utilities
export {
  DEFAULT_ALQUILER_STAGES,
  DEFAULT_VENTA_STAGES,
  DEFAULT_PIPELINE_STAGES,
  TICKET_SLA_HOURS,
} from './constants';

export type { DefaultStageDefinition } from './constants';

// Template engine
export {
  renderTemplate,
  renderTemplatePlain,
  extractVariableNames,
  escapeHtml,
} from './template-engine';

// Fechas en UTC y dinero exacto
export {
  addMonthsClamped,
  periodToMonths,
  monthStartUTC,
  periodFilter,
  periodKey,
  todayInAR,
  formatDateAR,
  AR_TIME_ZONE,
  normalizeTimeZone,
} from './date-utils';
export { Money, round2, toAmountString, sumMoney, allocateLargestRemainder } from './money';
export type { MoneyInput } from './money';

// Formato de datos para mostrar
export { propertyLabel, personName, formatMoneyAR, formatPeriodAR, formatPeriodShortAR, formatReceiptNumber } from './format';
export type { PropertyLabelInput, PersonNameInput, MoneyLike } from './format';

// Adjustment engine
export {
  calculateIPC,
  calculateICL,
  calculateCCP,
  calculateFixedPercent,
  calculateCustom,
  calculateUVA,
  calculateEscalonado,
  calculateAdjustment,
  shiftWindowByLag,
  expectedMonthlyPeriods,
  monthsBetween,
  isWithinFixedInitialPeriod,
  resolveAdjustmentBasis,
  assessCoverage,
  calculateTrueUp,
  monthsInRange,
} from './adjustment-engine';
export type {
  AdjustmentResult,
  AdjustmentParams,
  EscalonadoStep,
  IndexWindow,
  AdjustmentBasisInput,
  IndexObservation,
  Coverage,
  TrueUpInput,
  TrueUpResult,
} from './adjustment-engine';

// Liquidacion engine
export {
  calculateLineItemsTotal,
  calculateRemainingBalance,
  isFullyPaid,
  InvalidLineAmountError,
  defaultCommissionable,
  defaultBeneficiary,
} from './liquidacion-engine';
export type { LineItemInput, LineItemsTotalResult, PaymentInput } from './liquidacion-engine';

// Commission engine
export { calculateCommission, InvalidCommissionError } from './commission-engine';
export type { CommissionConfig, CommissionResult } from './commission-engine';

// Settlement engine: reparto de un cobro entre inmobiliaria, entes y locadores
export {
  settlePayment,
  settlementBuckets,
  checkCompensation,
  compensationDefault,
  convertAmount,
  accountBalance,
  SettlementError,
  LessorDirectOwes,
  PartialAllocation,
  CompensationScope,
  DEFAULT_SETTLEMENT_OPTIONS,
} from './settlement-engine';
export type {
  SettlementInput,
  SettlementResult,
  SettlementLine,
  SettlementLessor,
  SettlementPosition,
  SettlementCompensation,
  SettlementBuckets,
  SettlementOptions,
  SettlementFlow,
  SettlementErrorCode,
} from './settlement-engine';

// Caja: series de recibos y categorías manuales
export {
  ReceiptSeriesMode,
  PAYMENT_RECEIPT_SERIES,
  receiptSeriesFor,
  MANUAL_CASH_CATEGORIES,
  defaultDirectionFor,
} from './cash';

// Schemas — caja y cobros
export {
  CreateFinancialAccountSchema,
  UpdateFinancialAccountSchema,
  FinancialAccountFilterSchema,
  CashMovementFilterSchema,
  CreateCashMovementSchema,
  CreateConversionSchema,
  DeliverCustodySchema,
  CreateCompensationSchema,
  ReceiptFilterSchema,
  AgencyExpenseSchema,
} from './schemas/cash.schema';
export type {
  CreateFinancialAccountInput,
  CreateCashMovementInput,
  CreateConversionInput,
  CreateCompensationInput,
} from './schemas/cash.schema';

// Cuenta corriente y estado de cuenta del locador (ADR-0009)
export {
  LessorChargeTiming,
  PAYOUT_ENTRY_TYPES,
  ledgerTypeForLine,
  paymentPostings,
  splitByShare,
  repairManagementFee,
  statementPeriodFor,
  statementPeriodRange,
  computeStatement,
  statementsByCurrency,
} from './owner-ledger';
export type {
  LedgerPosting,
  PaymentPostingInput,
  PostingLine,
  PostingPosition,
  StatementEntry,
  StatementGroup,
  StatementResult,
} from './owner-ledger';
export {
  OwnerLedgerFilterSchema,
  OpeningBalanceSchema,
  OWNER_PAYOUT_METHODS,
  OwnerPayoutSchema,
  GenerateOwnerStatementsSchema,
  OwnerStatementListSchema,
  AnnulOwnerStatementSchema,
} from './schemas/owner-account.schema';
export type { OpeningBalanceInput, OwnerPayoutInput } from './schemas/owner-account.schema';

// Vencimientos: checklists y semáforo
export {
  FOLLOW_UP_CHECKLISTS,
  checklistFor,
  ExpirationLight,
  daysUntil,
  expirationLight,
} from './follow-up';
export type { FollowUpTaskTemplate, ExpirationThresholds } from './follow-up';

// Schemas — vencimientos, prórroga de palabra y renovación
export {
  FollowUpFilterSchema,
  UpdateFollowUpSchema,
  ToggleFollowUpTaskSchema,
  OralExtensionSchema,
  RenewalRuleSchema,
  RenewContractSchema,
} from './schemas/follow-up.schema';
export type {
  FollowUpFilterInput,
  UpdateFollowUpInput,
  OralExtensionInput,
  RenewContractInput,
} from './schemas/follow-up.schema';

// Honorarios (D10): motor y esquemas
export {
  ContractTotalMode,
  StaffCommissionBase,
  FeePayerChoice,
  SaleAsset,
  FeeEngineError,
  contractTermMonths,
  contractTotal,
  feeAmounts,
  pctOf,
  splitBetweenPayers,
  feeInstallments,
  adjustInstallments,
  distributeFee,
  defaultFeePct,
} from './fee-engine';
export type {
  FeeRentRule,
  ContractTotalResult,
  FeeAmounts,
  FeeInstallmentDraft,
  RentChange,
  FeeDistribution,
} from './fee-engine';
export {
  FeePayerMode,
  FeePreviewSchema,
  FeePayerInputSchema,
  FeeShareInputSchema,
  StaffCommissionInputSchema,
  CreateFeeSchema,
  UpdateFeeSchema,
  CancelFeeSchema,
  FeeFilterSchema,
  FeeInstallmentFilterSchema,
  PayFeeInstallmentSchema,
  StaffCommissionFilterSchema,
  PayStaffCommissionSchema,
} from './schemas/fee.schema';
export type {
  FeePreviewInput,
  CreateFeeInput,
  CreateFeeFormInput,
  PayFeeInstallmentInput,
  StaffCommissionInput,
  FeeShareInput,
} from './schemas/fee.schema';

// Rendicion engine (histórico: lo usa solo la rendición vieja; el reparto de cobros es settlement-engine)
export {
  buildRendicionFromPayments,
  splitRendicionAmongLessors,
  InvalidRendicionLineError,
} from './rendicion-engine';
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
  PenaltyModeEnum,
  PenaltyConfigSchema,
  PreviewPenaltySchema,
  WaivePenaltySchema,
  PayoffQuerySchema,
  WaiveAllQuerySchema,
} from './schemas/penalty-config.schema';
export type {
  PenaltyMode,
  PenaltyConfig,
  PreviewPenaltyInput,
} from './schemas/penalty-config.schema';

export { NotificationFilterSchema } from './schemas/notification.schema';

// Mensajería saliente (ADR-0013)
export {
  MESSAGING_MODES,
  parseMessagingMode,
  normalizeEmail,
  normalizePhone,
  normalizeAddress,
  parseAllowlist,
  DEFAULT_SENDING_WINDOW,
  isInsideSendingWindow,
  nextSendingWindowStart,
  MESSAGE_TEMPLATE_KEYS,
  MESSAGE_TEMPLATES,
  REDACTED,
  redactMessageVars,
  requiresOptIn,
} from './messaging';
export type {
  MessagingMode,
  SendingWindow,
  MessageAttachmentKind,
  MessageTemplateInfo,
  MessageTemplateKey,
} from './messaging';
export {
  OutboxFilterSchema,
  SENDABLE_DOCUMENTS,
  SendDocumentSchema,
  SetConsentSchema,
} from './schemas/messaging.schema';
export type {
  OutboxFilter,
  SendableDocument,
  SendDocumentInput,
  SetConsentInput,
  OutboxItem,
  OutboxPage,
  ChannelConsent,
  PersonConsents,
  MessagingSettings,
} from './schemas/messaging.schema';
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
  EstimateTicketSchema,
  PreauthorizeTicketSchema,
  CreateTicketQuoteSchema,
  UpdateTicketQuoteSchema,
  ApproveTicketQuoteSchema,
  RegisterProviderPaymentSchema,
  RepairFeeSchema,
  ImputeTicketSchema,
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
  ImputeTicketSchema as _ImputeTicketSchema,
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
export type ImputeTicketInput = z.infer<typeof _ImputeTicketSchema>;
export type CreateProviderProfileInput = z.infer<typeof _CreateProviderProfileSchema>;
export type UpdateProviderProfileInput = z.infer<typeof _UpdateProviderProfileSchema>;
export type ProviderFilterInput = z.infer<typeof _ProviderFilterSchema>;
export type AssignProviderInput = z.infer<typeof _AssignProviderSchema>;

// ── Incidencias y reparaciones ──────────────────────────
export {
  TICKET_STEPS,
  ticketStep,
  ticketStepIndex,
  PROVIDER_PAYMENT_STATUSES,
  IMPUTATION_STATUSES,
  QUOTING_STATUSES,
  requiresPreauthorization,
  ticketRepairFee,
  totalPaid,
  feeApplies,
} from './ticket-repairs';
export type {
  TicketStep,
  PreauthorizationCheck,
  RepairFeeMode,
  RepairFeeInput,
} from './ticket-repairs';

// ── State machine ───────────────────────────────────────
export {
  ticketMachine,
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

// Schemas — priorizacion diaria asistida por modelo de lenguaje
export {
  AiPriorityUrgencySchema,
  AiPriorityItemSchema,
  AiPrioritiesResponseSchema,
} from './schemas/ai.schema';
import {
  AiPriorityUrgencySchema as _AiPriorityUrgencySchema,
  AiPriorityItemSchema as _AiPriorityItemSchema,
  AiPrioritiesResponseSchema as _AiPrioritiesResponseSchema,
} from './schemas/ai.schema';
export type AiPriorityUrgency = z.infer<typeof _AiPriorityUrgencySchema>;
export type AiPriorityItem = z.infer<typeof _AiPriorityItemSchema>;
export type AiPrioritiesResponse = z.infer<typeof _AiPrioritiesResponseSchema>;

// Schemas — resumen de gestion al cierre de contrato
export {
  ClosureSummarySourceSchema,
  ContractClosureMetricsSchema,
  AiClosureSummaryResponseSchema,
} from './schemas/ai.schema';
import {
  ClosureSummarySourceSchema as _ClosureSummarySourceSchema,
  ContractClosureMetricsSchema as _ContractClosureMetricsSchema,
  AiClosureSummaryResponseSchema as _AiClosureSummaryResponseSchema,
} from './schemas/ai.schema';
export type ClosureSummarySource = z.infer<typeof _ClosureSummarySourceSchema>;
export type ContractClosureMetrics = z.infer<typeof _ContractClosureMetricsSchema>;
export type AiClosureSummaryResponse = z.infer<typeof _AiClosureSummaryResponseSchema>;

// Liquidation builder
export { buildLiquidation, lastMonthRent, onBehalfOfText } from './liquidation-builder';
export {
  accruePenalty,
  splitPayments,
  daysOverdueBetween,
  BNA_RATE_KINDS,
  PARTIAL_PAYMENT_ALLOCATIONS,
  ROUNDING_MODES,
  CAP_BASES,
  MISSING_RATE_BEHAVIORS,
  PENALTY_MODES,
  DEFAULT_BNA_MULTIPLIER,
  DEFAULT_YEAR_DAYS,
} from './penalty-engine';
export type {
  PenaltyRule,
  PenaltyRuleMode,
  BnaRate,
  PenaltyPayment,
  AccruePenaltyInput,
  AccruedPenalty,
  SplitPaymentsInput,
} from './penalty-engine';
export type {
  BuilderResult,
  BuiltLine,
  BuiltLiquidation,
  LiquidationBuilderInput,
  LiquidationConventionsInput,
  LiquidationExtraLine,
  LiquidationSkipReason,
} from './liquidation-builder';

// Charge split
export { splitBill, chargeAllocationLine, chargeAllocationLines, InvalidChargeRuleError } from './charge-split';
export type {
  ChargeAllocation,
  ChargeBillInput,
  ChargeLineSource,
  ChargeRuleInput,
  ChargeSkipReason,
  ChargeSplitResult,
} from './charge-split';

// Centro de carga
export {
  imputationTarget,
  pendingChargeLine,
  requiresUpfront,
  signedChargeAmount,
  splitInstallments,
} from './pending-charge';
export type { ChargeImputationTarget, PendingChargeLineSource, UpfrontCheck } from './pending-charge';

// Amount in words
export { amountInWords } from './amount-in-words';

// Importación desde el sistema anterior (lotes por referencia externa)
export {
  ImportBankAccountSchema,
  ImportPersonSchema,
  ImportPropertySchema,
  ImportContractSchema,
  ImportBatchRequestSchema,
  ImportBatchRowsQuerySchema,
  IMPORT_ERROR_CODES,
} from './schemas/import-batch.schema';
export type {
  ImportPersonRow,
  ImportPropertyRow,
  ImportContractRow,
  ImportBatchRequest,
  ImportBatchCounts,
  ImportRowErrorDetail,
  ImportErrorCode,
} from './schemas/import-batch.schema';

export {
  DATA_QUALITY_CHECKS,
  DATA_QUALITY_CHECK_IDS,
  DataQualityFindingsQuerySchema,
  MergePersonsSchema,
} from './schemas/data-quality.schema';
export type {
  DataQualityCheckId,
  DataQualityGroup,
  DataQualitySeverity,
  DataQualityEntityType,
  DataQualityFinding,
  DataQualitySummaryItem,
  DataQualitySummary,
  DataQualityPage,
  MergePersonsInput,
  MergePersonsPlanItem,
  MergePersonsPlan,
  MergePersonsResult,
} from './schemas/data-quality.schema';

export {
  MoveOutItemKind,
  rentAt,
  updatedDepositFactor,
  depositRefundAmount,
  depositSchedule,
  depositStatusFor,
  refundDueDate,
  refundSchedule,
  computeMoveOut,
} from './deposit-engine';
export type {
  RentStep,
  DepositRefundInput,
  DepositInstallmentRow,
  MoveOutItem,
  MoveOutInput,
  MoveOutResult,
} from './deposit-engine';
export {
  UpsertDepositSchema,
  CollectDepositInstallmentSchema,
  MoveOutItemSchema,
  MoveOutPreviewQuerySchema,
  CreateMoveOutSchema,
  ConfirmMoveOutSchema,
} from './schemas/deposit.schema';
export type { UpsertDepositInput, CreateMoveOutInput } from './schemas/deposit.schema';

// Facturación por cuenta del locador
export {
  LessorInvoiceScope,
  LessorInvoiceWhen,
  LESSOR_INVOICE_VAT_RATES,
  InvoicingSettingsSchema,
  LessorInvoicingOverrideSchema,
  DEFAULT_INVOICING_SETTINGS,
  resolveInvoicingSettings,
  SCOPE_ENTRY_TYPES,
  lessorInvoiceAmount,
  splitVatIncluded,
  lessorInvoiceKey,
} from './lessor-invoicing';
export type { InvoicingSettings, LessorInvoicingOverride } from './lessor-invoicing';
export { LessorInvoiceJobFilterSchema, LessorIssuerCreateSchema } from './schemas/lessor-invoicing.schema';

// Reconciliación del ciclo mensual (ítem 45): formato, comparador, ciclo puro y caso de caracterización
export {
  CONTRACT_CONCEPTS,
  STATEMENT_CONCEPTS,
  LESSOR_NET_PREFIX,
  contractConcepts,
  statementConcepts,
  statementKey,
  compareReconciliation,
  formatDifferences,
} from './reconciliation/format';
export type {
  ReconciliationResult,
  ReconciliationScope,
  ReconciliationDifference,
  ContractSnapshot,
  SnapshotLine,
} from './reconciliation/format';
export { runCycle } from './reconciliation/cycle';
export type {
  CycleInput,
  CycleAgency,
  CycleLessor,
  CycleContract,
  CycleAdjustment,
  CycleCommission,
  CycleBill,
  CycleBillRule,
  CycleCharge,
  CyclePayment,
  CycleCompensation,
  CyclePayout,
  CycleOpeningBalance,
  CycleCurrency,
} from './reconciliation/cycle';
export { RECONCILIATION_CYCLE, RECONCILIATION_EXPECTED } from './reconciliation/characterization.fixture';

// Publicación: portales, avisos por portal y aviso optimizado
export * from './publication';

// ─── Ventas y llaves ────────────────────────────────────
export {
  SalesOperationStatus,
  SalesPartyRole,
  SalesDepositKind,
  SalesDepositHolder,
  SalesDepositStatus,
  KeyHolder,
} from './enums';
export { salesMachine, OPEN_SALES_STATUSES } from './state-machine/sales-state-machine';
export {
  SALES_DOC_TEMPLATE,
  SALES_DOC_CODES,
  hasUnresolvedMoney,
  blocksLeavingStage,
  isDepositExpired,
  reservationExpiry,
} from './sales';
export type { SalesDocTemplateItem } from './sales';
export {
  SalesPartyInputSchema,
  CreateSalesOperationSchema,
  UpdateSalesOperationSchema,
  SetSalesPartiesSchema,
  SalesFilterSchema,
  TransitionSalesSchema,
  CreateSalesDepositSchema,
  UpdateSalesDepositSchema,
  ReceiveSalesDepositSchema,
  RefundSalesDepositSchema,
  ForfeitSalesDepositSchema,
  SalesPendingDepositsFilterSchema,
  UpdateSalesDocCheckSchema,
  CreateSalesFeeSchema,
  CreateKeySetSchema,
  UpdateKeySetSchema,
  KeyCheckOutSchema,
  KeyCheckInSchema,
  KeysOutFilterSchema,
} from './schemas/sales.schema';
export type {
  CreateSalesOperationInput,
  TransitionSalesInput,
  CreateSalesDepositInput,
  CreateKeySetInput,
  KeyCheckOutInput,
} from './schemas/sales.schema';

// Cobranza escalonada
export {
  COLLECTION_MAX_LEVEL,
  DEFAULT_COLLECTION_POLICY,
  planCollection,
  isActionDue,
  stageAfter,
  reminderKind,
  daysOverdue,
  addDays,
  joinPeriods,
} from './collection-engine';
export type {
  CollectionPolicy,
  CollectionCaseInput,
  CollectionPlan,
  CollectionPlanStatus,
  LetterFields,
} from './collection-engine';
export {
  CollectionCaseFilterSchema,
  AddCollectionNoteSchema,
  CollectionAgreementSchema,
  ConfirmLetterSentSchema,
  UpdateLetterSchema,
  DeriveToLawyerSchema,
  CollectionNoteBodySchema,
  CloseCollectionCaseSchema,
  AssignCollectionCaseSchema,
} from './schemas/collection.schema';
export type {
  CollectionCaseFilter,
  CollectionAgreementInput,
  UpdateLetterInput,
  CollectionDebtLine,
  CollectionActionItem,
  CollectionCaseItem,
  CollectionCasePage,
  CollectionCaseDetail,
} from './schemas/collection.schema';
