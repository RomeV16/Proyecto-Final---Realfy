'use client';

import { useLocale, useTranslations } from 'next-intl';
import type { ShareableLink } from '@realfy/shared';
import { formatDateTime } from '@/lib/format';
import { toast } from '@/lib/toast';
import { Button } from '@/components/ui/button';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Dialog, DialogBody, DialogFooter, DialogHeader } from '@/components/ui/dialog';

export interface SharedLink {
  kind: 'invitation' | 'reset';
  data: ShareableLink;
}

/**
 * El enlace de invitación o de recupero se ve una sola vez: el servidor solo
 * guarda su hash. Mientras no haya correo configurado, es el Admin quien lo
 * comparte a mano, por eso la nota de un solo uso y de vencimiento.
 */
export function ShareLinkDialog({ shared, onClose }: { shared: SharedLink | null; onClose: () => void }) {
  const t = useTranslations('users.share');
  const locale = useLocale();

  async function copy() {
    if (!shared) return;
    try {
      await navigator.clipboard.writeText(shared.data.link);
      toast.success(t('copied'));
    } catch {
      toast.error(t('copyFailed'));
    }
  }

  return (
    <Dialog open={shared !== null} onClose={onClose} describedBy="share-link-note">
      <DialogHeader>
        <h2 className="text-base font-semibold text-[var(--color-text)]">
          {shared?.kind === 'reset' ? t('resetTitle') : t('invitationTitle')}
        </h2>
      </DialogHeader>
      <DialogBody className="space-y-4">
        {shared && (
          <>
            <p className="text-sm text-[var(--color-text)]">{t('intro', { email: shared.data.email })}</p>
            <FormField label={t('linkLabel')}>
              {(c) => (
                <Input {...c} readOnly value={shared.data.link} onFocus={(e) => e.currentTarget.select()} />
              )}
            </FormField>
            <div id="share-link-note" className="space-y-1 text-sm text-[var(--color-muted)]">
              <p>{shared.data.emailSent ? t('emailSent') : t('noEmail')}</p>
              <p>{t('singleUse', { date: formatDateTime(shared.data.expiresAt, undefined, locale) })}</p>
            </div>
          </>
        )}
      </DialogBody>
      <DialogFooter>
        <Button type="button" variant="secondary" onClick={copy}>
          {t('copy')}
        </Button>
        <Button type="button" onClick={onClose}>
          {t('close')}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
