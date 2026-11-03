import { SalesDepositKind as K, SalesDepositStatus as D } from '../enums';
import {
  SALES_DOC_CODES,
  SALES_DOC_TEMPLATE,
  blocksLeavingStage,
  hasUnresolvedMoney,
  isDepositExpired,
  reservationExpiry,
} from './index';

const today = new Date('2026-11-10T00:00:00Z');

describe('ventas', () => {
  it('la lista de documentación no repite códigos y tiene obligatorios y opcionales', () => {
    expect(new Set(SALES_DOC_CODES).size).toBe(SALES_DOC_TEMPLATE.length);
    expect(SALES_DOC_TEMPLATE.some((i) => i.required)).toBe(true);
    expect(SALES_DOC_TEMPLATE.some((i) => !i.required)).toBe(true);
  });

  it('el dinero sin resolver es el recibido sin cerrar', () => {
    expect(hasUnresolvedMoney({ status: D.Recibida, receivedAt: '2026-11-01' })).toBe(true);
    expect(hasUnresolvedMoney({ status: D.Vencida, receivedAt: '2026-11-01' })).toBe(true);
    expect(hasUnresolvedMoney({ status: D.Devuelta, receivedAt: '2026-11-01', resolvedAt: '2026-11-05' })).toBe(false);
    expect(hasUnresolvedMoney({ status: D.Aplicada, receivedAt: '2026-11-01' })).toBe(false);
    expect(hasUnresolvedMoney({ status: D.Pendiente })).toBe(false);
  });

  it('bloquean volver atrás las pendientes y las que tienen dinero sin resolver', () => {
    expect(blocksLeavingStage({ status: D.Pendiente })).toBe(true);
    expect(blocksLeavingStage({ status: D.Recibida, receivedAt: new Date() })).toBe(true);
    expect(blocksLeavingStage({ status: D.Retenida, receivedAt: new Date(), resolvedAt: new Date() })).toBe(false);
    expect(blocksLeavingStage({ status: D.Vencida })).toBe(false);
  });

  it('una reserva vence el día después de su fecha, y solo si sigue viva', () => {
    const base = { kind: K.Reserva, status: D.Pendiente };
    expect(isDepositExpired({ ...base, expiresAt: '2026-11-10' }, today)).toBe(false);
    expect(isDepositExpired({ ...base, expiresAt: '2026-11-09' }, today)).toBe(true);
    expect(isDepositExpired({ ...base, status: D.Recibida, expiresAt: new Date('2026-11-01') }, today)).toBe(true);
    expect(isDepositExpired({ ...base, status: D.Devuelta, expiresAt: '2026-11-01' }, today)).toBe(false);
    expect(isDepositExpired({ ...base, expiresAt: null }, today)).toBe(false);
    expect(isDepositExpired({ kind: K.Sena, status: D.Pendiente, expiresAt: '2026-11-01' }, today)).toBe(false);
  });

  it('el vencimiento por defecto suma los días de reserva', () => {
    expect(reservationExpiry(new Date('2026-11-28T15:00:00Z'), 7).toISOString().slice(0, 10)).toBe('2026-12-05');
  });
});
