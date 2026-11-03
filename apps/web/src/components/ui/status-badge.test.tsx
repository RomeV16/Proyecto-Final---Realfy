// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import {
  ConsentStatus,
  ContractStatus,
  ExpirationLight,
  FeeInstallmentStatus,
  LessorInvoiceStatus,
  FeeStatus,
  ImportBatchStatus,
  ImportRowAction,
  LeadStatus,
  LiquidacionStatus,
  MessageStatus,
  CollectionStage,
  OwnerStatementStatus,
  PendingChargeStatus,
  RendicionStatus,
  SalesDepositStatus,
  SalesOperationStatus,
  TicketStatus,
  USER_STATUSES,
  VisitStatus,
  ADJUSTMENT_ROW_STATUSES,
  ListingStatus,
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
  usuario: USER_STATUSES,
  ajuste: ADJUSTMENT_ROW_STATUSES,
  importacion: ImportBatchStatus,
  importFila: ImportRowAction,
  cargo: PendingChargeStatus,
  estadoCuenta: OwnerStatementStatus,
  vencimiento: ExpirationLight,
  venta: SalesOperationStatus,
  sena: SalesDepositStatus,
  honorario: FeeStatus,
  cuotaHonorario: FeeInstallmentStatus,
  facturaLocador: LessorInvoiceStatus,
  mensaje: MessageStatus,
  consentimiento: ConsentStatus,
  aviso: ListingStatus,
  cobranza: CollectionStage,
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

  it('mensajes: pendiente a vigilar, enviado brand, entregado y leído success, fallido y bloqueado danger', () => {
    expect(statusEntry('mensaje', 'Pending')?.tone).toBe('warning');
    expect(statusEntry('mensaje', 'Sent')?.tone).toBe('brand');
    expect(statusEntry('mensaje', 'Read')?.tone).toBe('success');
    expect(statusEntry('mensaje', 'Blocked')?.tone).toBe('danger');
    expect(statusEntry('mensaje', 'Cancelled')).toMatchObject({ tone: 'neutral', strike: true });
    expect(statusEntry('consentimiento', 'OptOut')?.tone).toBe('danger');
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
