'use client';

import { useTranslations } from 'next-intl';
import { Button } from './button';
import { DialogFooter } from './dialog';

interface Props {
  onCancel: () => void;
  busy: boolean;
  /** Texto del botón que envía el formulario (ya con el "guardando..." si corresponde). */
  submitLabel: string;
}

/** Pie de un diálogo con formulario: cancelar y enviar, los dos deshabilitados mientras se envía. */
export function FormDialogFooter({ onCancel, busy, submitLabel }: Props) {
  const t = useTranslations('common');
  return (
    <DialogFooter>
      <Button type="button" variant="secondary" onClick={onCancel} disabled={busy}>
        {t('cancel')}
      </Button>
      <Button type="submit" disabled={busy}>
        {submitLabel}
      </Button>
    </DialogFooter>
  );
}
