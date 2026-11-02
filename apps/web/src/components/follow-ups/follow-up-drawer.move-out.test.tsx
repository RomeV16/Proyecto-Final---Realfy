// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderEs } from '../index-data/test-utils';

vi.mock('@/lib/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api-client')>()),
  apiClient: vi.fn().mockResolvedValue({ items: [] }),
}));
vi.mock('@/lib/auth-context', () => {
  const user = { id: 'u1', firstName: 'Usuario', lastName: 'Demo', role: 'Admin' };
  return { useAuth: () => ({ user }), useOptionalAuth: () => ({ user }) };
});
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));

import { FollowUpDrawer } from './follow-up-drawer';

const followUp = (kind: string) => ({
  id: 'f1',
  contractId: 'c1',
  kind,
  status: 'Abierto',
  outcome: 'Pendiente',
  dueDate: '2026-12-15T00:00:00.000Z',
  assigneeId: null,
  notes: null,
  closedAt: null,
  effectiveEnd: '2026-12-15T00:00:00.000Z',
  signedEnd: '2026-12-15T00:00:00.000Z',
  daysLeft: 43,
  light: 'yellow',
  property: 'Depto Sintético',
  tenantName: 'Inés Ficticia',
  tasks: [{ id: 't1', code: 'DEPOSITO', label: 'Devolución del depósito', done: false, doneAt: null, doneById: null, dueDate: null }],
  progress: { done: 0, total: 1 },
});

describe('FollowUpDrawer: liquidación de egreso', () => {
  it('una devolución enlaza a la liquidación de egreso del contrato', () => {
    renderEs(<FollowUpDrawer followUp={followUp('Devolucion') as never} onClose={vi.fn()} onChanged={vi.fn()} />);
    expect(screen.getByRole('link', { name: 'Liquidación de egreso' })).toHaveAttribute('href', '/contracts/c1#deposito');
  });

  it('una renovación no lo ofrece', () => {
    renderEs(<FollowUpDrawer followUp={followUp('Renovacion') as never} onClose={vi.fn()} onChanged={vi.fn()} />);
    expect(screen.queryByRole('link', { name: 'Liquidación de egreso' })).toBeNull();
  });
});
