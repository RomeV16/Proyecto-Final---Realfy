import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  CollectionActionKind,
  CollectionActionStatus,
  CollectionStage,
  Money,
  collectionPolicyOf,
  formatDateAR,
  isActionDue,
  joinPeriods,
  personName,
  propertyLabel,
  stageAfter,
  todayInAR,
  type CollectionPlan,
  type CollectionPolicy,
  type LetterFields,
  type MessageTemplateKey,
} from '@realfy/shared';
import { OutboxService } from '../../common/messaging/outbox.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { TenantCron } from '../../common/scheduler/tenant-cron';
import { notifyManagement } from '../messaging/notify-management';
import { NotificationsService } from '../notifications/notifications.service';
import { getParties } from '../contracts/contract-parties';
import { OperationalDefaultsService } from '../tenants/operational-defaults.service';
import { CollectionDebtService, formatDebtAmount, overduePeriods, type ContractDebt } from './collection-debt.service';
import { CollectionStateService, type CaseRow } from './collection-state.service';

type Db = any;

export interface CollectionRunSummary {
  tenantsProcessed: number;
  opened: number;
  remindersQueued: number;
  lettersPrepared: number;
  closed: number;
  failed: number;
}

const EMPTY: CollectionRunSummary = {
  tenantsProcessed: 0,
  opened: 0,
  remindersQueued: 0,
  lettersPrepared: 0,
  closed: 0,
  failed: 0,
};

/** Aviso para la gerencia que se manda después de confirmar la transacción del caso. */
interface PendingNotice {
  title: string;
  message: string;
  caseId: string;
}

/** Plantilla del recordatorio según el nivel de tono (1 a 3). */
export function reminderTemplate(level: number): MessageTemplateKey {
  return `payment_reminder_${Math.min(Math.max(level, 1), 3)}` as MessageTemplateKey;
}

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Proceso diario de cobranza escalonada (ADR-0013): abre un caso por contrato con
 * alquileres vencidos impagos, manda por la bandeja de salida el recordatorio que
 * toca (con el importe exacto de hoy), prepara la carta documento como borrador y
 * cierra los casos pagados. Nunca manda nada legal: la carta se confirma a mano y
 * derivar a un abogado es una decisión de una persona.
 */
@Injectable()
export class CollectionsProcessService {
  private readonly logger = new Logger(CollectionsProcessService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantCron: TenantCron,
    private readonly defaults: OperationalDefaultsService,
    private readonly debt: CollectionDebtService,
    private readonly state: CollectionStateService,
    private readonly outbox: OutboxService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Una vuelta para todas las inmobiliarias activas. */
  async runAll(today: Date = todayInAR()): Promise<CollectionRunSummary> {
    const total = { ...EMPTY };
    const summary = await this.tenantCron.forEachActiveTenant('collections-daily', async (tenantId) => {
      const result = await this.runTenant(tenantId, today);
      total.opened += result.opened;
      total.remindersQueued += result.remindersQueued;
      total.lettersPrepared += result.lettersPrepared;
      total.closed += result.closed;
      total.failed += result.failed;
    });
    total.tenantsProcessed = summary.ok;
    total.failed += summary.failed;
    this.logger.log(
      `Collections completed: tenants=${total.tenantsProcessed} opened=${total.opened} reminders=${total.remindersQueued} letters=${total.lettersPrepared} closed=${total.closed} failed=${total.failed}`,
    );
    return total;
  }

  /** Una vuelta de una inmobiliaria; debe correr dentro de su contexto (`TenantCron` o un pedido). */
  async runTenant(tenantId: string, today: Date = todayInAR()): Promise<CollectionRunSummary> {
    const result = { ...EMPTY, tenantsProcessed: 1 };
    const policy = collectionPolicyOf(await this.defaults.get(tenantId));
    if (!policy.enabled) return result;

    const db = this.prisma.client as Db;
    const contractIds = await this.debt.overdueContractIds(db, today);
    const open: CaseRow[] = await db.collectionCase.findMany({
      where: { stage: { not: CollectionStage.Cerrado } },
      orderBy: [{ overdueSince: 'asc' }, { id: 'asc' }],
    });
    const covered = new Set(open.map((c) => c.contractId));
    for (const contractId of contractIds) {
      if (covered.has(contractId)) continue;
      try {
        const row = await this.open(db, tenantId, contractId, today);
        if (row) {
          open.push(row);
          result.opened++;
        }
      } catch (err) {
        result.failed++;
        this.logger.error(`Case open failed: tenantId=${tenantId} contractId=${contractId}: ${(err as Error).message}`, (err as Error).stack);
      }
    }

    for (const row of open) {
      try {
        const outcome = await this.processCase(tenantId, row.id, today, policy);
        result.remindersQueued += outcome.reminders;
        result.lettersPrepared += outcome.letters;
        result.closed += outcome.closed ? 1 : 0;
        for (const notice of outcome.notices) {
          await notifyManagement(this.prisma, this.notifications, tenantId, {
            type: 'SystemAlert',
            entityType: 'CollectionCase',
            entityId: notice.caseId,
            title: notice.title,
            message: notice.message,
          });
        }
      } catch (err) {
        result.failed++;
        this.logger.error(`Case failed: tenantId=${tenantId} caseId=${row.id}: ${(err as Error).message}`, (err as Error).stack);
      }
    }
    return result;
  }

  /** Abre el caso de un contrato con mora; null si ya no tiene deuda vencida. */
  private async open(db: Db, tenantId: string, contractId: string, today: Date): Promise<CaseRow | null> {
    const debt = await this.debt.loadDebt(db, tenantId, contractId, today);
    if (debt.overdue.length === 0 || !debt.oldestDue) return null;
    const row: CaseRow = await db.collectionCase.create({
      data: {
        tenantId,
        contractId,
        currency: debt.currency,
        overdueSince: debt.oldestDue,
        lastBalance: debt.balance.toFixed(2),
        openedOn: today,
      },
    });
    await this.audit.record(db, {
      action: 'CREATE',
      entity: 'CollectionCase',
      entityId: row.id,
      tenantId,
      userId: null,
      after: { contractId, overdueSince: isoDay(debt.oldestDue), balance: debt.balance.toFixed(2) },
      metadata: { source: 'cron' },
    });
    return row;
  }

  /** Un caso en su propia transacción, con la fila bloqueada para que una acción manual no se pise. */
  private async processCase(tenantId: string, caseId: string, today: Date, policy: CollectionPolicy) {
    const outcome = { reminders: 0, letters: 0, closed: false, notices: [] as PendingNotice[] };
    await (this.prisma.client as Db).$transaction(async (tx: Db) => {
      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM collection_cases WHERE id = ${caseId} AND "tenantId" = ${tenantId} FOR UPDATE`,
      );
      const current: CaseRow | null = await tx.collectionCase.findFirst({ where: { id: caseId } });
      if (!current || current.stage === CollectionStage.Cerrado) return;

      // Saldo vencido de la última pasada, antes de que `refresh` lo reemplace por el de hoy.
      const before = current.lastBalance ? new Money(current.lastBalance.toString()) : null;
      const { debt, plan, row } = await this.state.refresh(tx, current, today, policy);

      // Un saldo menor que el de la última pasada es un pago parcial: queda en la línea de tiempo.
      if (before && debt.balance.gt(0) && debt.balance.lt(before)) {
        await tx.collectionAction.create({
          data: {
            tenantId,
            caseId,
            kind: CollectionActionKind.Pago,
            amount: before.minus(debt.balance).toFixed(2),
            onDate: today,
            note: `Pago parcial. Saldo vencido: ${formatDebtAmount(debt.currency, debt.balance)}`,
          },
        });
      }

      if (plan.status === 'Close') {
        const paid = before && before.gt(0) ? before : undefined;
        await this.state.close(tx, row, {
          reason: 'Pagado',
          kind: CollectionActionKind.Pago,
          note: 'Sin saldo vencido: caso cerrado',
          amount: paid,
          userId: null,
        });
        outcome.closed = true;
        return;
      }

      if (!isActionDue(plan, today) || plan.manual) {
        this.announceManual(plan, today, row, outcome.notices);
        return;
      }

      if (plan.action === CollectionActionKind.CartaDocumento) {
        await this.prepareLetter(tx, row, debt, policy, today);
        outcome.letters++;
        outcome.notices.push({
          caseId,
          title: 'Carta documento preparada',
          message: `Se preparó el borrador de la carta documento de un caso de cobranza. Revisalo, mandalo en papel y confirmá el envío.`,
        });
      } else if (plan.action) {
        const sent = await this.sendReminders(tx, row, debt, plan.level ?? 1, today);
        outcome.reminders += sent.queued;
        if (sent.unreachable) {
          outcome.notices.push({
            caseId,
            title: 'Cobranza sin medio de contacto',
            message: 'No se pudo mandar el recordatorio de pago: el inquilino no tiene un mail o un WhatsApp con alta registrada.',
          });
        }
      }
      // Lo hecho cambia lo que toca después.
      await this.state.refresh(tx, await tx.collectionCase.findFirst({ where: { id: caseId } }), today, policy);
    });
    return outcome;
  }

  /** Un aviso más a la gerencia el día en que vence el plazo de la carta: sugiere derivar, nunca deriva. */
  private announceManual(plan: CollectionPlan, today: Date, row: CaseRow, notices: PendingNotice[]): void {
    if (plan.action === CollectionActionKind.DerivacionAbogado && plan.dueOn && isoDay(plan.dueOn) === isoDay(today)) {
      notices.push({
        caseId: row.id,
        title: 'Venció el plazo de la carta documento',
        message: 'Venció el plazo de la carta documento de un caso de cobranza. Evaluá derivarlo a un abogado.',
      });
    }
  }

  /** Recordatorio de nivel `level` a cada inquilino con un canal disponible. */
  private async sendReminders(db: Db, row: CaseRow, debt: ContractDebt, level: number, today: Date) {
    const contract = await this.loadContract(db, row.contractId);
    const agency = await this.agencyName(db, row.tenantId);
    const templateKey = reminderTemplate(level);
    const kind = level <= 1 ? CollectionActionKind.Recordatorio : CollectionActionKind.RecordatorioFirme;
    const parties = getParties<any>(contract, 'Inquilino').map((p) => p.person).filter(Boolean);
    const vars = (name: string) => ({
      name,
      amount: formatDebtAmount(debt.currency, debt.payoff),
      periods: joinPeriods(overduePeriods(debt)),
      agency,
    });

    let queued = 0;
    for (const person of parties) {
      const channel = await this.outbox.pickChannel(db, person, templateKey);
      if (!channel) continue;
      const key = `${kind}:${level}:${isoDay(today)}:${person.id}`;
      if (await db.collectionAction.findFirst({ where: { caseId: row.id, key }, select: { id: true } })) continue;
      const message = await this.outbox.enqueue(db, {
        channel,
        templateKey,
        vars: vars(personName(person) || 'cliente'),
        personId: person.id,
        relatedType: 'CollectionCase',
        relatedId: row.id,
        idempotencyKey: `CollectionReminder:${row.id}:${level}:${isoDay(today)}:${person.id}:${channel}`,
        createdByUserId: null,
      });
      await db.collectionAction.create({
        data: {
          tenantId: row.tenantId,
          caseId: row.id,
          kind,
          level,
          channel,
          outboxMessageId: message.id,
          amount: debt.payoff.toFixed(2),
          onDate: today,
          key,
          data: { recipient: personName(person) },
        },
      });
      queued++;
    }
    if (queued > 0) return { queued, unreachable: false };

    // Nadie a quien avisar: queda registrado (y avanza el ritmo) en lugar de reintentar todos los días.
    await db.collectionAction.create({
      data: {
        tenantId: row.tenantId,
        caseId: row.id,
        kind,
        level,
        amount: debt.payoff.toFixed(2),
        onDate: today,
        key: `${kind}:${level}:${isoDay(today)}:none`,
        note: 'Sin medio de contacto: no se pudo avisar por mail ni por WhatsApp',
      },
    });
    return { queued: 0, unreachable: true };
  }

  /** Borrador de la carta documento: se guarda para revisar, editar e imprimir; no sale de acá. */
  private async prepareLetter(db: Db, row: CaseRow, debt: ContractDebt, policy: CollectionPolicy, today: Date) {
    const contract = await this.loadContract(db, row.contractId);
    const tenants = getParties<any>(contract, 'Inquilino').map((p) => p.person).filter(Boolean);
    const fields: LetterFields = {
      recipientName: tenants.map((p) => personName(p)).join(' y ') || '',
      recipientAddress: tenants.find((p) => p.address)?.address ?? '',
      propertyAddress: propertyLabel(contract.property),
      periods: joinPeriods(overduePeriods(debt)),
      amount: formatDebtAmount(debt.currency, debt.payoff),
      issuedOn: formatDateAR(today),
      termDays: policy.letterTermDays,
      extraText: '',
    };
    await db.collectionAction.create({
      data: {
        tenantId: row.tenantId,
        caseId: row.id,
        kind: CollectionActionKind.CartaDocumento,
        status: CollectionActionStatus.Preparada,
        amount: debt.payoff.toFixed(2),
        onDate: null,
        key: `${CollectionActionKind.CartaDocumento}:${isoDay(today)}`,
        note: 'Borrador preparado. No se envía solo: hay que revisarlo, mandarlo en papel y confirmar el envío.',
        data: fields as unknown as Prisma.InputJsonValue,
      },
    });
    await db.collectionCase.update({
      where: { id: row.id },
      data: {
        stage: stageAfter(CollectionActionKind.CartaDocumento, row.stage),
        letterPreparedOn: today,
      },
    });
    await this.audit.record(db, {
      action: 'UPDATE',
      entity: 'CollectionCase',
      entityId: row.id,
      tenantId: row.tenantId,
      userId: null,
      after: { stage: CollectionStage.Prejudicial, letterPreparedOn: isoDay(today), amount: debt.payoff.toFixed(2) },
      metadata: { source: 'cron', operation: 'collection-letter-prepared' },
    });
  }

  private async loadContract(db: Db, contractId: string) {
    return db.contract.findFirst({
      where: { id: contractId },
      select: {
        id: true,
        property: { select: { title: true, street: true, number: true, floor: true, apartment: true } },
        persons: {
          where: { role: 'Inquilino' },
          select: {
            role: true,
            person: { select: { id: true, firstName: true, lastName: true, email: true, phone: true, address: true } },
          },
        },
      },
    });
  }

  private async agencyName(db: Db, tenantId: string): Promise<string> {
    const tenant = await db.tenant.findFirst({ where: { id: tenantId }, select: { name: true } });
    return tenant?.name ?? 'Inmobiliaria';
  }
}

