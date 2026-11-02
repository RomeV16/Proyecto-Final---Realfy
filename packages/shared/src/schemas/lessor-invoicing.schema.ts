import { z } from 'zod';

/** Cola de emisión por cuenta del locador: pendientes y fallidas, por locador. */
export const LessorInvoiceJobFilterSchema = z.object({
  status: z.enum(['Pendiente', 'Emitido', 'Fallido']).optional(),
  personId: z.string().uuid().optional(),
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().positive().max(100).optional().default(20),
});

/** Datos propios del emisor de un locador; el CUIT, el nombre y la condición salen de la persona. */
export const LessorIssuerCreateSchema = z.object({
  ingresosBrutos: z.string().trim().max(40).optional(),
  activityStartDate: z.string().trim().max(10).optional(),
  businessAddress: z.string().trim().max(200).optional(),
});
