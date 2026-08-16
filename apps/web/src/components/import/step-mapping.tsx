'use client';

import { useState, useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { PROPERTY_IMPORT_FIELDS, PERSON_IMPORT_FIELDS } from '@realfy/shared';
import type { ImportEntityType, ColumnMappingInput } from '@realfy/shared';
import type { UploadResult } from './import-wizard';

interface StepMappingProps {
  uploadResult: UploadResult;
  entityType: ImportEntityType;
  initialMappings: ColumnMappingInput[];
  onComplete: (mappings: ColumnMappingInput[]) => void;
  onBack: () => void;
}

export function StepMapping({ uploadResult, entityType, initialMappings, onComplete, onBack }: StepMappingProps) {
  const t = useTranslations('import');

  const targetFields = useMemo(
    () => (entityType === 'property' ? [...PROPERTY_IMPORT_FIELDS] : [...PERSON_IMPORT_FIELDS]),
    [entityType],
  );

  // Initialize mappings: use initial if provided, else try auto-match by header name
  const [mappings, setMappings] = useState<Record<string, string>>(() => {
    if (initialMappings.length > 0) {
      const map: Record<string, string> = {};
      initialMappings.forEach((m) => { map[m.sourceColumn] = m.targetField; });
      return map;
    }
    // Auto-match: if header matches a target field (case-insensitive), map it
    const map: Record<string, string> = {};
    uploadResult.headers.forEach((header) => {
      const normalized = header.toLowerCase().trim();
      const match = targetFields.find((f) => f.toLowerCase() === normalized);
      if (match) map[header] = match;
    });
    return map;
  });

  const mappedCount = Object.values(mappings).filter(Boolean).length;
  const usedTargets = new Set(Object.values(mappings).filter(Boolean));

  function handleMappingChange(sourceColumn: string, targetField: string) {
    setMappings((prev) => {
      const next = { ...prev };
      if (targetField === '') {
        delete next[sourceColumn];
      } else {
        next[sourceColumn] = targetField;
      }
      return next;
    });
  }

  function handleSubmit() {
    const result: ColumnMappingInput[] = Object.entries(mappings)
      .filter(([, target]) => target)
      .map(([source, target]) => ({ sourceColumn: source, targetField: target }));
    onComplete(result);
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-6 space-y-6">
      {/* File info */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-slate-900">{uploadResult.fileName}</p>
          <p className="text-xs text-slate-500">
            {t('mapping.rowCount', { count: uploadResult.rowCount })} · {uploadResult.headers.length} {t('mapping.columns')}
          </p>
        </div>
        <span className="text-sm text-slate-500">
          {t('mapping.mapped', { count: mappedCount, total: uploadResult.headers.length })}
        </span>
      </div>

      {/* Mapping table */}
      <div className="border border-slate-200 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50">
              <th className="text-left px-4 py-3 font-medium text-slate-600">{t('mapping.sourceColumn')}</th>
              <th className="text-center px-4 py-3 w-10" />
              <th className="text-left px-4 py-3 font-medium text-slate-600">{t('mapping.targetField')}</th>
              <th className="text-left px-4 py-3 font-medium text-slate-600">{t('mapping.sampleData')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {uploadResult.headers.map((header, idx) => {
              const currentTarget = mappings[header] || '';
              const sampleValues = uploadResult.sampleRows
                .map((row) => row[idx])
                .filter(Boolean)
                .slice(0, 3);

              return (
                <tr key={header} className="hover:bg-slate-50/50">
                  <td className="px-4 py-3">
                    <span className="font-mono text-xs bg-slate-100 px-2 py-1 rounded">{header}</span>
                  </td>
                  <td className="text-center text-slate-300">→</td>
                  <td className="px-4 py-3">
                    <select
                      value={currentTarget}
                      onChange={(e) => handleMappingChange(header, e.target.value)}
                      className={`w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500 ${
                        currentTarget
                          ? 'border-green-300 bg-green-50 text-green-800'
                          : 'border-slate-200 bg-white text-slate-900'
                      }`}
                    >
                      <option value="">{t('mapping.skip')}</option>
                      {targetFields.map((field) => (
                        <option
                          key={field}
                          value={field}
                          disabled={usedTargets.has(field) && currentTarget !== field}
                        >
                          {t(`fields.${entityType}.${field}`, { defaultValue: field })}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1 flex-wrap">
                      {sampleValues.map((val, i) => (
                        <span key={i} className="text-xs text-slate-500 bg-slate-50 px-2 py-0.5 rounded truncate max-w-[120px]">
                          {val}
                        </span>
                      ))}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Actions */}
      <div className="flex items-center justify-between">
        <button
          onClick={onBack}
          className="px-4 py-2.5 rounded-lg border border-slate-200 text-sm text-slate-700 hover:bg-slate-50 transition-colors"
        >
          {t('common.back')}
        </button>
        <button
          onClick={handleSubmit}
          disabled={mappedCount === 0}
          className="px-6 py-2.5 rounded-lg bg-brand-500 text-white text-sm font-medium hover:bg-brand-600 active:bg-brand-700 transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {t('mapping.submit')}
        </button>
      </div>
    </div>
  );
}
