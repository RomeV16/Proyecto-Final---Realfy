'use client';

import { useState, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import type { ImportEntityType, ColumnMappingInput } from '@realfy/shared';
import { StepUpload } from './step-upload';
import { StepMapping } from './step-mapping';
import { StepValidation } from './step-validation';
import { StepConfirm } from './step-confirm';

/* ──────────── Wizard State ──────────── */

export interface UploadResult {
  fileId: string;
  fileName: string;
  headers: string[];
  rowCount: number;
  sampleRows: string[][];
}

export interface ValidationResult {
  totalRows: number;
  validRows: number;
  errorRows: number;
  errors: { row: number; field: string; message: string; value?: unknown }[];
  preview: Record<string, unknown>[];
}

export interface ExecuteResult {
  totalRows: number;
  importedRows: number;
  skippedRows: number;
  errors: { row: number; field: string; message: string; value?: unknown }[];
}

type WizardStep = 'upload' | 'mapping' | 'validation' | 'confirm';

const STEPS: WizardStep[] = ['upload', 'mapping', 'validation', 'confirm'];

/* ──────────── Component ──────────── */

export function ImportWizard() {
  const t = useTranslations('import');

  const [step, setStep] = useState<WizardStep>('upload');
  const [entityType, setEntityType] = useState<ImportEntityType>('property');
  const [uploadResult, setUploadResult] = useState<UploadResult | null>(null);
  const [columnMappings, setColumnMappings] = useState<ColumnMappingInput[]>([]);
  const [validationResult, setValidationResult] = useState<ValidationResult | null>(null);

  const stepIndex = STEPS.indexOf(step);

  const handleUploadComplete = useCallback((result: UploadResult, type: ImportEntityType) => {
    setUploadResult(result);
    setEntityType(type);
    setStep('mapping');
  }, []);

  const handleMappingComplete = useCallback((mappings: ColumnMappingInput[]) => {
    setColumnMappings(mappings);
    setStep('validation');
  }, []);

  const handleValidationComplete = useCallback((result: ValidationResult) => {
    setValidationResult(result);
    setStep('confirm');
  }, []);

  const handleBack = useCallback(() => {
    const idx = STEPS.indexOf(step);
    if (idx > 0) setStep(STEPS[idx - 1]);
  }, [step]);

  const handleReset = useCallback(() => {
    setStep('upload');
    setUploadResult(null);
    setColumnMappings([]);
    setValidationResult(null);
    setEntityType('property');
  }, []);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">{t('title')}</h1>
        <p className="text-sm text-slate-500 mt-0.5">{t('subtitle')}</p>
      </div>

      {/* Step Indicator */}
      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <div className="flex items-center justify-between">
          {STEPS.map((s, i) => {
            const isActive = i === stepIndex;
            const isDone = i < stepIndex;
            return (
              <div key={s} className="flex items-center flex-1">
                <div className="flex items-center gap-2">
                  <div
                    className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold shrink-0 transition-colors ${
                      isDone
                        ? 'bg-green-500 text-white'
                        : isActive
                          ? 'bg-brand-500 text-white'
                          : 'bg-slate-100 text-slate-400'
                    }`}
                  >
                    {isDone ? (
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                      </svg>
                    ) : (
                      i + 1
                    )}
                  </div>
                  <span
                    className={`text-sm hidden sm:inline ${
                      isActive ? 'font-medium text-slate-900' : 'text-slate-400'
                    }`}
                  >
                    {t(`steps.${s}`)}
                  </span>
                </div>
                {i < STEPS.length - 1 && (
                  <div
                    className={`flex-1 h-px mx-3 ${
                      i < stepIndex ? 'bg-green-300' : 'bg-slate-200'
                    }`}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Step Content */}
      {step === 'upload' && (
        <StepUpload
          initialEntityType={entityType}
          onComplete={handleUploadComplete}
        />
      )}

      {step === 'mapping' && uploadResult && (
        <StepMapping
          uploadResult={uploadResult}
          entityType={entityType}
          initialMappings={columnMappings}
          onComplete={handleMappingComplete}
          onBack={handleBack}
        />
      )}

      {step === 'validation' && uploadResult && (
        <StepValidation
          uploadResult={uploadResult}
          entityType={entityType}
          columnMappings={columnMappings}
          onComplete={handleValidationComplete}
          onBack={handleBack}
        />
      )}

      {step === 'confirm' && uploadResult && validationResult && (
        <StepConfirm
          uploadResult={uploadResult}
          entityType={entityType}
          columnMappings={columnMappings}
          validationResult={validationResult}
          onBack={handleBack}
          onReset={handleReset}
        />
      )}
    </div>
  );
}
