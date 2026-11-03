'use client';

import { useTranslations } from 'next-intl';
import { apiClient } from '@/lib/api-client';
import { today } from '@/lib/cash';
import { KEY_HOLDERS, KEY_HOLDERS_OUT } from '@/lib/sales';
import { FieldsDialog, type FieldDef } from '@/components/ui/fields-dialog';
import { useStaffUsers } from '@/components/fees/use-staff-users';

interface DialogProps {
  onClose: () => void;
  onDone: () => void;
}

/** Alta de un juego de llaves de la propiedad; si nace fuera de la oficina se anota quién lo tiene. */
export function KeySetDialog({ propertyId, onClose, onDone }: DialogProps & { propertyId: string }) {
  const t = useTranslations('keys');
  const fields: FieldDef[] = [
    { name: 'label', label: t('dialog.label'), kind: 'text', required: true, hint: t('dialog.labelHint') },
    { name: 'copies', label: t('dialog.copies'), kind: 'number', required: true },
    { name: 'location', label: t('dialog.location'), kind: 'text', hint: t('dialog.locationHint') },
    { name: 'holder', label: t('dialog.holder'), kind: 'select', required: true, options: KEY_HOLDERS.map((h) => ({ value: h, label: t(`holders.${h}`) })) },
    { name: 'holderName', label: t('dialog.holderName'), kind: 'text', required: true, visible: (v) => v.holder !== 'Oficina' },
  ];
  return (
    <FieldsDialog
      title={t('dialog.addTitle')}
      fields={fields}
      initial={{ copies: '1', holder: 'Oficina' }}
      submitLabel={t('dialog.save')}
      successMessage={t('dialog.added')}
      errorFallback={t('dialog.error')}
      request={(v) =>
        apiClient(`/properties/${propertyId}/keys`, {
          method: 'POST',
          body: JSON.stringify({
            label: v.label,
            copies: Number(v.copies),
            location: v.location || null,
            holder: v.holder,
            holderName: v.holder === 'Oficina' ? undefined : v.holderName,
          }),
        })
      }
      onClose={onClose}
      onDone={onDone}
    />
  );
}

/** Salida de un juego: a quién se entrega (personal, propietario, inquilino o un tercero), para qué y cuándo debería volver. */
export function KeyCheckOutDialog({ keySetId, label, onClose, onDone }: DialogProps & { keySetId: string; label: string }) {
  const t = useTranslations('keys');
  const staff = useStaffUsers(true);
  const fields: FieldDef[] = [
    { name: 'holder', label: t('dialog.holder'), kind: 'select', required: true, options: KEY_HOLDERS_OUT.map((h) => ({ value: h, label: t(`holders.${h}`) })) },
    {
      name: 'holderUserId',
      label: t('dialog.staff'),
      kind: 'select',
      required: true,
      visible: (v) => v.holder === 'Empleado' && staff.length > 0,
      options: staff.map((s) => ({ value: s.id, label: s.name })),
    },
    { name: 'holderName', label: t('dialog.holderName'), kind: 'text', required: true, visible: (v) => v.holder !== 'Empleado' || staff.length === 0 },
    { name: 'reason', label: t('dialog.reason'), kind: 'text', hint: t('dialog.reasonHint') },
    { name: 'outAt', label: t('dialog.outAt'), kind: 'date', required: true },
    { name: 'expectedReturnAt', label: t('dialog.expectedReturnAt'), kind: 'date', hint: t('dialog.expectedHint') },
  ];
  return (
    <FieldsDialog
      title={t('dialog.checkOutTitle', { label })}
      fields={fields}
      initial={{ holder: 'Empleado', outAt: today() }}
      submitLabel={t('dialog.checkOut')}
      successMessage={t('dialog.checkedOut')}
      errorFallback={t('dialog.error')}
      request={(v) =>
        apiClient(`/keys/${keySetId}/check-out`, {
          method: 'POST',
          body: JSON.stringify({
            holder: v.holder,
            holderUserId: v.holderUserId || undefined,
            holderName: v.holderName || undefined,
            reason: v.reason || null,
            outAt: v.outAt,
            expectedReturnAt: v.expectedReturnAt || null,
          }),
        })
      }
      onClose={onClose}
      onDone={onDone}
    />
  );
}

/** Devolución: el juego vuelve a la oficina; se puede anotar dónde queda guardado. */
export function KeyCheckInDialog({ keySetId, label, onClose, onDone }: DialogProps & { keySetId: string; label: string }) {
  const t = useTranslations('keys');
  return (
    <FieldsDialog
      title={t('dialog.checkInTitle', { label })}
      fields={[
        { name: 'returnedAt', label: t('dialog.returnedAt'), kind: 'date', required: true },
        { name: 'location', label: t('dialog.location'), kind: 'text', hint: t('dialog.locationHint') },
        { name: 'notes', label: t('dialog.notes'), kind: 'textarea' },
      ]}
      initial={{ returnedAt: today() }}
      submitLabel={t('dialog.checkIn')}
      successMessage={t('dialog.checkedIn')}
      errorFallback={t('dialog.error')}
      request={(v) =>
        apiClient(`/keys/${keySetId}/check-in`, {
          method: 'POST',
          body: JSON.stringify({ returnedAt: v.returnedAt, location: v.location || undefined, notes: v.notes || undefined }),
        })
      }
      onClose={onClose}
      onDone={onDone}
    />
  );
}
