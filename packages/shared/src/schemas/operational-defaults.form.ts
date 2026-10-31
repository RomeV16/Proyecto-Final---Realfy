import { z } from 'zod';
import type { OperationalDefaults, OperationalDefaultsInput } from './operational-defaults.schema';

// Esquema del formulario web de valores por defecto: todos los campos viajan
// como texto (lo que escribe la persona) y se convierten con
// `operationalDefaultsFromForm`. Los mensajes son claves i18n.

const numberText = (opts: { int?: boolean; min: number; max?: number }) =>
  z
    .string()
    .trim()
    .min(1, { message: 'validation.required' })
    .refine((v) => /^\d+([.,]\d+)?$/.test(v), { message: 'validation.invalidNumber' })
    .refine((v) => !opts.int || /^\d+$/.test(v), { message: 'validation.invalidNumber' })
    .refine((v) => Number(v.replace(',', '.')) >= opts.min, { message: 'validation.outOfRange' })
    .refine((v) => opts.max === undefined || Number(v.replace(',', '.')) <= opts.max, {
      message: 'validation.outOfRange',
    });

export const operationalDefaultsFormSchema = z
  .object({
    dueDay: numberText({ int: true, min: 1, max: 28 }),
    leadDays: numberText({ int: true, min: 0, max: 60 }),
    ipcLagMonths: numberText({ int: true, min: 0, max: 12 }),
    commissionPct: numberText({ min: 0, max: 100 }),
    feeAlta: numberText({ min: 0, max: 100 }),
    feeRenovacion: numberText({ min: 0, max: 100 }),
    feeVentaConstruido: numberText({ min: 0, max: 100 }),
    feeVentaLote: numberText({ min: 0, max: 100 }),
    valuationUsd: numberText({ min: 0 }),
    upfrontThresholdFees: numberText({ min: 0 }),
    firstReminderDays: numberText({ int: true, min: 0, max: 365 }),
    everyDays: numberText({ int: true, min: 1, max: 365 }),
    redDays: numberText({ int: true, min: 0, max: 365 }),
    yellowDays: numberText({ int: true, min: 0, max: 365 }),
  })
  .refine((v) => Number(v.yellowDays) >= Number(v.redDays) || !/^\d+$/.test(v.yellowDays), {
    message: 'validation.outOfRange',
    path: ['yellowDays'],
  });

export type OperationalDefaultsFormInput = z.infer<typeof operationalDefaultsFormSchema>;

const num = (v: string) => Number(v.replace(',', '.'));

/** Valores guardados -> texto de los campos. */
export function operationalDefaultsToForm(d: OperationalDefaults): OperationalDefaultsFormInput {
  return {
    dueDay: String(d.dueDay),
    leadDays: String(d.leadDays),
    ipcLagMonths: String(d.ipcLagMonths),
    commissionPct: String(d.commissionPct),
    feeAlta: String(d.fees.alta),
    feeRenovacion: String(d.fees.renovacion),
    feeVentaConstruido: String(d.fees.ventaConstruido),
    feeVentaLote: String(d.fees.ventaLote),
    valuationUsd: String(d.valuationUsd),
    upfrontThresholdFees: String(d.upfrontThresholdFees),
    firstReminderDays: String(d.collectionCadence.firstReminderDays),
    everyDays: String(d.collectionCadence.everyDays),
    redDays: String(d.expiryLight.redDays),
    yellowDays: String(d.expiryLight.yellowDays),
  };
}

/** Texto de los campos (ya validado) -> cuerpo de `PUT /tenants/me/operational-defaults`. */
export function operationalDefaultsFromForm(f: OperationalDefaultsFormInput): OperationalDefaultsInput {
  return {
    dueDay: num(f.dueDay),
    leadDays: num(f.leadDays),
    ipcLagMonths: num(f.ipcLagMonths),
    commissionPct: num(f.commissionPct),
    fees: {
      alta: num(f.feeAlta),
      renovacion: num(f.feeRenovacion),
      ventaConstruido: num(f.feeVentaConstruido),
      ventaLote: num(f.feeVentaLote),
    },
    valuationUsd: num(f.valuationUsd),
    upfrontThresholdFees: num(f.upfrontThresholdFees),
    collectionCadence: { firstReminderDays: num(f.firstReminderDays), everyDays: num(f.everyDays) },
    expiryLight: { redDays: num(f.redDays), yellowDays: num(f.yellowDays) },
  };
}
