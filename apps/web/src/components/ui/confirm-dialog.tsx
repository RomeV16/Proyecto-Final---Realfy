'use client';

import { createContext, ReactNode, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogFooter, DialogHeader } from '@/components/ui/dialog';

export interface ConfirmOptions {
  title?: string;
  body: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'default' | 'danger';
}

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

interface Pending extends ConfirmOptions {
  resolve: (value: boolean) => void;
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const t = useTranslations('common');
  const [pending, setPending] = useState<Pending | null>(null);
  const pendingRef = useRef<Pending | null>(null);
  pendingRef.current = pending;

  const confirm = useCallback<ConfirmFn>((options) => {
    // Si ya hay una pregunta abierta, se la da por cancelada.
    pendingRef.current?.resolve(false);
    return new Promise<boolean>((resolve) => setPending({ ...options, resolve }));
  }, []);

  const settle = useCallback((value: boolean) => {
    const current = pendingRef.current;
    if (!current) return;
    pendingRef.current = null;
    setPending(null);
    current.resolve(value);
  }, []);

  // Si el proveedor se desmonta con una pregunta abierta, no queda colgada.
  useEffect(() => () => pendingRef.current?.resolve(false), []);

  const cancelRef = useRef<HTMLButtonElement>(null);
  const danger = pending?.tone === 'danger';

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Dialog
        open={pending !== null}
        onClose={() => settle(false)}
        size="sm"
        initialFocusRef={danger ? cancelRef : undefined}
        describedBy="confirm-dialog-body"
      >
        <DialogHeader>
          <h2 className="text-base font-semibold text-[var(--color-text)]">
            {pending?.title ?? t('confirm')}
          </h2>
        </DialogHeader>
        <DialogBody>
          <div id="confirm-dialog-body" className="text-sm text-[var(--color-text)]">
            {pending?.body}
          </div>
        </DialogBody>
        <DialogFooter>
          <Button ref={cancelRef} variant="secondary" onClick={() => settle(false)}>
            {pending?.cancelLabel ?? t('cancel')}
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={() => settle(true)}>
            {pending?.confirmLabel ?? t('confirm')}
          </Button>
        </DialogFooter>
      </Dialog>
    </ConfirmContext.Provider>
  );
}

/** `if (await confirm({ body: '…', tone: 'danger' })) { … }` */
export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error('useConfirm requiere <ConfirmProvider> en el árbol');
  return ctx;
}
