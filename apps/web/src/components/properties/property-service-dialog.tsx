'use client';

import { useTranslations } from 'next-intl';
import { BILL_PROVIDER_KEYS, BillingFrequency, Currency, ServiceType } from '@realfy/shared';
import { apiClient } from '@/lib/api-client';
import { parseAmountInput } from '@/lib/service-bills';
import { FieldsDialog, type FieldDef, type FieldValues } from '@/components/ui/fields-dialog';

export interface PropertyService {
  id: string;
  propertyId: string;
  serviceType: string;
  providerName: string | null;
  providerKey: string | null;
  accountNumber: string | null;
  amount: string | number;
  currency: string;
  dueDay: number;
  billingFrequency: string;
  hasAnnualOption: boolean;
  isActive: boolean;
  notes: string | null;
}

const YES = 'yes';
const NO = 'no';

/** El cuerpo del alta o la edición: la cuenta se manda tal cual, la API la valida y normaliza según el proveedor. */
export function buildServicePayload(values: FieldValues, providerLabel: (key: string) => string) {
  const key = values.providerKey || null;
  const named = key && key !== 'generico' ? providerLabel(key) : values.providerName || null;
  return {
    serviceType: values.serviceType,
    providerKey: key,
    providerName: named,
    accountNumber: values.accountNumber || null,
    amount: Number(parseAmountInput(values.amount)),
    currency: values.currency,
    dueDay: Number(values.dueDay),
    billingFrequency: values.billingFrequency,
    hasAnnualOption: values.hasAnnualOption === YES,
    notes: values.notes || null,
  };
}

interface Props {
  propertyId: string;
  /** Con un servicio es edición; sin él, alta. */
  service?: PropertyService;
  onClose: () => void;
  onDone: () => void;
}

/** Alta y edición de un servicio o impuesto de la propiedad (`POST` / `PATCH /services`). */
export function PropertyServiceDialog({ propertyId, service, onClose, onDone }: Props) {
  const t = useTranslations('propertyServices');
  const tTypes = useTranslations('services.serviceTypes');

  const fields: FieldDef[] = [
    {
      name: 'serviceType',
      label: t('fields.serviceType'),
      kind: 'select',
      required: true,
      options: Object.values(ServiceType).map((v) => ({ value: v, label: tTypes(v) })),
    },
    {
      name: 'providerKey',
      label: t('fields.providerKey'),
      hint: t('fields.providerKeyHint'),
      kind: 'select',
      options: BILL_PROVIDER_KEYS.map((k) => ({ value: k, label: t(`providers.${k}`) })),
    },
    {
      name: 'providerName',
      label: t('fields.providerName'),
      visible: (v) => !v.providerKey || v.providerKey === 'generico',
    },
    { name: 'accountNumber', label: t('fields.accountNumber'), hint: t('fields.accountNumberHint') },
    { name: 'amount', label: t('fields.amount'), kind: 'amount', required: true },
    {
      name: 'currency',
      label: t('fields.currency'),
      kind: 'select',
      required: true,
      options: Object.values(Currency).map((c) => ({ value: c, label: c })),
    },
    {
      name: 'dueDay',
      label: t('fields.dueDay'),
      kind: 'select',
      required: true,
      options: Array.from({ length: 31 }, (_, i) => ({ value: String(i + 1), label: String(i + 1) })),
    },
    {
      name: 'billingFrequency',
      label: t('fields.billingFrequency'),
      kind: 'select',
      required: true,
      options: Object.values(BillingFrequency).map((f) => ({ value: f, label: t(`frequencies.${f}`) })),
    },
    {
      name: 'hasAnnualOption',
      label: t('fields.hasAnnualOption'),
      kind: 'select',
      required: true,
      options: [
        { value: NO, label: t('no') },
        { value: YES, label: t('yes') },
      ],
    },
    { name: 'notes', label: t('fields.notes'), kind: 'textarea' },
  ];

  const initial: FieldValues = service
    ? {
        serviceType: service.serviceType,
        providerKey: service.providerKey ?? '',
        providerName: service.providerName ?? '',
        accountNumber: service.accountNumber ?? '',
        amount: String(service.amount).replace('.', ','),
        currency: service.currency,
        dueDay: String(service.dueDay),
        billingFrequency: service.billingFrequency,
        hasAnnualOption: service.hasAnnualOption ? YES : NO,
        notes: service.notes ?? '',
      }
    : {
        serviceType: ServiceType.Electricidad,
        currency: Currency.ARS,
        dueDay: '10',
        billingFrequency: BillingFrequency.Mensual,
        hasAnnualOption: NO,
      };

  return (
    <FieldsDialog
      title={service ? t('editTitle') : t('createTitle')}
      fields={fields}
      initial={initial}
      submitLabel={service ? t('saveChanges') : t('create')}
      successMessage={service ? t('updated') : t('created')}
      errorFallback={t('saveError')}
      request={(values) => {
        const body = buildServicePayload(values, (k) => t(`providers.${k}`));
        return service
          ? apiClient(`/services/${service.id}`, { method: 'PATCH', body: JSON.stringify(body) })
          : apiClient('/services', { method: 'POST', body: JSON.stringify({ ...body, propertyId }) });
      }}
      onClose={onClose}
      onDone={onDone}
    />
  );
}
