// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderEs } from '../index-data/test-utils';

const { apiClient, auth } = vi.hoisted(() => ({
  apiClient: vi.fn(),
  auth: { role: 'Admin' },
}));

vi.mock('@/lib/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api-client')>()),
  apiClient: (...args: unknown[]) => apiClient(...args),
}));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ user: { id: 'u1', role: auth.role } }),
  useOptionalAuth: () => ({ user: { id: 'u1', role: auth.role } }),
}));
vi.mock('@/lib/toast', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  usePathname: () => '/es/contracts/c-1',
}));
vi.mock('../contracts/closure-summary', () => ({ ClosureSummary: () => null }));
vi.mock('../contracts/commission-config', () => ({ CommissionConfig: () => null }));
vi.mock('../contracts/generate-document-modal', () => ({ GenerateDocumentModal: () => null }));
vi.mock('../contracts/adjustment-timeline', () => ({ AdjustmentTimeline: () => null }));

import { ContractDetailView } from '../contracts/contract-detail';
import { ContractPowersSection } from './contract-powers-section';
import { PersonPicker } from './person-picker';
import type { ContractLessor, PartyPerson, PowerOfAttorney } from './parties';
import { ApiRequestError } from '@/lib/api-client';

const ANA: PartyPerson = { id: '00000000-0000-4000-8000-000000000001', firstName: 'Ana', lastName: 'Propietaria' };
const BETO: PartyPerson = { id: '00000000-0000-4000-8000-000000000002', firstName: 'Beto', lastName: 'Cotitular' };
const CARLA: PartyPerson = { id: '00000000-0000-4000-8000-000000000003', firstName: 'Carla', lastName: 'Apoderada' };

function lessor(id: string, person: PartyPerson, pct: string, extra: Partial<ContractLessor> = {}): ContractLessor {
  return {
    id,
    personId: person.id,
    capacity: 'Propietario',
    payoutPct: pct,
    validFrom: '2026-01-01T00:00:00.000Z',
    validTo: null,
    needsReview: false,
    person,
    ...extra,
  };
}

const POWER: PowerOfAttorney = {
  id: 'w-1',
  principalId: ANA.id,
  agentId: CARLA.id,
  scopes: ['Cobrar', 'Firmar'],
  signatureMode: 'Conjunta',
  groupKey: 'grupo-a',
  contractId: 'c-1',
  validFrom: '2025-01-01T00:00:00.000Z',
  validTo: null,
  principal: ANA,
  agent: CARLA,
};

function contract(overrides: Record<string, unknown> = {}) {
  return {
    id: 'c-1',
    contractType: 'Alquiler',
    status: 'Activo',
    startDate: '2026-01-01T00:00:00.000Z',
    endDate: '2028-01-01T00:00:00.000Z',
    rentAmount: '100000',
    rentCurrency: 'ARS',
    isActive: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    propertyId: 'p-1',
    property: { id: 'p-1', title: 'Depto de prueba' },
    persons: [{ id: 'cp-1', role: 'Inquilino', person: { id: 't-1', firstName: 'Tomás', lastName: 'Inquilino' } }],
    lessors: [lessor('00000000-0000-4000-8000-0000000000a1', ANA, '60.0000', { payee: CARLA, payeePersonId: CARLA.id, bankAccount: { id: '00000000-0000-4000-8000-0000000000b1', currency: 'ARS', bankName: 'Banco de Prueba', alias: 'ana.pesos', isDefault: true } }), lessor('00000000-0000-4000-8000-0000000000a2', BETO, '40.0000', { needsReview: true })],
    apoderados: [POWER],
    guarantees: [],
    adjustments: [],
    schedules: [],
    ...overrides,
  };
}

function mockApi(get: () => unknown) {
  apiClient.mockImplementation((path: string) => {
    if (path === '/contracts/c-1') return Promise.resolve(get());
    if (path.endsWith('/powers') || path.includes('/powers?')) return Promise.resolve([]);
    if (path.endsWith('/bank-accounts')) return Promise.resolve([]);
    return Promise.resolve({});
  });
}

async function renderDetail() {
  renderEs(<ContractDetailView contractId="c-1" />);
  await screen.findByRole('heading', { name: 'Depto de prueba' });
  return userEvent.setup();
}

describe('Contrato — sección Locadores', () => {
  beforeEach(() => {
    apiClient.mockReset();
    auth.role = 'Admin';
  });

  it('muestra persona, carácter, % de cobro, cobrador, cuenta, vigencia y la marca "A revisar"', async () => {
    mockApi(() => contract());
    await renderDetail();
    const region = screen.getByRole('region', { name: 'Locadores' });
    expect(within(region).getAllByText('60 %').length).toBeGreaterThan(0);
    expect(within(region).getAllByText('40 %').length).toBeGreaterThan(0);
    expect(within(region).getAllByRole('link', { name: 'Ana Propietaria' })[0]).toHaveAttribute('href', `/es/persons/${ANA.id}`);
    expect(within(region).getAllByRole('link', { name: 'Carla Apoderada' }).length).toBeGreaterThan(0);
    expect(within(region).getAllByText('Banco de Prueba · ana.pesos'.replace('Banco de Prueba · ', 'ARS · Banco de Prueba · ')).length).toBeGreaterThan(0);
    expect(within(region).getAllByText('A revisar').length).toBeGreaterThan(0);
    expect(within(region).getByText(/se migró en partes iguales por suposición/)).toBeInTheDocument();
    expect(within(region).getAllByText('Cobra el propio locador').length).toBeGreaterThan(0);
  });

  it('ya no mezcla a los locadores con los propietarios viejos en Personas', async () => {
    mockApi(() => contract({ persons: [{ id: 'cp-9', role: 'Propietario', person: { id: 'o-9', firstName: 'Viejo', lastName: 'Propietario' } }] }));
    await renderDetail();
    // Con locadores cargados, el propietario viejo no aparece en ningún lado.
    expect(screen.queryByText('Viejo Propietario')).not.toBeInTheDocument();
  });

  it('sin locadores muestra los propietarios viejos como "A migrar"', async () => {
    mockApi(() =>
      contract({
        lessors: [],
        persons: [{ id: 'cp-9', role: 'Propietario', person: { id: 'o-9', firstName: 'Viejo', lastName: 'Propietario' } }],
      }),
    );
    await renderDetail();
    const region = screen.getByRole('region', { name: 'Locadores' });
    expect(within(region).getByText('Viejo Propietario')).toBeInTheDocument();
    expect(within(region).getByText('A migrar')).toBeInTheDocument();
    expect(within(region).getByRole('button', { name: 'Cargar locadores' })).toBeInTheDocument();
  });

  it('sin locadores ni propietarios viejos muestra el vacío', async () => {
    mockApi(() => contract({ lessors: [], persons: [] }));
    await renderDetail();
    expect(screen.getByText('Este contrato no tiene locadores cargados')).toBeInTheDocument();
  });

  it.each(['Lectura', 'Liquidaciones', 'Soporte'])('%s no puede editar los locadores', async (role) => {
    auth.role = role;
    mockApi(() => contract());
    await renderDetail();
    expect(screen.queryByRole('button', { name: 'Editar locadores' })).not.toBeInTheDocument();
  });

  it('Ventas abre el editor, y al guardar se vuelve a leer el contrato', async () => {
    auth.role = 'Ventas';
    let reads = 0;
    mockApi(() => {
      reads += 1;
      return contract();
    });
    apiClient.mockImplementation((path: string, init?: { method?: string }) => {
      if (init?.method === 'PUT') return Promise.resolve({});
      if (path === '/contracts/c-1') {
        reads += 1;
        return Promise.resolve(contract());
      }
      if (path.includes('/powers') || path.endsWith('/bank-accounts')) return Promise.resolve([]);
      return Promise.resolve({});
    });
    reads = 0;
    const user = await renderDetail();
    await user.click(screen.getByRole('button', { name: 'Editar locadores' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: 'Locadores del contrato' })).toBeInTheDocument();
    const before = reads;
    await user.click(within(dialog).getByRole('button', { name: 'Guardar locadores' }));
    await waitFor(() => expect(reads).toBeGreaterThan(before));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(apiClient).toHaveBeenCalledWith('/contracts/c-1/lessors', expect.objectContaining({ method: 'PUT' }));
  });
});

describe('Contrato — sección Apoderados', () => {
  beforeEach(() => {
    apiClient.mockReset();
    auth.role = 'Admin';
  });

  it('lista poderdante, apoderado, alcances y modo de firma con enlaces a las fichas', async () => {
    mockApi(() => contract());
    await renderDetail();
    const region = screen.getByRole('region', { name: 'Apoderados' });
    expect(within(region).getAllByRole('link', { name: 'Carla Apoderada' })[0]).toHaveAttribute('href', `/es/persons/${CARLA.id}`);
    expect(within(region).getAllByRole('link', { name: 'Ana Propietaria' })[0]).toHaveAttribute('href', `/es/persons/${ANA.id}`);
    expect(within(region).getAllByText('Cobrar').length).toBeGreaterThan(0);
    expect(within(region).getAllByText('Firmar').length).toBeGreaterThan(0);
    expect(within(region).getAllByText(/Conjunta \(firman todos\)/).length).toBeGreaterThan(0);
    expect(within(region).getAllByText('Un contrato').length).toBeGreaterThan(0);
  });

  it('sin poderes vigentes muestra el vacío', async () => {
    mockApi(() => contract({ apoderados: [] }));
    await renderDetail();
    expect(screen.getByText('No hay poderes vigentes que apliquen a este contrato')).toBeInTheDocument();
  });

  it('distingue poderes generales, de propiedad y de contrato', () => {
    renderEs(
      <ContractPowersSection
        powers={[
          { ...POWER, id: 'a', contractId: null, signatureMode: 'Indistinta', groupKey: null },
          { ...POWER, id: 'b', contractId: null, propertyId: 'p-1', agent: BETO },
        ]}
      />,
    );
    expect(screen.getAllByText('General').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Una propiedad').length).toBeGreaterThan(0);
  });
});

describe('PersonPicker', () => {
  beforeEach(() => {
    apiClient.mockReset();
  });

  it('busca desde 2 letras, ofrece resultados y deja fijada la persona elegida', async () => {
    apiClient.mockResolvedValue({ items: [ANA, BETO] });
    const onChange = vi.fn();
    const user = userEvent.setup();
    renderEs(<PersonPicker label="Persona" value={null} onChange={onChange} excludeIds={[BETO.id]} />);
    const input = screen.getByLabelText('Persona');
    await user.type(input, 'A');
    expect(apiClient).not.toHaveBeenCalled();
    await user.type(input, 'n');
    const option = await screen.findByRole('button', { name: /Ana Propietaria/ });
    expect(screen.queryByRole('button', { name: /Beto Cotitular/ })).not.toBeInTheDocument();
    expect(apiClient).toHaveBeenCalledWith('/persons?search=An&limit=8');
    await user.click(option);
    expect(onChange).toHaveBeenCalledWith(ANA);
  });

  it('avisa cuando no hay resultados o la búsqueda falla', async () => {
    apiClient.mockImplementation(() => Promise.reject(new ApiRequestError(500, 'X', 'caído')));
    const user = userEvent.setup();
    renderEs(<PersonPicker label="Persona" value={null} onChange={() => {}} error="Elegí una persona" />);
    expect(screen.getByLabelText('Persona')).toHaveAttribute('aria-invalid', 'true');
    await user.type(screen.getByLabelText('Persona'), 'zz');
    expect(await screen.findByText('No hay personas con ese dato')).toBeInTheDocument();
    // Borrar el texto limpia los resultados.
    await user.clear(screen.getByLabelText('Persona'));
    expect(screen.queryByText('No hay personas con ese dato')).not.toBeInTheDocument();
  });

  it('con una persona elegida permite cambiarla, salvo si está deshabilitado', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    const { unmount } = renderEs(<PersonPicker label="Persona" value={ANA} onChange={onChange} />);
    await user.click(screen.getByRole('button', { name: 'Cambiar a Ana Propietaria' }));
    expect(onChange).toHaveBeenCalledWith(null);
    unmount();

    renderEs(<PersonPicker label="Persona" value={ANA} onChange={onChange} disabled />);
    expect(screen.getByText('Ana Propietaria')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Cambiar/ })).not.toBeInTheDocument();
  });
});
