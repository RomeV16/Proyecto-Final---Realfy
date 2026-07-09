'use client';

import { useTranslations } from 'next-intl';
import { Spinner } from '@/components/ui/spinner';
import { useAuth } from '@/lib/auth-context';
import { apiClient, ApiRequestError } from '@/lib/api-client';
import {
  ContractType,
  AdjustmentType,
  AdjustmentPeriod,
  GuaranteeType,
  Currency,
  PersonRole,
} from '@realfy/shared';
import { contractFormSchema } from '@realfy/shared/schemas';
import { useState, type FormEvent } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ContractStatusBadge } from './contract-status-badge';
import { GuaranteeBadge } from './guarantee-badge';

/* ──────────── Types ──────────── */

interface PersonResult {
  id: string;
  firstName: string;
  lastName: string;
  cuit?: string;
  roles: string[];
}

interface PropertyResult {
  id: string;
  title: string;
  street?: string;
  city?: string;
}

interface GuaranteeEntry {
  _key: string; // local-only key for React lists
  type: string;
  description: string;
  amount: string;
  issuer: string;
  policyNumber: string;
  startDate: string;
  endDate: string;
}

interface SelectedPerson {
  personId: string;
  role: string;
  person: PersonResult;
}

interface FormData {
  propertyId: string;
  contractType: string;
  startDate: string;
  endDate: string;
  notes: string;
  persons: SelectedPerson[];
  rentAmount: string;
  currency: string;
  depositAmount: string;
  adjustmentType: string;
  adjustmentPeriod: string;
  customAdjustmentPct: string;
  guarantees: GuaranteeEntry[];
}

const INITIAL_FORM: FormData = {
  propertyId: '',
  contractType: '',
  startDate: '',
  endDate: '',
  notes: '',
  persons: [],
  rentAmount: '',
  currency: 'ARS',
  depositAmount: '',
  adjustmentType: '',
  adjustmentPeriod: '',
  customAdjustmentPct: '',
  guarantees: [],
};

const STEPS = ['step1', 'step2', 'step3', 'step4'] as const;

/* ──────────── Step Indicator ──────────── */

function StepIndicator({ current, total, t }: { current: number; total: number; t: (key: string, params?: Record<string, string | number | Date>) => string }) {
  return (
    <div className="mb-6">
      <p className="text-xs text-slate-500 mb-2">{t('step', { current, total })}</p>
      <div className="flex gap-2">
        {Array.from({ length: total }).map((_, i) => (
          <div
            key={i}
            className={`h-1.5 flex-1 rounded-full transition-colors ${
              i < current ? 'bg-brand-500' : 'bg-slate-200'
            }`}
          />
        ))}
      </div>
    </div>
  );
}

/* ──────────── Main Wizard ──────────── */

export function ContractForm() {
  const t = useTranslations('contracts.wizard');
  const tContracts = useTranslations('contracts');
  const tCommon = useTranslations('common');
  const { user } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const localePrefix = pathname.match(/^\/(?:[a-z]{2}-[A-Z]{2}|[a-z]{2})/)?.[0] || '/es';

  const [step, setStep] = useState(0);
  const [form, setForm] = useState<FormData>(INITIAL_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [stepErrors, setStepErrors] = useState<Record<string, string>>({});

  // Person search state
  const [personSearch, setPersonSearch] = useState('');
  const [personResults, setPersonResults] = useState<PersonResult[]>([]);
  const [searchingPerson, setSearchingPerson] = useState(false);

  // Property search state
  const [propertySearch, setPropertySearch] = useState('');
  const [propertyResults, setPropertyResults] = useState<PropertyResult[]>([]);
  const [searchingProperty, setSearchingProperty] = useState(false);
  const [selectedProperty, setSelectedProperty] = useState<PropertyResult | null>(null);

  function update<K extends keyof FormData>(key: K, value: FormData[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setStepErrors({});
  }

  /* ── Property search ── */
  async function searchProperties(query: string) {
    setPropertySearch(query);
    if (query.length < 2) { setPropertyResults([]); return; }
    setSearchingProperty(true);
    try {
      const res = await apiClient<{ items: PropertyResult[] }>(`/properties?search=${encodeURIComponent(query)}&limit=5`);
      setPropertyResults(res.items || []);
    } catch {
      setPropertyResults([]);
    } finally {
      setSearchingProperty(false);
    }
  }

  function selectProperty(p: PropertyResult) {
    setSelectedProperty(p);
    update('propertyId', p.id);
    setPropertySearch(p.title);
    setPropertyResults([]);
  }

  /* ── Person search ── */
  async function searchPersons(query: string) {
    setPersonSearch(query);
    if (query.length < 2) { setPersonResults([]); return; }
    setSearchingPerson(true);
    try {
      const res = await apiClient<{ items: Array<Omit<PersonResult, 'roles'> & { roles: Array<{ role: string } | string> }> }>(`/persons?search=${encodeURIComponent(query)}&limit=8`);
      // Normalize roles: API returns { id, role, ... } objects; flatten to string[]
      const normalized = (res.items || []).map((p) => ({
        ...p,
        roles: (p.roles || []).map((r: { role: string } | string) => typeof r === 'string' ? r : r.role),
      }));
      setPersonResults(normalized);
    } catch {
      setPersonResults([]);
    } finally {
      setSearchingPerson(false);
    }
  }

  function addPerson(person: PersonResult, role: string) {
    // Validate person has the required role
    if (!person.roles?.includes(role)) {
      setStepErrors({ personRole: t('step2.invalidRole', { role }) });
      return;
    }
    // Remove existing person in same role (replace)
    const filtered = form.persons.filter((p) => p.role !== role || role === 'Garante');
    update('persons', [...filtered, { personId: person.id, role, person }]);
    setPersonSearch('');
    setPersonResults([]);
    setStepErrors({});
  }

  function removePerson(personId: string, role: string) {
    update('persons', form.persons.filter((p) => !(p.personId === personId && p.role === role)));
  }

  /* ── Guarantees ── */
  function addGuarantee() {
    const entry: GuaranteeEntry = {
      _key: crypto.randomUUID(),
      type: '',
      description: '',
      amount: '',
      issuer: '',
      policyNumber: '',
      startDate: '',
      endDate: '',
    };
    update('guarantees', [...form.guarantees, entry]);
  }

  function updateGuarantee(index: number, key: keyof GuaranteeEntry, value: string) {
    const updated = [...form.guarantees];
    updated[index] = { ...updated[index], [key]: value };
    update('guarantees', updated);
  }

  function removeGuarantee(index: number) {
    update('guarantees', form.guarantees.filter((_, i) => i !== index));
  }

  /* ── Validation ── */
  function validateStep(s: number): boolean {
    const errors: Record<string, string> = {};
    if (s === 0) {
      if (!form.propertyId) errors.propertyId = tCommon('error');
      if (!form.contractType) errors.contractType = tCommon('error');
      if (!form.startDate) errors.startDate = tCommon('error');
    } else if (s === 1) {
      const hasPropietario = form.persons.some((p) => p.role === 'Propietario');
      const hasInquilino = form.persons.some((p) => p.role === 'Inquilino');
      if (!hasPropietario && form.contractType !== 'Venta') errors.propietario = t('step2.propietarioRequired');
      if (!hasInquilino && form.contractType !== 'Venta') errors.inquilino = t('step2.inquilinoRequired');
    } else if (s === 2) {
      if (!form.rentAmount || Number(form.rentAmount) <= 0) errors.rentAmount = tCommon('error');
    }
    setStepErrors(errors);
    return Object.keys(errors).length === 0;
  }

  function goNext() {
    if (validateStep(step)) {
      setStep((s) => Math.min(s + 1, STEPS.length - 1));
    }
  }

  function goBack() {
    setStep((s) => Math.max(s - 1, 0));
  }

  /* ── Submit ── */
  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!validateStep(step)) return;
    setSubmitting(true);
    setError('');

    try {
      const payload: Record<string, unknown> = {
        propertyId: form.propertyId,
        contractType: form.contractType,
        startDate: form.startDate,
        endDate: form.endDate || undefined,
        notes: form.notes || undefined,
        rentAmount: form.rentAmount,
        rentCurrency: form.currency,
        depositAmount: form.depositAmount || undefined,
        adjustmentType: form.adjustmentType || undefined,
        adjustmentPeriod: form.adjustmentPeriod || undefined,
        customAdjustmentPct: form.customAdjustmentPct ? Number(form.customAdjustmentPct) : undefined,
        persons: form.persons.map((p) => ({ personId: p.personId, role: p.role })),
        guarantees: form.guarantees
          .filter((g) => g.type)
          .map((g) => ({
            type: g.type,
            description: g.description || undefined,
            amount: g.amount ? Number(g.amount) : undefined,
            issuer: g.issuer || undefined,
            policyNumber: g.policyNumber || undefined,
            startDate: g.startDate || undefined,
            endDate: g.endDate || undefined,
          })),
      };

      await apiClient('/contracts', {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      router.push(`${localePrefix}/contracts`);
    } catch (err) {
      if (err instanceof ApiRequestError) {
        setError(err.message);
      } else {
        setError(t('error'));
      }
    } finally {
      setSubmitting(false);
    }
  }

  const showCustomPct = form.adjustmentType === 'FixedPercent' || form.adjustmentType === 'Custom';

  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-6">
        <Link href={`${localePrefix}/contracts`} className="text-sm text-brand-600 hover:text-brand-700">
          ← {tCommon('back')}
        </Link>
      </div>

      <h1 className="text-2xl font-bold text-slate-900 tracking-tight mb-2">{t('title')}</h1>

      <StepIndicator current={step + 1} total={STEPS.length} t={t} />

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* ── STEP 1: Propiedad y Datos ── */}
        {step === 0 && (
          <div className="bg-white rounded-xl border border-slate-200 p-6 space-y-4">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">{t('step1.title')}</h2>
              <p className="text-sm text-slate-500">{t('step1.description')}</p>
            </div>

            {/* Property search */}
            <div className="max-w-sm">
              <label className="block text-xs font-medium text-slate-500 mb-1">{t('step1.property')}</label>
              <div className="relative">
                <input
                  type="text"
                  value={propertySearch}
                  onChange={(e) => searchProperties(e.target.value)}
                  placeholder={t('step1.propertySearch')}
                  className={`w-full rounded-lg border bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500 ${stepErrors.propertyId ? 'border-red-300' : 'border-slate-200'}`}
                />
                {searchingProperty && (
                  <div className="absolute right-2 top-2.5">
                    <Spinner className="w-4 h-4 text-brand-500" />
                  </div>
                )}
              </div>
              {propertyResults.length > 0 && (
                <div className="mt-1 bg-white border border-slate-200 rounded-lg shadow-lg max-h-40 overflow-y-auto">
                  {propertyResults.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => selectProperty(p)}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50 transition-colors"
                    >
                      <span className="font-medium text-slate-900">{p.title}</span>
                      {p.street && <span className="text-xs text-slate-500 ml-2">{p.street}</span>}
                    </button>
                  ))}
                </div>
              )}
              {selectedProperty && (
                <p className="mt-1 text-xs text-emerald-600">✓ {selectedProperty.title}</p>
              )}
            </div>

            {/* Contract type */}
            <div className="max-w-sm">
              <label className="block text-xs font-medium text-slate-500 mb-1">{t('step1.contractType')}</label>
              <select
                value={form.contractType}
                onChange={(e) => update('contractType', e.target.value)}
                className={`w-full rounded-lg border bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500 ${stepErrors.contractType ? 'border-red-300' : 'border-slate-200'}`}
              >
                <option value="">{t('step1.contractTypePlaceholder')}</option>
                {Object.values(ContractType).map((ct) => (
                  <option key={ct} value={ct}>{tContracts(`types.${ct}`)}</option>
                ))}
              </select>
            </div>

            {/* Start date */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-sm">
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">{t('step1.startDate')}</label>
                <input
                  type="date"
                  value={form.startDate}
                  onChange={(e) => update('startDate', e.target.value)}
                  className={`w-full rounded-lg border bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-500/30 ${stepErrors.startDate ? 'border-red-300' : 'border-slate-200'}`}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">{t('step1.endDate')}</label>
                <input
                  type="date"
                  value={form.endDate}
                  onChange={(e) => update('endDate', e.target.value)}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
                />
              </div>
            </div>

            {/* Notes */}
            <div className="max-w-sm">
              <label className="block text-xs font-medium text-slate-500 mb-1">{t('step1.notes')}</label>
              <textarea
                value={form.notes}
                onChange={(e) => update('notes', e.target.value)}
                placeholder={t('step1.notesPlaceholder')}
                rows={3}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500/30 resize-none"
              />
            </div>
          </div>
        )}

        {/* ── STEP 2: Personas ── */}
        {step === 1 && (
          <div className="bg-white rounded-xl border border-slate-200 p-6 space-y-4">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">{t('step2.title')}</h2>
              <p className="text-sm text-slate-500">{t('step2.description')}</p>
            </div>

            {/* Person search */}
            <div className="max-w-sm">
              <label className="block text-xs font-medium text-slate-500 mb-1">{t('step2.searchPerson')}</label>
              <div className="relative">
                <input
                  type="text"
                  value={personSearch}
                  onChange={(e) => searchPersons(e.target.value)}
                  placeholder={t('step2.searchPerson')}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
                />
                {searchingPerson && (
                  <div className="absolute right-2 top-2.5">
                    <Spinner className="w-4 h-4 text-brand-500" />
                  </div>
                )}
              </div>
              {personResults.length > 0 && (
                <div className="mt-1 bg-white border border-slate-200 rounded-lg shadow-lg max-h-60 overflow-y-auto">
                  {personResults.map((p) => (
                    <div key={p.id} className="px-3 py-2 hover:bg-slate-50 transition-colors">
                      <div className="flex items-center justify-between">
                        <div>
                          <span className="text-sm font-medium text-slate-900">{p.firstName} {p.lastName}</span>
                          {p.cuit && <span className="text-xs text-slate-500 ml-2">{p.cuit}</span>}
                        </div>
                      </div>
                      <div className="flex gap-1 mt-1">
                        {p.roles?.includes(PersonRole.Propietario) && (
                          <button type="button" onClick={() => addPerson(p, 'Propietario')} className="text-xs px-2 py-0.5 rounded bg-blue-50 text-blue-600 hover:bg-blue-100">
                            + {t('step2.addPropietario')}
                          </button>
                        )}
                        {p.roles?.includes(PersonRole.Inquilino) && (
                          <button type="button" onClick={() => addPerson(p, 'Inquilino')} className="text-xs px-2 py-0.5 rounded bg-emerald-50 text-emerald-600 hover:bg-emerald-100">
                            + {t('step2.addInquilino')}
                          </button>
                        )}
                        {p.roles?.includes(PersonRole.Garante) && (
                          <button type="button" onClick={() => addPerson(p, 'Garante')} className="text-xs px-2 py-0.5 rounded bg-amber-50 text-amber-600 hover:bg-amber-100">
                            + {t('step2.addGarante')}
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {stepErrors.personRole && (
              <p className="text-xs text-red-600">{stepErrors.personRole}</p>
            )}

            {/* Selected persons */}
            <div className="space-y-3">
              {/* Propietario */}
              <div>
                <h3 className="text-xs font-medium text-slate-500 mb-1">{tContracts('detail.propietario')}</h3>
                {form.persons.filter((p) => p.role === 'Propietario').map((p) => (
                  <div key={`${p.personId}-${p.role}`} className="flex items-center justify-between bg-blue-50 rounded-lg px-3 py-2">
                    <div className="flex items-center gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                      <span className="text-sm text-slate-900">{p.person.firstName} {p.person.lastName}</span>
                    </div>
                    <button type="button" onClick={() => removePerson(p.personId, p.role)} className="text-xs text-red-500 hover:text-red-700">
                      {t('step2.removePerson')}
                    </button>
                  </div>
                ))}
                {!form.persons.some((p) => p.role === 'Propietario') && (
                  <p className={`text-xs italic ${stepErrors.propietario ? 'text-red-500' : 'text-slate-400'}`}>
                    {t('step2.noPropietario')}
                  </p>
                )}
              </div>

              {/* Inquilino */}
              <div>
                <h3 className="text-xs font-medium text-slate-500 mb-1">{tContracts('detail.inquilino')}</h3>
                {form.persons.filter((p) => p.role === 'Inquilino').map((p) => (
                  <div key={`${p.personId}-${p.role}`} className="flex items-center justify-between bg-emerald-50 rounded-lg px-3 py-2">
                    <div className="flex items-center gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                      <span className="text-sm text-slate-900">{p.person.firstName} {p.person.lastName}</span>
                    </div>
                    <button type="button" onClick={() => removePerson(p.personId, p.role)} className="text-xs text-red-500 hover:text-red-700">
                      {t('step2.removePerson')}
                    </button>
                  </div>
                ))}
                {!form.persons.some((p) => p.role === 'Inquilino') && (
                  <p className={`text-xs italic ${stepErrors.inquilino ? 'text-red-500' : 'text-slate-400'}`}>
                    {t('step2.noInquilino')}
                  </p>
                )}
              </div>

              {/* Garantes */}
              <div>
                <h3 className="text-xs font-medium text-slate-500 mb-1">{tContracts('detail.garantes')}</h3>
                {form.persons.filter((p) => p.role === 'Garante').map((p) => (
                  <div key={`${p.personId}-${p.role}`} className="flex items-center justify-between bg-amber-50 rounded-lg px-3 py-2 mb-1">
                    <div className="flex items-center gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                      <span className="text-sm text-slate-900">{p.person.firstName} {p.person.lastName}</span>
                    </div>
                    <button type="button" onClick={() => removePerson(p.personId, p.role)} className="text-xs text-red-500 hover:text-red-700">
                      {t('step2.removePerson')}
                    </button>
                  </div>
                ))}
                {form.persons.filter((p) => p.role === 'Garante').length === 0 && (
                  <p className="text-xs italic text-slate-400">{t('step2.noGarantes')}</p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ── STEP 3: Precio y Ajuste ── */}
        {step === 2 && (
          <div className="bg-white rounded-xl border border-slate-200 p-6 space-y-4">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">{t('step3.title')}</h2>
              <p className="text-sm text-slate-500">{t('step3.description')}</p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-sm">
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">{t('step3.rentAmount')}</label>
                <input
                  type="number"
                  step="0.01"
                  value={form.rentAmount}
                  onChange={(e) => update('rentAmount', e.target.value)}
                  placeholder={t('step3.rentAmountPlaceholder')}
                  className={`w-full rounded-lg border bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500/30 ${stepErrors.rentAmount ? 'border-red-300' : 'border-slate-200'}`}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">{t('step3.currency')}</label>
                <select
                  value={form.currency}
                  onChange={(e) => update('currency', e.target.value)}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
                >
                  {Object.values(Currency).map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="max-w-sm">
              <label className="block text-xs font-medium text-slate-500 mb-1">{t('step3.depositAmount')}</label>
              <input
                type="number"
                step="0.01"
                value={form.depositAmount}
                onChange={(e) => update('depositAmount', e.target.value)}
                placeholder={t('step3.depositPlaceholder')}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-sm">
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">{t('step3.adjustmentType')}</label>
                <select
                  value={form.adjustmentType}
                  onChange={(e) => update('adjustmentType', e.target.value)}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
                >
                  <option value="">{t('step3.adjustmentTypePlaceholder')}</option>
                  {Object.values(AdjustmentType).map((at) => (
                    <option key={at} value={at}>{tContracts(`adjustmentTypes.${at}`)}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">{t('step3.adjustmentPeriod')}</label>
                <select
                  value={form.adjustmentPeriod}
                  onChange={(e) => update('adjustmentPeriod', e.target.value)}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
                >
                  <option value="">{t('step3.adjustmentPeriodPlaceholder')}</option>
                  {Object.values(AdjustmentPeriod).map((ap) => (
                    <option key={ap} value={ap}>{tContracts(`adjustmentPeriods.${ap}`)}</option>
                  ))}
                </select>
              </div>
            </div>

            {showCustomPct && (
              <div className="max-w-sm">
                <label className="block text-xs font-medium text-slate-500 mb-1">{t('step3.customPercentage')}</label>
                <input
                  type="number"
                  step="0.01"
                  value={form.customAdjustmentPct}
                  onChange={(e) => update('customAdjustmentPct', e.target.value)}
                  placeholder={t('step3.customPercentagePlaceholder')}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
                />
              </div>
            )}

            {/* Adjustment summary */}
            {form.adjustmentType && (
              <div className="bg-slate-50 rounded-lg p-3">
                <p className="text-xs font-medium text-slate-600 mb-1">{t('step3.adjustmentSummary')}</p>
                <p className="text-sm text-slate-700">
                  {form.adjustmentType === 'IPC' && t('step3.summaryIPC')}
                  {form.adjustmentType === 'ICL' && t('step3.summaryICL')}
                  {form.adjustmentType === 'CCP' && t('step3.summaryCCP')}
                  {form.adjustmentType === 'FixedPercent' && t('step3.summaryFixed', { pct: form.customAdjustmentPct || '0' })}
                  {form.adjustmentType === 'Custom' && t('step3.summaryCustom', { pct: form.customAdjustmentPct || '0' })}
                </p>
              </div>
            )}
          </div>
        )}

        {/* ── STEP 4: Garantías ── */}
        {step === 3 && (
          <div className="bg-white rounded-xl border border-slate-200 p-6 space-y-4">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">{t('step4.title')}</h2>
              <p className="text-sm text-slate-500">{t('step4.description')}</p>
            </div>

            {form.guarantees.length === 0 && (
              <p className="text-sm text-slate-400 italic">{t('step4.noGuarantees')}</p>
            )}

            {form.guarantees.map((g, i) => (
              <div key={g._key} className="bg-slate-50 rounded-lg p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-slate-700">#{i + 1}</span>
                  <button type="button" onClick={() => removeGuarantee(i)} className="text-xs text-red-500 hover:text-red-700">
                    {t('step4.removeGuarantee')}
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-sm">
                  <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1">{t('step4.guaranteeType')}</label>
                    <select
                      value={g.type}
                      onChange={(e) => updateGuarantee(i, 'type', e.target.value)}
                      className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
                    >
                      <option value="">{t('step4.guaranteeTypePlaceholder')}</option>
                      {Object.values(GuaranteeType).map((gt) => (
                        <option key={gt} value={gt}>{tContracts(`guaranteeTypes.${gt}`)}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1">{t('step4.amount')}</label>
                    <input
                      type="number"
                      step="0.01"
                      value={g.amount}
                      onChange={(e) => updateGuarantee(i, 'amount', e.target.value)}
                      placeholder={t('step4.amountPlaceholder')}
                      className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
                    />
                  </div>
                </div>

                <div className="max-w-sm">
                  <label className="block text-xs font-medium text-slate-500 mb-1">{t('step4.description_field')}</label>
                  <input
                    type="text"
                    value={g.description}
                    onChange={(e) => updateGuarantee(i, 'description', e.target.value)}
                    placeholder={t('step4.descriptionPlaceholder')}
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-sm">
                  <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1">{t('step4.issuer')}</label>
                    <input
                      type="text"
                      value={g.issuer}
                      onChange={(e) => updateGuarantee(i, 'issuer', e.target.value)}
                      placeholder={t('step4.issuerPlaceholder')}
                      className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1">{t('step4.policyNumber')}</label>
                    <input
                      type="text"
                      value={g.policyNumber}
                      onChange={(e) => updateGuarantee(i, 'policyNumber', e.target.value)}
                      placeholder={t('step4.policyNumberPlaceholder')}
                      className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-sm">
                  <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1">{t('step4.startDate')}</label>
                    <input
                      type="date"
                      value={g.startDate}
                      onChange={(e) => updateGuarantee(i, 'startDate', e.target.value)}
                      className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1">{t('step4.endDate')}</label>
                    <input
                      type="date"
                      value={g.endDate}
                      onChange={(e) => updateGuarantee(i, 'endDate', e.target.value)}
                      className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
                    />
                  </div>
                </div>

                {g.type && g.endDate && (
                  <div className="pt-1">
                    <GuaranteeBadge type={g.type} endDate={g.endDate} />
                  </div>
                )}
              </div>
            ))}

            <button
              type="button"
              onClick={addGuarantee}
              className="px-4 py-2 rounded-lg border border-dashed border-slate-300 text-sm text-slate-600 hover:bg-slate-50 hover:border-slate-400 transition-colors w-full"
            >
              + {t('step4.addGuarantee')}
            </button>
          </div>
        )}

        {/* Navigation buttons */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3">
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}

        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={goBack}
            disabled={step === 0}
            className="px-4 py-2.5 rounded-lg border border-slate-200 text-sm text-slate-700 hover:bg-slate-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {t('back')}
          </button>

          {step < STEPS.length - 1 ? (
            <button
              type="button"
              onClick={goNext}
              className="px-6 py-2.5 rounded-lg bg-brand-500 text-white text-sm font-medium hover:bg-brand-600 transition-colors shadow-sm"
            >
              {t('next')}
            </button>
          ) : (
            <button
              type="submit"
              disabled={submitting}
              className="px-6 py-2.5 rounded-lg bg-brand-500 text-white text-sm font-medium hover:bg-brand-600 transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {submitting && (
                <Spinner className="w-4 h-4 text-white" />
              )}
              {submitting ? t('creating') : t('submit')}
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
