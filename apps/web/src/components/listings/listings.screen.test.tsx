// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderEs } from '../index-data/test-utils';

const { apiClient, auth, toastSuccess, toastError } = vi.hoisted(() => ({
  apiClient: vi.fn(),
  auth: { role: 'Admin' },
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('@/lib/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api-client')>()),
  apiClient: (...args: unknown[]) => apiClient(...args),
}));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ user: { id: 'u1', firstName: 'Usuario', lastName: 'Demo', role: auth.role } }),
  useOptionalAuth: () => ({ user: { id: 'u1', firstName: 'Usuario', lastName: 'Demo', role: auth.role } }),
}));
vi.mock('@/lib/toast', () => ({
  toast: { success: (...a: unknown[]) => toastSuccess(...a), error: (...a: unknown[]) => toastError(...a), info: vi.fn() },
}));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { ApiRequestError } from '@/lib/api-client';
import ListingsPage from '@/app/[locale]/(app)/publicaciones/page';
import { AdCopyDialog } from './ad-copy-dialog';
import { ListingEditDialog } from './listing-edit-dialog';
import { PortalsSettingsDialog, portalKeyFromName } from './portals-settings-dialog';
import { PropertyPublication } from './property-publication';

const PORTALS = [
  { key: 'micrositio', name: 'Micrositio', urlTemplate: null, enabled: true, builtin: true },
  { key: 'zonaprop', name: 'Zonaprop', urlTemplate: 'https://zp.test/{code}', enabled: true, builtin: false },
  { key: 'lavoz', name: 'Clasificados La Voz', urlTemplate: null, enabled: false, builtin: false },
];

const row = (o: Record<string, unknown> = {}) => ({
  id: 'l1',
  operationType: 'Alquiler',
  portal: 'zonaprop',
  status: 'Publicado',
  effectiveStatus: 'Publicado',
  externalUrl: 'https://zp.test/123',
  externalCode: '123',
  publishedAt: '2026-11-01T12:00:00.000Z',
  expiresAt: '2026-12-01T23:59:59.000Z',
  updatedAt: '2026-11-02T10:00:00.000Z',
  updatedBy: 'Lucía Demo',
  ...o,
});

const propertyListings = (o: Record<string, unknown> = {}) => ({
  settings: { expiryWarnDays: 7 },
  micrositePath: '/p/mi-inmo/propiedades/p1',
  portals: PORTALS,
  operations: [{ operationType: 'Alquiler', state: 'Disponible' }],
  listings: [row()],
  ...o,
});

const adCopy = (o: Record<string, unknown> = {}) => ({
  propertyId: 'p1',
  portal: 'zonaprop',
  portalName: 'Zonaprop',
  operationType: 'Alquiler',
  title: 'Departamento 2 ambientes en alquiler - Córdoba',
  description: 'Departamento en alquiler.\nPrecio: ARS 450.000 por mes.',
  limits: { title: 70, description: 4000, photos: 30 },
  photos: [
    { id: 'm1', url: 'https://cdn.test/1.jpg', position: 1 },
    { id: 'm2', url: 'https://cdn.test/2.jpg', position: 2 },
  ],
  omittedPhotos: 0,
  warnings: ['contact_data_removed'],
  ...o,
});

beforeEach(() => {
  vi.clearAllMocks();
  auth.role = 'Admin';
});

describe('Publicación en la ficha de la propiedad', () => {
  it('muestra el estado de cada portal, el vencimiento y los enlaces', async () => {
    apiClient.mockResolvedValue(propertyListings());
    renderEs(<PropertyPublication propertyId="p1" />);

    expect(await screen.findByText('Zonaprop')).toBeInTheDocument();
    expect(screen.getByText('Micrositio')).toBeInTheDocument();
    // El portal dado de baja y sin avisos no se muestra.
    expect(screen.queryByText('Clasificados La Voz')).not.toBeInTheDocument();
    expect(screen.getByText('Publicado')).toBeInTheDocument();
    expect(screen.getByText('No publicado')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ver aviso' })).toHaveAttribute('href', 'https://zp.test/123');
    expect(screen.getByText('Actualizado por Lucía Demo')).toBeInTheDocument();
    expect(apiClient).toHaveBeenCalledWith('/properties/p1/listings');
  });

  it('no linkea una dirección que no es http(s)', async () => {
    apiClient.mockResolvedValue(propertyListings({ listings: [row({ externalUrl: 'javascript:alert(1)' })] }));
    renderEs(<PropertyPublication propertyId="p1" />);
    await screen.findByText('Zonaprop');
    expect(screen.queryByRole('link', { name: 'Ver aviso' })).not.toBeInTheDocument();
  });

  it('linka a la ficha del micrositio cuando está publicada ahí', async () => {
    apiClient.mockResolvedValue(
      propertyListings({ listings: [row({ id: 'l2', portal: 'micrositio', externalUrl: null })] }),
    );
    renderEs(<PropertyPublication propertyId="p1" />);
    const link = await screen.findByRole('link', { name: 'Ver en el micrositio' });
    expect(link).toHaveAttribute('href', '/p/mi-inmo/propiedades/p1');
  });

  it('un rol sin permiso para publicar no ve el botón de editar pero sí puede copiar el aviso', async () => {
    auth.role = 'Lectura';
    apiClient.mockResolvedValue(propertyListings());
    renderEs(<PropertyPublication propertyId="p1" />);
    await screen.findByText('Zonaprop');
    expect(screen.queryByRole('button', { name: 'Editar' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Copiar aviso' }).length).toBeGreaterThan(0);
  });

  it('avisa si la propiedad no tiene operaciones y si falla la carga', async () => {
    apiClient.mockResolvedValueOnce(propertyListings({ operations: [], listings: [] }));
    const first = renderEs(<PropertyPublication propertyId="p1" />);
    expect(await screen.findByText('La propiedad todavía no tiene operaciones para publicar.')).toBeInTheDocument();
    first.unmount();

    apiClient.mockRejectedValueOnce(new ApiRequestError(500, 'ERR_500', 'Falló'));
    renderEs(<PropertyPublication propertyId="p1" />);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });

  it('edita un aviso y manda la operación, el portal, el estado y las fechas', async () => {
    const user = userEvent.setup();
    apiClient.mockResolvedValueOnce(propertyListings()).mockResolvedValue(propertyListings());
    renderEs(<PropertyPublication propertyId="p1" />);
    await screen.findByText('Zonaprop');

    const zonaprop = screen.getByText('Zonaprop').closest('li') as HTMLElement;
    await user.click(within(zonaprop).getByRole('button', { name: 'Editar' }));
    const dialog = await screen.findByRole('dialog');
    await user.selectOptions(within(dialog).getByLabelText(/Estado/), 'Pausado');
    await user.click(within(dialog).getByRole('button', { name: 'Guardar' }));

    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Aviso actualizado'));
    const put = apiClient.mock.calls.find((c) => c[0] === '/properties/p1/listings' && c[1]?.method === 'PUT');
    expect(JSON.parse(put![1].body)).toEqual({
      listings: [
        {
          operationType: 'Alquiler',
          portal: 'zonaprop',
          status: 'Pausado',
          externalUrl: 'https://zp.test/123',
          externalCode: '123',
          publishedAt: '2026-11-01T12:00:00.000Z',
          expiresAt: '2026-12-01T23:59:59.000Z',
        },
      ],
    });
  });

  it('el micrositio no pide dirección ni código del aviso', async () => {
    renderEs(
      <ListingEditDialog
        propertyId="p1"
        operationType="Venta"
        portal={PORTALS[0]}
        onClose={() => {}}
        onSaved={() => {}}
      />,
    );
    expect(await screen.findByText('Aviso en Micrositio')).toBeInTheDocument();
    expect(screen.queryByLabelText(/Dirección del aviso/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Código del aviso/)).not.toBeInTheDocument();
  });

  it('muestra el error de la API al guardar y no cierra', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    apiClient.mockRejectedValue(new ApiRequestError(409, 'ERR_409', 'La operación no se puede publicar'));
    renderEs(
      <ListingEditDialog propertyId="p1" operationType="Alquiler" portal={PORTALS[1]} onClose={onClose} onSaved={() => {}} />,
    );
    await user.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('La operación no se puede publicar');
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('Aviso para copiar', () => {
  it('carga el aviso del portal elegido y muestra contadores, advertencias y fotos en orden', async () => {
    apiClient.mockResolvedValue(adCopy());
    renderEs(
      <AdCopyDialog
        propertyId="p1"
        operationType="Alquiler"
        portals={PORTALS.filter((p) => p.enabled)}
        initialPortal="zonaprop"
        onClose={() => {}}
      />,
    );
    expect(await screen.findByText('Departamento 2 ambientes en alquiler - Córdoba')).toBeInTheDocument();
    expect(apiClient).toHaveBeenCalledWith('/properties/p1/ad-copy?portal=zonaprop&operation=Alquiler');
    expect(screen.getByText(/46 de 70 caracteres/)).toBeInTheDocument();
    expect(screen.getByText('Se quitaron teléfonos, mails o links del texto libre de la ficha.')).toBeInTheDocument();
    expect(screen.getAllByRole('img').map((i) => i.getAttribute('alt'))).toEqual(['Foto 1', 'Foto 2']);
  });

  it('copia el título, la descripción, los enlaces de las fotos y todo junto', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    apiClient.mockResolvedValue(adCopy());
    renderEs(
      <AdCopyDialog propertyId="p1" operationType="Alquiler" portals={PORTALS} initialPortal="zonaprop" onClose={() => {}} />,
    );
    await screen.findByText('Copiar título');

    await user.click(screen.getByRole('button', { name: 'Copiar título' }));
    expect(writeText).toHaveBeenLastCalledWith('Departamento 2 ambientes en alquiler - Córdoba');
    await user.click(screen.getByRole('button', { name: 'Copiar descripción' }));
    expect(writeText).toHaveBeenLastCalledWith('Departamento en alquiler.\nPrecio: ARS 450.000 por mes.');
    await user.click(screen.getByRole('button', { name: 'Copiar enlaces de las fotos' }));
    expect(writeText).toHaveBeenLastCalledWith('https://cdn.test/1.jpg\nhttps://cdn.test/2.jpg');
    await user.click(screen.getByRole('button', { name: 'Copiar título y descripción' }));
    expect(writeText).toHaveBeenLastCalledWith(
      'Departamento 2 ambientes en alquiler - Córdoba\n\nDepartamento en alquiler.\nPrecio: ARS 450.000 por mes.',
    );
    expect(toastSuccess).toHaveBeenCalledWith('Copiado');
  });

  it('avisa cuando el navegador no deja copiar', async () => {
    const user = userEvent.setup();
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
      configurable: true,
    });
    apiClient.mockResolvedValue(adCopy({ photos: [], warnings: ['no_photos'] }));
    renderEs(
      <AdCopyDialog propertyId="p1" operationType="Alquiler" portals={PORTALS} initialPortal="zonaprop" onClose={() => {}} />,
    );
    await user.click(await screen.findByRole('button', { name: 'Copiar título' }));
    expect(toastError).toHaveBeenCalledWith('No pudimos copiar: seleccioná el texto y copialo a mano.');
    expect(screen.getByText('Sin fotos.')).toBeInTheDocument();
  });

  it('al cambiar de portal pide el aviso de ese portal; un error se muestra', async () => {
    const user = userEvent.setup();
    apiClient.mockResolvedValueOnce(adCopy()).mockRejectedValueOnce(new ApiRequestError(400, 'ERR_400', 'Portal desconocido'));
    renderEs(
      <AdCopyDialog propertyId="p1" operationType="Alquiler" portals={PORTALS} initialPortal="zonaprop" onClose={() => {}} />,
    );
    await screen.findByText('Copiar título');
    await user.selectOptions(screen.getByLabelText('Portal'), 'micrositio');
    expect(await screen.findByRole('alert')).toHaveTextContent('Portal desconocido');
    expect(apiClient).toHaveBeenLastCalledWith('/properties/p1/ad-copy?portal=micrositio&operation=Alquiler');
  });
});

describe('Pantalla de publicaciones', () => {
  const overview = (o: Record<string, unknown> = {}) => ({
    expiryWarnDays: 7,
    counts: { notPublished: 1, expiring: 1, expired: 1, shouldPause: 1, published: 4 },
    perPortal: [{ portal: 'zonaprop', portalName: 'Zonaprop', count: 4 }],
    notPublished: [{ propertyId: 'p9', title: 'Casa sin publicar', type: 'Casa', city: 'Villa Allende', operationType: 'Venta' }],
    expiring: [
      {
        listingId: 'l1',
        propertyId: 'p1',
        title: 'Depto por vencer',
        operationType: 'Alquiler',
        portal: 'zonaprop',
        portalName: 'Zonaprop',
        status: 'Publicado',
        expiresAt: '2026-11-06T00:00:00.000Z',
        externalUrl: null,
        operationState: 'Disponible',
      },
    ],
    expired: [
      {
        listingId: 'l2',
        propertyId: 'p2',
        title: 'Depto vencido',
        operationType: 'Alquiler',
        portal: 'lavoz',
        portalName: 'Clasificados La Voz',
        status: 'Vencido',
        expiresAt: '2026-10-01T00:00:00.000Z',
        externalUrl: null,
        operationState: 'Disponible',
      },
    ],
    shouldPause: [
      {
        listingId: 'l3',
        propertyId: 'p3',
        title: 'Depto ya alquilado',
        operationType: 'Alquiler',
        portal: 'zonaprop',
        portalName: 'Zonaprop',
        status: 'Publicado',
        expiresAt: null,
        externalUrl: null,
        operationState: 'Alquilado',
      },
    ],
    ...o,
  });

  it('lista lo que falta publicar, lo que vence y lo que hay que bajar, con enlaces a la ficha', async () => {
    apiClient.mockResolvedValue(overview());
    renderEs(<ListingsPage />);

    expect(await screen.findByText('Depto ya alquilado')).toBeInTheDocument();
    expect(screen.getByText('Depto vencido')).toBeInTheDocument();
    expect(screen.getByText('Depto por vencer')).toBeInTheDocument();
    expect(screen.getByText('Casa sin publicar')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Depto ya alquilado' })).toHaveAttribute('href', '/properties/p3');
    expect(screen.getByText('Alquilado')).toBeInTheDocument();
    expect(screen.getByText('Zonaprop: 4')).toBeInTheDocument();
    expect(apiClient).toHaveBeenCalledWith('/listings/overview');
  });

  it('pausa todos los avisos de lo no disponible después de confirmar', async () => {
    const user = userEvent.setup();
    apiClient.mockImplementation(async (path: string, opts?: { method?: string }) => {
      if (path === '/listings/pause-unavailable') return { paused: 1 };
      return overview();
    });
    renderEs(<ListingsPage />);
    await screen.findByText('Depto ya alquilado');

    await user.click(screen.getByRole('button', { name: 'Pausar todos' }));
    const confirm = await screen.findByRole('dialog');
    expect(confirm).toHaveTextContent('Se van a pausar 1 avisos');
    await user.click(within(confirm).getByRole('button', { name: 'Pausar' }));

    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Se pausaron 1 avisos'));
    expect(apiClient).toHaveBeenCalledWith('/listings/pause-unavailable', { method: 'POST' });
  });

  it('no pausa nada si se cancela la confirmación', async () => {
    const user = userEvent.setup();
    apiClient.mockResolvedValue(overview());
    renderEs(<ListingsPage />);
    await screen.findByText('Depto ya alquilado');
    await user.click(screen.getByRole('button', { name: 'Pausar todos' }));
    await user.click(await screen.findByRole('button', { name: 'Cancelar' }));
    expect(apiClient).not.toHaveBeenCalledWith('/listings/pause-unavailable', expect.anything());
  });

  it('sin pendientes muestra "Nada para revisar" y sin permiso no ofrece pausar ni configurar', async () => {
    auth.role = 'Lectura';
    apiClient.mockResolvedValue(
      overview({
        counts: { notPublished: 0, expiring: 0, expired: 0, shouldPause: 0, published: 0 },
        perPortal: [],
        notPublished: [],
        expiring: [],
        expired: [],
        shouldPause: [],
      }),
    );
    renderEs(<ListingsPage />);
    expect((await screen.findAllByText('Nada para revisar.')).length).toBe(4);
    expect(screen.queryByRole('button', { name: 'Pausar todos' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Portales y privacidad' })).not.toBeInTheDocument();
  });

  it('muestra el error de la carga', async () => {
    apiClient.mockRejectedValue(new ApiRequestError(500, 'ERR_500', 'Sin conexión'));
    renderEs(<ListingsPage />);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });

  it('abre la configuración de portales y privacidad', async () => {
    const user = userEvent.setup();
    apiClient.mockImplementation(async (path: string) =>
      path === '/listings/portals'
        ? {
            portals: [{ key: 'zonaprop', name: 'Zonaprop', urlTemplate: null, enabled: true }],
            hideExactAddress: true,
            showMap: false,
            expiryWarnDays: 7,
            catalog: PORTALS,
          }
        : overview(),
    );
    renderEs(<ListingsPage />);
    await user.click(await screen.findByRole('button', { name: 'Portales y privacidad' }));
    expect(await screen.findByDisplayValue('Zonaprop')).toBeInTheDocument();
  });
});

describe('Portales y privacidad', () => {
  const settings = {
    portals: [
      { key: 'zonaprop', name: 'Zonaprop', urlTemplate: 'https://zp.test/{code}', enabled: true },
      { key: 'lavoz', name: 'Clasificados La Voz', urlTemplate: null, enabled: true },
    ],
    hideExactAddress: true,
    showMap: false,
    expiryWarnDays: 7,
    catalog: PORTALS,
  };

  it('arma la clave de un portal nuevo a partir del nombre', () => {
    expect(portalKeyFromName('Clasificados La Voz')).toBe('clasificados-la-voz');
    expect(portalKeyFromName('  ÁrgenProp!! ')).toBe('argenprop');
  });

  it('guarda los portales, agrega uno nuevo y cambia la privacidad', async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();
    apiClient.mockImplementation(async (path: string, opts?: { method?: string }) =>
      opts?.method === 'PUT' ? settings : settings,
    );
    renderEs(<PortalsSettingsDialog onClose={() => {}} onSaved={onSaved} />);
    await screen.findByDisplayValue('Zonaprop');

    await user.type(screen.getByLabelText('Nuevo portal'), 'Portal Nuevo');
    await user.click(screen.getByRole('button', { name: 'Agregar portal' }));
    expect(screen.getByDisplayValue('Portal Nuevo')).toBeInTheDocument();

    await user.click(screen.getByLabelText(/Ocultar la dirección exacta/));
    await user.click(screen.getByLabelText(/Mostrar un mapa en el micrositio/));
    await user.click(screen.getAllByRole('button', { name: 'Quitar' })[1]);
    await user.click(screen.getByRole('button', { name: 'Guardar' }));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    const put = apiClient.mock.calls.find((c) => c[1]?.method === 'PUT');
    expect(JSON.parse(put![1].body)).toEqual({
      portals: [
        { key: 'zonaprop', name: 'Zonaprop', urlTemplate: 'https://zp.test/{code}', enabled: true },
        { key: 'portal-nuevo', name: 'Portal Nuevo', urlTemplate: null, enabled: true },
      ],
      hideExactAddress: false,
      showMap: true,
      expiryWarnDays: 7,
    });
  });

  it('rechaza un nombre repetido o el del portal propio', async () => {
    const user = userEvent.setup();
    apiClient.mockResolvedValue(settings);
    renderEs(<PortalsSettingsDialog onClose={() => {}} onSaved={() => {}} />);
    await screen.findByDisplayValue('Zonaprop');

    await user.type(screen.getByLabelText('Nuevo portal'), 'zonaprop');
    await user.click(screen.getByRole('button', { name: 'Agregar portal' }));
    expect(screen.getByText('Ingresá un nombre que no esté repetido.')).toBeInTheDocument();
    await user.clear(screen.getByLabelText('Nuevo portal'));
    await user.type(screen.getByLabelText('Nuevo portal'), 'Micrositio');
    await user.click(screen.getByRole('button', { name: 'Agregar portal' }));
    expect(screen.getByText('Ingresá un nombre que no esté repetido.')).toBeInTheDocument();
  });

  it('muestra el error al cargar y al guardar', async () => {
    const user = userEvent.setup();
    apiClient.mockRejectedValueOnce(new ApiRequestError(500, 'ERR_500', 'No se pudo'));
    const first = renderEs(<PortalsSettingsDialog onClose={() => {}} onSaved={() => {}} />);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    first.unmount();

    apiClient.mockResolvedValueOnce(settings).mockRejectedValueOnce(new ApiRequestError(400, 'ERR_400', 'Clave repetida'));
    renderEs(<PortalsSettingsDialog onClose={() => {}} onSaved={() => {}} />);
    await screen.findByDisplayValue('Zonaprop');
    await user.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Clave repetida');
  });
});
