/**
 * Thin wrapper around Sonner that enforces consistent durations and positioning.
 *
 * Usage:
 *   import { toast } from '@/lib/toast';
 *   toast.success('Guardado');
 *   toast.error('Ocurrió un error');
 *   toast.promise(fetch('/api/data'), { loading: '…', success: 'Listo', error: 'Error' });
 */
import { toast as sonnerToast } from 'sonner';

const SUCCESS_DURATION = 3_000; // 3s
const ERROR_DURATION = 6_000; // 6s
const INFO_DURATION = 4_000; // 4s

export const toast = {
  success(message: string) {
    return sonnerToast.success(message, { duration: SUCCESS_DURATION });
  },

  error(message: string) {
    return sonnerToast.error(message, { duration: ERROR_DURATION });
  },

  info(message: string) {
    return sonnerToast.info(message, { duration: INFO_DURATION });
  },

  promise<T>(
    promise: Promise<T>,
    messages: {
      loading: string;
      success: string | ((data: T) => string);
      error: string | ((err: unknown) => string);
    },
  ) {
    return sonnerToast.promise(promise, {
      loading: messages.loading,
      success: messages.success,
      error: messages.error,
      duration: SUCCESS_DURATION,
    });
  },
} as const;
