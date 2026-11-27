'use client';

import { useTranslations } from 'next-intl';
import { Dialog, DialogBody, DialogFooter, DialogHeader } from '@/components/ui/dialog';
import { Spinner } from '@/components/ui/spinner';
import { PaymentMethod, PaymentReceiver } from '@realfy/shared';
import { useEffect, useRef, useState } from 'react';
import { apiClient, ApiRequestError } from '@/lib/api-client';
import { agencyAccounts, type RegisteredPayment } from '@/lib/cash';
import { formatMoneyFixed, formatNumber } from '@/lib/format';
import { printReceipt } from '@/components/cash/print-receipt';
import { useCashAccounts } from '@/components/cash/use-cash-data';

const FIELD =
  'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500';

interface PaymentFormProps {
  /** Si se omite, el diálogo está abierto mientras el componente esté montado. */
  open?: boolean;
  liquidacionId: string;
  remainingBalance: number;
  /** Moneda de la liquidación: las cuentas que se ofrecen son de esta moneda. */
  currency?: string;
  /** Monto y fecha propuestos (los del cálculo "pagar hoy"). */
  initialAmount?: string;
  initialPaidAt?: string;
  /** Cobra también los punitorios devengados a la fecha del pago: el monto tiene que ser el total. */
  settlePenalties?: boolean;
  onSuccess: () => void;
  onClose: () => void;
}

interface DialogState {
  busy: boolean;
  /** El pago ya se registró: cerrar equivale a "Listo". */
  done: boolean;
}

/**
 * Diálogo de "Registrar pago". El formulario vive adentro del diálogo: se monta al abrir y se
 * desmonta cuando termina de cerrarse, así cada apertura arranca con los valores propuestos.
 */
export function PaymentForm({ open = true, ...props }: PaymentFormProps) {
  const [state, setState] = useState<DialogState>({ busy: false, done: false });
  return (
    <Dialog open={open} size="sm" className="max-sm:max-w-none" busy={state.busy} onClose={state.done ? props.onSuccess : props.onClose}>
      <PaymentFormContent {...props} onStateChange={setState} />
    </Dialog>
  );
}

function PaymentFormContent({
  liquidacionId,
  remainingBalance,
  currency = 'ARS',
  initialAmount,
  initialPaidAt,
  settlePenalties = false,
  onSuccess,
  onClose,
  onStateChange,
}: Omit<PaymentFormProps, 'open'> & { onStateChange: (state: DialogState) => void }) {
  const t = useTranslations('liquidaciones.payments');
  const tMethods = useTranslations('liquidaciones.paymentMethods');
  const tCommon = useTranslations('common');
  const tCash = useTranslations('cash');

  const [amount, setAmount] = useState(initialAmount ?? (remainingBalance > 0 ? String(remainingBalance) : ''));
  const [method, setMethod] = useState('');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [paidAt, setPaidAt] = useState(initialPaidAt ?? new Date().toISOString().split('T')[0]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  // Quién recibió el cobro: vacío es según el contrato (el flujo de pago pactado).
  const [receivedBy, setReceivedBy] = useState('');
  const [accountId, setAccountId] = useState('');
  const [inCustody, setInCustody] = useState(false);
  const [externalRef, setExternalRef] = useState('');
  const [receipt, setReceipt] = useState<{ id: string; label: string } | null>(null);
  const toAgency = receivedBy === PaymentReceiver.Inmobiliaria;
  const accounts = useCashAccounts(toAgency);
  const accountOptions = agencyAccounts(accounts.data?.items ?? [], currency);
  const errorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    onStateChange({ busy: submitting, done: receipt !== null });
  }, [submitting, receipt, onStateChange]);

  // El aviso queda al final del cuerpo desplazable: se lo trae a la vista.
  useEffect(() => {
    if (error) errorRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [error]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    const parsedAmount = parseFloat(amount);
    if (!amount || isNaN(parsedAmount) || parsedAmount <= 0) {
      setError(t('invalidAmount'));
      return;
    }
    if (!method) {
      setError(t('methodRequired'));
      return;
    }

    setSubmitting(true);
    try {
      const res = await apiClient<{ registeredPayment?: RegisteredPayment } | undefined>(`/liquidaciones/${liquidacionId}/payments`, {
        method: 'POST',
        body: JSON.stringify({
          amount: parsedAmount,
          method,
          reference: reference || undefined,
          notes: notes || undefined,
          paidAt: paidAt ? new Date(paidAt).toISOString() : undefined,
          ...(settlePenalties ? { settlePenalties: true } : {}),
          ...(receivedBy ? { receivedBy } : {}),
          ...(toAgency && accountId ? { accountId } : {}),
          ...(toAgency && inCustody ? { inCustody: true } : {}),
          ...(externalRef.trim() ? { externalRef: externalRef.trim() } : {}),
        }),
      });
      const issued = res?.registeredPayment?.receipt;
      if (issued) {
        // Con recibo, el formulario queda abierto para imprimirlo; "Listo" cierra y recarga.
        setReceipt({ id: issued.id, label: issued.label });
      } else {
        onSuccess();
      }
    } catch (err) {
      if (err instanceof ApiRequestError && err.errorCode === 'PAYMENT_EXCEEDS_BALANCE') {
        setError(t('exceedsBalance', { balance: formatNumber(remainingBalance) }));
      } else if (err instanceof ApiRequestError && err.errorCode === 'PAYOFF_REQUIRES_FULL_AMOUNT') {
        setError(t('payoffRequiresFullAmount'));
      } else if (err instanceof ApiRequestError && err.errorCode === 'PAYMENT_EXTERNAL_REF_EXISTS') {
        setError(t('externalRefExists'));
      } else {
        setError(err instanceof ApiRequestError ? err.message : t('registerError'));
      }
    } finally {
      setSubmitting(false);
    }
  }


  if (receipt) {
    return (
      <>
        <DialogHeader>
          <h2 className="text-lg font-semibold text-slate-900">{t('registerSuccess')}</h2>
        </DialogHeader>
        <DialogBody>
          <p className="text-sm text-slate-600">{t('receiptIssued', { number: receipt.label })}</p>
        </DialogBody>
        <DialogFooter>
          <button
            type="button"
            onClick={() => void printReceipt(receipt.id, receipt.label, tCommon('downloadFailed'))}
            className="flex-1 px-4 py-2.5 rounded-lg border border-slate-200 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
          >
            {t('printReceipt')}
          </button>
          <button
            type="button"
            onClick={onSuccess}
            className="flex-1 px-4 py-2.5 rounded-lg bg-brand-500 text-white text-sm font-medium hover:bg-brand-600 transition-colors"
          >
            {t('done')}
          </button>
        </DialogFooter>
      </>
    );
  }

  return (
    <form onSubmit={handleSubmit}>
      {/* Remaining balance header */}
      <div className="shrink-0 bg-slate-50 px-6 py-4 border-b border-slate-100">
        <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">{t('remainingBalance')}</p>
        <p className="text-2xl font-bold text-slate-900 tabular-nums mt-0.5">{formatMoneyFixed(remainingBalance)}</p>
      </div>
      <DialogHeader>
        <h2 className="text-lg font-semibold text-slate-900">{t('title')}</h2>
      </DialogHeader>
      <DialogBody className="space-y-4">
        {settlePenalties && (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            {t('withPenalties')}
          </p>
        )}

        {/* Amount */}
        <div>
          <label htmlFor="payment-amount" className="block text-xs font-medium text-slate-500 mb-1">
            {t('amount')} *
          </label>
          <input
            id="payment-amount"
            type="number"
            step="0.01"
            min="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder={t('amountPlaceholder')}
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 tabular-nums focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500"
            required
          />
        </div>

        {/* Method */}
        <div>
          <label htmlFor="payment-method" className="block text-xs font-medium text-slate-500 mb-1">
            {t('method')} *
          </label>
          <select
            id="payment-method"
            value={method}
            onChange={(e) => setMethod(e.target.value)}
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500"
            required
          >
            <option value="">{t('method')}</option>
            {Object.values(PaymentMethod).filter((m) => m !== PaymentMethod.AplicacionDeposito).map((m) => (
              <option key={m} value={m}>{tMethods(m)}</option>
            ))}
          </select>
        </div>

        {/* Reference */}
        <div>
          <label htmlFor="payment-reference" className="block text-xs font-medium text-slate-500 mb-1">
            {t('reference')}
          </label>
          <input
            id="payment-reference"
            type="text"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            placeholder={t('referencePlaceholder')}
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500"
          />
        </div>

        {/* Who received the money */}
        <div>
          <label htmlFor="payment-receiver" className="block text-xs font-medium text-slate-500 mb-1">
            {t('receivedBy')}
          </label>
          <select
            id="payment-receiver"
            value={receivedBy}
            onChange={(e) => {
              setReceivedBy(e.target.value);
              setAccountId('');
              setInCustody(false);
            }}
            className={FIELD}
          >
            <option value="">{t('receivedByContract')}</option>
            {Object.values(PaymentReceiver).map((r) => (
              <option key={r} value={r}>
                {tCash(`receivers.${r}`)}
              </option>
            ))}
          </select>
        </div>

        {toAgency && (
          <>
            <div>
              <label htmlFor="payment-account" className="block text-xs font-medium text-slate-500 mb-1">
                {t('account')}
              </label>
              <select id="payment-account" value={accountId} onChange={(e) => setAccountId(e.target.value)} className={FIELD}>
                <option value="">{t('accountAuto', { currency })}</option>
                {accountOptions.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </div>
            <label className="flex items-start gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={inCustody}
                onChange={(e) => setInCustody(e.target.checked)}
              />
              <span>
                <span className="block font-medium">{t('inCustody')}</span>
                <span className="block text-xs text-slate-500">{t('inCustodyHint')}</span>
              </span>
            </label>
          </>
        )}

        {/* External reference */}
        <div>
          <label htmlFor="payment-external-ref" className="block text-xs font-medium text-slate-500 mb-1">
            {t('externalRef')}
          </label>
          <input
            id="payment-external-ref"
            type="text"
            maxLength={100}
            value={externalRef}
            onChange={(e) => setExternalRef(e.target.value)}
            placeholder={t('externalRefPlaceholder')}
            className={FIELD}
          />
        </div>

        {/* Paid at */}
        <div>
          <label htmlFor="payment-date" className="block text-xs font-medium text-slate-500 mb-1">
            {t('paidAt')}
          </label>
          <input
            id="payment-date"
            type="date"
            value={paidAt}
            onChange={(e) => setPaidAt(e.target.value)}
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500"
          />
        </div>

        {/* Notes */}
        <div>
          <label htmlFor="payment-notes" className="block text-xs font-medium text-slate-500 mb-1">
            {t('notes')}
          </label>
          <textarea
            id="payment-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder={t('notesPlaceholder')}
            rows={2}
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500 resize-none"
          />
        </div>

        {/* Error */}
        {error && (
          <div ref={errorRef} role="alert" className="scroll-mb-4 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}

      </DialogBody>

      {/* Actions */}
      <DialogFooter>
        <button
          type="button"
          onClick={onClose}
          className="flex-1 px-4 py-2.5 rounded-lg border border-slate-200 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
        >
          {tCommon('cancel')}
        </button>
        <button
          type="submit"
          disabled={submitting}
          className="flex-1 px-4 py-2.5 rounded-lg bg-brand-500 text-white text-sm font-medium hover:bg-brand-600 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {submitting && <Spinner className="w-4 h-4 text-white" />}
          {t('registerPayment')}
        </button>
      </DialogFooter>
    </form>
  );
}
