'use client';

import { useTranslations } from 'next-intl';
import { UserRole } from '@realfy/shared';

const ROLES = Object.values(UserRole) as string[];

/** Rótulo de un rol; un valor fuera del enum se muestra tal cual para no romper la clave. */
export function useRoleLabel(): (role: string) => string {
  const t = useTranslations('users.roles');
  return (role) => (ROLES.includes(role) ? t(role as UserRole) : role);
}

interface RoleSelectProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  error?: string;
  disabled?: boolean;
}

export function RoleSelect({ id, label, value, onChange, placeholder, error, disabled }: RoleSelectProps) {
  const roleLabel = useRoleLabel();
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-[0.8rem] font-medium text-[var(--color-text)]">
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        aria-invalid={!!error}
        className="h-11 w-full rounded-lg border border-[var(--color-border)] px-3 text-sm bg-[var(--color-surface)] text-[var(--color-text)] focus:outline-2 focus:outline-brand-500 disabled:opacity-50"
      >
        {placeholder && <option value="">{placeholder}</option>}
        {ROLES.map((role) => (
          <option key={role} value={role}>
            {roleLabel(role)}
          </option>
        ))}
      </select>
      {error && <p className="text-xs text-[var(--color-danger)]">{error}</p>}
    </div>
  );
}
