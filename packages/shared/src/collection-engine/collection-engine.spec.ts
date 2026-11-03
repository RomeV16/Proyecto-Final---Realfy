import { CollectionActionKind as K, CollectionStage as S } from '../enums';
import { collectionCaseMachine } from '../state-machine/collection-case-state-machine';
import { DEFAULT_OPERATIONAL_DEFAULTS, OperationalDefaultsSchema, collectionPolicyOf } from '../schemas/operational-defaults.schema';
import {
  DEFAULT_COLLECTION_POLICY,
  addDays,
  daysOverdue,
  isActionDue,
  joinPeriods,
  planCollection,
  reminderKind,
  stageAfter,
  type CollectionCaseInput,
  type CollectionPolicy,
} from './index';

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const iso = (date: Date | null) => (date ? date.toISOString().slice(0, 10) : null);
const policy: CollectionPolicy = { ...DEFAULT_COLLECTION_POLICY, enabled: true };

/** Alquiler de marzo (vence el 10) y el de abril (vence el 10 del mes siguiente), los dos impagos. */
const base: CollectionCaseInput = {
  stage: S.Recordatorio,
  unpaidDueDates: [d('2026-03-10'), d('2026-04-10')],
  nextRentBilled: true,
  reminderDates: [],
  agreementUntil: null,
  letterPreparedOn: null,
  letterSentOn: null,
};

const plan = (input: Partial<CollectionCaseInput>, today: string, p: CollectionPolicy = policy) =>
  planCollection({ ...base, ...input }, d(today), p);

describe('política de cobranza escalonada (línea de tiempo de fábrica)', () => {
  it('a los 5 días de vencido toca el recordatorio amable (nivel 1)', () => {
    const p = plan({}, '2026-03-15');
    expect(p).toMatchObject({ status: 'Scheduled', action: K.Recordatorio, level: 1, manual: false });
    expect(iso(p.dueOn)).toBe('2026-03-15');
    expect(isActionDue(p, d('2026-03-15'))).toBe(true);
  });

  it('antes del día 5 todavía no toca: avisa para el 15', () => {
    const p = plan({}, '2026-03-12');
    expect(iso(p.dueOn)).toBe('2026-03-15');
    expect(isActionDue(p, d('2026-03-12'))).toBe(false);
  });

  it('a los 10 días toca el segundo, más firme (nivel 2)', () => {
    const p = plan({ reminderDates: [d('2026-03-15')] }, '2026-03-20');
    expect(p).toMatchObject({ action: K.RecordatorioFirme, level: 2 });
    expect(iso(p.dueOn)).toBe('2026-03-20');
  });

  it('a los 15 días toca el tercero (nivel 3) y es el último', () => {
    const p = plan({ reminderDates: [d('2026-03-15'), d('2026-03-20')] }, '2026-03-25');
    expect(p).toMatchObject({ action: K.RecordatorioFirme, level: 3 });
    expect(iso(p.dueOn)).toBe('2026-03-25');

    const after = plan({ reminderDates: [d('2026-03-15'), d('2026-03-20'), d('2026-03-25')] }, '2026-03-26');
    expect(after.level).toBeNull();
    expect(after.action).toBe(K.CartaDocumento);
  });

  it('al vencer el alquiler siguiente impago se prepara la carta documento (prejudicial)', () => {
    const reminders = [d('2026-03-15'), d('2026-03-20'), d('2026-03-25')];
    const wait = plan({ reminderDates: reminders }, '2026-04-10');
    expect(iso(wait.dueOn)).toBe('2026-04-11');
    expect(isActionDue(wait, d('2026-04-10'))).toBe(false);

    const due = plan({ reminderDates: reminders }, '2026-04-11');
    expect(due).toMatchObject({ status: 'Scheduled', action: K.CartaDocumento, manual: false });
    expect(isActionDue(due, d('2026-04-11'))).toBe(true);
    expect(stageAfter(K.CartaDocumento, S.Recordatorio)).toBe(S.Prejudicial);
  });

  it('con la carta preparada espera la confirmación del envío y no manda más recordatorios', () => {
    const p = plan({ stage: S.Prejudicial, letterPreparedOn: d('2026-04-11') }, '2026-04-20');
    expect(p).toMatchObject({ status: 'AwaitingLetterConfirmation', action: K.CartaDocumento, manual: true, dueOn: null });
  });

  it('con la carta enviada, a los 10 días corridos se sugiere derivar a un abogado (manual)', () => {
    const p = plan({ stage: S.Prejudicial, letterPreparedOn: d('2026-04-11'), letterSentOn: d('2026-04-13') }, '2026-04-20');
    expect(p).toMatchObject({ action: K.DerivacionAbogado, manual: true });
    expect(iso(p.dueOn)).toBe('2026-04-23');
    expect(stageAfter(K.DerivacionAbogado, S.Prejudicial)).toBe(S.Abogado);
  });

  it('el plazo de la carta es configurable', () => {
    const p = plan(
      { stage: S.Prejudicial, letterPreparedOn: d('2026-04-11'), letterSentOn: d('2026-04-13') },
      '2026-04-20',
      { ...policy, letterTermDays: 15 },
    );
    expect(iso(p.dueOn)).toBe('2026-04-28');
  });

  it('derivado a un abogado o en juicio: nada automático', () => {
    expect(plan({ stage: S.Abogado }, '2026-05-01')).toMatchObject({ status: 'Manual', action: null });
    expect(plan({ stage: S.Judicial }, '2026-05-01')).toMatchObject({ status: 'Manual', action: null });
  });
});

describe('pagos', () => {
  it('un pago total (sin deuda vencida) cierra el caso', () => {
    expect(plan({ unpaidDueDates: [] }, '2026-03-20').status).toBe('Close');
  });

  it('lo que todavía no venció no abre ni mantiene el caso', () => {
    expect(plan({ unpaidDueDates: [d('2026-04-10')] }, '2026-04-10').status).toBe('Close');
  });

  it('un pago parcial deja saldo: el caso sigue abierto con el mismo ritmo', () => {
    // El saldo restante mantiene el mismo vencimiento impago: la política ve lo mismo.
    const full = plan({}, '2026-03-20', policy);
    const partial = plan({ unpaidDueDates: [d('2026-03-10'), d('2026-04-10')] }, '2026-03-20', policy);
    expect(partial).toEqual(full);
    expect(partial.status).toBe('Scheduled');
  });

  it('si se paga el alquiler más viejo y queda el siguiente, el ritmo vuelve a empezar desde ese vencimiento', () => {
    const p = plan(
      { unpaidDueDates: [d('2026-04-10')], reminderDates: [d('2026-03-15'), d('2026-03-20'), d('2026-03-25')] },
      '2026-04-16',
    );
    expect(p).toMatchObject({ action: K.Recordatorio, level: 1 });
    expect(iso(p.dueOn)).toBe('2026-04-15');
  });

  it('un caso cerrado no tiene nada que hacer', () => {
    expect(plan({ stage: S.Cerrado }, '2026-03-20').status).toBe('Close');
  });
});

describe('acuerdo de pago', () => {
  it('pausa los avisos hasta su último día', () => {
    const p = plan({ agreementUntil: d('2026-03-30'), reminderDates: [d('2026-03-15')] }, '2026-03-22');
    expect(p).toMatchObject({ status: 'Paused', action: null });
    expect(iso(p.dueOn)).toBe('2026-03-31');
    expect(plan({ agreementUntil: d('2026-03-30') }, '2026-03-30').status).toBe('Paused');
  });

  it('si no se cumple, retoma al día siguiente sin juntar los recordatorios atrasados', () => {
    const reminders = [d('2026-03-15'), d('2026-03-20')];
    const p = plan({ agreementUntil: d('2026-03-30'), reminderDates: reminders }, '2026-03-31');
    expect(p).toMatchObject({ action: K.RecordatorioFirme, level: 3 });
    expect(iso(p.dueOn)).toBe('2026-03-31');
  });

  it('al retomar no se manda la carta antes del día siguiente al acuerdo', () => {
    const p = plan(
      { agreementUntil: d('2026-04-20'), reminderDates: [d('2026-03-15'), d('2026-03-20'), d('2026-03-25')] },
      '2026-04-21',
    );
    expect(p.action).toBe(K.CartaDocumento);
    expect(iso(p.dueOn)).toBe('2026-04-21');
  });
});

describe('casos de borde', () => {
  it('los recordatorios no salen más seguido que el ritmo configurado, aunque el proceso se atrase', () => {
    const p = plan({ reminderDates: [d('2026-03-28')] }, '2026-03-29');
    expect(iso(p.dueOn)).toBe('2026-04-02');
    expect(p.level).toBe(2);
  });

  it('una mora vieja pasa directo a la carta, sin un recordatorio amable de por medio', () => {
    const p = plan({ unpaidDueDates: [d('2026-01-10'), d('2026-02-10')], nextRentBilled: true }, '2026-03-01');
    expect(p.action).toBe(K.CartaDocumento);
    expect(iso(p.dueOn)).toBe('2026-02-11');
  });

  it('con un solo alquiler impago y sin siguiente facturado, el siguiente vence un mes después', () => {
    const p = plan({ unpaidDueDates: [d('2026-03-10')], nextRentBilled: false, reminderDates: [d('2026-03-15'), d('2026-03-20'), d('2026-03-25')] }, '2026-03-26');
    expect(p.action).toBe(K.CartaDocumento);
    expect(iso(p.dueOn)).toBe('2026-04-11');
  });

  it('con un solo alquiler impago y el siguiente ya pagado, no hay prejudicial: queda a la espera', () => {
    const p = plan(
      { unpaidDueDates: [d('2026-03-10')], nextRentBilled: true, reminderDates: [d('2026-03-15'), d('2026-03-20'), d('2026-03-25')] },
      '2026-05-01',
    );
    expect(p).toMatchObject({ status: 'Scheduled', action: null, dueOn: null });
    expect(isActionDue(p, d('2026-05-01'))).toBe(false);
  });

  it('con menos niveles configurados, deja de recordar antes', () => {
    const p = plan({ reminderDates: [d('2026-03-15')], unpaidDueDates: [d('2026-03-10'), d('2026-04-10')] }, '2026-03-20', {
      ...policy,
      maxLevel: 1,
    });
    expect(p.action).toBe(K.CartaDocumento);
  });

  it('el primer recordatorio y el ritmo salen de la configuración', () => {
    const p = plan({}, '2026-03-20', { ...policy, firstReminderDays: 7, everyDays: 3 });
    expect(iso(p.dueOn)).toBe('2026-03-17');
    const second = plan({ reminderDates: [d('2026-03-17')] }, '2026-03-20', { ...policy, firstReminderDays: 7, everyDays: 3 });
    expect(iso(second.dueOn)).toBe('2026-03-20');
  });

  it('el orden de los vencimientos no importa', () => {
    const a = plan({ unpaidDueDates: [d('2026-04-10'), d('2026-03-10')] }, '2026-03-15');
    const b = plan({ unpaidDueDates: [d('2026-03-10'), d('2026-04-10')] }, '2026-03-15');
    expect(a).toEqual(b);
  });
});

describe('ayudas', () => {
  it('días de mora', () => {
    expect(daysOverdue(d('2026-03-10'), d('2026-03-15'))).toBe(5);
    expect(daysOverdue(d('2026-03-10'), d('2026-03-10'))).toBe(0);
    expect(daysOverdue(d('2026-03-10'), d('2026-03-01'))).toBe(0);
  });

  it('suma días corridos sin mirar la hora', () => {
    expect(iso(addDays(d('2026-03-25'), 10))).toBe('2026-04-04');
  });

  it('el primer nivel es el recordatorio y los demás son firmes', () => {
    expect(reminderKind(1)).toBe(K.Recordatorio);
    expect(reminderKind(2)).toBe(K.RecordatorioFirme);
    expect(reminderKind(3)).toBe(K.RecordatorioFirme);
  });

  it('junta períodos para el mensaje', () => {
    expect(joinPeriods([])).toBe('');
    expect(joinPeriods(['03/2026'])).toBe('03/2026');
    expect(joinPeriods(['03/2026', '04/2026'])).toBe('03/2026 y 04/2026');
    expect(joinPeriods(['03/2026', '04/2026', '05/2026'])).toBe('03/2026, 04/2026 y 05/2026');
  });

  it('realizar una acción no cambia la etapa salvo la carta y la derivación', () => {
    expect(stageAfter(K.Recordatorio, S.Recordatorio)).toBe(S.Recordatorio);
    expect(stageAfter(K.CartaDocumento, S.Abogado)).toBe(S.Abogado);
  });
});

describe('política vigente de una inmobiliaria', () => {
  it('de fábrica está apagada y usa 5 días, cada 5, 3 niveles y 10 días corridos', () => {
    expect(collectionPolicyOf(DEFAULT_OPERATIONAL_DEFAULTS)).toEqual(DEFAULT_COLLECTION_POLICY);
    expect(DEFAULT_COLLECTION_POLICY).toMatchObject({ enabled: false, firstReminderDays: 5, everyDays: 5, maxLevel: 3, letterTermDays: 10 });
  });

  it('toma el ritmo de collectionCadence y lo propio de collections', () => {
    const defaults = OperationalDefaultsSchema.parse({
      collectionCadence: { firstReminderDays: 7, everyDays: 4 },
      collections: { enabled: true, maxLevel: 2, letterTermDays: 15 },
    });
    expect(collectionPolicyOf(defaults)).toEqual({ enabled: true, firstReminderDays: 7, everyDays: 4, maxLevel: 2, letterTermDays: 15 });
  });

  it('rechaza más de tres niveles o un plazo fuera de rango', () => {
    expect(OperationalDefaultsSchema.safeParse({ collections: { maxLevel: 4 } }).success).toBe(false);
    expect(OperationalDefaultsSchema.safeParse({ collections: { letterTermDays: 0 } }).success).toBe(false);
  });
});

describe('máquina de estados del caso', () => {
  const all = Object.values(S);
  const allowed: Array<[S, S[]]> = [
    [S.Recordatorio, [S.Prejudicial, S.Abogado, S.Cerrado]],
    [S.Prejudicial, [S.Abogado, S.Cerrado]],
    [S.Abogado, [S.Judicial, S.Cerrado]],
    [S.Judicial, [S.Cerrado]],
    [S.Cerrado, []],
  ];

  it('cubre exactamente las etapas del enum', () => {
    expect(allowed.map(([from]) => from).sort()).toEqual([...all].sort());
  });

  describe.each(allowed)('desde %s', (from, targets) => {
    it('permite los destinos declarados y rechaza los demás', () => {
      for (const to of all) expect(collectionCaseMachine.canTransition(from, to)).toBe(targets.includes(to));
    });
  });
});
