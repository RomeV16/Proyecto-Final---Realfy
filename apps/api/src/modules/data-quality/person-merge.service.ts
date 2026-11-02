import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  MergePersonsSchema,
  type MergePersonsPlan,
  type MergePersonsPlanItem,
  type MergePersonsResult,
} from '@realfy/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { parseOrThrow } from '../../common/validation/zod';
import { normalizeCbu } from './normalize';
import { MERGE_FILL_FIELDS, MERGE_RULES, type MergeRule } from './person-merge.config';

/** Lo que el plan decidió hacer con las filas de una regla. */
interface RuleOutcome {
  rule: MergeRule;
  moveIds: string[];
  discardIds: string[];
  conflicts: number;
}

const SNAPSHOT_FIELDS = ['id', 'firstName', 'lastName', 'isActive', 'cuit', 'externalRef', 'notes', ...MERGE_FILL_FIELDS];

const pick = (row: Record<string, unknown>) =>
  Object.fromEntries(SNAPSHOT_FIELDS.filter((k) => k in row).map((k) => [k, row[k]]));

/**
 * Une personas repetidas: todo lo que apunta a las personas unidas pasa a la
 * conservada y las unidas quedan dadas de baja (`isActive = false`, sin CUIT,
 * con una nota que dice con quién se unieron). No se borra ninguna fila de
 * persona: la baja lógica es la que ya usa el resto de la aplicación y deja la
 * referencia (`externalRef`) de la carga original.
 *
 * Todo ocurre en una sola transacción. Si dos personas tienen una fila que no
 * se puede combinar (por ejemplo, las dos con perfil de proveedor), la unión
 * se rechaza con 409 y no cambia nada.
 */
@Injectable()
export class PersonMergeService {
  private readonly logger = new Logger(PersonMergeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Qué se movería y qué se descartaría, sin cambiar nada. */
  async preview(body: unknown): Promise<MergePersonsPlan> {
    const input = parseOrThrow(MergePersonsSchema, body, 'Invalid merge request');
    await this.loadPeople(this.prisma.client, input.keepId, input.mergeIds);
    const { plan } = await this.plan(this.prisma.client, input.keepId, input.mergeIds);
    return plan;
  }

  async merge(body: unknown): Promise<MergePersonsResult> {
    const input = parseOrThrow(MergePersonsSchema, body, 'Invalid merge request');
    const { keepId, mergeIds } = input;

    const result = await this.prisma.client.$transaction(async (tx: any) => {
      const { keep, merged } = await this.loadPeople(tx, keepId, mergeIds);
      const { plan, outcomes, accountDupes } = await this.plan(tx, keepId, mergeIds);

      await this.mergeBankAccounts(tx, keepId, mergeIds, accountDupes);
      for (const o of outcomes) await this.apply(tx, o, keepId, mergeIds);

      const fill: Record<string, unknown> = {};
      for (const field of MERGE_FILL_FIELDS) {
        if (keep[field] != null && keep[field] !== '') continue;
        const donor = merged.find((m: any) => m[field] != null && m[field] !== '');
        if (donor) fill[field] = donor[field];
      }

      // El CUIT es único por inmobiliaria: se libera en la unida antes de pasarlo.
      const note = `Unida con ${keep.lastName}, ${keep.firstName} (${keepId}) el ${new Date().toISOString().slice(0, 10)}`;
      for (const m of merged) {
        await tx.person.update({
          where: { id: m.id },
          data: { isActive: false, cuit: null, notes: [m.notes, note].filter(Boolean).join('\n') },
        });
      }
      const after = Object.keys(fill).length
        ? await tx.person.update({ where: { id: keepId }, data: fill })
        : keep;

      await this.audit.record(tx, {
        action: 'UPDATE',
        entity: 'Person',
        entityId: keepId,
        before: pick(keep),
        after: pick(after),
        metadata: { operation: 'persons.merge', mergedIds: mergeIds, items: plan.items, discarded: plan.discarded },
      });
      for (const m of merged) {
        await this.audit.record(tx, {
          action: 'UPDATE',
          entity: 'Person',
          entityId: m.id,
          before: pick(m),
          after: { isActive: false, cuit: null, mergedInto: keepId },
          metadata: { operation: 'persons.merge' },
        });
      }
      return { ...plan, merged: merged.length };
    });

    this.logger.log(`Persons merged: keep=${keepId} merged=${mergeIds.join(',')}`);
    return result;
  }

  private async loadPeople(client: any, keepId: string, mergeIds: string[]) {
    const people = await client.person.findMany({ where: { id: { in: [keepId, ...mergeIds] } } });
    const byId = new Map<string, any>(people.map((p: any) => [p.id, p]));
    if (people.length !== mergeIds.length + 1) {
      throw new NotFoundException({ error: 'PERSON_NOT_FOUND', message: 'Person not found' });
    }
    const inactive = people.filter((p: any) => !p.isActive);
    if (inactive.length) {
      throw new ConflictException({
        error: 'MERGE_CONFLICT',
        message: 'Inactive persons cannot be merged',
        conflicts: inactive.map((p: any) => ({ entity: 'Person', field: 'isActive', count: 1 })),
      });
    }
    return { keep: byId.get(keepId), merged: mergeIds.map((id) => byId.get(id)) };
  }

  /** Decide qué hace cada regla con las filas de las personas unidas. Rechaza lo que no se puede combinar. */
  private async plan(client: any, keepId: string, mergeIds: string[]) {
    const outcomes: RuleOutcome[] = [];
    for (const rule of MERGE_RULES) outcomes.push(await this.planRule(client, rule, keepId, mergeIds));

    const conflicts: MergePersonsPlanItem[] = outcomes
      .filter((o) => o.conflicts > 0)
      .map((o) => ({ entity: o.rule.delegate, field: o.rule.field, count: o.conflicts }));

    // Un poder entre las personas que se unen quedaría de una persona hacia sí misma.
    const both = { in: [keepId, ...mergeIds] };
    const selfPowers = await client.powerOfAttorney.count({ where: { principalId: both, agentId: both } });
    if (selfPowers > 0) conflicts.push({ entity: 'powerOfAttorney', field: 'principalId', count: selfPowers });

    if (conflicts.length) {
      throw new ConflictException({
        error: 'MERGE_CONFLICT',
        message: 'The persons have records that cannot be combined',
        conflicts,
      });
    }

    const accountDupes = await this.duplicateAccounts(client, keepId, mergeIds);
    const accountDiscards = accountDupes.map((d) => d.id);
    const items: MergePersonsPlanItem[] = [];
    const discarded: MergePersonsPlanItem[] = [];
    for (const o of outcomes) {
      const moved = o.moveIds.length;
      const dropped = o.discardIds.length;
      if (moved) items.push({ entity: o.rule.delegate, field: o.rule.field, count: moved });
      if (dropped) discarded.push({ entity: o.rule.delegate, field: o.rule.field, count: dropped });
    }
    if (accountDiscards.length) {
      const idx = items.findIndex((i) => i.entity === 'personBankAccount');
      if (idx >= 0) {
        items[idx].count -= accountDiscards.length;
        if (items[idx].count === 0) items.splice(idx, 1);
      }
      discarded.push({ entity: 'personBankAccount', field: 'cbu', count: accountDiscards.length });
    }
    return { plan: { keepId, mergeIds, items, discarded } satisfies MergePersonsPlan, outcomes, accountDupes };
  }

  private async planRule(client: any, rule: MergeRule, keepId: string, mergeIds: string[]): Promise<RuleOutcome> {
    const delegate = client[rule.delegate];
    if (rule.kind === 'repoint') {
      const rows = await delegate.findMany({ where: { [rule.field]: { in: mergeIds } }, select: { id: true } });
      return { rule, moveIds: rows.map((r: any) => r.id), discardIds: [], conflicts: 0 };
    }

    const select = Object.fromEntries([['id', true], [rule.field, true], ...rule.scope.map((s) => [s, true])]);
    const rows: any[] = await delegate.findMany({ where: { [rule.field]: { in: [keepId, ...mergeIds] } }, select });
    const keyOf = (r: any) => rule.scope.map((s) => String(r[s])).join('|');
    const seen = new Set(rows.filter((r) => r[rule.field] === keepId).map(keyOf));

    const outcome: RuleOutcome = { rule, moveIds: [], discardIds: [], conflicts: 0 };
    for (const mergeId of mergeIds) {
      for (const r of rows.filter((x) => x[rule.field] === mergeId)) {
        const key = keyOf(r);
        if (!seen.has(key)) {
          seen.add(key);
          outcome.moveIds.push(r.id);
        } else if (rule.kind === 'dedupe') {
          outcome.discardIds.push(r.id);
        } else {
          outcome.conflicts++;
        }
      }
    }
    return outcome;
  }

  private async apply(tx: any, o: RuleOutcome, keepId: string, mergeIds: string[]) {
    const { rule } = o;
    if (rule.kind === 'repoint') {
      await tx[rule.delegate].updateMany({
        where: { [rule.field]: { in: mergeIds } },
        data: { [rule.field]: keepId },
      });
      return;
    }
    if (o.discardIds.length) await tx[rule.delegate].deleteMany({ where: { id: { in: o.discardIds } } });
    if (o.moveIds.length) {
      await tx[rule.delegate].updateMany({ where: { id: { in: o.moveIds } }, data: { [rule.field]: keepId } });
    }
  }

  /** Cuentas de las personas unidas con el mismo CBU que una de la conservada (o entre sí). */
  private async duplicateAccounts(client: any, keepId: string, mergeIds: string[]) {
    const accounts: any[] = await client.personBankAccount.findMany({
      where: { personId: { in: [keepId, ...mergeIds] } },
      orderBy: { createdAt: 'asc' },
    });
    const kept = new Map<string, string>();
    const dupes: { id: string; keepAccountId: string }[] = [];
    const ordered = [...accounts.filter((a) => a.personId === keepId), ...accounts.filter((a) => a.personId !== keepId)];
    for (const a of ordered) {
      const cbu = normalizeCbu(a.cbu);
      if (!cbu) continue;
      const key = `${a.currency}|${cbu}`;
      const first = kept.get(key);
      if (first && a.personId !== keepId) dupes.push({ id: a.id, keepAccountId: first });
      else if (!first) kept.set(key, a.id);
    }
    return dupes;
  }

  /**
   * Las cuentas repetidas se descartan y los locadores que cobraban en ellas
   * pasan a la cuenta que queda; en el resto, la cuenta predeterminada de la
   * conservada sigue siéndolo.
   */
  private async mergeBankAccounts(
    tx: any,
    keepId: string,
    mergeIds: string[],
    dupes: { id: string; keepAccountId: string }[],
  ) {
    for (const d of dupes) {
      await tx.contractLessor.updateMany({ where: { bankAccountId: d.id }, data: { bankAccountId: d.keepAccountId } });
    }
    if (dupes.length) await tx.personBankAccount.deleteMany({ where: { id: { in: dupes.map((d) => d.id) } } });

    const keepDefaults: any[] = await tx.personBankAccount.findMany({
      where: { personId: keepId, isDefault: true },
      select: { currency: true },
    });
    for (const { currency } of keepDefaults) {
      await tx.personBankAccount.updateMany({
        where: { personId: { in: mergeIds }, currency, isDefault: true },
        data: { isDefault: false },
      });
    }
  }
}
