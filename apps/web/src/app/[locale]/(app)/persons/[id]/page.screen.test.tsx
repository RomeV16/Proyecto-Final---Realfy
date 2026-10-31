// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderEs } from '@/components/index-data/test-utils';

const { apiClient, auth, push } = vi.hoisted(() => ({
  apiClient: vi.fn(),
  auth: { role: 'Admin' },
  push: vi.fn(),
}));

vi.mock('@/lib/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api-client')>()),
  apiClient: (...args: unknown[]) => apiClient(...args),
}));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ user: { id: 'u1', role: auth.role, firstName: 'Ana', lastName: 'Prueba' } }),
  useOptionalAuth: () => ({
    user: { id: 'u1', role: auth.role, firstName: 'Ana', lastName: 'Prueba' },
  }),
}));
vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  usePathname: () => '/es/persons/pe-1',
  useParams: () => ({ id: 'pe-1' }),
  useRouter: () => ({ push, replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('@/i18n/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/i18n/navigation')>()),
  useRouter: () => ({ push, replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('@/lib/toast', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));
vi.mock('@/components/persons/person-form', () => ({
  PersonForm: ({ onCancel, onSuccess }: { onCancel: () => void; onSuccess: () => void }) => (
    <div>
      <p>Formulario de persona</p>
      <button onClick={onCancel}>Cancelar formulario</button>
      <button onClick={onSuccess}>Guardar formulario</button>
    </div>
  ),
}));

import { ApiRequestError } from '@/lib/api-client';
import PersonDetailPage from './page';

function person(overrides: Record<string, unknown> = {}) {
  return {
    id: 'pe-1',
    firstName: 'Luis',
    lastName: 'Inventado',
    email: 'luis@prueba.test',
    phone: '1111-0000',
    cuit: '20-00000000-1',
    fiscalCondition: 'Monotributista',
    bankName: 'Banco de Prueba',
    cbu: '0000000000000000000000',
    bankAlias: 'alias.prueba',
    notes: 'Nota ficticia de la persona',
    isActive: true,
    roles: [
      { id: 'r-1', role: 'Inquilino', assignedAt: '2026-11-01T00:00:00.000Z', propertyId: 'p-1' },
      { id: 'r-2', role: 'Garante', assignedAt: '2026-11-01T00:00:00.000Z', guarantorForPersonId: 'pe-9' },
    ],
    documents: [
      {
        id: 'd-1',
        fileName: 'dni-prueba.pdf',
        fileSize: 2048,
        mimeType: 'application/pdf',
        url: 'https://archivos.prueba.test/dni.pdf',
        createdAt: '2026-11-01T15:00:00.000Z',
      },
    ],
    createdAt: '2026-11-01T15:00:00.000Z',
    updatedAt: '2026-11-02T15:00:00.000Z',
    ...overrides,
  };
}

const score = {
  id: 's-1',
  guaranteeScore: 80,
  jobStabilityScore: 70,
  referencesScore: 60,
  paymentHistoryScore: 50,
  manualRating: 40,
  totalScore: '62.5',
  notes: 'Puntuación ficticia',
  scoredAt: '2026-11-01T15:00:00.000Z',
  scoredBy: { id: 'u9', firstName: 'Carla', lastName: 'Ejemplo' },
};

interface Opts {
  person?: () => unknown;
  score?: () => unknown;
  mutate?: (path: string, init: { method?: string }) => unknown;
}

function mockApi(opts: Opts = {}) {
  apiClient.mockImplementation((path: string, init?: { method?: string }) => {
    if (init?.method && init.method !== 'GET') {
      return Promise.resolve().then(() => (opts.mutate ? opts.mutate(path, init) : {}));
    }
    if (path === '/persons/pe-1') return Promise.resolve().then(opts.person ?? (() => person()));
    if (path === '/scoring/persons/pe-1') {
      return Promise.resolve().then(opts.score ?? (() => score));
    }
    if (path.startsWith('/properties')) {
      return Promise.resolve({ items: [{ id: 'p-1', title: 'Depto de prueba', street: 'Calle Falsa' }] });
    }
    if (path.startsWith('/persons?')) {
      return Promise.resolve({ items: [{ id: 'pe-9', firstName: 'Marta', lastName: 'Ficticia' }] });
    }
    return Promise.resolve({});
  });
}

async function renderPage() {
  renderEs(<PersonDetailPage />);
  await screen.findByRole('heading', { name: 'Luis Inventado' });
  return userEvent.setup();
}

describe('PersonDetailPage', () => {
  beforeEach(() => {
    apiClient.mockReset();
    push.mockReset();
    auth.role = 'Admin';
  });
  afterEach(() => vi.unstubAllGlobals());

  it('muestra los datos, roles con nombres resueltos y el documento', async () => {
    mockApi();
    await renderPage();
    expect(screen.getByText('20-00000000-1')).toBeInTheDocument();
    expect(screen.getByText('Monotributista')).toBeInTheDocument();
    expect(screen.getByText('Banco de Prueba')).toBeInTheDocument();
    expect(screen.getByText('alias.prueba')).toBeInTheDocument();
    expect(screen.getByText('Nota ficticia de la persona')).toBeInTheDocument();
    expect(await screen.findByText('Depto de prueba')).toBeInTheDocument();
    expect(await screen.findByText(/Marta Ficticia/)).toBeInTheDocument();
    expect(screen.getByText('dni-prueba.pdf')).toBeInTheDocument();
    expect(screen.getByText(/2,0 KB|2\.0 KB/)).toBeInTheDocument();
    expect(screen.getByText(/KB · .*2026/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Volver a personas' }).getAttribute('href')).toBe(
      '/es/persons',
    );
  });

  it.each(['Admin', 'Gerente'])('%s ve Editar, Eliminar y la puntuación', async (role) => {
    auth.role = role;
    mockApi();
    await renderPage();
    expect(screen.getAllByRole('button', { name: 'Editar' })[0]).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Eliminar' })).toBeInTheDocument();
    expect(await screen.findByText('62.5')).toBeInTheDocument();
    expect(screen.getByText(/Carla Ejemplo/)).toBeInTheDocument();
  });

  it('Ventas edita pero no elimina ni puntúa', async () => {
    auth.role = 'Ventas';
    mockApi();
    await renderPage();
    expect(screen.getAllByRole('button', { name: 'Editar' })[0]).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Eliminar' })).not.toBeInTheDocument();
    expect(screen.queryByText('Puntuación total')).not.toBeInTheDocument();
    expect(apiClient).not.toHaveBeenCalledWith('/scoring/persons/pe-1');
  });

  it.each(['Lectura', 'Soporte'])('%s no ve ninguna acción', async (role) => {
    auth.role = role;
    mockApi();
    await renderPage();
    expect(screen.queryByRole('button', { name: 'Editar' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Eliminar' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Subir documento' })).not.toBeInTheDocument();
    expect(screen.queryByTitle('Quitar rol')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Agregar rol' })).not.toBeInTheDocument();
  });

  it('elimina y vuelve al listado; cancelar oculta el aviso', async () => {
    mockApi();
    const user = await renderPage();
    await user.click(screen.getByRole('button', { name: 'Eliminar' }));
    expect(screen.getByText('¿Estás seguro de eliminar esta persona?')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByText('¿Estás seguro de eliminar esta persona?')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Eliminar' }));
    await user.click(screen.getByRole('button', { name: 'Confirmar' }));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/persons'));
  });

  it('si eliminar falla se queda en la pantalla', async () => {
    mockApi({
      mutate: () => {
        throw new Error('boom');
      },
    });
    const user = await renderPage();
    await user.click(screen.getByRole('button', { name: 'Eliminar' }));
    await user.click(screen.getByRole('button', { name: 'Confirmar' }));
    await waitFor(() => expect(apiClient).toHaveBeenCalledWith('/persons/pe-1', { method: 'DELETE' }));
    expect(push).not.toHaveBeenCalled();
  });

  it('entra y sale del modo edición', async () => {
    mockApi();
    const user = await renderPage();
    await user.click(screen.getAllByRole('button', { name: 'Editar' })[0]);
    expect(screen.getByText('Formulario de persona')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Editar persona' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cancelar formulario' }));
    expect(screen.getByRole('heading', { name: 'Detalle de persona' })).toBeInTheDocument();
    await user.click(screen.getAllByRole('button', { name: 'Editar' })[0]);
    await user.click(screen.getByRole('button', { name: 'Guardar formulario' }));
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Detalle de persona' })).toBeInTheDocument(),
    );
  });

  it('una persona sin datos opcionales muestra los vacíos', async () => {
    mockApi({
      person: () =>
        person({
          email: undefined,
          phone: undefined,
          cuit: undefined,
          fiscalCondition: undefined,
          bankName: undefined,
          cbu: undefined,
          bankAlias: undefined,
          notes: undefined,
          roles: [],
          documents: [],
        }),
      score: () => {
        throw new ApiRequestError(404, 'NF', 'sin puntuar');
      },
    });
    await renderPage();
    expect(screen.getByText('Sin roles asignados')).toBeInTheDocument();
    expect(screen.getByText('No hay documentos cargados')).toBeInTheDocument();
    expect(screen.queryByText('Datos fiscales / Datos bancarios')).not.toBeInTheDocument();
    expect(await screen.findByText('Sin puntuación')).toBeInTheDocument();
  });

  it('agrega un rol de propiedad', async () => {
    mockApi({
      person: () => person({ roles: [], documents: [] }),
      mutate: (path) => ({ id: 'r-9', role: 'Propietario', assignedAt: '2026-11-01T00:00:00.000Z', path }),
    });
    const user = await renderPage();
    const add = screen.getByRole('button', { name: 'Agregar rol' });
    expect(add).toBeDisabled();
    await user.selectOptions(screen.getByLabelText('Agregar rol'), 'Propietario');
    await screen.findByRole('option', { name: /Depto de prueba/ });
    await user.selectOptions(screen.getByLabelText('Propiedad vinculada'), 'p-1');
    await user.click(screen.getByRole('button', { name: 'Agregar rol' }));
    await waitFor(() =>
      expect(apiClient).toHaveBeenCalledWith(
        '/persons/pe-1/roles',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ role: 'Propietario', propertyId: 'p-1' }),
        }),
      ),
    );
    await waitFor(() => expect(screen.queryByText('Sin roles asignados')).not.toBeInTheDocument());
  });

  it('agrega un rol de garante eligiendo propietario', async () => {
    mockApi({ person: () => person({ roles: [], documents: [] }) });
    const user = await renderPage();
    await user.selectOptions(screen.getByLabelText('Agregar rol'), 'Garante');
    await screen.findByRole('option', { name: 'Marta Ficticia' });
    await user.selectOptions(screen.getByLabelText('Garante de propietario'), 'pe-9');
    await user.click(screen.getByRole('button', { name: 'Agregar rol' }));
    await waitFor(() =>
      expect(apiClient).toHaveBeenCalledWith(
        '/persons/pe-1/roles',
        expect.objectContaining({ body: JSON.stringify({ role: 'Garante', guarantorForPersonId: 'pe-9' }) }),
      ),
    );
  });

  it('el error de la API al agregar un rol se muestra', async () => {
    mockApi({
      person: () => person({ roles: [], documents: [] }),
      mutate: () => {
        throw new ApiRequestError(400, 'X', 'Rol duplicado');
      },
    });
    const user = await renderPage();
    await user.selectOptions(screen.getByLabelText('Agregar rol'), 'Lead');
    await user.click(screen.getByRole('button', { name: 'Agregar rol' }));
    expect(await screen.findByText('Rol duplicado')).toBeInTheDocument();
  });

  it('quita un rol y muestra el error si falla', async () => {
    mockApi();
    const user = await renderPage();
    await user.click(screen.getAllByTitle('Quitar rol')[0]);
    await waitFor(() =>
      expect(apiClient).toHaveBeenCalledWith('/persons/pe-1/roles/r-1', { method: 'DELETE' }),
    );
    await waitFor(() => expect(screen.getAllByTitle('Quitar rol')).toHaveLength(1));

    apiClient.mockImplementation((_p: string, init?: { method?: string }) =>
      init?.method ? Promise.reject(new ApiRequestError(400, 'X', 'No se pudo quitar')) : Promise.resolve({}),
    );
    await user.click(screen.getAllByTitle('Quitar rol')[0]);
    expect(await screen.findByText('No se pudo quitar')).toBeInTheDocument();
  });

  it('elimina un documento', async () => {
    mockApi();
    const user = await renderPage();
    await user.click(screen.getByRole('button', { name: 'Eliminar documento' }));
    await waitFor(() =>
      expect(apiClient).toHaveBeenCalledWith('/persons/pe-1/documents/d-1', { method: 'DELETE' }),
    );
    expect(await screen.findByText('No hay documentos cargados')).toBeInTheDocument();
  });

  it('si eliminar un documento falla muestra el mensaje', async () => {
    mockApi({
      mutate: () => {
        throw new Error('x');
      },
    });
    const user = await renderPage();
    await user.click(screen.getByRole('button', { name: 'Eliminar documento' }));
    expect(await screen.findByText('Error al eliminar el documento')).toBeInTheDocument();
  });

  it('sube un documento con fetch directo', async () => {
    const created = {
      id: 'd-2',
      fileName: 'contrato-prueba.pdf',
      fileSize: 3 * 1024 * 1024,
      mimeType: 'application/pdf',
      url: 'https://archivos.prueba.test/c.pdf',
      createdAt: '2026-11-01T15:00:00.000Z',
    };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => created });
    vi.stubGlobal('fetch', fetchMock);
    mockApi();
    await renderPage();
    const input = document.getElementById('doc-upload') as HTMLInputElement;
    const file = new File(['x'], 'contrato-prueba.pdf', { type: 'application/pdf' });
    fireEvent.change(input, { target: { files: [file] } });
    expect(await screen.findByText('contrato-prueba.pdf')).toBeInTheDocument();
    expect(screen.getByText(/3,0 MB|3\.0 MB/)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalled();
  });

  it('un fallo al subir muestra el mensaje del servidor o el genérico', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, statusText: 'Bad', json: async () => ({ message: 'Archivo inválido' }) })
      .mockRejectedValueOnce(new ApiRequestError(400, 'X', 'Muy grande'));
    vi.stubGlobal('fetch', fetchMock);
    mockApi();
    await renderPage();
    const input = document.getElementById('doc-upload') as HTMLInputElement;
    const file = new File(['x'], 'a.pdf', { type: 'application/pdf' });
    fireEvent.change(input, { target: { files: [file] } });
    expect(await screen.findByText('Error al subir el documento')).toBeInTheDocument();
    fireEvent.change(input, { target: { files: [file] } });
    expect(await screen.findByText('Muy grande')).toBeInTheDocument();
  });

  it('puntúa a una persona sin puntuación', async () => {
    let scored = false;
    mockApi({
      score: () => {
        if (!scored) throw new ApiRequestError(404, 'NF', 'sin puntuar');
        return score;
      },
      mutate: () => {
        scored = true;
        return {};
      },
    });
    const user = await renderPage();
    await user.click(await screen.findByRole('button', { name: 'Puntuar' }));
    fireEvent.change(screen.getByLabelText('Garantía'), { target: { value: '90' } });
    await user.type(screen.getByLabelText('Notas'), 'Buena');
    await user.click(screen.getByRole('button', { name: 'Guardar' }));
    await waitFor(() =>
      expect(apiClient).toHaveBeenCalledWith(
        '/scoring/persons/pe-1',
        expect.objectContaining({ method: 'PUT' }),
      ),
    );
    expect(await screen.findByText('62.5')).toBeInTheDocument();
  });

  it('edita la puntuación, cancela y vuelve a los valores guardados', async () => {
    mockApi();
    const user = await renderPage();
    await screen.findByText('62.5');
    const edits = screen.getAllByRole('button', { name: 'Editar' });
    await user.click(edits[edits.length - 1]);
    fireEvent.change(screen.getByLabelText('Referencias'), { target: { value: '500' } });
    await user.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(await screen.findByText('62.5')).toBeInTheDocument();
  });

  it('el error al guardar la puntuación se muestra', async () => {
    mockApi({
      mutate: () => {
        throw new Error('x');
      },
    });
    const user = await renderPage();
    await screen.findByText('62.5');
    const edits = screen.getAllByRole('button', { name: 'Editar' });
    await user.click(edits[edits.length - 1]);
    await user.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(await screen.findByText('Error al guardar la configuración')).toBeInTheDocument();
  });

  it('una persona inexistente muestra el estado vacío con enlace', async () => {
    apiClient.mockImplementation(() => Promise.reject(new ApiRequestError(404, 'NF', 'no')));
    renderEs(<PersonDetailPage />);
    expect(await screen.findByText('Persona no encontrada')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Volver a personas' }).getAttribute('href')).toBe(
      '/es/persons',
    );
  });
});
