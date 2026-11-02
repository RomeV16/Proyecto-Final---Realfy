import {
  detectContractEssentials,
  detectDuplicateCbu,
  detectDuplicateCuit,
  detectDuplicateDni,
  detectDuplicateEmail,
  detectDuplicateName,
  detectDuplicatePhone,
  detectExpiredUndecided,
  detectLessorWithoutTaxId,
  detectLessorsSum,
  detectOwnerWithoutBankAccount,
  detectOwnershipSum,
  detectPropertyWithoutOwner,
  inForce,
  payeeIds,
  type ContractRow,
  type LessorRow,
  type OwnershipRow,
  type PersonRow,
} from './detectors';

const NOW = new Date('2026-06-15T12:00:00Z');
const d = (s: string) => new Date(`${s}T00:00:00Z`);

const person = (id: string, extra: Partial<PersonRow> = {}): PersonRow => ({
  id,
  firstName: `Nombre${id}`,
  lastName: `Apellido${id}`,
  email: null,
  phone: null,
  phone2: null,
  cuit: null,
  dni: null,
  personType: 'Fisica',
  payoutMethod: null,
  roles: [],
  ...extra,
});

const contract = (id: string, extra: Partial<ContractRow> = {}): ContractRow => ({
  id,
  status: 'Activo',
  propertyId: `p-${id}`,
  propertyTitle: `Unidad ${id}`,
  endDate: d('2027-01-01'),
  actualEndDate: null,
  closedAt: null,
  rentAmount: 1000,
  adjustmentType: 'IPC',
  customAdjustmentPct: null,
  tenantCount: 1,
  renewalCount: 0,
  hasClosureSummary: false,
  ...extra,
});

const lessor = (contractId: string, personId: string, payoutPct: number, extra: Partial<LessorRow> = {}): LessorRow => ({
  contractId,
  personId,
  payoutPct,
  validFrom: d('2025-01-01'),
  validTo: null,
  ...extra,
});

describe('duplicados de personas', () => {
  it('CUIT: agrupa por los dígitos aunque se escriba distinto', () => {
    const found = detectDuplicateCuit([
      person('a', { cuit: '20-12345678-6' }),
      person('b', { cuit: '20123456786' }),
      person('c', { cuit: '27-11111111-1' }),
      person('e', { cuit: null }),
    ]);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      check: 'duplicate-cuit',
      severity: 'error',
      entityType: 'Person',
      entityId: 'a',
      fields: ['cuit'],
      link: '/persons/a',
    });
    expect(found[0].members?.map((m) => m.id)).toEqual(['a', 'b']);
  });

  it('DNI: también cruza el DNI con el que lleva el CUIL de una persona física', () => {
    const found = detectDuplicateDni([
      person('a', { dni: '12.345.678' }),
      person('b', { cuit: '20-12345678-6' }),
      person('c', { cuit: '30-12345678-1', personType: 'Juridica' }),
      person('e', { dni: '99999999' }),
    ]);
    expect(found).toHaveLength(1);
    expect(found[0].members?.map((m) => m.id)).toEqual(['a', 'b']);
  });

  it('CBU: dos personas con la misma cuenta, no una persona con la cuenta repetida', () => {
    const persons = [person('a'), person('b'), person('c')];
    const cbu = '0170000040000000123456';
    const found = detectDuplicateCbu(
      [
        { personId: 'a', cbu, alias: null },
        { personId: 'a', cbu, alias: 'otra' },
        { personId: 'b', cbu: '0170 0000 4000 0000 1234 56', alias: null },
        { personId: 'c', cbu: '1', alias: null },
        { personId: 'zzz', cbu, alias: null },
      ],
      persons,
    );
    expect(found).toHaveLength(1);
    expect(found[0].members?.map((m) => m.id)).toEqual(['a', 'b']);
    const none = detectDuplicateCbu([{ personId: 'a', cbu, alias: null }, { personId: 'a', cbu, alias: null }], persons);
    expect(none).toEqual([]);
  });

  it('teléfono: compara las dos líneas y normaliza el prefijo argentino', () => {
    const found = detectDuplicatePhone([
      person('a', { phone: '+54 9 11 1234-5678' }),
      person('b', { phone2: '011 15 1234 5678' }),
      person('c', { phone: '1234' }),
    ]);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ check: 'duplicate-phone', severity: 'warning' });
  });

  it('correo: minúsculas y espacios', () => {
    const found = detectDuplicateEmail([
      person('a', { email: 'Ana@Ejemplo.com' }),
      person('b', { email: ' ana@ejemplo.com ' }),
      person('c', { email: 'otra@ejemplo.com' }),
    ]);
    expect(found).toHaveLength(1);
    expect(found[0].details).toEqual({ value: 'ana@ejemplo.com', count: 2 });
  });

  it('nombre: sin tildes ni orden, salvo que los documentos digan que son otra persona', () => {
    const found = detectDuplicateName([
      person('a', { firstName: 'Juan', lastName: 'Pérez' }),
      person('b', { firstName: 'JUAN', lastName: 'Perez', dni: '11111111' }),
      person('c', { firstName: 'Perez', lastName: 'Juan', dni: '22222222' }),
      person('e', { firstName: 'Ana', lastName: 'López', cuit: '27-11111111-1' }),
      person('f', { firstName: 'Ana', lastName: 'Lopez', cuit: '27-22222222-2' }),
      person('g', { firstName: 'Luis', lastName: 'Gómez', dni: '30000001' }),
      person('h', { firstName: 'Luis', lastName: 'Gomez', dni: '30000001' }),
    ]);
    const groups = found.map((f) => f.members?.map((m) => m.id));
    // b y c tienen DNI distintos: la persona sin documento (a) empareja con las dos.
    expect(groups).toContainEqual(['a', 'b', 'c']);
    expect(groups).toContainEqual(['g', 'h']);
    expect(groups.some((g) => g?.includes('e'))).toBe(false);
  });
});

describe('locadores y titularidades', () => {
  it('vigente: empieza y no terminó (el fin es exclusivo)', () => {
    expect(inForce(d('2026-01-01'), null, NOW)).toBe(true);
    expect(inForce(d('2026-07-01'), null, NOW)).toBe(false);
    expect(inForce(null, d('2026-06-16'), NOW)).toBe(true);
    expect(inForce(null, d('2026-06-01'), NOW)).toBe(false);
  });

  it('locadores que no suman 100 en contratos activos, con tolerancia de redondeo', () => {
    const contracts = [
      contract('ok'),
      contract('tercios'),
      contract('corto'),
      contract('sin'),
      contract('vencido', { status: 'Vencido' }),
      contract('historico'),
    ];
    const lessors = [
      lessor('ok', 'a', 60),
      lessor('ok', 'b', 40),
      lessor('tercios', 'a', 33.3333),
      lessor('tercios', 'b', 33.3333),
      lessor('tercios', 'c', 33.3334),
      lessor('corto', 'a', 60),
      lessor('corto', 'b', 30),
      lessor('vencido', 'a', 10),
      lessor('historico', 'a', 100),
      lessor('historico', 'b', 50, { validTo: d('2026-01-01') }),
      lessor('historico', 'b', 50, { validFrom: d('2027-01-01') }),
    ];
    const found = detectLessorsSum(contracts, lessors, NOW);
    expect(found.map((f) => f.entityId).sort()).toEqual(['corto', 'sin']);
    expect(found.find((f) => f.entityId === 'corto')?.details).toEqual({ sum: 90, lessors: 2 });
    expect(found.find((f) => f.entityId === 'sin')?.details).toEqual({ sum: 0, lessors: 0 });
    expect(found[0]).toMatchObject({ check: 'lessors-sum', severity: 'error', link: expect.stringMatching(/^\/contracts\//) });
  });

  const properties = ['p1', 'p2', 'p3', 'p4', 'p5'].map((id) => ({ id, title: `Propiedad ${id}` }));
  const own = (propertyId: string, personId: string, sharePct: number | null, extra: Partial<OwnershipRow> = {}): OwnershipRow => ({
    propertyId,
    personId,
    sharePct,
    since: null,
    until: null,
    ...extra,
  });

  it('titularidad: partes que no suman 100, partes vacías con varios titulares; un titular sin parte es válido', () => {
    const ownerships = [
      own('p1', 'a', 50),
      own('p1', 'b', 50),
      own('p2', 'a', 50),
      own('p2', 'b', 30),
      own('p3', 'a', null),
      own('p4', 'a', null),
      own('p4', 'b', 50),
      own('p4', 'c', 50, { until: d('2026-01-01') }),
    ];
    const found = detectOwnershipSum(properties, ownerships, NOW);
    expect(found.map((f) => f.entityId).sort()).toEqual(['p2', 'p4']);
    expect(found.find((f) => f.entityId === 'p2')?.details).toEqual({ sum: 80, owners: 2, withoutShare: 0 });
    expect(found.find((f) => f.entityId === 'p4')?.details).toMatchObject({ withoutShare: 1 });
  });

  it('propiedad sin titular vigente', () => {
    const found = detectPropertyWithoutOwner(
      properties,
      [own('p1', 'a', null), own('p2', 'a', null, { until: d('2026-01-01') }), own('p3', 'a', null, { since: d('2027-01-01') })],
      NOW,
    );
    expect(found.map((f) => f.entityId).sort()).toEqual(['p2', 'p3', 'p4', 'p5']);
  });

  it('quiénes cobran: locadores y titulares vigentes', () => {
    const ids = payeeIds(
      [lessor('c', 'a', 100), lessor('c', 'old', 100, { validTo: d('2026-01-01') })],
      [own('p', 'b', null), own('p', 'older', null, { until: d('2026-01-01') })],
      NOW,
    );
    expect([...ids].sort()).toEqual(['a', 'b']);
  });

  it('cobra por transferencia sin cuenta con CBU o alias', () => {
    const persons = [
      person('a', { payoutMethod: 'Transferencia' }),
      person('b', { payoutMethod: 'Transferencia' }),
      person('c', { payoutMethod: 'Efectivo' }),
      person('e', { payoutMethod: 'Transferencia' }),
      person('f', { payoutMethod: 'Transferencia' }),
    ];
    const found = detectOwnerWithoutBankAccount(
      persons,
      [
        { personId: 'b', cbu: '0170000040000000123456', alias: null },
        { personId: 'e', cbu: ' ', alias: ' ' },
        { personId: 'f', cbu: null, alias: 'mi.alias' },
      ],
      new Set(['a', 'b', 'c', 'e', 'f']),
    );
    expect(found.map((f) => f.entityId)).toEqual(['a', 'e']);
    expect(found[0].fields).toEqual(['bankAccounts', 'payoutMethod']);
    expect(detectOwnerWithoutBankAccount(persons, [], new Set())).toEqual([]);
  });

  it('locador sin CUIT ni DNI', () => {
    const found = detectLessorWithoutTaxId(
      [person('a'), person('b', { cuit: '20-12345678-6' }), person('c', { dni: '12345678' }), person('e', { cuit: '123' })],
      new Set(['a', 'b', 'c', 'e']),
    );
    expect(found.map((f) => f.entityId)).toEqual(['a', 'e']);
    expect(found[0].fields).toEqual(['cuit', 'dni']);
  });
});

describe('contratos', () => {
  it('vencidos sin decisión: pasaron el fin efectivo y no hay renovación ni cierre', () => {
    const found = detectExpiredUndecided(
      [
        contract('sin', { status: 'Vencido', endDate: d('2026-03-01') }),
        contract('renovado', { status: 'Vencido', endDate: d('2026-03-01'), renewalCount: 1 }),
        contract('cerrado', { status: 'Vencido', endDate: d('2026-03-01'), hasClosureSummary: true }),
        contract('fecha', { status: 'Vencido', endDate: d('2026-03-01'), closedAt: d('2026-03-10') }),
        contract('prorroga', { status: 'Vencido', endDate: d('2026-03-01'), actualEndDate: d('2026-12-01') }),
        contract('activo', { status: 'Activo', endDate: d('2026-03-01') }),
        contract('antes', { status: 'Vencido', endDate: d('2026-01-01') }),
      ],
      NOW,
    );
    expect(found.map((f) => f.entityId)).toEqual(['antes', 'sin']);
    expect(found[0].details).toEqual({ effectiveEnd: '2026-01-01' });
  });

  it('el fin efectivo manda sobre el fin pactado', () => {
    const found = detectExpiredUndecided(
      [contract('c', { status: 'Vencido', endDate: d('2026-01-01'), actualEndDate: d('2026-02-01') })],
      NOW,
    );
    expect(found[0].details).toEqual({ effectiveEnd: '2026-02-01' });
  });

  it('activos sin lo esencial: inquilino, alquiler, porcentaje de ajuste', () => {
    const found = detectContractEssentials([
      contract('bien'),
      contract('sin-inquilino', { tenantCount: 0 }),
      contract('sin-alquiler', { rentAmount: 0 }),
      contract('sin-pct', { adjustmentType: 'FixedPercent', customAdjustmentPct: null }),
      contract('con-pct', { adjustmentType: 'Custom', customAdjustmentPct: 5 }),
      contract('todo', { tenantCount: 0, rentAmount: 0, adjustmentType: 'Custom' }),
      contract('vencido', { status: 'Vencido', tenantCount: 0 }),
    ]);
    expect(Object.fromEntries(found.map((f) => [f.entityId, f.fields]))).toEqual({
      'sin-alquiler': ['rentAmount'],
      'sin-inquilino': ['tenant'],
      'sin-pct': ['adjustment'],
      todo: ['tenant', 'rentAmount', 'adjustment'],
    });
  });
});
