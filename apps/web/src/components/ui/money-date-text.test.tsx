// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { DateText } from './date-text';
import { MoneyText } from './money-text';

function renderIn(locale: string, ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale={locale} messages={{}}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe('MoneyText', () => {
  it('formatea con el locale de la pantalla', () => {
    renderIn('es', <MoneyText value={1234.5} currency="USD" decimals={2} className="m" />);
    expect(screen.getByText(/US\$/)).toHaveTextContent('1.234,50');
    expect(screen.getByText(/US\$/)).toHaveClass('m');
  });

  it('muestra el texto de reemplazo si falta el valor', () => {
    renderIn('en', <MoneyText value={null} placeholder="n/d" />);
    expect(screen.getByText('n/d')).toBeInTheDocument();
  });
});

describe('DateText', () => {
  it('fecha de solo día', () => {
    renderIn('es', <DateText value="2026-11-01T00:00:00.000Z" style="long" />);
    expect(screen.getByText('1 de noviembre de 2026')).toBeInTheDocument();
  });

  it('instante como fecha local', () => {
    renderIn('es', <DateText value="2026-11-01T15:00:00.000Z" kind="instant" style="numeric" />);
    expect(screen.getByText('01/11/2026')).toBeInTheDocument();
  });

  it('fecha y hora', () => {
    renderIn(
      'es',
      <DateText
        value="2026-11-01T15:00:00.000Z"
        kind="datetime"
        style={{ hour: '2-digit', minute: '2-digit', hour12: false }}
      />,
    );
    expect(screen.getByText('15:00')).toBeInTheDocument();
  });

  it('fecha y hora con el estilo por defecto', () => {
    renderIn('es', <DateText value="2026-11-01T15:00:00.000Z" kind="datetime" />);
    expect(screen.getByText(/1 de nov de 2026/)).toBeInTheDocument();
  });

  it('sin valor muestra guion', () => {
    renderIn('es', <DateText value={null} />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });
});
