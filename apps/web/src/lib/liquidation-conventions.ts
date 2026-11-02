import {
  FirstDueMode,
  FixedDiscountProration,
  MidMonthAdjustmentMode,
  ProrationMode,
  UpfrontBasis,
} from '@realfy/shared';

/** Las convenciones de liquidación y de anticipo que se pactan por contrato, con su valor por defecto en la inmobiliaria. */
export const CONVENTION_FIELDS = [
  'prorationMode',
  'midMonthAdjustmentMode',
  'firstDueMode',
  'fixedDiscountProration',
  'upfrontBasis',
] as const;

export type ConventionField = (typeof CONVENTION_FIELDS)[number];

export type ConventionValues = Record<ConventionField, string>;

/** Opciones de cada convención, en el orden en que se muestran. */
export const CONVENTION_OPTIONS: Record<ConventionField, readonly string[]> = {
  prorationMode: Object.values(ProrationMode),
  midMonthAdjustmentMode: Object.values(MidMonthAdjustmentMode),
  firstDueMode: Object.values(FirstDueMode),
  fixedDiscountProration: Object.values(FixedDiscountProration),
  upfrontBasis: Object.values(UpfrontBasis),
};

export function isConventionField(field: string): field is ConventionField {
  return (CONVENTION_FIELDS as readonly string[]).includes(field);
}
