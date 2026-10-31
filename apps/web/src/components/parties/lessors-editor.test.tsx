// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderEs } from '../index-data/test-utils';

const { apiClient, toast } = vi.hoisted(() => ({
  apiClient: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock('@/lib/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api-client')>()),
  apiClient: (...args: unknown[]) => apiClient(...args),
}));
vi.mock('@/lib/toast', () => ({ toast }));

import { ApiRequestError } from '@/lib/api-client';
import { LessorsEditor } from './lessors-editor';
import type { BankAccount, ContractLessor, PartyPerson, PowerOfAttorney } from './parties';

const CONTRACT = {
  id: 'c-1',
  propertyId: 'p-1',
  startDate: '2026-01-01T00:00:00.000Z',
  endDate: '2028-01-01T00:00:00.000Z',
};

const ANA: PartyPerson = { id: '00000000-0000-4000-8000-000000000001', firstName: 'Ana', lastName: 'Propietaria' };
const BETO: PartyPerson = { id: '00000000-0000-4000-8000-000000000002', firstName: 'Beto', lastName: 'Cotitular' };
const CARLA: PartyPerson = { id: '00000000-0000-4000-8000-000000000003', firstName: 'Carla', lastName: 'Apoderada' };
const DIEGO: PartyPerson = { id: '00000000-0000-4000-8000-000000000004', firstName: 'Diego', lastName: 'SoloFirma' };
const ELSA: PartyPerson = { id: '00000000-0000-4000-8000-000000000005', firstName: 'Elsa', lastName: 'OtroContrato' };

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

const LESSORS = [lessor('00000000-0000-4000-8000-0000000000a1', ANA, '60.0000'), lessor('00000000-0000-4000-8000-0000000000a2', BETO, '40.0000')];

function power(id: string, agent: PartyPerson, extra: Partial<PowerOfAttorney> = {}): PowerOfAttorney {
  return {
    id,
    principalId: ANA.id,
    agentId: agent.id,
    scopes: ['Cobrar'],
    signatureMode: 'Indistinta',
    validFrom: '2025-01-01T00:00:00.000Z',
    validTo: null,
    agent,
    ...extra,
  };
}

const ANA_POWERS: PowerOfAttorney[] = [
  power('w-1', CARLA),
  power('w-2', DIEGO, { scopes: ['Firmar'] }),
  power('w-3', ELSA, { contractId: 'c-otro' }),
  power('w-4', BETO, { validTo: '2025-06-01T00:00:00.000Z' }),
];

const ANA_ACCOUNTS: BankAccount[] = [
  { id: '00000000-0000-4000-8000-0000000000b1', currency: 'ARS', bankName: 'Banco de Prueba', alias: 'ana.pesos', isDefault: true },
  { id: '00000000-0000-4000-8000-0000000000b2', currency: 'USD', bankName: 'Banco de Prueba', alias: 'ana.dolares', isDefault: true },
];

let putResult: () => Promise<unknown>;

function mockApi() {
  apiClient.mockImplementation((path: string, init?: { method?: string }) => {
    if (init?.method === 'PUT') return putResult();
    if (path.startsWith('/persons/00000000-0000-4000-8000-000000000001/powers')) return Promise.resolve(ANA_POWERS);
    if (path === '/persons/00000000-0000-4000-8000-000000000001/bank-accounts') return Promise.resolve(ANA_ACCOUNTS);
    if (path.endsWith('/powers')) return Promise.resolve([]);
    if (path.endsWith('/bank-accounts')) return Promise.resolve([]);
    if (path.startsWith('/persons?search=')) return Promise.resolve({ items: [CARLA, DIEGO] });
    return Promise.resolve({});
  });
}

const onClose = vi.fn();
const onSaved = vi.fn();

function renderEditor(lessors: ContractLessor[] = LESSORS, legacyOwners: PartyPerson[] = [], contract = CONTRACT) {
  return renderEs(
    <LessorsEditor open onClose={onClose} contract={contract} lessors={lessors} legacyOwners={legacyOwners} onSaved={onSaved} />,
  );
}

const saveButton = () => screen.getByRole('button', { name: 'Guardar locadores' });
const pctInputs = () => screen.getAllByLabelText(/^% de cobro/);

async function setPct(user: ReturnType<typeof userEvent.setup>, index: number, value: string) {
  const input = pctInputs()[index];
  await user.clear(input);
  await user.type(input, value);
}

describe('LessorsEditor', () => {
  beforeEach(() => {
    apiClient.mockReset();
    onClose.mockReset();
    onSaved.mockReset();
    toast.success.mockReset();
    putResult = () => Promise.resolve({});
    mockApi();
  });

  it('muestra la suma de los locadores vigentes y habilita guardar cuando es exactamente 100', async () => {
    renderEditor();
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('Suma de los locadores vigentes: 100,0000 %');
    expect(status).toHaveTextContent('El reparto suma 100 %.');
    expect(saveButton()).toBeEnabled();
    expect(pctInputs().map((i) => (i as HTMLInputElement).value)).toEqual(['60.0000', '40.0000']);
  });

  it('deshabilita guardar y muestra cuánto falta cuando no llega a 100', async () => {
    const user = userEvent.setup();
    renderEditor();
    await setPct(user, 0, '50');
    expect(screen.getByRole('status')).toHaveTextContent('Suma de los locadores vigentes: 90,0000 %');
    expect(screen.getByRole('status')).toHaveTextContent('Falta 10,0000 % para llegar a 100 %.');
    expect(saveButton()).toBeDisabled();
  });

  it('deshabilita guardar y muestra cuánto sobra cuando pasa de 100, aceptando coma decimal', async () => {
    const user = userEvent.setup();
    renderEditor();
    await setPct(user, 0, '70,5');
    expect(screen.getByRole('status')).toHaveTextContent('Sobran 10,5000 % sobre el 100 %.');
    expect(saveButton()).toBeDisabled();
  });

  it('no deja guardar un porcentaje con más de 4 decimales o fuera de rango', async () => {
    const user = userEvent.setup();
    renderEditor();
    await setPct(user, 0, '33,33333');
    expect(saveButton()).toBeDisabled();
    expect(screen.getByText(/Ingresá un porcentaje mayor que 0/)).toBeInTheDocument();
    await setPct(user, 0, '60');
    expect(saveButton()).toBeEnabled();
  });

  it('guarda el conjunto completo con PUT: filas existentes con id y la nueva sin id', async () => {
    const user = userEvent.setup();
    renderEditor();
    await setPct(user, 1, '30');
    await user.click(screen.getByRole('button', { name: 'Agregar locador' }));
    await user.type(screen.getByPlaceholderText('Buscar persona…'), 'Car');
    await user.click(await screen.findByRole('button', { name: /Carla Apoderada/ }));
    await setPct(user, 2, '10,25');
    // 60 + 30 + 10,25 = 100,25: falta ajustar
    expect(saveButton()).toBeDisabled();
    await setPct(user, 2, '10');
    expect(saveButton()).toBeEnabled();

    await user.click(saveButton());
    await waitFor(() => expect(onSaved).toHaveBeenCalled());

    const call = apiClient.mock.calls.find(([, init]) => init?.method === 'PUT')!;
    expect(call[0]).toBe('/contracts/c-1/lessors');
    expect(JSON.parse(call[1].body)).toEqual({
      lessors: [
        { id: '00000000-0000-4000-8000-0000000000a1', personId: '00000000-0000-4000-8000-000000000001', capacity: 'Propietario', payoutPct: '60.0000', payeePersonId: null, bankAccountId: null, validFrom: '2026-01-01', validTo: null },
        { id: '00000000-0000-4000-8000-0000000000a2', personId: '00000000-0000-4000-8000-000000000002', capacity: 'Propietario', payoutPct: '30', payeePersonId: null, bankAccountId: null, validFrom: '2026-01-01', validTo: null },
        { personId: '00000000-0000-4000-8000-000000000003', capacity: 'Propietario', payoutPct: '10', payeePersonId: null, bankAccountId: null, validTo: null },
      ],
    });
    expect(toast.success).toHaveBeenCalledWith('Locadores guardados');
    expect(onClose).toHaveBeenCalled();
  });

  it('el cobrador se limita a apoderados con poder de cobro vigente de ese locador para este contrato', async () => {
    const user = userEvent.setup();
    renderEditor();
    const payee = await waitFor(() => {
      const select = screen.getAllByLabelText('Quién cobra')[0] as HTMLSelectElement;
      expect(within(select).getAllByRole('option').length).toBeGreaterThan(1);
      return select;
    });
    const labels = within(payee).getAllByRole('option').map((o) => o.textContent);
    // Carla (Cobrar general) sí; Diego (solo Firmar), Elsa (poder de otro contrato) y Beto (vencido) no.
    expect(labels).toEqual(['Cobra el propio locador', 'Carla Apoderada']);

    await user.selectOptions(payee, '00000000-0000-4000-8000-000000000003');
    await user.click(saveButton());
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    const call = apiClient.mock.calls.find(([, init]) => init?.method === 'PUT')!;
    expect(JSON.parse(call[1].body).lessors[0].payeePersonId).toBe('00000000-0000-4000-8000-000000000003');
  });

  it('la cuenta se limita a las cuentas de ese locador', async () => {
    const user = userEvent.setup();
    renderEditor();
    const account = await waitFor(() => {
      const select = screen.getAllByLabelText('Cuenta de cobro')[0] as HTMLSelectElement;
      expect(within(select).getAllByRole('option').length).toBeGreaterThan(1);
      return select;
    });
    expect(within(account).getAllByRole('option').map((o) => o.textContent)).toEqual([
      'Sin cuenta',
      'ARS · Banco de Prueba · ana.pesos',
      'USD · Banco de Prueba · ana.dolares',
    ]);
    // Beto no tiene cuentas: solo "Sin cuenta".
    const betoAccount = screen.getAllByLabelText('Cuenta de cobro')[1];
    expect(within(betoAccount).getAllByRole('option')).toHaveLength(1);

    await user.selectOptions(account, '00000000-0000-4000-8000-0000000000b2');
    await user.click(saveButton());
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    const call = apiClient.mock.calls.find(([, init]) => init?.method === 'PUT')!;
    expect(JSON.parse(call[1].body).lessors[0].bankAccountId).toBe('00000000-0000-4000-8000-0000000000b2');
  });

  it('cambiar de persona limpia el cobrador y la cuenta elegidos', async () => {
    const user = userEvent.setup();
    renderEditor([lessor('00000000-0000-4000-8000-0000000000a1', ANA, '100.0000', { payeePersonId: '00000000-0000-4000-8000-000000000003', bankAccountId: '00000000-0000-4000-8000-0000000000b1' })]);
    await waitFor(() => expect(within(screen.getByLabelText('Quién cobra')).getAllByRole('option')).toHaveLength(2));
    expect(screen.getByLabelText('Quién cobra')).toHaveValue('00000000-0000-4000-8000-000000000003');

    await user.click(screen.getByRole('button', { name: 'Cambiar a Ana Propietaria' }));
    await user.type(screen.getByPlaceholderText('Buscar persona…'), 'Die');
    await user.click(await screen.findByRole('button', { name: /Diego SoloFirma/ }));
    expect(screen.getByLabelText('Quién cobra')).toHaveValue('');
    expect(screen.getByLabelText('Cuenta de cobro')).toHaveValue('');
  });

  it('parte de los propietarios viejos del contrato con reparto en partes iguales', async () => {
    renderEditor([], [ANA, BETO, CARLA]);
    expect(pctInputs().map((i) => (i as HTMLInputElement).value)).toEqual(['33.3333', '33.3333', '33.3334']);
    expect(saveButton()).toBeEnabled();
    // Sin id: se crean al guardar.
    const user = userEvent.setup();
    await user.click(saveButton());
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    const call = apiClient.mock.calls.find(([, init]) => init?.method === 'PUT')!;
    expect(JSON.parse(call[1].body).lessors.every((l: { id?: string }) => l.id === undefined)).toBe(true);
  });

  it('sin locadores ni propietarios viejos arranca con una fila vacía y no deja guardar', async () => {
    renderEditor([], []);
    expect(pctInputs()).toHaveLength(1);
    expect(screen.getByRole('status')).toHaveTextContent('Completá la persona y el porcentaje');
    expect(saveButton()).toBeDisabled();
    expect(screen.queryByRole('button', { name: /^Quitar a/ })).not.toBeInTheDocument();
  });

  it('repartir en partes iguales y quitar una fila', async () => {
    const user = userEvent.setup();
    renderEditor([...LESSORS, lessor('00000000-0000-4000-8000-0000000000a3', CARLA, '0.0001')]);
    expect(saveButton()).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Repartir en partes iguales' }));
    expect(pctInputs().map((i) => (i as HTMLInputElement).value)).toEqual(['33.3333', '33.3333', '33.3334']);
    expect(saveButton()).toBeEnabled();

    await user.click(screen.getByRole('button', { name: 'Quitar a Carla Apoderada' }));
    expect(pctInputs()).toHaveLength(2);
    expect(saveButton()).toBeDisabled();
  });

  it('una cesión con fechas que cierran en 100 se puede guardar; si deja un hueco lista los días', async () => {
    const user = userEvent.setup();
    renderEditor([
      lessor('00000000-0000-4000-8000-0000000000a1', ANA, '100.0000', { validTo: '2026-07-01T00:00:00.000Z' }),
      lessor('00000000-0000-4000-8000-0000000000a2', BETO, '100.0000', { validFrom: '2026-07-01T00:00:00.000Z' }),
    ]);
    expect(saveButton()).toBeEnabled();

    // Beto entra un mes más tarde: del 1/7 al 1/8 no hay locadores.
    fireDate(screen.getAllByLabelText('Vigente desde')[1], '2026-08-01');
    await waitFor(() => expect(saveButton()).toBeDisabled());
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('suman 0,0000 %');
    await user.click(saveButton()).catch(() => {});
    expect(apiClient.mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(false);
  });

  it('avisa si la fecha de fin no es posterior al inicio', async () => {
    renderEditor();
    fireDate(screen.getAllByLabelText('Vigente desde')[0], '2026-06-01');
    fireDate(screen.getAllByLabelText('Vigente hasta')[0], '2026-05-01');
    expect(await screen.findByText('La fecha de fin debe ser posterior al inicio')).toBeInTheDocument();
  });

  describe('errores de la API', () => {
    it('LESSOR_SHARES_INVALID muestra el aviso y los días que no cierran', async () => {
      putResult = () =>
        Promise.reject(
          new ApiRequestError(400, 'LESSOR_SHARES_INVALID', 'no cierra', {
            details: { invalidDates: [{ date: '2026-07-01', sum: '90.0000' }] },
          }),
        );
      const user = userEvent.setup();
      renderEditor();
      await user.click(saveButton());
      const alert = await screen.findByText('Los locadores vigentes tienen que sumar 100 % en cada fecha.');
      expect(alert).toBeInTheDocument();
      expect(await screen.findByText(/suman 90,0000 %/)).toBeInTheDocument();
      expect(onSaved).not.toHaveBeenCalled();
      expect(onClose).not.toHaveBeenCalled();
      // El botón vuelve a estar disponible para corregir y reintentar.
      expect(saveButton()).toBeEnabled();
    });

    it('PAYEE_WITHOUT_POWER y BANK_ACCOUNT_NOT_OF_LESSOR muestran su mensaje localizado', async () => {
      const user = userEvent.setup();
      renderEditor();
      putResult = () => Promise.reject(new ApiRequestError(400, 'PAYEE_WITHOUT_POWER', 'sin poder'));
      await user.click(saveButton());
      expect(await screen.findByText('El cobrador necesita un poder de cobro vigente del locador.')).toBeInTheDocument();

      putResult = () => Promise.reject(new ApiRequestError(400, 'BANK_ACCOUNT_NOT_OF_LESSOR', 'cuenta ajena'));
      await user.click(saveButton());
      expect(await screen.findByText('La cuenta elegida no pertenece al locador.')).toBeInTheDocument();
    });

    it('un error desconocido que no es de la API usa el texto de reserva', async () => {
      putResult = () => Promise.reject('boom');
      const user = userEvent.setup();
      renderEditor();
      await user.click(saveButton());
      expect(await screen.findByText('No se pudieron guardar los locadores')).toBeInTheDocument();
    });
  });

  it('Cancelar cierra sin guardar', async () => {
    const user = userEvent.setup();
    renderEditor();
    await user.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(onClose).toHaveBeenCalled();
    expect(apiClient.mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(false);
  });

  it('si la ficha de poderes o cuentas falla, el editor sigue usable sin opciones extra', async () => {
    apiClient.mockImplementation((path: string, init?: { method?: string }) => {
      if (init?.method === 'PUT') return putResult();
      return Promise.reject(new Error('sin red'));
    });
    renderEditor();
    await waitFor(() => expect(apiClient).toHaveBeenCalled());
    expect(within(screen.getAllByLabelText('Quién cobra')[0]).getAllByRole('option')).toHaveLength(1);
    expect(saveButton()).toBeEnabled();
  });
});

import { fireEvent } from '@testing-library/react';
function fireDate(input: HTMLElement, value: string) {
  fireEvent.change(input, { target: { value } });
}
