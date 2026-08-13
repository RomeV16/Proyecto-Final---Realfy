'use client';

import { useTranslations } from 'next-intl';
import { useState, useRef, useCallback, type DragEvent } from 'react';
import { apiClient, ApiRequestError } from '@/lib/api-client';
import { cn } from '@/lib/cn';
import { SmartImage } from '@/components/ui/entity-cover';
import { Badge } from '@/components/ui/badge';
import { Icon } from '@/components/ui/icon';
import { EmptyState } from '@/components/ui/empty-state';

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

/* ──────────── Upload transport ──────────── */

/**
 * XHR rather than fetch so we get real `upload.onprogress` events — the only
 * way to drive a per-file progress bar instead of a fake one.
 */
function uploadWithProgress(
  url: string,
  formData: FormData,
  onProgress: (pct: number) => void,
): Promise<MediaItem> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    xhr.withCredentials = true;
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText) as MediaItem);
        } catch {
          reject(new Error('Invalid response'));
        }
      } else {
        let message = xhr.statusText;
        try {
          message = JSON.parse(xhr.responseText)?.message || message;
        } catch {
          /* ignore parse errors, fall back to statusText */
        }
        reject(new Error(message));
      }
    };
    xhr.onerror = () => reject(new Error('Network error'));
    xhr.send(formData);
  });
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

      const baseUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api';
      const newMedia = await uploadWithProgress(
        `${baseUrl}/properties/${propertyId}/media`,
        formData,
        (pct) => setUploading((prev) => prev.map((u) => (u.id === tempId ? { ...u, progress: pct } : u))),
      );

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
  const isEmpty = sortedMedia.length === 0 && uploading.length === 0;

  return (
    <div className="space-y-4">
      {error && (
        <div className="flex items-center justify-between gap-2 rounded-[var(--radius-lg)] border border-[color-mix(in_oklab,var(--color-danger)_28%,var(--color-border))] bg-[color-mix(in_oklab,var(--color-danger)_10%,var(--color-surface))] px-3 py-2.5 text-sm text-[color-mix(in_oklab,var(--color-danger)_75%,var(--color-text))]">
          <span className="flex min-w-0 items-center gap-2">
            <Icon name="alert" className="h-4 w-4 shrink-0" strokeWidth={2} />
            <span className="truncate">{error}</span>
          </span>
          <button
            onClick={() => setError('')}
            className="shrink-0 rounded-full p-1 text-current/70 transition-colors hover:bg-black/5"
            aria-label={t('dismiss')}
          >
            <Icon name="close" className="h-3.5 w-3.5" strokeWidth={2.25} />
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
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') fileInputRef.current?.click();
          }}
          className={cn(
            'relative flex flex-col items-center justify-center gap-3 rounded-[var(--radius-2xl)] border-2 border-dashed px-6 py-8 cursor-pointer transition-all duration-200',
            dragOver
              ? 'border-[var(--color-brand-400)] bg-[color-mix(in_oklab,var(--color-brand-500)_8%,var(--color-surface))] scale-[1.01]'
              : 'border-[var(--color-border)] bg-[var(--color-bg)] hover:border-[var(--color-brand-300)] hover:bg-[color-mix(in_oklab,var(--color-brand-500)_4%,var(--color-bg))]',
          )}
        >
          <div
            className={cn(
              'flex h-12 w-12 items-center justify-center rounded-[var(--radius-xl)] transition-colors',
              dragOver
                ? 'bg-[var(--color-brand-100)] text-[var(--color-brand-600)]'
                : 'bg-[var(--color-surface)] text-[var(--color-muted)]',
            )}
          >
            <Icon name="image" className="h-6 w-6" strokeWidth={1.5} />
          </div>
          <div className="text-center">
            <p className="text-sm font-medium text-[var(--color-text)]">{t('dropOrClick')}</p>
            <p className="mt-1 text-xs text-[var(--color-muted)]">{t('formats')}</p>
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

      {/* Uploading files — skeleton tiles with per-file progress */}
      {uploading.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
          {uploading.map((u) => (
            <div
              key={u.id}
              className="relative aspect-[4/3] overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-bg)]"
            >
              {!u.error && <div className="absolute inset-0 skeleton" aria-hidden="true" />}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={u.preview}
                alt=""
                className={cn('h-full w-full object-cover transition-opacity', u.error ? 'opacity-30' : 'opacity-60')}
              />
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 bg-black/10 p-2">
                {u.error ? (
                  <>
                    <Icon name="alert" className="h-5 w-5 text-white drop-shadow" strokeWidth={2} />
                    <span className="text-center text-[10px] leading-tight text-white drop-shadow">{u.error}</span>
                    <button
                      onClick={() => dismissUploadError(u.id)}
                      className="mt-0.5 text-[11px] font-medium text-white underline underline-offset-2"
                    >
                      {t('dismiss')}
                    </button>
                  </>
                ) : (
                  <span className="w-9/12 max-w-[8rem]">
                    <span className="block h-1 w-full overflow-hidden rounded-full bg-white/30">
                      <span
                        className="block h-full rounded-full bg-white transition-[width] duration-200 ease-out"
                        style={{ width: `${Math.max(u.progress, 6)}%` }}
                      />
                    </span>
                  </span>
                )}
              </div>
              {/* Truncated filename chip anchors the tile even while it's a plain preview */}
              {!u.error && (
                <span className="absolute bottom-1.5 left-1.5 right-1.5 truncate rounded-full bg-black/45 px-2 py-0.5 text-center text-[10px] text-white backdrop-blur-sm">
                  {u.file.name}
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Gallery — primary tile dominant, rest in a tidy grid */}
      {sortedMedia.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
          {sortedMedia.map((m) => {
            const isPrimary = m.id === primaryId;
            return (
              <div
                key={m.id}
                draggable={!readOnly}
                onDragStart={() => handleMediaDragStart(m.id)}
                onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
                onDrop={(e) => { e.preventDefault(); e.stopPropagation(); handleMediaDrop(m.id); }}
                className={cn(
                  'group relative overflow-hidden rounded-[var(--radius-lg)] bg-[var(--color-bg)] transition-all duration-150',
                  isPrimary
                    ? 'col-span-2 row-span-2 aspect-[4/3] ring-2 ring-[var(--color-brand-400)] ring-offset-1 ring-offset-[var(--color-surface)] sm:aspect-[16/11]'
                    : 'aspect-[4/3] border border-[var(--color-border)]',
                  !readOnly && 'cursor-grab active:cursor-grabbing',
                  dragSourceId === m.id && 'opacity-40',
                )}
              >
                <SmartImage
                  src={m.thumbnailUrl || m.url}
                  alt=""
                  fallback={
                    <div className="flex h-full w-full items-center justify-center bg-[var(--color-bg)] text-[var(--color-muted)]">
                      <Icon name="image" className="h-6 w-6" strokeWidth={1.5} />
                    </div>
                  }
                />

                {/* Primary badge */}
                {isPrimary && (
                  <div className="absolute left-2 top-2 z-[1]">
                    <Badge onCover>
                      <svg className="h-3 w-3" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
                        <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                      </svg>
                      {t('primaryBadge')}
                    </Badge>
                  </div>
                )}

                {/* Hover actions */}
                {!readOnly && (
                  <div className="absolute inset-0 z-[1] flex items-center justify-center gap-2 bg-black/0 opacity-0 transition-all duration-200 group-hover:bg-black/30 group-hover:opacity-100">
                    {!isPrimary && (
                      <button
                        onClick={(e) => { e.stopPropagation(); handleSetPrimary(m.id); }}
                        title={t('setPrimary')}
                        aria-label={t('setPrimary')}
                        className="flex h-8 w-8 items-center justify-center rounded-full bg-white/90 text-amber-500 shadow-sm transition-colors hover:bg-amber-50"
                      >
                        <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
                          <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                        </svg>
                      </button>
                    )}
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDelete(m.id); }}
                      title={t('delete')}
                      aria-label={t('delete')}
                      className="flex h-8 w-8 items-center justify-center rounded-full bg-white/90 text-red-500 shadow-sm transition-colors hover:bg-red-50"
                    >
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Empty — only surfaced read-only; editable mode already has the drop zone as its CTA */}
      {isEmpty && readOnly && (
        <EmptyState variant="filtered" iconName="image" title={t('noImages')} />
      )}
    </div>
  );
}
