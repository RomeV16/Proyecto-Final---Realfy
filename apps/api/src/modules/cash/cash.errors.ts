import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { SettlementError } from '@realfy/shared';

export const notFound = (error: string, message: string) => new NotFoundException({ error, message });
export const badRequest = (error: string, message: string) => new BadRequestException({ error, message });
export const conflict = (error: string, message: string) => new ConflictException({ error, message });

/** Un error del motor de reparto pasa a 400 con su código de dominio; los demás se relanzan. */
export function rethrowSettlement(error: unknown): never {
  if (error instanceof SettlementError) throw badRequest(error.code, error.message);
  throw error;
}

/** "YYYY-MM-DD" -> medianoche UTC de ese día. */
export const dayStart = (value: string): Date => new Date(`${value.slice(0, 10)}T00:00:00.000Z`);

/** Copia apta para la auditoría: importes (Decimal) y fechas pasan a texto. */
export const auditJson = <T>(value: T): unknown => JSON.parse(JSON.stringify(value ?? null));
