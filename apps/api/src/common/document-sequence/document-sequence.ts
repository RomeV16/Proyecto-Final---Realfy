import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';

/** Lo único que hace falta de una transacción de Prisma: SQL crudo. */
export interface SequenceTx {
  $queryRaw<T = unknown>(query: Prisma.Sql): Promise<T>;
}

/**
 * Próximo número de una serie de documentos de la inmobiliaria (recibos de
 * liquidación, recibos de cobro). Un solo INSERT ... ON CONFLICT incrementa el
 * contador, así que dos pedidos simultáneos no repiten número; dentro de la
 * transacción del documento, un rollback no gasta el número. El SQL crudo no
 * pasa por la extensión de inmobiliaria: filtra por tenantId a mano (ADR-0006).
 */
export async function nextDocumentNumber(tx: SequenceTx, tenantId: string, series: string): Promise<number> {
  const rows = await tx.$queryRaw<{ next: number }[]>(
    Prisma.sql`INSERT INTO document_sequences ("id", "tenantId", "series", "next")
      VALUES (${randomUUID()}, ${tenantId}, ${series}, 2)
      ON CONFLICT ("tenantId", "series")
      DO UPDATE SET "next" = document_sequences."next" + 1
      RETURNING "next"`,
  );
  return rows[0].next - 1;
}
