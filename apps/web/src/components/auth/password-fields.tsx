'use client';

import { useTranslations } from 'next-intl';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';

interface PasswordFieldsProps {
  password: string;
  confirm: string;
  onPassword: (value: string) => void;
  onConfirm: (value: string) => void;
  passwordError?: string;
  confirmError?: string;
  passwordLabel: string;
  confirmLabel: string;
  disabled?: boolean;
}

/** Par de campos "contraseña nueva" + "repetila", con la misma ayuda en todas las pantallas. */
export function PasswordFields({
  password,
  confirm,
  onPassword,
  onConfirm,
  passwordError,
  confirmError,
  passwordLabel,
  confirmLabel,
  disabled,
}: PasswordFieldsProps) {
  const t = useTranslations('auth');
  return (
    <>
      <FormField label={passwordLabel} error={passwordError} hint={t('passwordRules')} required>
        {(c) => (
          <Input
            {...c}
            type="password"
            value={password}
            onChange={(e) => onPassword(e.target.value)}
            autoComplete="new-password"
            disabled={disabled}
          />
        )}
      </FormField>
      <FormField label={confirmLabel} error={confirmError} required>
        {(c) => (
          <Input
            {...c}
            type="password"
            value={confirm}
            onChange={(e) => onConfirm(e.target.value)}
            autoComplete="new-password"
            disabled={disabled}
          />
        )}
      </FormField>
    </>
  );
}
