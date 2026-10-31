// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import {
  ContractStatus,
  LeadStatus,
  LiquidacionStatus,
  RendicionStatus,
  TicketStatus,
  VisitStatus,
} from '@realfy/shared';
import es from '@/i18n/messages/es.json';
import en from '@/i18n/messages/en.json';
import { STATUS_REGISTRY, statusAccent, statusEntry, type StatusDomain } from '@/lib/status-registry';
import { renderEs } from '../index-data/test-utils';
import { StatusBadge } from './status-badge';

const ENUMS: Record<StatusDomain, object> = {
  liquidacion: LiquidacionStatus,
  rendicion: RendicionStatus,
  contrato: ContractStatus,
  ticket: TicketStatus,
  lead: LeadStatus,
  visita: VisitStatus,
};

function lookup(messages: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, k) => (acc as Record<string, unknown> | undefined)?.[k], messages);
}

describe('registro de estados', () => {
  it.each(Object.keys(ENUMS) as StatusDomain[])('%s: cubre cada valor del enum y su etiqueta existe en es y en', (domain) => {
    const values = Object.values(ENUMS[domain]);
    expect(Object.keys(STATUS_REGISTRY[domain]).sort()).toEqual([...values].sort());
    for (const status of values) {
      const { labelKey } = statusEntry(domain, status)!;
      expect(typeof lookup(es, labelKey)).toBe('string');
      expect(typeof lookup(en, labelKey)).toBe('string');
    }
  });

  it('liquidaciones usa un solo tono por estado (Aprobada brand, Enviada info, Pendiente warning)', () => {
    expect(statusEntry('liquidacion', 'Aprobada')?.tone).toBe('brand');
    expect(statusEntry('liquidacion', 'Enviada')?.tone).toBe('info');
    expect(statusEntry('liquidacion', 'Pendiente')?.tone).toBe('warning');
    expect(statusEntry('liquidacion', 'Pagada')?.tone).toBe('success');
  });

  it('el acento deriva del tono y neutral no lleva barra', () => {
    expect(statusAccent('liquidacion', 'Borrador')).toBe('none');
    expect(statusAccent('liquidacion', 'Vencida')).toBe('danger');
    expect(statusAccent('contrato', 'Inexistente')).toBe('none');
  });
});

describe('StatusBadge', () => {
  it('muestra la etiqueta traducida del estado', () => {
    renderEs(<StatusBadge domain="liquidacion" status="Pendiente" />);
    expect(screen.getByText('Pendiente')).toBeInTheDocument();
  });

  it('tacha las liquidaciones anuladas', () => {
    renderEs(<StatusBadge domain="liquidacion" status="Anulada" />);
    expect(screen.getByText('Anulada')).toHaveClass('line-through');
  });

  it('un estado desconocido se muestra crudo y neutral', () => {
    renderEs(<StatusBadge domain="ticket" status="Raro" dot={false} />);
    expect(screen.getByText('Raro')).toBeInTheDocument();
  });

  it('cubre el valor de cada dominio', () => {
    renderEs(<StatusBadge domain="visita" status="NoShow" />);
    expect(screen.getByText('No asistió')).toBeInTheDocument();
  });
});
