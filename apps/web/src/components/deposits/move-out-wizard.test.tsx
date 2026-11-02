// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderEs } from '../index-data/test-utils';

const { apiClient, toastSuccess, toastError, downloadFile } = vi.hoisted(() => ({
  apiClient: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  downloadFile: vi.fn(),
}));

vi.mock('@/lib/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api-client')>()),
  apiClient: (...args: unknown[]) => apiClient(...args),
}));
vi.mock('@/lib/toast', () => ({
  toast: { success: (...a: unknown[]) => toastSuccess(...a), error: (...a: unknown[]) => toastError(...a), info: vi.fn() },
}));
vi.mock('@/lib/download', () => ({ downloadFile: (...a: unknown[]) => downloadFile(...a) }));

import { MoveOutWizard } from './move-out-wizard';
import { moveOutTotals, parseSigned } from '@/lib/deposits';

const PREVIEW = {
  contractId: 'c1',
  date: '2026-06-01',
  currency: 'ARS',
  items: [
    { kind: 'AlquilerPendiente', description: 'Liquidación 05/2026', amount: '30000.00', included: true, sourceType: 'Liquidacion', sourceId: 'l1' },
    { kind: 'Reparacion', description: 'Cerradura', amount: '8000.00', included: true, sourceType: 'PendingCharge', sourceId: 'pc1' },
  ],
  deposit: {
    id: 'd1',
    amount: '100000',
    currency: 'ARS',
    heldBy: 'Inmobiliaria',
    refundRule: 'PesosActualizado',
    refundInstallments: 1,
    refundDueDate: '2026-07-01',
    refundable: '182000.00',
    collected: '100000.00',
  },
};

interface Setup {
  existing?: unknown;
  preview?: unknown;
  previewError?: Error;
  confirmError?: Error;
}

function setup({ existing = null, preview = PREVIEW, previewError, confirmError }: Setup = {}) {
  const onDone = vi.fn();
  const onClose = vi.fn();
  apiClient.mockImplementation(async (path: string, init?: { method?: string; body?: string }) => {
    if (path.includes('/move-out/preview')) {
      if (previewError) throw previewError;
      return preview;
    }
    if (path.endsWith('/move-out') && init?.method === 'POST') return { id: 'mo1', status: 'Borrador', date: '2026-06-01', currency: 'ARS', items: [], netAmount: '1' };
    if (path.endsWith('/move-out')) return { settlement: existing };
    if (path.endsWith('/confirm')) {
      if (confirmError) throw confirmError;
      return { id: 'mo1', status: 'Confirmada', date: '2026-06-01', currency: 'ARS', items: [], netAmount: '144000' };
    }
    return {};
  });
  renderEs(<MoveOutWizard contractId="c1" onClose={onClose} onDone={onDone} />);
  return { onDone, onClose };
}

const calls = (suffix: string) => apiClient.mock.calls.filter(([p]) => String(p).endsWith(suffix));

async function toItems() {
  await userEvent.click(await screen.findByRole('button', { name: 'Ver la liquidación' }));
  await screen.findByText('Total adeudado');
}

beforeEach(() => {
  apiClient.mockReset();
  toastSuccess.mockReset();
  toastError.mockReset();
  downloadFile.mockReset();
  downloadFile.mockResolvedValue(undefined);
});

describe('MoveOutWizard', () => {
  it('paso 1: pide la fecha y trae la vista previa con los totales', async () => {
    setup();
    await toItems();
    expect(calls('/move-out/preview?date=' + new Date().toISOString().slice(0, 10)).length).toBe(1);
    expect(screen.getByText('Liquidación 05/2026')).toBeInTheDocument();
    expect(screen.getByText('Cerradura')).toBeInTheDocument();
    expect(screen.getByText(/Depósito a devolver \(pesos actualizados\)/)).toBeInTheDocument();
    expect(screen.getByText('A devolver al inquilino')).toBeInTheDocument();
    // 182000 - 38000 = 144000
    expect(screen.getAllByText(/144\.000,00/).length).toBeGreaterThan(0);
  });

  it('destildar un renglón y agregar un descuento recalcula', async () => {
    setup();
    await toItems();
    await userEvent.click(screen.getByRole('checkbox', { name: /Incluir: Cerradura/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Agregar un descuento' }));
    await userEvent.type(screen.getAllByLabelText('Detalle').at(-1)!, 'Pintura');
    await userEvent.type(screen.getByLabelText('Importe: Pintura'), '12000');
    // adeudado 30000 + 12000 = 42000 -> 182000 - 42000 = 140000
    expect(screen.getAllByText(/140\.000,00/).length).toBeGreaterThan(0);
  });

  it('con deuda mayor al depósito muestra lo que se cobra', async () => {
    setup();
    await toItems();
    await userEvent.clear(screen.getByLabelText('Importe: Liquidación 05/2026'));
    await userEvent.type(screen.getByLabelText('Importe: Liquidación 05/2026'), '250000');
    expect(screen.getByText('A cobrar al inquilino')).toBeInTheDocument();
  });

  it('un importe inválido bloquea guardar y confirmar', async () => {
    setup();
    await toItems();
    await userEvent.clear(screen.getByLabelText('Importe: Cerradura'));
    await userEvent.type(screen.getByLabelText('Importe: Cerradura'), 'abc');
    expect(screen.getByRole('button', { name: 'Guardar borrador' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Confirmar liquidación' })).toBeDisabled();
  });

  it('guarda el borrador con los renglones editados', async () => {
    setup();
    await toItems();
    await userEvent.type(screen.getByLabelText('Observaciones'), 'Entrega ok');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar borrador' }));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Borrador guardado'));
    const [, init] = calls('/move-out').find(([, i]) => i?.method === 'POST')!;
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({ date: expect.any(String), notes: 'Entrega ok' });
    expect(body.items).toHaveLength(2);
  });

  it('confirma con diálogo: guarda y confirma una sola vez', async () => {
    const { onDone } = setup();
    await toItems();
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar liquidación' }));
    const confirmDialog = await screen.findByText('Confirmar la liquidación de egreso');
    expect(within(confirmDialog.closest('[role="dialog"]') as HTMLElement).getByText(/144\.000,00/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar' }));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Liquidación confirmada'));
    expect(calls('/confirm')).toHaveLength(1);
    expect(onDone).toHaveBeenCalled();
    expect(await screen.findByText(/Resultado final/)).toBeInTheDocument();
  });

  it('cancelar el diálogo no confirma', async () => {
    setup();
    await toItems();
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar liquidación' }));
    await screen.findByText('Confirmar la liquidación de egreso');
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(calls('/confirm')).toHaveLength(0);
  });

  it('un error al confirmar se muestra', async () => {
    setup({ confirmError: new Error('Ya estaba confirmada') });
    await toItems();
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar liquidación' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Confirmar' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });

  it('un error en la vista previa se muestra y no pasa de paso', async () => {
    setup({ previewError: new Error('Falta el tipo de cambio') });
    await userEvent.click(await screen.findByRole('button', { name: 'Ver la liquidación' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText('Total adeudado')).toBeNull();
  });

  it('un tipo de cambio inválido no llama a la API y uno válido viaja en la consulta', async () => {
    setup();
    await userEvent.type(await screen.findByLabelText(/Tipo de cambio/), 'x');
    await userEvent.click(screen.getByRole('button', { name: 'Ver la liquidación' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(calls('').filter(([p]) => String(p).includes('preview'))).toHaveLength(0);
    await userEvent.clear(screen.getByLabelText(/Tipo de cambio/));
    await userEvent.type(screen.getByLabelText(/Tipo de cambio/), '1200,5');
    await userEvent.click(screen.getByRole('button', { name: 'Ver la liquidación' }));
    await screen.findByText('Total adeudado');
    expect(String(apiClient.mock.calls.find(([p]) => String(p).includes('preview'))![0])).toContain('rate=1200.5');
  });

  it('un contrato sin depósito lo aclara y deja todo a cargo del inquilino', async () => {
    setup({ preview: { ...PREVIEW, deposit: null } });
    await toItems();
    expect(screen.getByText(/no tiene depósito/)).toBeInTheDocument();
    expect(screen.getByText('A cobrar al inquilino')).toBeInTheDocument();
  });

  it('sin renglones lo dice y avisa si el depósito se cobró a medias', async () => {
    setup({ preview: { ...PREVIEW, items: [], deposit: { ...PREVIEW.deposit, collected: '50000.00' } } });
    await toItems();
    expect(screen.getByText(/No hay deudas registradas/)).toBeInTheDocument();
    expect(screen.getByText(/solo la parte cobrada/)).toBeInTheDocument();
  });

  it('una liquidación confirmada se muestra y se baja en PDF', async () => {
    setup({ existing: { id: 'mo1', status: 'Confirmada', date: '2026-06-01T00:00:00.000Z', currency: 'ARS', items: [], netAmount: '144000', notes: null } });
    expect(await screen.findByText(/Resultado final/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Ver la liquidación' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Descargar PDF' }));
    expect(downloadFile).toHaveBeenCalledWith('/move-outs/mo1/pdf', 'liquidacion-egreso.pdf');
  });

  it('retoma un borrador de la misma fecha con lo que se había editado', async () => {
    const edited = [{ kind: 'Deduccion', description: 'Llaves', amount: '500.00', included: true }];
    setup({ existing: { id: 'mo1', status: 'Borrador', date: '2026-06-01T00:00:00.000Z', currency: 'ARS', items: edited, netAmount: '1', notes: 'Nota previa' } });
    const date = await screen.findByLabelText(/Fecha de egreso/);
    await waitFor(() => expect((date as HTMLInputElement).value).toBe('2026-06-01'));
    await userEvent.click(screen.getByRole('button', { name: 'Ver la liquidación' }));
    expect(await screen.findByDisplayValue('Llaves')).toBeInTheDocument();
    expect(screen.getByLabelText('Observaciones')).toHaveValue('Nota previa');
  });

  it('si el PDF falla lo avisa', async () => {
    downloadFile.mockRejectedValue(new Error('no'));
    setup({ existing: { id: 'mo1', status: 'Confirmada', date: '2026-06-01T00:00:00.000Z', currency: 'ARS', items: [], netAmount: '1', notes: null } });
    await userEvent.click(await screen.findByRole('button', { name: 'Descargar PDF' }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith('No se pudo descargar el PDF'));
  });

  it('cerrar llama a onClose', async () => {
    const { onClose } = setup();
    await userEvent.click(await screen.findByRole('button', { name: 'Cerrar' }));
    expect(onClose).toHaveBeenCalled();
  });
});

describe('moveOutTotals', () => {
  it('usa el mismo motor que la API y tolera importes con coma', () => {
    const t = moveOutTotals(
      [
        { kind: 'Deduccion', description: 'a', amount: '1000,50', included: true },
        { kind: 'Deduccion', description: 'b', amount: '99', included: false },
      ],
      { ...PREVIEW.deposit, refundable: '5000.00' },
    );
    expect(t).toMatchObject({ totalOwed: '1000.50', refundToTenant: '3999.50', owedByTenant: '0.00' });
  });

  it('sin depósito todo es deuda', () => {
    expect(moveOutTotals([{ kind: 'Cargo', description: 'a', amount: '10', included: true }], null).owedByTenant).toBe('10.00');
  });

  it('parseSigned acepta negativos y rechaza texto', () => {
    expect(parseSigned('-5,5')).toBe('-5.5');
    expect(parseSigned('x')).toBeNull();
  });
});
