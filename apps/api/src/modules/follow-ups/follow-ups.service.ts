import { ConflictException, Injectable, Logger } from '@nestjs/common';
import {
  FollowUpFilterSchema,
  FollowUpKind,
  FollowUpOutcome,
  FollowUpStatus,
  ToggleFollowUpTaskSchema,
  UpdateFollowUpSchema,
  checklistFor,
  daysUntil,
  expirationLight,
  personName,
  propertyLabel,
  todayInAR,
} from '@realfy/shared';
import type { ExpirationThresholds } from '@realfy/shared';
import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContextService } from '../../common/tenant/tenant-context.service';
import { parseOrThrow } from '../../common/validation/zod';
import { OperationalDefaultsService } from '../tenants/operational-defaults.service';
import { getParty } from '../contracts/contract-parties';
import { getEffectiveEndDate } from '../contracts/contract-terms';
import { auditJson, badRequest, conflict, dayStart, notFound } from '../cash/cash.errors';
import { effectiveEndWhere, lightRange } from './follow-up-light';

const DAY_MS = 86_400_000;

const FOLLOW_UP_INCLUDE = {
  tasks: { orderBy: { position: 'asc' } },
  contract: {
    select: {
      id: true,
      status: true,
      endDate: true,
      actualEndDate: true,
      property: true,
      persons: { include: { person: { select: { id: true, firstName: true, lastName: true } } } },
    },
  },
} as const;

/** Fecha sin hora (medianoche UTC) del fin efectivo. */
const dateOnly = (date: Date) => new Date(date.toISOString().slice(0, 10) + 'T00:00:00.000Z');

/**
 * Seguimiento del fin de los contratos (D11): lo abre el proceso diario cuando
 * el fin efectivo entra en la ventana amarilla, lo trabaja el equipo con su
 * checklist y se cierra con un resultado. El semáforo se calcula del fin
 * efectivo del contrato; no se guarda.
 */
@Injectable()
export class FollowUpsService {
  private readonly logger = new Logger(FollowUpsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly defaults: OperationalDefaultsService,
    private readonly audit: AuditService,
  ) {}

  private async thresholds(): Promise<ExpirationThresholds> {
    const d = await this.defaults.get(this.tenantContext.getTenantId()!);
    return d.expiryLight;
  }

  // ─── Lectura ────────────────────────────────────────

  async list(query: unknown, today: Date = todayInAR()) {
    const filters = parseOrThrow(FollowUpFilterSchema, query, 'Invalid filter parameters');
    const t = await this.thresholds();
    const where: Record<string, any> = {};
    if (filters.kind) where.kind = filters.kind;
    if (filters.status) where.status = filters.status;
    if (filters.assigneeId) where.assigneeId = filters.assigneeId;
    if (filters.contractId) where.contractId = filters.contractId;
    if (filters.light) {
      // El color solo tiene sentido en un seguimiento abierto.
      where.status = FollowUpStatus.Abierto;
      where.contract = effectiveEndWhere(lightRange(filters.light, today, t));
    }

    const [rows, total] = await Promise.all([
      this.prisma.client.contractFollowUp.findMany({
        where,
        include: FOLLOW_UP_INCLUDE,
        orderBy: [{ dueDate: 'asc' }, { createdAt: 'asc' }],
        skip: (filters.page - 1) * filters.limit,
        take: filters.limit,
      }),
      this.prisma.client.contractFollowUp.count({ where }),
    ]);
    return {
      items: rows.map((r: any) => this.present(r, today, t)),
      total,
      page: filters.page,
      limit: filters.limit,
      totalPages: Math.ceil(total / filters.limit),
    };
  }

  async get(id: string, today: Date = todayInAR()) {
    const row = await this.require(id);
    return this.present(row, today, await this.thresholds());
  }

  private async require(id: string): Promise<any> {
    const row = await this.prisma.client.contractFollowUp.findFirst({ where: { id }, include: FOLLOW_UP_INCLUDE });
    if (!row) throw notFound('FOLLOW_UP_NOT_FOUND', 'Follow-up not found');
    return row;
  }

  private present(row: any, today: Date, t: ExpirationThresholds) {
    const contract = row.contract;
    const effectiveEnd = getEffectiveEndDate(contract);
    const open = row.status === FollowUpStatus.Abierto;
    const tenantParty = getParty<any>(contract, 'Inquilino');
    const done = row.tasks.filter((x: any) => x.done).length;
    return {
      id: row.id,
      contractId: row.contractId,
      kind: row.kind,
      status: row.status,
      outcome: row.outcome,
      dueDate: row.dueDate,
      assigneeId: row.assigneeId,
      notes: row.notes,
      closedAt: row.closedAt,
      effectiveEnd,
      signedEnd: contract.endDate,
      daysLeft: daysUntil(effectiveEnd, today),
      light: open ? expirationLight(effectiveEnd, today, t) : null,
      property: propertyLabel(contract.property) || null,
      tenantName: tenantParty?.person ? personName(tenantParty.person) : null,
      tasks: row.tasks.map((x: any) => ({
        id: x.id,
        code: x.code,
        label: x.label,
        done: x.done,
        doneAt: x.doneAt,
        doneById: x.doneById,
        dueDate: x.dueDate,
      })),
      progress: { done, total: row.tasks.length },
    };
  }

  // ─── Alta automática ────────────────────────────────

  /**
   * Abre el seguimiento de cada contrato de alquiler activo cuyo fin efectivo
   * ya está a `yellowDays` días o menos (incluidos los ya vencidos). Nace como
   * renovación con resultado pendiente; cambiarlo a devolución es una acción
   * del equipo. Idempotente: un contrato con seguimiento (de cualquier tipo)
   * para ese fin efectivo se omite, y la clave única lo respalda.
   * Debe correr dentro del contexto de una inmobiliaria. Devuelve cuántos abrió.
   */
  async openDueFollowUps(today: Date): Promise<number> {
    const tenantId = this.tenantContext.getTenantId()!;
    const t = await this.thresholds();
    const horizon = new Date(today.getTime() + t.yellowDays * DAY_MS);

    const contracts = await this.prisma.client.contract.findMany({
      where: {
        status: 'Activo',
        isActive: true,
        contractType: { in: ['Alquiler', 'AlquilerTemporario'] },
        ...effectiveEndWhere({ lte: horizon }),
      },
      select: { id: true, endDate: true, actualEndDate: true },
    });
    if (contracts.length === 0) return 0;

    const existing = await this.prisma.client.contractFollowUp.findMany({
      where: { contractId: { in: contracts.map((c: any) => c.id) } },
      select: { contractId: true, dueDate: true },
    });
    const seen = new Set(existing.map((e: any) => `${e.contractId}|${e.dueDate.toISOString().slice(0, 10)}`));

    let created = 0;
    for (const contract of contracts) {
      const dueDate = dateOnly(getEffectiveEndDate(contract));
      if (seen.has(`${contract.id}|${dueDate.toISOString().slice(0, 10)}`)) continue;
      try {
        await this.prisma.client.contractFollowUp.create({
          data: {
            tenantId,
            contractId: contract.id,
            kind: FollowUpKind.Renovacion,
            dueDate,
            tasks: { create: this.taskRows(tenantId, FollowUpKind.Renovacion) },
          },
        });
        created++;
      } catch (err) {
        // Otro proceso lo abrió entre la lectura y el alta: la clave única lo frena.
        if ((err as { code?: string }).code !== 'P2002') throw err;
      }
    }
    if (created > 0) this.logger.log(`Seguimientos abiertos: tenant=${tenantId} cantidad=${created}`);
    return created;
  }

  private taskRows(tenantId: string, kind: FollowUpKind, done: ReadonlySet<string> = new Set()) {
    return checklistFor(kind).map((task, position) => ({
      tenantId,
      code: task.code,
      label: task.label,
      position,
      done: done.has(task.code),
      doneAt: done.has(task.code) ? new Date() : null,
    }));
  }

  // ─── Cambios ────────────────────────────────────────

  async update(id: string, data: unknown) {
    const input = parseOrThrow(UpdateFollowUpSchema, data, 'Invalid follow-up data');
    const current = await this.require(id);
    const tenantId = this.tenantContext.getTenantId()!;

    if (input.assigneeId) {
      const user = await this.prisma.client.user.findFirst({
        where: { id: input.assigneeId, isActive: true },
        select: { id: true },
      });
      if (!user) throw badRequest('ASSIGNEE_NOT_FOUND', 'The assignee is not an active user of the agency');
    }
    const switchingKind = input.kind !== undefined && input.kind !== current.kind;
    if (switchingKind && current.status === FollowUpStatus.Cerrado) {
      throw conflict('FOLLOW_UP_CLOSED', 'A closed follow-up cannot change its kind');
    }

    const data2: Record<string, unknown> = {};
    if (input.assigneeId !== undefined) data2.assigneeId = input.assigneeId;
    if (input.notes !== undefined) data2.notes = input.notes;
    if (switchingKind) data2.kind = input.kind;
    if (input.outcome !== undefined) {
      const closing = input.outcome !== FollowUpOutcome.Pendiente;
      data2.outcome = input.outcome;
      data2.status = closing ? FollowUpStatus.Cerrado : FollowUpStatus.Abierto;
      data2.closedAt = closing ? new Date() : null;
    }

    try {
      await this.prisma.client.$transaction(async (tx: any) => {
        if (switchingKind) {
          // El checklist cambia con el tipo; lo ya hecho en pasos que se repiten se conserva.
          const kept = new Set<string>(current.tasks.filter((x: any) => x.done).map((x: any) => x.code));
          await tx.followUpTask.deleteMany({ where: { followUpId: id } });
          await tx.followUpTask.createMany({
            data: this.taskRows(tenantId, input.kind!, kept).map((row) => ({ ...row, followUpId: id })),
          });
        }
        await tx.contractFollowUp.update({ where: { id }, data: data2 });
        await this.audit.record(tx, {
          action: 'UPDATE',
          entity: 'ContractFollowUp',
          entityId: id,
          before: auditJson({
            kind: current.kind,
            outcome: current.outcome,
            status: current.status,
            assigneeId: current.assigneeId,
          }),
          after: auditJson(data2),
          metadata: { operation: 'follow-up-update', contractId: current.contractId },
        });
      });
    } catch (err) {
      if ((err as { code?: string }).code === 'P2002') {
        throw new ConflictException({
          error: 'FOLLOW_UP_EXISTS',
          message: 'The contract already has a follow-up of that kind for this end date',
        });
      }
      throw err;
    }
    return this.get(id);
  }

  async toggleTask(id: string, taskId: string, data: unknown) {
    const input = parseOrThrow(ToggleFollowUpTaskSchema, data, 'Invalid task data');
    const followUp = await this.require(id);
    if (followUp.status === FollowUpStatus.Cerrado) {
      throw conflict('FOLLOW_UP_CLOSED', 'The checklist of a closed follow-up cannot change');
    }
    const task = followUp.tasks.find((x: any) => x.id === taskId);
    if (!task) throw notFound('FOLLOW_UP_TASK_NOT_FOUND', 'Task not found');

    await this.prisma.client.followUpTask.update({
      where: { id: taskId },
      data: {
        done: input.done,
        doneAt: input.done ? new Date() : null,
        doneById: input.done ? (this.tenantContext.getUserId() ?? null) : null,
        ...(input.dueDate !== undefined && { dueDate: input.dueDate ? dayStart(input.dueDate) : null }),
      },
    });
    return this.get(id);
  }

  /**
   * Cierra los seguimientos abiertos de un contrato con un resultado. Lo usan
   * la prórroga de palabra y la renovación, dentro de su transacción.
   */
  async closeOpenForContract(tx: any, contractId: string, outcome: FollowUpOutcome): Promise<number> {
    const result = await tx.contractFollowUp.updateMany({
      where: { contractId, status: FollowUpStatus.Abierto },
      data: { status: FollowUpStatus.Cerrado, outcome, closedAt: new Date() },
    });
    return result.count;
  }
}
