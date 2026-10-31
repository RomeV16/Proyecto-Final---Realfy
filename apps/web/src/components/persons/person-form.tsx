'use client';

import { useTranslations } from 'next-intl';
import { FiscalCondition } from '@realfy/shared';
import { personFormSchema } from '@realfy/shared/schemas';
import { apiClient, ApiRequestError } from '@/lib/api-client';
import { FormShell } from '@/components/ui/form-shell';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useSchemaMessages, useZodForm } from '@/hooks/use-zod-form';

export interface PersonFormData {
  id?: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  phone2: string;
  cuit: string;
  fiscalCondition: string;
  bankName: string;
  cbu: string;
  bankAlias: string;
  notes: string;
}

const EMPTY_PERSON: PersonFormData = {
  firstName: '', lastName: '', email: '', phone: '', phone2: '',
  cuit: '', fiscalCondition: '', bankName: '', cbu: '', bankAlias: '', notes: '',
};

function formatCuit(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 11);
  if (digits.length <= 2) return digits;
  if (digits.length <= 10) return `${digits.slice(0, 2)}-${digits.slice(2)}`;
  return `${digits.slice(0, 2)}-${digits.slice(2, 10)}-${digits.slice(10)}`;
}

interface PersonFormProps {
  mode: 'create' | 'edit';
  initialData?: PersonFormData;
  personId?: string;
  onSuccess?: (id: string) => void;
  onCancel?: () => void;
}

export function PersonForm({ mode, initialData, personId, onSuccess, onCancel }: PersonFormProps) {
  const t = useTranslations('persons');
  const tForm = useTranslations('persons.form');
  const tCommon = useTranslations('common');
  const { values: form, set, errors, formError, submitting, submit } = useZodForm({
    schema: personFormSchema,
    initialValues: initialData || EMPTY_PERSON,
    translate: useSchemaMessages(),
  });

  const handleSubmit = submit(async () => {
    const body: Record<string, unknown> = {
      firstName: form.firstName, lastName: form.lastName,
      email: form.email || undefined, phone: form.phone || undefined,
      phone2: form.phone2 || undefined, cuit: form.cuit || undefined,
      fiscalCondition: form.fiscalCondition || undefined,
      bankName: form.bankName || undefined, cbu: form.cbu || undefined,
      bankAlias: form.bankAlias || undefined, notes: form.notes || undefined,
    };
    Object.keys(body).forEach((k) => { if (body[k] === undefined) delete body[k]; });
    if (mode === 'create') {
      const res = await apiClient<{ id: string }>('/persons', { method: 'POST', body: JSON.stringify(body) });
      onSuccess?.(res.id);
    } else {
      await apiClient(`/persons/${personId}`, { method: 'PATCH', body: JSON.stringify(body) });
      onSuccess?.(personId!);
    }
  });

  const error = formError instanceof ApiRequestError ? formError.message : formError ? tForm('error') : '';

  return (
    <FormShell
      onSubmit={handleSubmit}
      submitLabel={submitting ? (mode === 'create' ? tForm('creating') : tForm('updating')) : tForm('submit')}
      submitBusy={submitting}
      secondaryAction={onCancel ? { label: tCommon('cancel'), onClick: onCancel } : undefined}
    >
      {error && <div role="alert" className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">{error}</div>}
      <FormShell.Section title={tForm('personalInfo')} className="max-w-sm sm:max-w-none">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <FormField label={tForm('firstName')} required error={errors.firstName}>
            {(c) => <Input {...c} value={form.firstName} onChange={(e) => set('firstName', e.target.value)} placeholder={tForm('firstNamePlaceholder')} />}
          </FormField>
          <FormField label={tForm('lastName')} required error={errors.lastName}>
            {(c) => <Input {...c} value={form.lastName} onChange={(e) => set('lastName', e.target.value)} placeholder={tForm('lastNamePlaceholder')} />}
          </FormField>
          <FormField label={tForm('email')} error={errors.email}>
            {(c) => <Input {...c} type="email" value={form.email} onChange={(e) => set('email', e.target.value)} placeholder={tForm('emailPlaceholder')} />}
          </FormField>
          <FormField label={tForm('phone')} error={errors.phone}>
            {(c) => <Input {...c} type="tel" value={form.phone} onChange={(e) => set('phone', e.target.value)} placeholder={tForm('phonePlaceholder')} />}
          </FormField>
          <FormField label={tForm('phone2')} error={errors.phone2} className="sm:col-span-2">
            {(c) => <Input {...c} type="tel" value={form.phone2} onChange={(e) => set('phone2', e.target.value)} placeholder={tForm('phone2Placeholder')} />}
          </FormField>
        </div>
      </FormShell.Section>
      <FormShell.Section title={tForm('fiscalData')} className="max-w-sm sm:max-w-none">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <FormField label={tForm('cuit')} error={errors.cuit}>
            {(c) => <Input {...c} value={form.cuit} onChange={(e) => set('cuit', formatCuit(e.target.value))} placeholder={tForm('cuitPlaceholder')} maxLength={13} />}
          </FormField>
          <FormField label={tForm('fiscalCondition')} error={errors.fiscalCondition}>
            {(c) => (
              <Select {...c} value={form.fiscalCondition} onChange={(e) => set('fiscalCondition', e.target.value)}>
                <option value="">{tForm('fiscalConditionPlaceholder')}</option>
                {Object.values(FiscalCondition).map((fc) => <option key={fc} value={fc}>{t(`fiscalConditions.${fc}`)}</option>)}
              </Select>
            )}
          </FormField>
        </div>
      </FormShell.Section>
      <FormShell.Section title={tForm('bankingData')} className="max-w-sm sm:max-w-none">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <FormField label={tForm('bankName')} error={errors.bankName}>
            {(c) => <Input {...c} value={form.bankName} onChange={(e) => set('bankName', e.target.value)} placeholder={tForm('bankNamePlaceholder')} />}
          </FormField>
          <FormField label={tForm('bankAlias')} error={errors.bankAlias}>
            {(c) => <Input {...c} value={form.bankAlias} onChange={(e) => set('bankAlias', e.target.value)} placeholder={tForm('bankAliasPlaceholder')} />}
          </FormField>
          <FormField label={tForm('cbu')} error={errors.cbu} className="sm:col-span-2">
            {(c) => <Input {...c} inputMode="numeric" value={form.cbu} onChange={(e) => set('cbu', e.target.value.replace(/\D/g, '').slice(0, 22))} placeholder={tForm('cbuPlaceholder')} maxLength={22} />}
          </FormField>
        </div>
      </FormShell.Section>
      <FormShell.Section title={tForm('notes')} className="max-w-sm sm:max-w-none">
        <FormField label={<span className="sr-only">{tForm('notes')}</span>} error={errors.notes}>
          {(c) => <Textarea {...c} value={form.notes} onChange={(e) => set('notes', e.target.value)} placeholder={tForm('notesPlaceholder')} />}
        </FormField>
      </FormShell.Section>
    </FormShell>
  );
}
