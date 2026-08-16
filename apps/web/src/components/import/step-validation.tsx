'use client';

import { useState, useEffect, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { apiClient } from '@/lib/api-client';
import type { ImportEntityType, ColumnMappingInput } from '@realfy/shared';
import type { UploadResult, ValidationResult } from './import-wizard';

interface StepValidationProps {
  uploadResult: UploadResult;
  entityType: ImportEntityType;
  columnMappings: ColumnMappingInput[];
  onComplete: (result: ValidationResult) => void;
  onBack: () => void;
}

export function StepValidation({ uploadResult, entityType, columnMappings, onComplete, onBack }: StepValidationProps) {
  const t = useTranslations('import');

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ValidationResult | null>(null);

  const validate = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiClient<ValidationResult>('/import/validate', {
        method: 'POST',
        body: JSON.stringify({
          fileId: uploadResult.fileId,
          entityType,
          columnMappings,
        }),
      });
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('validation.error'));
    } finally {
      setLoading(false);
    }
  }, [uploadResult.fileId, entityType, columnMappings, t]);

  useEffect(() => {
    validate();
  }, [validate]);

  // Group errors by row
  const errorsByRow = result?.errors.reduce<Record<number, typeof result.errors>>((acc, err) => {
    if (!acc[err.row]) acc[err.row] = [];
    acc[err.row].push(err);
    return acc;
  }, {}) ?? {};

  const errorRowNumbers = new Set(Object.keys(errorsByRow).map(Number));

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-6 space-y-6">
      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-12">
          <div className="flex items-center gap-3">
            <svg className="w-5 h-5 animate-spin text-brand-500" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            <span className="text-sm text-slate-600">{t('validation.loading')}</span>
          </div>
        </div>
      )}

      {/* Error */}
      {error && !loading && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {error}
          <button onClick={validate} className="ml-2 underline hover:text-red-900">{t('validation.retry')}</button>
        </div>
      )}

      {/* Results */}
      {result && !loading && (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-3 gap-4">
            <div className="rounded-lg bg-slate-50 border border-slate-200 p-4 text-center">
              <p className="text-2xl font-bold text-slate-900 tabular-nums">{result.totalRows}</p>
              <p className="text-xs text-slate-500">{t('validation.totalRows')}</p>
            </div>
            <div className="rounded-lg bg-green-50 border border-green-200 p-4 text-center">
              <p className="text-2xl font-bold text-green-700 tabular-nums">{result.validRows}</p>
              <p className="text-xs text-green-600">{t('validation.validRows')}</p>
            </div>
            <div className={`rounded-lg p-4 text-center ${
              result.errorRows > 0 ? 'bg-red-50 border border-red-200' : 'bg-slate-50 border border-slate-200'
            }`}>
              <p className={`text-2xl font-bold tabular-nums ${result.errorRows > 0 ? 'text-red-700' : 'text-slate-900'}`}>
                {result.errorRows}
              </p>
              <p className={`text-xs ${result.errorRows > 0 ? 'text-red-600' : 'text-slate-500'}`}>
                {t('validation.errorRows')}
              </p>
            </div>
          </div>

          {/* Preview table */}
          {result.preview.length > 0 && (
            <div>
              <h3 className="text-sm font-medium text-slate-700 mb-2">{t('validation.previewTitle')}</h3>
              <div className="border border-slate-200 rounded-lg overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-slate-50">
                      <th className="text-left px-3 py-2 font-medium text-slate-600">#</th>
                      {columnMappings.map((m) => (
                        <th key={m.targetField} className="text-left px-3 py-2 font-medium text-slate-600">
                          {t(`fields.${entityType}.${m.targetField}`, { defaultValue: m.targetField })}
                        </th>
                      ))}
                      <th className="text-left px-3 py-2 font-medium text-slate-600">{t('validation.status')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {result.preview.map((row, idx) => {
                      const rowNum = idx + 1;
                      const hasError = errorRowNumbers.has(rowNum);
                      const rowErrors = errorsByRow[rowNum] || [];
                      const errorFields = new Set(rowErrors.map((e) => e.field));

                      return (
                        <tr
                          key={idx}
                          className={hasError ? 'bg-red-50/50' : 'bg-green-50/30'}
                        >
                          <td className="px-3 py-2 text-slate-500 tabular-nums">{rowNum}</td>
                          {columnMappings.map((m) => {
                            const cellHasError = errorFields.has(m.targetField);
                            const value = String(row[m.targetField] ?? '');
                            return (
                              <td
                                key={m.targetField}
                                className={`px-3 py-2 max-w-[150px] truncate ${
                                  cellHasError ? 'text-red-700 font-medium' : 'text-slate-700'
                                }`}
                                title={cellHasError ? rowErrors.find((e) => e.field === m.targetField)?.message : value}
                              >
                                {cellHasError && (
                                  <svg className="w-3 h-3 text-red-500 inline mr-1" fill="currentColor" viewBox="0 0 20 20">
                                    <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                                  </svg>
                                )}
                                {value || '—'}
                              </td>
                            );
                          })}
                          <td className="px-3 py-2">
                            {hasError ? (
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">
                                {t('validation.rowError')}
                              </span>
                            ) : (
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">
                                {t('validation.rowValid')}
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Error details */}
          {result.errors.length > 0 && (
            <div>
              <h3 className="text-sm font-medium text-slate-700 mb-2">
                {t('validation.errorDetails')} ({result.errors.length})
              </h3>
              <div className="border border-red-200 rounded-lg overflow-hidden max-h-60 overflow-y-auto">
                <table className="w-full text-xs">
                  <thead className="sticky top-0">
                    <tr className="bg-red-50">
                      <th className="text-left px-3 py-2 font-medium text-red-700">{t('validation.errorRow')}</th>
                      <th className="text-left px-3 py-2 font-medium text-red-700">{t('validation.errorField')}</th>
                      <th className="text-left px-3 py-2 font-medium text-red-700">{t('validation.errorMessage')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-red-100">
                    {result.errors.slice(0, 50).map((err, i) => (
                      <tr key={i}>
                        <td className="px-3 py-2 tabular-nums text-red-600">{err.row}</td>
                        <td className="px-3 py-2 text-red-700 font-mono">{err.field}</td>
                        <td className="px-3 py-2 text-red-600">{err.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {/* Actions */}
      <div className="flex items-center justify-between">
        <button
          onClick={onBack}
          className="px-4 py-2.5 rounded-lg border border-slate-200 text-sm text-slate-700 hover:bg-slate-50 transition-colors"
        >
          {t('common.back')}
        </button>
        {result && (
          <button
            onClick={() => onComplete(result)}
            disabled={result.validRows === 0}
            className="px-6 py-2.5 rounded-lg bg-brand-500 text-white text-sm font-medium hover:bg-brand-600 active:bg-brand-700 transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {t('validation.submit')}
          </button>
        )}
      </div>
    </div>
  );
}
