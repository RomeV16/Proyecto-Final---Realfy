'use client';

import { useTranslations } from 'next-intl';
import { UserRole } from '@realfy/shared';
import { FormField } from '@/components/ui/form-field';
import { Select } from '@/components/ui/select';

const ROLES = Object.values(UserRole) as string[];

/** Rótulo de un rol; un valor fuera del enum se muestra tal cual para no romper la clave. */
export function useRoleLabel(): (role: string) => string {
  const t = useTranslations('users.roles');
  return (role) => (ROLES.includes(role) ? t(role as UserRole) : role);
}

interface RoleSelectProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  error?: string;
  disabled?: boolean;
}

export function RoleSelect({ label, value, onChange, placeholder, error, disabled }: RoleSelectProps) {
  const roleLabel = useRoleLabel();
  return (
    <FormField label={label} error={error} required>
      {(c) => (
        <Select {...c} value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled}>
          {placeholder && <option value="">{placeholder}</option>}
          {ROLES.map((role) => (
            <option key={role} value={role}>
              {roleLabel(role)}
            </option>
          ))}
        </Select>
      )}
    </FormField>
  );
}
