'use client';

import { useTranslations } from 'next-intl';
import { useState, useRef, useCallback, type DragEvent } from 'react';
import { apiClient, ApiRequestError } from '@/lib/api-client';

/* ──────────── Types ──────────── */

interface MediaItem {
  id: string;
  url: string;
  thumbnailUrl?: string;
  isPrimary: boolean;
  sortOrder: number;
}

interface UploadingFile {
  id: string;
  file: File;
  preview: string;
  progress: number; // 0–100
  error?: string;
}

interface PropertyMediaUploadProps {
  propertyId: string;
  media: MediaItem[];
  onMediaChange: (media: MediaItem[]) => void;
  readOnly?: boolean;
}

/* ──────────── Component ──────────── */

export function PropertyMediaUpload({
  propertyId,
  media,
  onMediaChange,
  readOnly = false,
}: PropertyMediaUploadProps) {
  const t = useTranslations('properties.media');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState<UploadingFile[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [dragSourceId, setDragSourceId] = useState<string | null>(null);
  const [error, setError] = useState('');

  /* ── Upload logic ── */

  const uploadFile = useCallback(async (file: File) => {
    const tempId = `upload-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const preview = URL.createObjectURL(file);

    const uploadEntry: UploadingFile = { id: tempId, file, preview, progress: 0 };
    setUploading((prev) => [...prev, uploadEntry]);

    try {
      const formData = new FormData();
      formData.append('file', file);

      // Use fetch directly for multipart — apiClient sets Content-Type to JSON
      const baseUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api';
      const res = await fetch(`${baseUrl}/properties/${propertyId}/media`, {
        method: 'POST',
        credentials: 'include' as RequestCredentials,
        body: formData,
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({ message: res.statusText }));
        throw new Error(body.message || res.statusText);
      }

      const newMedia = await res.json() as MediaItem;

      setUploading((prev) => prev.filter((u) => u.id !== tempId));
      URL.revokeObjectURL(preview);
      onMediaChange([...media, newMedia]);
    } catch (err) {
      const message = err instanceof Error ? err.message : t('uploadError');
      setUploading((prev) =>
        prev.map((u) => (u.id === tempId ? { ...u, error: message, progress: 0 } : u))
      );
      console.error(`[PropertyMediaUpload] Upload failed for ${file.name}:`, message);
    }
  }, [propertyId, media, onMediaChange, t]);

  function handleFiles(files: FileList | null) {
    if (!files) return;
    setError('');
    Array.from(files).forEach((file) => {
      if (!file.type.startsWith('image/')) {
        setError(t('invalidType'));
        return;
      }
      if (file.size > 10 * 1024 * 1024) {
        setError(t('fileTooLarge'));
        return;
      }
      uploadFile(file);
    });
  }

  /* ── Drag-drop zone ── */

  function handleDragEnter(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(true);
  }
  function handleDragLeave(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
  }
  function handleDragOver(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
  }
  function handleDrop(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    handleFiles(e.dataTransfer.files);
  }

  /* ── Actions ── */

  async function handleDelete(mediaId: string) {
    try {
      await apiClient(`/properties/${propertyId}/media/${mediaId}`, { method: 'DELETE' });
      onMediaChange(media.filter((m) => m.id !== mediaId));
    } catch (err) {
      const msg = err instanceof ApiRequestError ? err.message : t('deleteError');
      setError(msg);
      console.error(`[PropertyMediaUpload] Delete failed for ${mediaId}:`, msg);
    }
  }

  async function handleSetPrimary(mediaId: string) {
    // Optimistic update
    const updated = media.map((m) => ({ ...m, isPrimary: m.id === mediaId }));
    onMediaChange(updated);
    try {
      await apiClient(`/properties/${propertyId}/media/reorder`, {
        method: 'PATCH',
        body: JSON.stringify({ mediaIds: [mediaId, ...media.filter((m) => m.id !== mediaId).map((m) => m.id)] }),
      });
    } catch (err) {
      // Revert on failure
      onMediaChange(media);
      const msg = err instanceof ApiRequestError ? err.message : t('reorderError');
      setError(msg);
    }
  }

  function dismissUploadError(uploadId: string) {
    setUploading((prev) => prev.filter((u) => u.id !== uploadId));
  }

  /* ── Reorder via drag ── */

  function handleMediaDragStart(mediaId: string) {
    setDragSourceId(mediaId);
  }

  async function handleMediaDrop(targetId: string) {
    if (!dragSourceId || dragSourceId === targetId) {
      setDragSourceId(null);
      return;
    }
    const items = [...media];
    const srcIdx = items.findIndex((m) => m.id === dragSourceId);
    const tgtIdx = items.findIndex((m) => m.id === targetId);
    if (srcIdx === -1 || tgtIdx === -1) return;

    const [moved] = items.splice(srcIdx, 1);
    items.splice(tgtIdx, 0, moved);

    const reordered = items.map((m, i) => ({ ...m, sortOrder: i }));
    onMediaChange(reordered);
    setDragSourceId(null);

    try {
      await apiClient(`/properties/${propertyId}/media/reorder`, {
        method: 'PATCH',
        body: JSON.stringify({ mediaIds: reordered.map((m) => m.id) }),
      });
    } catch {
      onMediaChange(media); // revert
    }
  }

  /* ── Render ── */

  const sortedMedia = [...media].sort((a, b) => a.sortOrder - b.sortOrder);
  const primaryId = sortedMedia.find((m) => m.isPrimary)?.id ?? sortedMedia[0]?.id;

  return (
    <div className="space-y-4">
      {error && (
        <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError('')} className="text-red-400 hover:text-red-600 ml-2">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {/* Drop zone */}
      {!readOnly && (
        <div
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`
            relative flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed
            px-6 py-8 cursor-pointer transition-all duration-200
            ${dragOver
              ? 'border-brand-400 bg-brand-50/60 scale-[1.01]'
              : 'border-slate-200 bg-slate-50/50 hover:border-slate-300 hover:bg-slate-50'
            }
          `}
        >
          <div className={`w-12 h-12 rounded-xl flex items-center justify-center transition-colors ${
            dragOver ? 'bg-brand-100 text-brand-600' : 'bg-slate-100 text-slate-400'
          }`}>
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0022.5 18.75V5.25A2.25 2.25 0 0020.25 3H3.75A2.25 2.25 0 001.5 5.25v13.5A2.25 2.25 0 003.75 21z" />
            </svg>
          </div>
          <div className="text-center">
            <p className="text-sm font-medium text-slate-700">{t('dropOrClick')}</p>
            <p className="text-xs text-slate-400 mt-1">{t('formats')}</p>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/*"
            onChange={(e) => handleFiles(e.target.files)}
            className="hidden"
          />
        </div>
      )}

      {/* Uploading files */}
      {uploading.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
          {uploading.map((u) => (
            <div key={u.id} className="relative aspect-[4/3] rounded-lg overflow-hidden bg-slate-100 border border-slate-200">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={u.preview} alt="" className="w-full h-full object-cover opacity-50" />
              <div className="absolute inset-0 flex items-center justify-center">
                {u.error ? (
                  <div className="flex flex-col items-center gap-1 px-2">
                    <svg className="w-5 h-5 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
                    </svg>
                    <span className="text-[10px] text-red-600 text-center leading-tight">{u.error}</span>
                    <button
                      onClick={() => dismissUploadError(u.id)}
                      className="text-xs text-slate-500 hover:text-slate-700 underline mt-0.5"
                    >
                      {t('dismiss')}
                    </button>
                  </div>
                ) : (
                  <div className="w-6 h-6 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Gallery grid */}
      {sortedMedia.length > 0 ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
          {sortedMedia.map((m) => {
            const isPrimary = m.id === primaryId;
            return (
              <div
                key={m.id}
                draggable={!readOnly}
                onDragStart={() => handleMediaDragStart(m.id)}
                onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
                onDrop={(e) => { e.preventDefault(); e.stopPropagation(); handleMediaDrop(m.id); }}
                className={`
                  group relative aspect-[4/3] rounded-lg overflow-hidden bg-slate-100
                  ${isPrimary ? 'ring-2 ring-amber-400 ring-offset-1' : 'border border-slate-200'}
                  ${!readOnly ? 'cursor-grab active:cursor-grabbing' : ''}
                  ${dragSourceId === m.id ? 'opacity-40' : ''}
                  transition-all duration-150
                `}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={m.thumbnailUrl || m.url}
                  alt=""
                  className="w-full h-full object-cover"
                />

                {/* Primary star */}
                {isPrimary && (
                  <div className="absolute top-1.5 left-1.5 w-6 h-6 rounded-full bg-amber-400 text-white flex items-center justify-center shadow-sm">
                    <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                      <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                    </svg>
                  </div>
                )}

                {/* Overlay actions */}
                {!readOnly && (
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-all duration-200 flex items-center justify-center gap-2 opacity-0 group-hover:opacity-100">
                    {/* Set as primary */}
                    {!isPrimary && (
                      <button
                        onClick={(e) => { e.stopPropagation(); handleSetPrimary(m.id); }}
                        title={t('setPrimary')}
                        className="w-8 h-8 rounded-full bg-white/90 text-amber-500 hover:bg-amber-50 flex items-center justify-center shadow-sm transition-colors"
                      >
                        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                          <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                        </svg>
                      </button>
                    )}
                    {/* Delete */}
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDelete(m.id); }}
                      title={t('delete')}
                      className="w-8 h-8 rounded-full bg-white/90 text-red-500 hover:bg-red-50 flex items-center justify-center shadow-sm transition-colors"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        !readOnly && uploading.length === 0 && (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <div className="w-14 h-14 rounded-2xl bg-slate-100 flex items-center justify-center mb-3">
              <svg className="w-7 h-7 text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0022.5 18.75V5.25A2.25 2.25 0 0020.25 3H3.75A2.25 2.25 0 001.5 5.25v13.5A2.25 2.25 0 003.75 21z" />
              </svg>
            </div>
            <p className="text-sm text-slate-400">{t('noImages')}</p>
          </div>
        )
      )}
    </div>
  );
}
