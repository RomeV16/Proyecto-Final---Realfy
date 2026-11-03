// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import { MESSAGE_TEMPLATES } from '@realfy/shared';
import { renderEs } from '../index-data/test-utils';

const { apiClient, auth } = vi.hoisted(() => ({ apiClient: vi.fn(), auth: { role: 'Gerente' } }));

vi.mock('@/lib/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api-client')>()),
  apiClient: (...args: unknown[]) => apiClient(...args),
}));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ user: { id: 'u1', role: auth.role } }),
  useOptionalAuth: () => ({ user: { id: 'u1', role: auth.role } }),
}));
vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  usePathname: () => '/es/configuracion/mensajeria',
}));

import { ApiRequestError } from '@/lib/api-client';
import MessagingSettingsPage from '@/app/[locale]/(app)/configuracion/mensajeria/page';

function settings(o: Record<string, unknown> = {}) {
  return {
    mode: 'allowlist',
    allowlistCount: 2,
    providers: {
      email: { configured: true, from: 'avisos@example.com', webhook: false },
      whatsapp: { configured: false, webhook: false },
    },
    sendingWindow: { fromHour: 9, untilHour: 20 },
    templates: Object.values(MESSAGE_TEMPLATES),
    ...o,
  };
}

function mockApi(data: unknown = settings(), fail = false) {
  apiClient.mockImplementation(async (path: string) => {
    if (path !== '/messaging/settings') throw new Error(`unexpected ${path}`);
    if (fail) throw new ApiRequestError(500, 'INTERNAL_ERROR', 'boom');
    return data;
  });
}

beforeEach(() => {
  apiClient.mockReset();
  auth.role = 'Gerente';
});

describe('Configuración → Mensajería', () => {
  it('muestra el modo actual con la explicación de cada modo y la nota del ambiente', async () => {
    mockApi();
    renderEs(<MessagingSettingsPage />);
    const mode = within(await screen.findByRole('region', { name: 'Modo de envío' }));
    expect(mode.getByText('Este ambiente está en:')).toBeInTheDocument();
    expect(mode.getAllByText('Solo la lista de prueba').length).toBe(2);
    expect(mode.getByText(/lista de prueba \(2 direcciones\); el resto queda bloqueado/)).toBeInTheDocument();
    expect(mode.getByText(/No se manda nada: los mensajes quedan en cola/)).toBeInTheDocument();
    expect(mode.getByText(/respetando el consentimiento de cada persona/)).toBeInTheDocument();
    expect(mode.getByText(/variable MESSAGING_MODE/)).toBeInTheDocument();
    expect(mode.getByText(/El ambiente piloto queda apagado/)).toBeInTheDocument();
    const current = mode.getAllByRole('listitem').find((li) => li.getAttribute('aria-current') === 'true');
    expect(current).toHaveTextContent('Solo la lista de prueba');
  });

  it('una lista de prueba vacía lo dice', async () => {
    mockApi(settings({ allowlistCount: 0, mode: 'off' }));
    renderEs(<MessagingSettingsPage />);
    expect(await screen.findByText(/sin direcciones cargadas/)).toBeInTheDocument();
    expect(screen.getAllByText('Apagado').length).toBe(2);
  });

  it('muestra el estado de los proveedores', async () => {
    mockApi();
    renderEs(<MessagingSettingsPage />);
    const providers = within(await screen.findByRole('region', { name: 'Proveedores' }));
    expect(providers.getByText('Mail (Resend)')).toBeInTheDocument();
    expect(providers.getByText('avisos@example.com')).toBeInTheDocument();
    expect(providers.getByText('WhatsApp (Cloud API)')).toBeInTheDocument();
    expect(providers.getAllByText('Sí')).toHaveLength(1);
    expect(providers.getAllByText('No')).toHaveLength(3);
  });

  it('sin remitente muestra un guion', async () => {
    mockApi(settings({ providers: { email: { configured: false, from: null, webhook: true }, whatsapp: { configured: true, webhook: true } } }));
    renderEs(<MessagingSettingsPage />);
    const providers = within(await screen.findByRole('region', { name: 'Proveedores' }));
    expect(providers.getByText('—')).toBeInTheDocument();
    expect(providers.getAllByText('Sí')).toHaveLength(3);
  });

  it('muestra el horario de envío con el enlace a Valores por defecto', async () => {
    mockApi();
    renderEs(<MessagingSettingsPage />);
    const window = within(await screen.findByRole('region', { name: 'Horario de envío' }));
    expect(window.getByText('De 9 a 20 h (hora de Buenos Aires)')).toBeInTheDocument();
    expect(window.getByRole('link', { name: 'Cambiarlo en Configuración → Valores por defecto' })).toHaveAttribute(
      'href',
      '/es/configuracion/valores-por-defecto',
    );
  });

  it('lista las plantillas con canales, destinatarios y el texto de WhatsApp', async () => {
    mockApi();
    renderEs(<MessagingSettingsPage />);
    const templates = within(await screen.findByRole('region', { name: 'Plantillas' }));
    expect(templates.getAllByText('Recibo de cobro').length).toBeGreaterThan(0);
    expect(templates.getAllByText('Mail · WhatsApp').length).toBeGreaterThan(0);
    expect(templates.getAllByText('recibo_de_cobro · es_AR').length).toBeGreaterThan(0);
    expect(templates.getAllByText(/Hola \{\{1\}\}, te enviamos el recibo de cobro/).length).toBeGreaterThan(0);
    expect(templates.getAllByText('Invitación al equipo').length).toBeGreaterThan(0);
    expect(templates.getAllByText('El personal').length).toBeGreaterThan(0);
    expect(templates.getAllByText('Solo mail').length).toBeGreaterThan(0);
  });

  it('un error al cargar se muestra', async () => {
    mockApi(undefined, true);
    renderEs(<MessagingSettingsPage />);
    expect(await screen.findByRole('alert')).toHaveTextContent('INTERNAL_ERROR');
  });

  it.each(['Liquidaciones', 'Ventas', 'Lectura'])('%s ve el aviso y no consulta', (role) => {
    auth.role = role;
    mockApi();
    renderEs(<MessagingSettingsPage />);
    expect(screen.getByText('Solo Administración y Gerencia ven la configuración de la mensajería.')).toBeInTheDocument();
    expect(apiClient).not.toHaveBeenCalled();
  });
});
