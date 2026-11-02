import { downloadFile } from '@/lib/download';
import { toast } from '@/lib/toast';

/** Imprime (descarga) el PDF de un recibo de cobro con su número; un fallo se avisa con `failed`. */
export function printReceipt(id: string, number: string, failed: string): Promise<void> {
  return downloadFile(`/receipts/${id}/pdf`, `recibo-${number}.pdf`).catch(() => {
    toast.error(failed);
  });
}
