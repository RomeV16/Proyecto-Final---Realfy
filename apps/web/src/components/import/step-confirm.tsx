'use client';

import { useState, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { apiClient } from '@/lib/api-client';
import type { ImportEntityType, ColumnMappingInput } from '@realfy/shared';
import type { UploadResult, ValidationResult, ExecuteResult } from './import-wizard';

interface StepConfirmProps {
  uploadResult: UploadResult;
  entityType: ImportEntityType;
  columnMappings: ColumnMappingInput[];
  validationResult: ValidationResult;
  onBack: () => void;
  onReset: () => void;
}

export function StepConfirm({
  uploadResult,
  entityType,
  columnMappings,
  validationResult,
  onBack,
  onReset,
}: StepConfirmProps) {
  const t = useTranslations('import');

  const [executing, setExecuting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ExecuteResult | null>(null);

  const handleExecute = useCallback(async () => {
    setExecuting(true);
    setError(null);
    try {
      const data = await apiClient<ExecuteResult>('/import/execute', {
        method: 'POST',
        body: JSON.stringify({
          fileId: uploadResult.fileId,
          entityType,
          columnMappings,
        }),
      });
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('confirm.error'));
    } finally {
      setExecuting(false);
    }
  }, [uploadResult.fileId, entityType, columnMappings, t]);

  // Completed state
  if (result) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-6 space-y-6">
        {/* Success header */}
        <div className="text-center py-4">
          <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
            </svg>
          </div>
          <h2 className="text-lg font-semibold text-slate-900">{t('confirm.successTitle')}</h2>
          <p className="text-sm text-slate-500 mt-1">{t('confirm.successSubtitle')}</p>
        </div>

        {/* Result stats */}
        <div className="grid grid-cols-3 gap-4">
          <div className="rounded-lg bg-slate-50 border border-slate-200 p-4 text-center">
            <p className="text-2xl font-bold text-slate-900 tabular-nums">{result.totalRows}</p>
            <p className="text-xs text-slate-500">{t('confirm.totalRows')}</p>
          </div>
          <div className="rounded-lg bg-green-50 border border-green-200 p-4 text-center">
            <p className="text-2xl font-bold text-green-700 tabular-nums">{result.importedRows}</p>
            <p className="text-xs text-green-600">{t('confirm.importedRows')}</p>
          </div>
          <div className={`rounded-lg p-4 text-center ${
            result.skippedRows > 0 ? 'bg-yellow-50 border border-yellow-200' : 'bg-slate-50 border border-slate-200'
          }`}>
            <p className={`text-2xl font-bold tabular-nums ${result.skippedRows > 0 ? 'text-yellow-700' : 'text-slate-900'}`}>
              {result.skippedRows}
            </p>
            <p className={`text-xs ${result.skippedRows > 0 ? 'text-yellow-600' : 'text-slate-500'}`}>
              {t('confirm.skippedRows')}
            </p>
          </div>
        </div>

        {/* Error details if any */}
        {result.errors.length > 0 && (
          <div>
            <h3 className="text-sm font-medium text-slate-700 mb-2">
              {t('confirm.errorDetails')} ({result.errors.length})
            </h3>
            <div className="border border-red-200 rounded-lg overflow-hidden max-h-48 overflow-y-auto">
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

        {/* New import button */}
        <div className="flex justify-center">
          <button
            onClick={onReset}
            className="px-6 py-2.5 rounded-lg bg-brand-500 text-white text-sm font-medium hover:bg-brand-600 active:bg-brand-700 transition-colors shadow-sm"
          >
            {t('confirm.newImport')}
          </button>
        </div>
      </div>
    );
  }

  // Pre-execution confirmation state
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-6 space-y-6">
      {/* Summary */}
      <div className="space-y-4">
        <h2 className="text-lg font-semibold text-slate-900">{t('confirm.title')}</h2>

        <div className="grid grid-cols-2 gap-4">
          <div className="rounded-lg bg-slate-50 border border-slate-200 p-4">
            <p className="text-xs text-slate-500">{t('confirm.file')}</p>
            <p className="text-sm font-medium text-slate-900 mt-1">{uploadResult.fileName}</p>
          </div>
          <div className="rounded-lg bg-slate-50 border border-slate-200 p-4">
            <p className="text-xs text-slate-500">{t('confirm.entityType')}</p>
            <p className="text-sm font-medium text-slate-900 mt-1">
              {t(`upload.entityTypes.${entityType}`)}
            </p>
          </div>
        </div>

        {/* Import summary */}
        <div className="rounded-lg border border-slate-200 p-4 space-y-3">
          <div className="flex items-center justify-between text-sm">
            <span className="text-slate-600">{t('confirm.rowsToImport')}</span>
            <span className="font-semibold text-green-700 tabular-nums">{validationResult.validRows}</span>
          </div>
          {validationResult.errorRows > 0 && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-slate-600">{t('confirm.rowsToSkip')}</span>
              <span className="font-semibold text-yellow-700 tabular-nums">{validationResult.errorRows}</span>
            </div>
          )}
          <div className="flex items-center justify-between text-sm">
            <span className="text-slate-600">{t('confirm.mappedColumns')}</span>
            <span className="font-semibold text-slate-900 tabular-nums">{columnMappings.length}</span>
          </div>
        </div>

        {validationResult.errorRows > 0 && (
          <div className="rounded-lg bg-yellow-50 border border-yellow-200 px-4 py-3 text-sm text-yellow-800">
            {t('confirm.skipWarning', { count: validationResult.errorRows })}
          </div>
        )}
      </div>

      {/* Error message */}
      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Executing spinner */}
      {executing && (
        <div className="flex items-center justify-center py-4">
          <div className="flex items-center gap-3">
            <svg className="w-5 h-5 animate-spin text-brand-500" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            <span className="text-sm text-slate-600">{t('confirm.executing')}</span>
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center justify-between">
        <button
          onClick={onBack}
          disabled={executing}
          className="px-4 py-2.5 rounded-lg border border-slate-200 text-sm text-slate-700 hover:bg-slate-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {t('common.back')}
        </button>
        <button
          onClick={handleExecute}
          disabled={executing}
          className="px-6 py-2.5 rounded-lg bg-green-600 text-white text-sm font-medium hover:bg-green-700 active:bg-green-800 transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
        >
          {t('confirm.execute')}
        </button>
      </div>
    </div>
  );
}
