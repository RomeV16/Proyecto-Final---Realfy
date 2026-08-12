'use client';

import { useTranslations } from 'next-intl';
import { useState, useEffect, useCallback } from 'react';
import { apiClient } from '@/lib/api-client';
import { Spinner } from '@/components/ui/spinner';

// ─── Types ──────────────────────────────────────────────

interface AvailableTemplate {
  id: string;
  name: string;
  contractType: string;
  variables: string[];
  isDefault: boolean;
}

interface GenerateDocumentModalProps {
  open: boolean;
  contractId: string;
  onClose: () => void;
}

// ─── Icons ──────────────────────────────────────────────

function IconX() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
}

function IconDocument() {
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
    </svg>
  );
}

// ─── Component ──────────────────────────────────────────

export function GenerateDocumentModal({ open, contractId, onClose }: GenerateDocumentModalProps) {
  const t = useTranslations('contractTemplates.generateDocument');
  const tCommon = useTranslations('common');

  const [templates, setTemplates] = useState<AvailableTemplate[]>([]);
  const [variables, setVariables] = useState<Record<string, string>>({});
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [format, setFormat] = useState<'pdf' | 'docx'>('pdf');
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');

  const loadData = useCallback(async () => {
    if (!open || !contractId) return;
    setLoading(true);
    setError('');
    try {
      const [templatesRes, varsRes] = await Promise.all([
        apiClient<AvailableTemplate[]>(`/contracts/${contractId}/available-templates`),
        apiClient<Record<string, string>>(`/contracts/${contractId}/template-variables`),
      ]);
      setTemplates(Array.isArray(templatesRes) ? templatesRes : []);
      setVariables(varsRes || {});

      // Auto-select default template or first available
      const tplList = Array.isArray(templatesRes) ? templatesRes : [];
      const defaultTpl = tplList.find((t) => t.isDefault);
      setSelectedTemplateId(defaultTpl?.id || tplList[0]?.id || '');
    } catch {
      setError(t('error'));
    } finally {
      setLoading(false);
    }
  }, [open, contractId, t]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Reset state when modal closes
  useEffect(() => {
    if (!open) {
      setSelectedTemplateId('');
      setFormat('pdf');
      setError('');
      setGenerating(false);
    }
  }, [open]);

  const selectedTemplate = templates.find((t) => t.id === selectedTemplateId);

  const handleGenerate = async () => {
    if (!selectedTemplateId) {
      setError(t('templateRequired'));
      return;
    }

    setGenerating(true);
    setError('');
    try {
      const apiBase = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api';
      const response = await fetch(
        `${apiBase}/contracts/${contractId}/generate-document`,
        {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            templateId: selectedTemplateId,
            format,
          }),
        },
      );

      if (!response.ok) {
        throw new Error('Document generation failed');
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;

      // Extract filename from Content-Disposition or build a default
      const disposition = response.headers.get('Content-Disposition');
      const filenameMatch = disposition?.match(/filename="(.+)"/);
      a.download = filenameMatch?.[1] || `contrato.${format}`;

      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      onClose();
    } catch {
      setError(t('error'));
    } finally {
      setGenerating(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-6 space-y-5 animate-zoom-in">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <IconDocument />
            <h2 className="text-lg font-semibold text-slate-900">{t('title')}</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
            aria-label={tCommon('close')}
          >
            <IconX />
          </button>
        </div>

        {loading ? (
          <div className="space-y-3 py-4">
            <div className="h-10 bg-slate-100 rounded-lg animate-pulse" />
            <div className="h-10 bg-slate-100 rounded-lg animate-pulse" />
            <div className="h-24 bg-slate-100 rounded-lg animate-pulse" />
          </div>
        ) : templates.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-sm text-slate-500">{t('noTemplates')}</p>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Template selector */}
            <div>
              <label htmlFor="gdTemplate" className="block text-sm font-medium text-slate-700 mb-1.5">
                {t('selectTemplate')}
              </label>
              <select
                id="gdTemplate"
                value={selectedTemplateId}
                onChange={(e) => setSelectedTemplateId(e.target.value)}
                className="w-full rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500"
              >
                {templates.map((tmpl) => (
                  <option key={tmpl.id} value={tmpl.id}>
                    {tmpl.name} {tmpl.isDefault ? '★' : ''}
                  </option>
                ))}
              </select>
            </div>

            {/* Format toggle */}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">
                {t('format')}
              </label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setFormat('pdf')}
                  className={`flex-1 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors border ${
                    format === 'pdf'
                      ? 'bg-brand-500 text-white border-brand-500'
                      : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  {t('formatPdf')}
                </button>
                <button
                  type="button"
                  onClick={() => setFormat('docx')}
                  className={`flex-1 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors border ${
                    format === 'docx'
                      ? 'bg-brand-500 text-white border-brand-500'
                      : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  {t('formatDocx')}
                </button>
              </div>
            </div>

            {/* Variables preview */}
            {selectedTemplate && Object.keys(variables).length > 0 && (
              <div>
                <p className="text-sm font-medium text-slate-700 mb-2">{t('variablesPreview')}</p>
                <div className="bg-slate-50 rounded-lg border border-slate-200 p-3 max-h-48 overflow-y-auto">
                  <div className="space-y-1">
                    {(selectedTemplate.variables || [])
                      .filter((v) => v in variables)
                      .map((v) => (
                        <div key={v} className="flex items-center gap-2 text-xs">
                          <span className="font-mono text-slate-500 shrink-0">{`{{${v}}}`}</span>
                          <span className="text-slate-300">→</span>
                          <span className="text-slate-700 truncate">{variables[v] || '—'}</span>
                        </div>
                      ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {error && (
          <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">
            {error}
          </div>
        )}

        {/* Actions */}
        <div className="flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2.5 rounded-lg border border-slate-200 text-slate-700 text-sm font-medium hover:bg-slate-50 transition-colors"
          >
            {tCommon('cancel')}
          </button>
          {templates.length > 0 && (
            <button
              onClick={handleGenerate}
              disabled={generating || !selectedTemplateId}
              className="px-4 py-2.5 rounded-lg bg-brand-500 text-white text-sm font-medium hover:bg-brand-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {generating && (
                <Spinner className="w-3 h-3 text-white" />
              )}
              {generating ? t('generating') : t('generate')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
