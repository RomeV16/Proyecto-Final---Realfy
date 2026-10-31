'use client';

import { useTranslations } from 'next-intl';
import { InviteUserFormSchema, UserRole, type ShareableLink } from '@realfy/shared';
import { apiClient } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogFooter, DialogHeader } from '@/components/ui/dialog';
import { ErrorNotice } from '@/components/ui/error-notice';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { useSchemaMessages, useZodForm } from '@/hooks/use-zod-form';
import { RoleSelect } from './role-select';

interface InviteDialogProps {
  open: boolean;
  onClose: () => void;
  onCreated: (link: ShareableLink) => void;
}

const INITIAL = { email: '', role: UserRole.Ventas as string };

export function InviteDialog({ open, onClose, onCreated }: InviteDialogProps) {
  const t = useTranslations('users.modal');
  const tCommon = useTranslations('common');
  const { values, set, setValues, errors, formError, setFormError, submitting, submit } = useZodForm({
    schema: InviteUserFormSchema,
    initialValues: INITIAL,
    translate: useSchemaMessages(),
  });

  function close() {
    setValues(INITIAL);
    setFormError(null);
    onClose();
  }

  const handleSubmit = submit(async (data) => {
    const link = await apiClient<ShareableLink>('/users/invite', {
      method: 'POST',
      body: JSON.stringify(data),
    });
    setValues(INITIAL);
    onCreated(link);
  });

  return (
    <Dialog open={open} onClose={close} busy={submitting}>
      <form onSubmit={handleSubmit} noValidate>
        <DialogHeader>
          <h2 className="text-base font-semibold text-[var(--color-text)]">{t('title')}</h2>
        </DialogHeader>
        <DialogBody className="space-y-4">
          <FormField label={t('email')} error={errors.email} required>
            {(c) => (
              <Input
                {...c}
                type="email"
                placeholder={t('emailPlaceholder')}
                value={values.email}
                onChange={(e) => set('email', e.target.value)}
                autoComplete="off"
                disabled={submitting}
              />
            )}
          </FormField>
          <RoleSelect
            label={t('role')}
            placeholder={t('rolePlaceholder')}
            value={values.role}
            onChange={(v) => set('role', v)}
            error={errors.role}
            disabled={submitting}
          />
          {formError != null && <ErrorNotice error={formError} fallback={t('error')} />}
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={close} disabled={submitting}>
            {tCommon('cancel')}
          </Button>
          <Button type="submit" disabled={submitting}>
            {submitting ? t('submitting') : t('submit')}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
