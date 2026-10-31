import type { ReactElement } from 'react';
import { render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NextIntlClientProvider } from 'next-intl';
import es from '@/i18n/messages/es.json';
import { ConfirmProvider } from '@/components/ui/confirm-dialog';

export function renderEs(ui: ReactElement) {
  return render(
    <NextIntlClientProvider locale="es" messages={es}>
      <ConfirmProvider>{ui}</ConfirmProvider>
    </NextIntlClientProvider>,
  );
}

/** Como `renderEs`, con un `QueryClientProvider` limpio y sin reintentos (las pantallas que usan react-query). */
export function renderEsWithQuery(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <NextIntlClientProvider locale="es" messages={es}>
      <QueryClientProvider client={client}>
        <ConfirmProvider>{ui}</ConfirmProvider>
      </QueryClientProvider>
    </NextIntlClientProvider>,
  );
}
