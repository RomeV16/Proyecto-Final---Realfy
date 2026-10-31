'use client';

import { useTranslations } from 'next-intl';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '@realfy/shared';
import { Input } from '@/components/ui/input';

export type PasswordErrorKey = 'required' | 'tooShort' | 'tooLong' | 'mismatch';

export interface PasswordErrors {
  password?: PasswordErrorKey;
  confirm?: PasswordErrorKey;
}

/** Las mismas reglas que impone la API: largo entre el mínimo y el máximo, y confirmación igual. */
export function validateNewPassword(password: string, confirm: string): PasswordErrors {
  const errors: PasswordErrors = {};
  if (!password) errors.password = 'required';
  else if (password.length < PASSWORD_MIN_LENGTH) errors.password = 'tooShort';
  else if (password.length > PASSWORD_MAX_LENGTH) errors.password = 'tooLong';
  if (!errors.password && confirm !== password) errors.confirm = 'mismatch';
  return errors;
}

interface PasswordFieldsProps {
  password: string;
  confirm: string;
  onPassword: (value: string) => void;
  onConfirm: (value: string) => void;
  errors: PasswordErrors;
  passwordLabel: string;
  confirmLabel: string;
  idPrefix: string;
  disabled?: boolean;
}

/** Par de campos "contraseña nueva" + "repetila", con el mismo texto de ayuda y errores en todas las pantallas. */
export function PasswordFields({
  password,
  confirm,
  onPassword,
  onConfirm,
  errors,
  passwordLabel,
  confirmLabel,
  idPrefix,
  disabled,
}: PasswordFieldsProps) {
  const t = useTranslations('auth');
  return (
    <>
      <Input
        id={`${idPrefix}-password`}
        type="password"
        label={passwordLabel}
        value={password}
        onChange={(e) => onPassword(e.target.value)}
        error={errors.password ? t(`passwordFields.${errors.password}`) : undefined}
        hint={t('passwordRules')}
        autoComplete="new-password"
        disabled={disabled}
      />
      <Input
        id={`${idPrefix}-confirm`}
        type="password"
        label={confirmLabel}
        value={confirm}
        onChange={(e) => onConfirm(e.target.value)}
        error={errors.confirm ? t(`passwordFields.${errors.confirm}`) : undefined}
        autoComplete="new-password"
        disabled={disabled}
      />
    </>
  );
}
