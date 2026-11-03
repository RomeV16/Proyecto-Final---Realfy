// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { EMPTY_INBOX_FILTERS, fillQuickReply, formatCountdown, inboxQuery, useNow } from './inbox';

const { apiClient } = vi.hoisted(() => ({ apiClient: vi.fn() }));
vi.mock('@/lib/api-client', () => ({ apiClient: (...a: unknown[]) => apiClient(...a) }));

import { refreshInboxSummary, resetInboxSummary, useInboxSummary } from './inbox-summary';

describe('inboxQuery', () => {
  it('por defecto pide las abiertas', () => {
    expect(inboxQuery(EMPTY_INBOX_FILTERS)).toBe('page=1&limit=50&open=true');
  });

  it('un estado explícito pesa más que "abiertas" y se suman canal, responsable, plazo y búsqueda', () => {
    const q = new URLSearchParams(
      inboxQuery({ scope: 'open', status: 'Resuelta', channel: 'Email', assignee: 'me', slaBreached: true, search: ' iris ' } as never, 2, 10),
    );
    expect(Object.fromEntries(q)).toEqual({
      page: '2',
      limit: '10',
      status: 'Resuelta',
      channel: 'Email',
      assignee: 'me',
      slaBreached: 'true',
      search: 'iris',
    });
  });

  it('"todas" no manda filtro de estado', () => {
    expect(inboxQuery({ ...EMPTY_INBOX_FILTERS, scope: 'all' })).toBe('page=1&limit=50');
  });
});

describe('formatCountdown', () => {
  it('minutos y segundos, y horas para plazos largos', () => {
    expect(formatCountdown(125_000)).toEqual({ text: '02:05', overdue: false });
    expect(formatCountdown(3_900_000)).toEqual({ text: '1 h 05', overdue: false });
  });

  it('un plazo pasado se marca vencido con el tiempo transcurrido', () => {
    expect(formatCountdown(-61_000)).toEqual({ text: '01:01', overdue: true });
    expect(formatCountdown(0).overdue).toBe(true);
  });
});

describe('fillQuickReply', () => {
  it('usa el nombre de pila y no deja huecos sin nombre', () => {
    expect(fillQuickReply('Hola {name}, gracias.', 'Iris Demo')).toBe('Hola Iris, gracias.');
    expect(fillQuickReply('Hola {name}, gracias.', null)).toBe('Hola, gracias.');
    expect(fillQuickReply('{name} escribió', '  ')).toBe(' escribió');
  });
});

describe('useNow', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('avanza con el reloj', () => {
    vi.setSystemTime(new Date('2026-11-03T12:00:00Z'));
    const { result } = renderHook(() => useNow(1000));
    const first = result.current.getTime();
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(result.current.getTime()).toBeGreaterThanOrEqual(first + 3000);
  });
});

describe('contadores del menú', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    apiClient.mockReset();
    resetInboxSummary();
  });
  afterEach(() => vi.useRealTimers());

  it('consulta al montar, cada minuto, y deja de consultar al desmontar; varios usos comparten una sola consulta', async () => {
    apiClient.mockResolvedValue({ unread: 3, breached: 1, unassigned: 2 });
    const a = renderHook(() => useInboxSummary(true));
    const b = renderHook(() => useInboxSummary(true));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(apiClient).toHaveBeenCalledTimes(1);
    expect(a.result.current).toEqual({ unread: 3, breached: 1, unassigned: 2 });
    expect(b.result.current.unread).toBe(3);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(apiClient).toHaveBeenCalledTimes(2);
    a.unmount();
    b.unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120_000);
    });
    expect(apiClient).toHaveBeenCalledTimes(2);
  });

  it('sin permiso no consulta ni muestra nada', async () => {
    renderHook(() => useInboxSummary(false));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(apiClient).not.toHaveBeenCalled();
  });

  it('un error conserva el último valor', async () => {
    apiClient.mockResolvedValueOnce({ unread: 5, breached: 0, unassigned: 0 }).mockRejectedValueOnce(new Error('x'));
    const { result } = renderHook(() => useInboxSummary(true));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    await act(async () => {
      await refreshInboxSummary();
    });
    expect(result.current.unread).toBe(5);
  });
});
