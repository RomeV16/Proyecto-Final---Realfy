'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { apiClient } from '@/lib/api-client';
import { personName, type SalesParty } from '@/lib/sales';
import { toast } from '@/lib/toast';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogHeader } from '@/components/ui/dialog';
import { ErrorNotice } from '@/components/ui/error-notice';
import { FormDialogFooter } from '@/components/ui/form-dialog-footer';
import { Input } from '@/components/ui/input';
import { PersonPicker } from '@/components/parties/person-picker';

interface Row {
  role: string;
  personId: string;
  name: string;
  sharePct: string;
}

interface Props {
  operationId: string;
  parties: SalesParty[];
  onClose: () => void;
  onDone: () => void;
}

const ROLES = ['Comprador', 'Vendedor'] as const;

/** Partes de la operación: compradores y vendedores con su parte de cada lado (cada lado suma 100 %). */
export function SalesPartiesDialog({ operationId, parties, onClose, onDone }: Props) {
  const t = useTranslations('sales.parties');
  const [rows, setRows] = useState<Row[]>(() =>
    parties.map((p) => ({ role: p.role, personId: p.personId, name: personName(p.person), sharePct: String(Number(p.sharePct)) })),
  );
  const [error, setError] = useState<unknown>(null);
  const [sumError, setSumError] = useState('');
  const [saving, setSaving] = useState(false);

  function add(role: string, person: { id: string; firstName: string; lastName: string }) {
    if (rows.some((r) => r.role === role && r.personId === person.id)) return;
    const side = rows.filter((r) => r.role === role);
    // El primero de un lado se lleva el 100 %; al sumar otro, la parte se completa a mano.
    const sharePct = side.length === 0 ? '100' : '';
    setRows([...rows, { role, personId: person.id, name: personName(person), sharePct }]);
  }

  const sideSum = (role: string) => rows.filter((r) => r.role === role).reduce((sum, r) => sum + Math.round(Number(r.sharePct.replace(',', '.')) * 10000), 0);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (rows.some((r) => !(Number(r.sharePct.replace(',', '.')) > 0))) {
      setSumError(t('shareError'));
      return;
    }
    const wrong = ROLES.find((role) => rows.some((r) => r.role === role) && sideSum(role) !== 1_000_000);
    if (wrong) {
      setSumError(t('sumError', { role: t(`roles.${wrong}`) }));
      return;
    }
    setSumError('');
    setSaving(true);
    setError(null);
    try {
      await apiClient(`/sales-operations/${operationId}/parties`, {
        method: 'PUT',
        body: JSON.stringify({ parties: rows.map((r) => ({ role: r.role, personId: r.personId, sharePct: r.sharePct.replace(',', '.') })) }),
      });
      toast.success(t('saved'));
      onDone();
      onClose();
    } catch (err) {
      setError(err);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onClose={onClose} busy={saving} size="lg">
      <form onSubmit={(e) => void save(e)} noValidate>
        <DialogHeader>
          <h2 className="text-base font-semibold text-[var(--color-text)]">{t('title')}</h2>
        </DialogHeader>
        <DialogBody className="space-y-6">
          {error != null && <ErrorNotice error={error} fallback={t('error')} />}
          {sumError && <p role="alert" className="text-sm text-[var(--color-danger)]">{sumError}</p>}
          {ROLES.map((role) => {
            const side = rows.filter((r) => r.role === role);
            return (
              <fieldset key={role} className="space-y-2">
                <legend className="text-sm font-semibold text-[var(--color-text)]">{t(`roles.${role}`)}</legend>
                {side.length === 0 && <p className="text-sm text-[var(--color-muted)]">{t('none')}</p>}
                {side.map((r) => (
                  <div key={r.personId} className="flex items-center gap-3">
                    <span className="flex-1 text-sm text-[var(--color-text)]">{r.name}</span>
                    <label className="flex items-center gap-1 text-sm text-[var(--color-muted)]">
                      <span className="sr-only">{t('share', { name: r.name })}</span>
                      <Input
                        aria-label={t('share', { name: r.name })}
                        inputMode="decimal"
                        className="w-24"
                        value={r.sharePct}
                        onChange={(e) => setRows(rows.map((x) => (x === r ? { ...x, sharePct: e.target.value } : x)))}
                      />
                      %
                    </label>
                    <Button type="button" variant="ghost" size="sm" aria-label={t('remove', { name: r.name })} onClick={() => setRows(rows.filter((x) => x !== r))}>
                      {t('removeShort')}
                    </Button>
                  </div>
                ))}
                <PersonPicker
                  label={t('add', { role: t(`roles.${role}`) })}
                  value={null}
                  onChange={(person) => person && add(role, person)}
                  excludeIds={side.map((r) => r.personId)}
                />
              </fieldset>
            );
          })}
        </DialogBody>
        <FormDialogFooter onCancel={onClose} busy={saving} submitLabel={saving ? t('saving') : t('save')} />
      </form>
    </Dialog>
  );
}
