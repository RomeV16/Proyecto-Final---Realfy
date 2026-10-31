import { z } from 'zod';
import { LessorCapacity, PowerScope, SignatureMode } from '../enums';

const dateString = z.string().datetime({ offset: true }).or(z.coerce.date());

/** Porcentaje con hasta 4 decimales, mayor que 0 y como máximo 100. */
export const payoutPctSchema = z
  .union([z.string(), z.number().transform(String)])
  .pipe(z.string().regex(/^\d{1,3}(\.\d{1,4})?$/, 'Must be a percentage with up to 4 decimals'))
  .refine((v) => Number(v) > 0 && Number(v) <= 100, {
    message: 'Must be greater than 0 and at most 100',
  });

const validWindow = (data: { validFrom?: unknown; validTo?: unknown }) =>
  !data.validFrom ||
  !data.validTo ||
  new Date(data.validTo as string).getTime() > new Date(data.validFrom as string).getTime();

const validWindowIssue = { message: 'validTo must be after validFrom', path: ['validTo'] };

// ─── Locadores del contrato ─────────────────────────────

const lessorFields = {
  personId: z.string().uuid(),
  capacity: z.nativeEnum(LessorCapacity).optional().default(LessorCapacity.Propietario),
  payoutPct: payoutPctSchema,
  payeePersonId: z.string().uuid().optional().nullable(),
  bankAccountId: z.string().uuid().optional().nullable(),
  validFrom: dateString.optional(),
  validTo: dateString.optional().nullable(),
};

export const CreateContractLessorSchema = z.object(lessorFields).refine(validWindow, validWindowIssue);

export const UpdateContractLessorSchema = z
  .object({
    capacity: z.nativeEnum(LessorCapacity).optional(),
    payoutPct: payoutPctSchema.optional(),
    payeePersonId: lessorFields.payeePersonId,
    bankAccountId: lessorFields.bankAccountId,
    validFrom: dateString.optional(),
    validTo: lessorFields.validTo,
    needsReview: z.boolean().optional(),
  })
  .refine(validWindow, validWindowIssue);

/** Reemplazo atómico del conjunto de locadores (las filas con `id` se actualizan). */
export const ReplaceContractLessorsSchema = z.object({
  lessors: z
    .array(z.object({ id: z.string().uuid().optional(), ...lessorFields }).refine(validWindow, validWindowIssue))
    .min(1, 'At least one lessor is required'),
});

// ─── Poderes ────────────────────────────────────────────

const powerFields = {
  agentId: z.string().uuid(),
  scopes: z
    .array(z.nativeEnum(PowerScope))
    .min(1, 'At least one scope is required')
    .transform((scopes) => [...new Set(scopes)]),
  signatureMode: z.nativeEnum(SignatureMode).optional().default(SignatureMode.Indistinta),
  groupKey: z.string().min(1).max(100).optional().nullable(),
  contractId: z.string().uuid().optional().nullable(),
  propertyId: z.string().uuid().optional().nullable(),
  validFrom: dateString.optional(),
  validTo: dateString.optional().nullable(),
  documentUrl: z.string().url().max(2000).optional().nullable(),
};

export const CreatePowerOfAttorneySchema = z
  .object(powerFields)
  .refine((d) => !(d.contractId && d.propertyId), {
    message: 'A power applies to a contract or to a property, not both',
    path: ['propertyId'],
  })
  .refine((d) => d.signatureMode === SignatureMode.Conjunta || !d.groupKey, {
    message: 'groupKey only applies to joint signature',
    path: ['groupKey'],
  })
  .refine(validWindow, validWindowIssue);

export const UpdatePowerOfAttorneySchema = z
  .object({
    scopes: powerFields.scopes.optional(),
    signatureMode: z.nativeEnum(SignatureMode).optional(),
    groupKey: powerFields.groupKey,
    validFrom: powerFields.validFrom,
    validTo: powerFields.validTo,
    documentUrl: powerFields.documentUrl,
  })
  .refine(validWindow, validWindowIssue);

export const PowerOfAttorneyFilterSchema = z.object({
  as: z.enum(['principal', 'agent']).optional().default('principal'),
  activeOn: dateString.optional(),
});

// ─── Titularidad de propiedades ─────────────────────────

export const CreatePropertyOwnershipSchema = z
  .object({
    personId: z.string().uuid(),
    sharePct: payoutPctSchema.optional().nullable(),
    title: z.string().max(200).optional().nullable(),
    since: dateString.optional().nullable(),
    until: dateString.optional().nullable(),
  })
  .refine(
    (d) => !d.since || !d.until || new Date(d.until).getTime() > new Date(d.since).getTime(),
    { message: 'until must be after since', path: ['until'] },
  );
