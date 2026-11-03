import { Injectable } from '@nestjs/common';
import {
  CollectionActionKind,
  CollectionActionStatus,
  CollectionStage,
  Money,
  collectionCaseMachine,
  planCollection,
  type CollectionCaseInput,
  type CollectionPlan,
  type CollectionPolicy,
} from '@realfy/shared';
import { AuditService } from '../../common/audit/audit.service';
import { assertTransition } from '../../common/errors/assert-transition';
import { CollectionDebtService, type ContractDebt } from './collection-debt.service';

type Db = any;

/** Fila de un caso tal como la leen los servicios de cobranza. */
export interface CaseRow {
  id: string;
  tenantId: string;
  contractId: string;
  stage: CollectionStage;
  currency: string;
  overdueSince: Date;
  lastBalance: { toString(): string } | null;
  nextActionKind: CollectionActionKind | null;
  nextActionAt: Date | null;
  pausedUntil: Date | null;
  letterPreparedOn: Date | null;
  letterSentOn: Date | null;
  assigneeId: string | null;
  closeReason: string | null;
  openedOn: Date;
  closedAt: Date | null;
  createdAt: Date;
}

const REMINDER_KINDS: readonly CollectionActionKind[] = [
  CollectionActionKind.Recordatorio,
  CollectionActionKind.RecordatorioFirme,
];

export interface CaseRefresh {
  debt: ContractDebt;
  plan: CollectionPlan;
  row: CaseRow;
}

/**
 * Estado de un caso de cobranza: arma la entrada de la política con la deuda y
 * la línea de tiempo, guarda la próxima acción y cierra casos. Lo comparten el
 * proceso diario y las acciones manuales.
 */
@Injectable()
export class CollectionStateService {
  constructor(
    private readonly debt: CollectionDebtService,
    private readonly audit: AuditService,
  ) {}

  /** Días (sin repetir) de los recordatorios ya hechos. */
  async reminderDates(db: Db, caseId: string): Promise<Date[]> {
    const rows: Array<{ onDate: Date | null; at: Date }> = await db.collectionAction.findMany({
      where: { caseId, kind: { in: [...REMINDER_KINDS] }, status: CollectionActionStatus.Realizada },
      select: { onDate: true, at: true },
    });
    const days = new Map<number, Date>();
    for (const r of rows) {
      const day = r.onDate ?? new Date(Date.UTC(r.at.getUTCFullYear(), r.at.getUTCMonth(), r.at.getUTCDate()));
      days.set(day.getTime(), day);
    }
    return [...days.values()].sort((a, b) => a.getTime() - b.getTime());
  }

  input(row: CaseRow, debt: ContractDebt, reminderDates: Date[]): CollectionCaseInput {
    return {
      stage: row.stage,
      unpaidDueDates: debt.unpaid.map((l) => l.dueDate),
      nextRentBilled: debt.nextRentBilled,
      reminderDates,
      agreementUntil: row.pausedUntil,
      letterPreparedOn: row.letterPreparedOn,
      letterSentOn: row.letterSentOn,
    };
  }

  /**
   * Vuelve a calcular qué toca y lo guarda en el caso (próxima acción, vencimiento
   * más viejo, saldo vencido). No cierra el caso aunque ya no haya deuda: quien
   * llama decide (`plan.status === 'Close'`).
   */
  async refresh(db: Db, row: CaseRow, today: Date, policy: CollectionPolicy): Promise<CaseRefresh> {
    const debt = await this.debt.loadDebt(db, row.tenantId, row.contractId, today);
    const reminders = await this.reminderDates(db, row.id);
    const plan = planCollection(this.input(row, debt, reminders), today, policy);
    const updated: CaseRow = await db.collectionCase.update({
      where: { id: row.id },
      data: {
        nextActionKind: plan.action,
        nextActionAt: plan.dueOn,
        overdueSince: debt.oldestDue ?? row.overdueSince,
        lastBalance: debt.balance.toFixed(2),
        currency: debt.overdue.length > 0 ? (debt.currency as any) : (row.currency as any),
      },
    });
    return { debt, plan, row: updated };
  }

  /** Cierra el caso: valida la etapa, deja el motivo y un renglón en la línea de tiempo. */
  async close(
    db: Db,
    row: CaseRow,
    input: { reason: 'Pagado' | 'Manual'; kind: CollectionActionKind; note: string; amount?: Money; userId: string | null },
  ): Promise<CaseRow> {
    assertTransition(collectionCaseMachine, row.stage, CollectionStage.Cerrado);
    await db.collectionAction.create({
      data: {
        tenantId: row.tenantId,
        caseId: row.id,
        kind: input.kind,
        status: CollectionActionStatus.Realizada,
        amount: input.amount ? input.amount.toFixed(2) : null,
        note: input.note,
        createdByUserId: input.userId,
      },
    });
    const closed: CaseRow = await db.collectionCase.update({
      where: { id: row.id },
      data: {
        stage: CollectionStage.Cerrado,
        closedAt: new Date(),
        closeReason: input.reason,
        nextActionKind: null,
        nextActionAt: null,
        pausedUntil: null,
      },
    });
    await this.audit.record(db, {
      action: 'UPDATE',
      entity: 'CollectionCase',
      entityId: row.id,
      tenantId: row.tenantId,
      ...(input.userId ? {} : { userId: null }),
      after: { stage: CollectionStage.Cerrado, reason: input.reason },
      metadata: { operation: 'collection-case-close' },
    });
    return closed;
  }
}
