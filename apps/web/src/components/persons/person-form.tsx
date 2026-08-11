'use client';

import { useTranslations } from 'next-intl';
import { FiscalCondition } from '@realfy/shared';
import { personFormSchema } from '@realfy/shared/schemas';
import { useState, type FormEvent } from 'react';
import { apiClient, ApiRequestError } from '@/lib/api-client';
import { FormShell } from '@/components/ui/form-shell';

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

function InputLabel({ htmlFor, children, required }: { htmlFor: string; children: React.ReactNode; required?: boolean }) {
  return (
    <label htmlFor={htmlFor} className="block text-sm font-medium text-slate-700 mb-1.5">
      {children}{required && <span className="text-red-400 ml-0.5">*</span>}
    </label>
  );
}

function TextInput({ id, value, onChange, placeholder, type = 'text', required, maxLength }: {
  id: string; value: string; onChange: (v: string) => void;
  placeholder?: string; type?: string; required?: boolean; maxLength?: number;
}) {
  return (
    <input id={id} type={type} value={value} onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder} required={required} maxLength={maxLength}
      className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500"
    />
  );
}

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
  const [form, setForm] = useState<PersonFormData>(initialData || EMPTY_PERSON);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  function updateField(field: keyof PersonFormData, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError('');
    const body: Record<string, unknown> = {
      firstName: form.firstName, lastName: form.lastName,
      email: form.email || undefined, phone: form.phone || undefined,
      phone2: form.phone2 || undefined, cuit: form.cuit || undefined,
      fiscalCondition: form.fiscalCondition || undefined,
      bankName: form.bankName || undefined, cbu: form.cbu || undefined,
      bankAlias: form.bankAlias || undefined, notes: form.notes || undefined,
    };
    Object.keys(body).forEach((k) => { if (body[k] === undefined) delete body[k]; });
    try {
      if (mode === 'create') {
        const res = await apiClient<{ id: string }>('/persons', { method: 'POST', body: JSON.stringify(body) });
        onSuccess?.(res.id);
      } else {
        await apiClient(`/persons/${personId}`, { method: 'PATCH', body: JSON.stringify(body) });
        onSuccess?.(personId!);
      }
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : tForm('error'));
    } finally { setSubmitting(false); }
  }

  return (
    <FormShell
      onSubmit={handleSubmit}
      submitLabel={submitting ? (mode === 'create' ? tForm('creating') : tForm('updating')) : tForm('submit')}
      submitBusy={submitting}
      secondaryAction={onCancel ? { label: tCommon('cancel'), onClick: onCancel } : undefined}
    >
      {error && <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">{error}</div>}
      <FormShell.Section title={tForm('personalInfo')} className="max-w-sm sm:max-w-none">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <InputLabel htmlFor="firstName" required>{tForm('firstName')}</InputLabel>
            <TextInput id="firstName" value={form.firstName} onChange={(v) => updateField('firstName', v)} placeholder={tForm('firstNamePlaceholder')} required />
          </div>
          <div>
            <InputLabel htmlFor="lastName" required>{tForm('lastName')}</InputLabel>
            <TextInput id="lastName" value={form.lastName} onChange={(v) => updateField('lastName', v)} placeholder={tForm('lastNamePlaceholder')} required />
          </div>
          <div>
            <InputLabel htmlFor="email">{tForm('email')}</InputLabel>
            <TextInput id="email" value={form.email} onChange={(v) => updateField('email', v)} placeholder={tForm('emailPlaceholder')} type="email" />
          </div>
          <div>
            <InputLabel htmlFor="phone">{tForm('phone')}</InputLabel>
            <TextInput id="phone" value={form.phone} onChange={(v) => updateField('phone', v)} placeholder={tForm('phonePlaceholder')} type="tel" />
          </div>
          <div className="sm:col-span-2">
            <InputLabel htmlFor="phone2">{tForm('phone2')}</InputLabel>
            <TextInput id="phone2" value={form.phone2} onChange={(v) => updateField('phone2', v)} placeholder={tForm('phone2Placeholder')} type="tel" />
          </div>
        </div>
      </FormShell.Section>
      <FormShell.Section title={tForm('fiscalData')} className="max-w-sm sm:max-w-none">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <InputLabel htmlFor="cuit">{tForm('cuit')}</InputLabel>
            <TextInput id="cuit" value={form.cuit} onChange={(v) => updateField('cuit', formatCuit(v))} placeholder={tForm('cuitPlaceholder')} maxLength={13} />
          </div>
          <div>
            <InputLabel htmlFor="fiscalCondition">{tForm('fiscalCondition')}</InputLabel>
            <select id="fiscalCondition" value={form.fiscalCondition} onChange={(e) => updateField('fiscalCondition', e.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500">
              <option value="">{tForm('fiscalConditionPlaceholder')}</option>
              {Object.values(FiscalCondition).map((fc) => <option key={fc} value={fc}>{t(`fiscalConditions.${fc}`)}</option>)}
            </select>
          </div>
        </div>
      </FormShell.Section>
      <FormShell.Section title={tForm('bankingData')} className="max-w-sm sm:max-w-none">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <InputLabel htmlFor="bankName">{tForm('bankName')}</InputLabel>
            <TextInput id="bankName" value={form.bankName} onChange={(v) => updateField('bankName', v)} placeholder={tForm('bankNamePlaceholder')} />
          </div>
          <div>
            <InputLabel htmlFor="bankAlias">{tForm('bankAlias')}</InputLabel>
            <TextInput id="bankAlias" value={form.bankAlias} onChange={(v) => updateField('bankAlias', v)} placeholder={tForm('bankAliasPlaceholder')} />
          </div>
          <div className="sm:col-span-2">
            <InputLabel htmlFor="cbu">{tForm('cbu')}</InputLabel>
            <TextInput id="cbu" value={form.cbu} onChange={(v) => updateField('cbu', v.replace(/\D/g, '').slice(0, 22))} placeholder={tForm('cbuPlaceholder')} maxLength={22} />
          </div>
        </div>
      </FormShell.Section>
      <FormShell.Section title={tForm('notes')} className="max-w-sm sm:max-w-none">
        <textarea id="notes" value={form.notes} onChange={(e) => updateField('notes', e.target.value)}
          placeholder={tForm('notesPlaceholder')} rows={3}
          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500 resize-none"
        />
      </FormShell.Section>
    </FormShell>
  );
}
