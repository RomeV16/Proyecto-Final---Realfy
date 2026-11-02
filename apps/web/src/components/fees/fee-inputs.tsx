'use client';

import { useTranslations } from 'next-intl';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import type { StaffUserOption } from './use-staff-users';

/** Porcentaje de una fila (coorretaje o comisión). */
export function PctInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <Input aria-label={label} placeholder="%" inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value)} className="w-24" />
  );
}

/** Persona del personal que cobra una comisión. */
export function StaffSelect({ users, value, onChange }: { users: StaffUserOption[]; value: string; onChange: (value: string) => void }) {
  const t = useTranslations('fees.create');
  return (
    <Select aria-label={t('staffUser')} value={value} onChange={(e) => onChange(e.target.value)} className="w-56">
      <option value="">{t('chooseUser')}</option>
      {users.map((u) => (
        <option key={u.id} value={u.id}>
          {u.name}
        </option>
      ))}
    </Select>
  );
}

/** Inmobiliaria con la que se comparte el honorario. */
export function CounterpartyInput({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const t = useTranslations('fees.create');
  return (
    <Input
      aria-label={t('shareCounterparty')}
      placeholder={t('shareCounterparty')}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-56"
    />
  );
}
