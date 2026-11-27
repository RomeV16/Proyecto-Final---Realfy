// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiRequestError } from '@/lib/api-client';
import { renderEs } from '../index-data/test-utils';
import { PageError, PageNotFound, SegmentError, SegmentLoading, SegmentNotFound } from './segment-states';
import NotFoundLocale from '@/app/[locale]/not-found';
import ErrorLocale from '@/app/[locale]/error';

vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  usePathname: () => '/es/contracts',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
}));

import LoadingApp from '@/app/[locale]/(app)/loading';
import ErrorApp from '@/app/[locale]/(app)/error';
import NotFoundApp from '@/app/[locale]/(app)/not-found';
import LoadingContracts from '@/app/[locale]/(app)/contracts/loading';
import ErrorContracts from '@/app/[locale]/(app)/contracts/error';
import NotFoundContracts from '@/app/[locale]/(app)/contracts/not-found';
import LoadingProperties from '@/app/[locale]/(app)/properties/loading';
import ErrorProperties from '@/app/[locale]/(app)/properties/error';
import NotFoundProperties from '@/app/[locale]/(app)/properties/not-found';
import LoadingPersons from '@/app/[locale]/(app)/persons/loading';
import ErrorPersons from '@/app/[locale]/(app)/persons/error';
import NotFoundPersons from '@/app/[locale]/(app)/persons/not-found';
import LoadingLiquidaciones from '@/app/[locale]/(app)/liquidaciones/loading';
import ErrorLiquidaciones from '@/app/[locale]/(app)/liquidaciones/error';
import NotFoundLiquidaciones from '@/app/[locale]/(app)/liquidaciones/not-found';

describe('estados de página fuera del panel', () => {
  it('no encontrado: explica y vuelve al inicio del sitio', () => {
    expect(NotFoundLocale).toBe(PageNotFound);
    renderEs(<PageNotFound />);
    expect(screen.getByText('Esta página no existe')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Volver al inicio' })).toHaveAttribute('href', '/es');
  });

  it('error: permite reintentar y volver al inicio', async () => {
    expect(ErrorLocale).toBe(PageError);
    const reset = vi.fn();
    renderEs(<PageError error={new Error('falló')} reset={reset} />);
    expect(screen.getByRole('heading', { name: 'No pudimos cargar esta sección' })).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(reset).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('link', { name: 'Volver al inicio' })).toHaveAttribute('href', '/es');
  });
});

describe('estados de segmento', () => {
  it('cargando: se anuncia como estado ocupado con texto para lectores de pantalla', () => {
    renderEs(<SegmentLoading />);
    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('aria-busy', 'true');
    expect(status).toHaveTextContent('Cargando…');
  });

  it('error: muestra el aviso, el digest, reintenta y ofrece volver al panel', async () => {
    const user = userEvent.setup();
    const reset = vi.fn();
    const error = Object.assign(new Error('Falló el render'), { digest: 'dg-123' });
    renderEs(<SegmentError error={error} reset={reset} />);
    expect(screen.getByRole('heading', { name: 'No pudimos cargar esta sección' })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Falló el render');
    expect(screen.getByText('dg-123')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ir al panel' })).toHaveAttribute('href', '/es/dashboard');
    await user.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(reset).toHaveBeenCalledOnce();
  });

  it('error de la API: usa código y referencia; sin digest no lo muestra', () => {
    const error = new ApiRequestError(500, 'BOOM', 'Falló', { correlationId: 'corr-9' });
    renderEs(<SegmentError error={error} reset={() => {}} />);
    expect(screen.getByRole('alert')).toHaveTextContent('corr-9');
    expect(screen.queryByText('dg-123')).not.toBeInTheDocument();
  });

  it('no encontrado: explica y lleva al panel', () => {
    renderEs(<SegmentNotFound />);
    expect(screen.getByText('No encontramos lo que buscás')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ir al panel' })).toHaveAttribute('href', '/es/dashboard');
  });

  it.each([
    ['app', LoadingApp, ErrorApp, NotFoundApp],
    ['contracts', LoadingContracts, ErrorContracts, NotFoundContracts],
    ['properties', LoadingProperties, ErrorProperties, NotFoundProperties],
    ['persons', LoadingPersons, ErrorPersons, NotFoundPersons],
    ['liquidaciones', LoadingLiquidaciones, ErrorLiquidaciones, NotFoundLiquidaciones],
  ])('el segmento %s usa los estados compartidos', (_name, Loading, ErrorPage, NotFound) => {
    expect(Loading).toBe(SegmentLoading);
    expect(ErrorPage).toBe(SegmentError);
    expect(NotFound).toBe(SegmentNotFound);
  });
});
