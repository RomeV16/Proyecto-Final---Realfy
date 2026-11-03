import { describe, expect, it } from 'vitest';
import { daysUntil, expiryState, holderLabel, orderedTransitions, partiesOf, personName, placeOf } from './sales';

const today = new Date(2026, 10, 10, 15, 0, 0);
const reserva = (over: Record<string, unknown> = {}) => ({ kind: 'Reserva', status: 'Pendiente', expiresAt: '2026-11-20T00:00:00.000Z', expired: false, ...over });

describe('lib/sales', () => {
  it('personName y holderLabel componen el nombre con lo que haya', () => {
    expect(personName({ firstName: 'Ana', lastName: 'Prueba' })).toBe('Ana Prueba');
    expect(personName(null)).toBe('');
    const base = { holderPerson: null, holderUser: null, holderName: null };
    expect(holderLabel({ ...base, holderPerson: { id: '1', firstName: 'Luis', lastName: 'Locador' } })).toBe('Luis Locador');
    expect(holderLabel({ ...base, holderUser: { id: '2', firstName: 'Vera', lastName: 'Vendedora' } })).toBe('Vera Vendedora');
    expect(holderLabel({ ...base, holderName: 'Escribana Gómez' })).toBe('Escribana Gómez');
    expect(holderLabel(base)).toBe('');
  });

  it('placeOf agrega la calle si hay', () => {
    expect(placeOf({ title: 'Depto', street: 'Calle Ficticia', number: '100' })).toBe('Depto · Calle Ficticia 100');
    expect(placeOf({ title: 'Depto' })).toBe('Depto');
  });

  it('partiesOf muestra la parte solo cuando el lado tiene más de una persona', () => {
    const p = (role: string, id: string, name: string, sharePct: string) => ({ id, role, personId: id, sharePct, person: { id, firstName: name, lastName: 'X' } });
    expect(partiesOf({ parties: [p('Vendedor', '1', 'Ana', '100'), p('Comprador', '2', 'Beto', '100')] }, 'Vendedor')).toBe('Ana X');
    expect(partiesOf({ parties: [p('Vendedor', '1', 'Ana', '60'), p('Vendedor', '3', 'Cris', '40')] }, 'Vendedor')).toBe('Ana X (60 %), Cris X (40 %)');
    expect(partiesOf({ parties: [] }, 'Comprador')).toBe('');
  });

  it('daysUntil cuenta los días hasta una fecha, o null sin fecha', () => {
    expect(daysUntil('2026-11-10', today)).toBe(0);
    expect(daysUntil('2026-11-13T00:00:00.000Z', today)).toBe(3);
    expect(daysUntil('2026-11-08', today)).toBe(-2);
    expect(daysUntil(null, today)).toBeNull();
  });

  it('expiryState: vencida, vence hoy, pronto, lejos y sin aviso', () => {
    expect(expiryState(reserva({ expiresAt: '2026-11-20' }), today)).toBe('ok');
    expect(expiryState(reserva({ expiresAt: '2026-11-12' }), today)).toBe('soon');
    expect(expiryState(reserva({ expiresAt: '2026-11-10' }), today)).toBe('today');
    expect(expiryState(reserva({ expiresAt: '2026-11-09' }), today)).toBe('expired');
    expect(expiryState(reserva({ expired: true }), today)).toBe('expired');
    expect(expiryState(reserva({ status: 'Vencida' }), today)).toBe('expired');
    expect(expiryState(reserva({ status: 'Devuelta' }), today)).toBe('none');
    expect(expiryState(reserva({ kind: 'Sena' }), today)).toBe('none');
    expect(expiryState(reserva({ expiresAt: null }), today)).toBe('none');
  });

  it('orderedTransitions ofrece las etapas en el orden del recorrido', () => {
    expect(orderedTransitions(['Cancelada', 'Publicada', 'SenaRecibida'])).toEqual(['SenaRecibida', 'Publicada', 'Cancelada']);
    expect(orderedTransitions([])).toEqual([]);
  });
});
