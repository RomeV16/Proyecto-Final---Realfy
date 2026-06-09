'use client';

import { useTranslations } from 'next-intl';
import { usePathname, useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';
import { apiClient, ApiRequestError } from '@/lib/api-client';
import { PersonRole } from '@realfy/shared';
import { useState, useEffect, useCallback, useRef } from 'react';
import { PersonForm, type PersonFormData } from '@/components/persons/person-form';
import { PersonRoleBadge } from '@/components/persons/person-role-badge';

/* ──────────── Types ──────────── */

interface PersonRoleAssignment {
  id: string;
  role: string;
  assignedAt: string;
  propertyId?: string | null;
  guarantorForPersonId?: string | null;
}

interface PropertyOption {
  id: string;
  title: string;
  street?: string;
  city?: string;
}

interface PersonOption {
  id: string;
  firstName: string;
  lastName: string;
}

interface PersonDocument {
  id: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  url: string;
  createdAt: string;
}

interface PersonDetail {
  id: string;
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
  phone2?: string;
  cuit?: string;
  fiscalCondition?: string;
  bankName?: string;
  cbu?: string;
  bankAlias?: string;
  notes?: string;
  isActive: boolean;
  roles: PersonRoleAssignment[];
  documents: PersonDocument[];
  createdAt: string;
  updatedAt: string;
}

/* ──────────── Helpers ──────────── */

function toFormData(detail: PersonDetail): PersonFormData {
  return {
    id: detail.id,
    firstName: detail.firstName,
    lastName: detail.lastName,
    email: detail.email || '',
    phone: detail.phone || '',
    phone2: detail.phone2 || '',
    cuit: detail.cuit || '',
    fiscalCondition: detail.fiscalCondition || '',
    bankName: detail.bankName || '',
    cbu: detail.cbu || '',
    bankAlias: detail.bankAlias || '',
    notes: detail.notes || '',
  };
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/* ──────────── Role Management Section ──────────── */

const ROLES_NEED_PROPERTY = [PersonRole.Propietario, PersonRole.Inquilino, PersonRole.Comprador];
const ROLES_NEED_GUARANTEE = [PersonRole.Garante];

function RoleSection({
  personId,
  roles,
  onRolesChange,
  canEdit,
}: {
  personId: string;
  roles: PersonRoleAssignment[];
  onRolesChange: (roles: PersonRoleAssignment[]) => void;
  canEdit: boolean;
}) {
  const t = useTranslations('persons');
  const tRoles = useTranslations('persons.roles');
  const [newRole, setNewRole] = useState('');
  const [propertyId, setPropertyId] = useState('');
  const [guarantorForPersonId, setGuarantorForPersonId] = useState('');
  const [properties, setProperties] = useState<PropertyOption[]>([]);
  const [propietarios, setPropietarios] = useState<PersonOption[]>([]);
  const [adding, setAdding] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const assignedRoles = roles.map((r) => r.role);
  const availableRoles = Object.values(PersonRole).filter(
    (r) => !assignedRoles.includes(r)
  );

  const needsProperty = ROLES_NEED_PROPERTY.includes(newRole as PersonRole);
  const needsGuarantee = ROLES_NEED_GUARANTEE.includes(newRole as PersonRole);

  // Load properties when role needs one
  useEffect(() => {
    if (!needsProperty && !needsGuarantee) return;
    if (needsProperty && properties.length === 0) {
      apiClient<{ items: PropertyOption[] }>('/properties?limit=100&isActive=true')
        .then((r) => setProperties(r.items))
        .catch(() => {});
    }
    if (needsGuarantee && propietarios.length === 0) {
      apiClient<{ items: { id: string; firstName: string; lastName: string }[] }>(
        '/persons?limit=100&role=Propietario'
      )
        .then((r) => setPropietarios(r.items))
        .catch(() => {});
    }
  }, [needsProperty, needsGuarantee, properties.length, propietarios.length]);

  async function handleAddRole() {
    if (!newRole) return;
    setAdding(true);
    setError('');
    try {
      const payload: Record<string, unknown> = { role: newRole };
      if (needsProperty && propertyId) payload.propertyId = propertyId;
      if (needsGuarantee && guarantorForPersonId) payload.guarantorForPersonId = guarantorForPersonId;
      const res = await apiClient<PersonRoleAssignment>(`/persons/${personId}/roles`, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      onRolesChange([...roles, res]);
      setNewRole('');
      setPropertyId('');
      setGuarantorForPersonId('');
    } catch (err) {
      if (err instanceof ApiRequestError) setError(err.message);
    } finally {
      setAdding(false);
    }
  }

  async function handleRemoveRole(roleId: string) {
    setRemovingId(roleId);
    setError('');
    try {
      await apiClient(`/persons/${personId}/roles/${roleId}`, { method: 'DELETE' });
      onRolesChange(roles.filter((r) => r.id !== roleId));
    } catch (err) {
      if (err instanceof ApiRequestError) setError(err.message);
    } finally {
      setRemovingId(null);
    }
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5">
      <h3 className="text-base font-semibold text-slate-900 pb-2 mb-4 border-b border-slate-100">
        {tRoles('title')}
      </h3>

      {error && (
        <div className="p-2 mb-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-xs">
          {error}
        </div>
      )}

      {roles.length === 0 ? (
        <p className="text-sm text-slate-400 mb-4">{tRoles('noRoles')}</p>
      ) : (
        <div className="flex flex-wrap gap-2 mb-4">
          {roles.map((r) => (
            <div key={r.id} className="inline-flex items-center gap-1.5">
              <PersonRoleBadge role={r.role} size="md" />
              {(r.propertyId || r.guarantorForPersonId) && (
                <span className="text-xs text-slate-500 italic">
                  {r.propertyId ? `#${r.propertyId.slice(0, 8)}` : `↳ #${r.guarantorForPersonId?.slice(0, 8)}`}
                </span>
              )}
              {canEdit && (
                <button
                  type="button"
                  disabled={removingId === r.id}
                  onClick={() => handleRemoveRole(r.id)}
                  className="w-5 h-5 flex items-center justify-center rounded-full text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors disabled:opacity-50"
                  title={tRoles('remove')}
                >
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {canEdit && availableRoles.length > 0 && (
        <div className="space-y-3 pt-2 border-t border-slate-100">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-end">
            <div>
              <label htmlFor="newRole" className="block text-sm font-medium text-slate-700 mb-1.5">
                {tRoles('add')}
              </label>
              <select
                id="newRole"
                value={newRole}
                onChange={(e) => { setNewRole(e.target.value); setPropertyId(''); setGuarantorForPersonId(''); }}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500"
              >
                <option value="">{tRoles('addPlaceholder')}</option>
                {availableRoles.map((r) => (
                  <option key={r} value={r}>{t(`roles.${r}`)}</option>
                ))}
              </select>
            </div>

            {needsProperty && (
              <div>
                <label htmlFor="roleProperty" className="block text-sm font-medium text-slate-700 mb-1.5">
                  {tRoles('property')}
                </label>
                <select
                  id="roleProperty"
                  value={propertyId}
                  onChange={(e) => setPropertyId(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500"
                >
                  <option value="">{tRoles('propertyPlaceholder')}</option>
                  {properties.map((p) => (
                    <option key={p.id} value={p.id}>{p.title}{p.street ? ` — ${p.street}` : ''}</option>
                  ))}
                </select>
              </div>
            )}

            {needsGuarantee && (
              <div>
                <label htmlFor="roleGuarantee" className="block text-sm font-medium text-slate-700 mb-1.5">
                  {tRoles('guarantorFor')}
                </label>
                <select
                  id="roleGuarantee"
                  value={guarantorForPersonId}
                  onChange={(e) => setGuarantorForPersonId(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500"
                >
                  <option value="">{tRoles('guarantorForPlaceholder')}</option>
                  {propietarios.map((p) => (
                    <option key={p.id} value={p.id}>{p.firstName} {p.lastName}</option>
                  ))}
                </select>
              </div>
            )}
          </div>

          <button
            type="button"
            disabled={!newRole || adding}
            onClick={handleAddRole}
            className="px-4 py-2.5 rounded-lg border border-slate-200 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {tRoles('add')}
          </button>
        </div>
      )}
    </div>
  );
}

/* ──────────── Documents Section ──────────── */

function DocumentsSection({
  personId,
  documents,
  onDocumentsChange,
  canEdit,
}: {
  personId: string;
  documents: PersonDocument[];
  onDocumentsChange: (docs: PersonDocument[]) => void;
  canEdit: boolean;
}) {
  const t = useTranslations('persons.documents');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState('');

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError('');

    try {
      const formData = new FormData();
      formData.append('file', file);

      // Use fetch directly for multipart — apiClient sets Content-Type to JSON
      const baseUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api';
      const rawRes = await fetch(`${baseUrl}/persons/${personId}/documents`, {
        method: 'POST',
        credentials: 'include' as RequestCredentials,
        body: formData,
      });

      if (!rawRes.ok) {
        const body = await rawRes.json().catch(() => ({ message: rawRes.statusText }));
        throw new Error(body.message || rawRes.statusText);
      }

      const res = await rawRes.json() as PersonDocument;
      onDocumentsChange([...documents, res]);
    } catch (err) {
      if (err instanceof ApiRequestError) setError(err.message);
      else setError(t('uploadError'));
    } finally {
      setUploading(false);
      // Reset file input
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function handleDelete(docId: string) {
    setDeletingId(docId);
    setError('');
    try {
      await apiClient(`/persons/${personId}/documents/${docId}`, { method: 'DELETE' });
      onDocumentsChange(documents.filter((d) => d.id !== docId));
    } catch (err) {
      if (err instanceof ApiRequestError) setError(err.message);
      else setError(t('deleteError'));
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5">
      <h3 className="text-base font-semibold text-slate-900 pb-2 mb-4 border-b border-slate-100">
        {t('title')}
      </h3>

      {error && (
        <div className="p-2 mb-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-xs">
          {error}
        </div>
      )}

      {documents.length === 0 ? (
        <p className="text-sm text-slate-400 mb-4">{t('noDocuments')}</p>
      ) : (
        <div className="space-y-2 mb-4">
          {documents.map((doc) => (
            <div
              key={doc.id}
              className="flex items-center gap-3 p-3 rounded-lg bg-slate-50 border border-slate-100"
            >
              {/* File icon */}
              <div className="w-8 h-8 rounded-lg bg-slate-200 flex items-center justify-center shrink-0">
                <svg className="w-4 h-4 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
                </svg>
              </div>

              {/* File info */}
              <div className="flex-1 min-w-0">
                <a
                  href={doc.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm font-medium text-slate-900 hover:text-brand-600 truncate block transition-colors"
                >
                  {doc.fileName}
                </a>
                <p className="text-xs text-slate-500">
                  {formatFileSize(doc.fileSize)}
                  {' · '}
                  {new Date(doc.createdAt).toLocaleDateString('es-AR', {
                    day: '2-digit',
                    month: '2-digit',
                    year: 'numeric',
                  })}
                </p>
              </div>

              {/* Delete button */}
              {canEdit && (
                <button
                  type="button"
                  disabled={deletingId === doc.id}
                  onClick={() => handleDelete(doc.id)}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors disabled:opacity-50"
                  title={t('delete')}
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                  </svg>
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Upload button */}
      {canEdit && (
        <div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.jpg,.jpeg,.png"
            onChange={handleFileChange}
            className="hidden"
            id="doc-upload"
          />
          <button
            type="button"
            disabled={uploading}
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-dashed border-slate-300 text-sm text-slate-600 hover:border-brand-400 hover:text-brand-600 hover:bg-brand-50/50 transition-colors disabled:opacity-50"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5" />
            </svg>
            {uploading ? '...' : t('upload')}
          </button>
          <p className="text-xs text-slate-400 mt-1.5">{t('uploadHint')}</p>
        </div>
      )}
    </div>
  );
}

/* ──────────── Scoring Section ──────────── */

interface TenantScoreData {
  id: string;
  guaranteeScore: number;
  jobStabilityScore: number;
  referencesScore: number;
  paymentHistoryScore: number;
  manualRating: number;
  totalScore: number | string;
  notes: string | null;
  scoredAt: string;
  scoredBy: { id: string; firstName: string; lastName: string };
}

const SCORE_FACTORS = [
  'guarantee',
  'jobStability',
  'references',
  'paymentHistory',
  'manualRating',
] as const;

function ScoringSection({ personId }: { personId: string }) {
  const t = useTranslations('scoring');
  const [score, setScore] = useState<TenantScoreData | null>(null);
  const [loading, setLoading] = useState(true);
  const [notScored, setNotScored] = useState(false);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [formValues, setFormValues] = useState({
    guaranteeScore: 0,
    jobStabilityScore: 0,
    referencesScore: 0,
    paymentHistoryScore: 0,
    manualRating: 0,
    notes: '',
  });

  const loadScore = useCallback(async () => {
    try {
      const data = await apiClient<TenantScoreData>(`/scoring/persons/${personId}`);
      setScore(data);
      setNotScored(false);
      setFormValues({
        guaranteeScore: data.guaranteeScore,
        jobStabilityScore: data.jobStabilityScore,
        referencesScore: data.referencesScore,
        paymentHistoryScore: data.paymentHistoryScore,
        manualRating: data.manualRating,
        notes: data.notes || '',
      });
    } catch (err) {
      if (err instanceof ApiRequestError && err.statusCode === 404) {
        setNotScored(true);
      } else if (err instanceof ApiRequestError) {
        setError(err.message);
      }
    } finally {
      setLoading(false);
    }
  }, [personId]);

  useEffect(() => {
    loadScore();
  }, [loadScore]);

  async function handleSave() {
    setSaving(true);
    setError('');
    try {
      await apiClient(`/scoring/persons/${personId}`, {
        method: 'PUT',
        body: JSON.stringify({
          guaranteeScore: formValues.guaranteeScore,
          jobStabilityScore: formValues.jobStabilityScore,
          referencesScore: formValues.referencesScore,
          paymentHistoryScore: formValues.paymentHistoryScore,
          manualRating: formValues.manualRating,
          notes: formValues.notes || undefined,
        }),
      });
      setEditing(false);
      setLoading(true);
      await loadScore();
    } catch (err) {
      if (err instanceof ApiRequestError) setError(err.message);
      else setError(t('saveError'));
    } finally {
      setSaving(false);
    }
  }

  function handleFieldChange(field: string, value: number | string) {
    setFormValues((prev) => ({
      ...prev,
      [field]: typeof value === 'number' ? Math.max(0, Math.min(100, value)) : value,
    }));
  }

  if (loading) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <div className="animate-pulse space-y-3">
          <div className="h-5 bg-slate-200 rounded w-32" />
          <div className="h-4 bg-slate-100 rounded w-full" />
          <div className="h-4 bg-slate-100 rounded w-3/4" />
        </div>
      </div>
    );
  }

  const scoreFactorMap: Record<string, string> = {
    guarantee: 'guaranteeScore',
    jobStability: 'jobStabilityScore',
    references: 'referencesScore',
    paymentHistory: 'paymentHistoryScore',
    manualRating: 'manualRating',
  };

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5">
      <div className="flex items-center justify-between pb-2 mb-4 border-b border-slate-100">
        <h3 className="text-base font-semibold text-slate-900">{t('sectionTitle')}</h3>
        {score && !editing && (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="text-sm text-brand-600 hover:text-brand-700 font-medium transition-colors"
          >
            {t('edit')}
          </button>
        )}
      </div>

      {error && (
        <div className="p-2 mb-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-xs">
          {error}
        </div>
      )}

      {notScored && !editing ? (
        <div className="text-center py-4">
          <p className="text-sm text-slate-400 mb-3">{t('noScore')}</p>
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="px-4 py-2 rounded-lg bg-brand-500 text-white text-sm font-medium hover:bg-brand-600 transition-colors"
          >
            {t('scoreButton')}
          </button>
        </div>
      ) : editing ? (
        <div className="space-y-4">
          {SCORE_FACTORS.map((factor) => {
            const fieldKey = scoreFactorMap[factor];
            const value = (formValues as any)[fieldKey] as number;
            return (
              <div key={factor} className="space-y-1">
                <div className="flex items-center justify-between">
                  <label htmlFor={`score-${factor}`} className="text-sm font-medium text-slate-700">
                    {t(`factors.${factor}`)}
                  </label>
                  <span className="text-sm font-mono text-slate-500 tabular-nums w-8 text-right">
                    {value}
                  </span>
                </div>
                <input
                  id={`score-${factor}`}
                  type="range"
                  min={0}
                  max={100}
                  value={value}
                  onChange={(e) => handleFieldChange(fieldKey, parseInt(e.target.value, 10))}
                  className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-brand-500"
                />
              </div>
            );
          })}

          <div>
            <label htmlFor="score-notes" className="block text-sm font-medium text-slate-700 mb-1.5">
              {t('notes')}
            </label>
            <textarea
              id="score-notes"
              rows={2}
              value={formValues.notes}
              onChange={(e) => handleFieldChange('notes', e.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500"
              placeholder={t('notesPlaceholder')}
            />
          </div>

          <div className="flex gap-2 justify-end pt-2">
            <button
              type="button"
              onClick={() => {
                setEditing(false);
                if (score) {
                  setFormValues({
                    guaranteeScore: score.guaranteeScore,
                    jobStabilityScore: score.jobStabilityScore,
                    referencesScore: score.referencesScore,
                    paymentHistoryScore: score.paymentHistoryScore,
                    manualRating: score.manualRating,
                    notes: score.notes || '',
                  });
                }
              }}
              className="px-4 py-2 rounded-lg border border-slate-200 text-sm text-slate-700 hover:bg-slate-50 transition-colors"
            >
              {t('cancel')}
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={handleSave}
              className="px-4 py-2 rounded-lg bg-brand-500 text-white text-sm font-medium hover:bg-brand-600 transition-colors disabled:opacity-50"
            >
              {saving ? '...' : t('save')}
            </button>
          </div>
        </div>
      ) : score ? (
        <div className="space-y-3">
          {SCORE_FACTORS.map((factor) => {
            const fieldKey = scoreFactorMap[factor];
            const value = (score as any)[fieldKey] as number;
            return (
              <div key={factor}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm text-slate-600">{t(`factors.${factor}`)}</span>
                  <span className="text-sm font-mono text-slate-900 tabular-nums">{value}</span>
                </div>
                <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-brand-500 rounded-full transition-all"
                    style={{ width: `${value}%` }}
                  />
                </div>
              </div>
            );
          })}

          <div className="pt-3 border-t border-slate-100 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-slate-900">{t('totalScore')}</span>
              <span className="text-lg font-bold text-brand-600 tabular-nums">
                {Number(score.totalScore).toFixed(1)}
              </span>
            </div>

            {score.notes && (
              <div>
                <span className="text-xs text-slate-500">{t('notes')}</span>
                <p className="text-sm text-slate-700 mt-0.5">{score.notes}</p>
              </div>
            )}

            <p className="text-xs text-slate-400">
              {t('scoredBy')} {score.scoredBy.firstName} {score.scoredBy.lastName}
              {' · '}
              {new Date(score.scoredAt).toLocaleDateString('es-AR', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric',
              })}
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/* ──────────── Main Page ──────────── */

export default function PersonDetailPage() {
  const t = useTranslations('persons');
  const tCommon = useTranslations('common');
  const pathname = usePathname();
  const router = useRouter();
  const params = useParams();
  const { user } = useAuth();
  const localePrefix = pathname.match(/^\/(?:[a-z]{2}-[A-Z]{2}|[a-z]{2})/)?.[0] || '/es';
  const personId = params.id as string;

  const [person, setPerson] = useState<PersonDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [editing, setEditing] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);

  const canEdit = ['Admin', 'Gerente', 'Ventas'].includes(user?.role || '');
  const canDelete = ['Admin', 'Gerente'].includes(user?.role || '');

  const loadPerson = useCallback(async () => {
    try {
      const data = await apiClient<PersonDetail>(`/persons/${personId}`);
      setPerson(data);
    } catch (err) {
      if (err instanceof ApiRequestError && err.statusCode === 404) {
        setNotFound(true);
      }
    } finally {
      setLoading(false);
    }
  }, [personId]);

  useEffect(() => {
    loadPerson();
  }, [loadPerson]);

  async function handleDelete() {
    try {
      await apiClient(`/persons/${personId}`, { method: 'DELETE' });
      router.push(`${localePrefix}/persons`);
    } catch {
      // stay on page
    }
  }

  // Loading
  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  // Not found
  if (notFound || !person) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <div className="w-16 h-16 rounded-2xl bg-slate-100 flex items-center justify-center mb-4">
          <svg className="w-8 h-8 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
          </svg>
        </div>
        <h2 className="text-lg font-semibold text-slate-900">{t('empty.detail')}</h2>
        <Link
          href={`${localePrefix}/persons`}
          className="mt-4 px-4 py-2 rounded-lg border border-slate-200 text-sm text-slate-700 hover:bg-slate-50 transition-colors"
        >
          {t('backToList')}
        </Link>
      </div>
    );
  }

  const fullName = `${person.firstName} ${person.lastName}`;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link
          href={`${localePrefix}/persons`}
          className="p-2 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
          aria-label={t('backToList')}
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
          </svg>
        </Link>
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
          {editing ? t('editTitle') : t('detailTitle')}
        </h1>
      </div>

      {/* Delete confirmation */}
      {deleteConfirm && (
        <div className="p-4 rounded-lg bg-red-50 border border-red-200 flex flex-col sm:flex-row items-start sm:items-center gap-3">
          <p className="text-sm text-red-700 flex-1">{t('detail.deleteConfirm')}</p>
          <div className="flex gap-2">
            <button
              onClick={handleDelete}
              className="px-4 py-2 rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-700 transition-colors"
            >
              {tCommon('confirm')}
            </button>
            <button
              onClick={() => setDeleteConfirm(false)}
              className="px-4 py-2 rounded-lg border border-slate-200 text-slate-700 text-sm font-medium hover:bg-slate-50 transition-colors"
            >
              {tCommon('cancel')}
            </button>
          </div>
        </div>
      )}

      {editing ? (
        <PersonForm
          mode="edit"
          personId={person.id}
          initialData={toFormData(person)}
          onSuccess={() => {
            setEditing(false);
            loadPerson();
          }}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <div className="space-y-6 w-full max-w-2xl">
          {/* Person summary card */}
          <div className="bg-white rounded-xl border border-slate-200 p-5">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-4">
                <div className="w-14 h-14 rounded-full bg-brand-100 text-brand-700 flex items-center justify-center text-lg font-bold shrink-0">
                  {person.firstName.charAt(0)}{person.lastName.charAt(0)}
                </div>
                <div className="space-y-1">
                  <h2 className="text-xl font-bold text-slate-900">{fullName}</h2>
                  {person.cuit && (
                    <p className="text-sm text-slate-500 tabular-nums">{person.cuit}</p>
                  )}
                  {person.email && (
                    <p className="text-sm text-slate-600">{person.email}</p>
                  )}
                  {person.phone && (
                    <p className="text-sm text-slate-500">{person.phone}</p>
                  )}
                </div>
              </div>
              <div className="flex gap-2 shrink-0">
                {canEdit && (
                  <button
                    onClick={() => setEditing(true)}
                    className="px-4 py-2 rounded-lg bg-brand-500 text-white text-sm font-medium hover:bg-brand-600 transition-colors"
                  >
                    {t('detail.edit')}
                  </button>
                )}
                {canDelete && (
                  <button
                    onClick={() => setDeleteConfirm(true)}
                    className="px-4 py-2 rounded-lg border border-red-200 text-red-600 text-sm font-medium hover:bg-red-50 transition-colors"
                  >
                    {tCommon('delete')}
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Fiscal info */}
          {(person.fiscalCondition || person.bankName || person.cbu || person.bankAlias) && (
            <div className="bg-white rounded-xl border border-slate-200 p-5">
              <h3 className="text-base font-semibold text-slate-900 pb-2 mb-3 border-b border-slate-100">
                {t('form.fiscalData')} / {t('form.bankingData')}
              </h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                {person.fiscalCondition && (
                  <div>
                    <p className="text-xs text-slate-500">{t('form.fiscalCondition')}</p>
                    <p className="text-sm font-medium text-slate-900">
                      {t(`fiscalConditions.${person.fiscalCondition}`)}
                    </p>
                  </div>
                )}
                {person.bankName && (
                  <div>
                    <p className="text-xs text-slate-500">{t('form.bankName')}</p>
                    <p className="text-sm font-medium text-slate-900">{person.bankName}</p>
                  </div>
                )}
                {person.cbu && (
                  <div>
                    <p className="text-xs text-slate-500">{t('form.cbu')}</p>
                    <p className="text-sm font-medium text-slate-900 tabular-nums">{person.cbu}</p>
                  </div>
                )}
                {person.bankAlias && (
                  <div>
                    <p className="text-xs text-slate-500">{t('form.bankAlias')}</p>
                    <p className="text-sm font-medium text-slate-900">{person.bankAlias}</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Notes */}
          {person.notes && (
            <div className="bg-white rounded-xl border border-slate-200 p-5">
              <h3 className="text-base font-semibold text-slate-900 pb-2 mb-3 border-b border-slate-100">
                {t('form.notes')}
              </h3>
              <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">{person.notes}</p>
            </div>
          )}

          {/* Roles */}
          <RoleSection
            personId={person.id}
            roles={person.roles || []}
            onRolesChange={(roles) => setPerson((prev) => prev ? { ...prev, roles } : null)}
            canEdit={canEdit}
          />

          {/* Documents */}
          <DocumentsSection
            personId={person.id}
            documents={person.documents || []}
            onDocumentsChange={(documents) => setPerson((prev) => prev ? { ...prev, documents } : null)}
            canEdit={canEdit}
          />

          {/* Scoring — Admin/Gerente only */}
          {['Admin', 'Gerente'].includes(user?.role || '') && (
            <ScoringSection personId={person.id} />
          )}
        </div>
      )}
    </div>
  );
}
