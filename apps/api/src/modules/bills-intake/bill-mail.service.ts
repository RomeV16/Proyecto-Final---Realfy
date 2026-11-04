import { Injectable, NotFoundException } from '@nestjs/common';
import { BillChannel, BillMailIngestSchema, normalizeEmail } from '@realfy/shared';
import { ClsService } from 'nestjs-cls';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContextService } from '../../common/tenant/tenant-context.service';
import { parseOrThrow } from '../../common/validation/zod';
import { BillIntakeService, type IntakeResult } from './bill-intake.service';
import { isPdf } from './pdf-text.service';

const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

/** La inmobiliaria de una dirección de destino `boletas+<slug>@dominio`. */
export function tenantSlugFromAddress(address: string | undefined): string | null {
  const match = /^boletas\+([a-z0-9-]+)@/i.exec(address?.trim() ?? '');
  return match ? match[1].toLowerCase() : null;
}

/**
 * Ingreso de boletas por mail (POST /bills-intake/email-ingest): el servicio de recepción
 * reenvía el mail, ya firmado y con los adjuntos en base64. Cada PDF entra al circuito con
 * canal `Mail`; sin PDF queda un documento para revisión ("sin adjunto"). La inmobiliaria
 * sale de `tenantSlug` o de la dirección `boletas+<slug>@...`. El remitente automático (`no-reply`,
 * marca `automatic`) se acepta: es como mandan la factura los proveedores.
 */
@Injectable()
export class BillMailService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cls: ClsService,
    private readonly tenantContext: TenantContextService,
    private readonly intake: BillIntakeService,
  ) {}

  async ingest(body: unknown): Promise<{ received: true; ignored?: 'invalid-sender'; documents: IntakeResult['document'][] }> {
    const input = parseOrThrow(BillMailIngestSchema, body, 'Invalid inbound bill email');
    const slug = input.tenantSlug ?? tenantSlugFromAddress(input.to);
    const tenant = slug
      ? await this.prisma.baseClient.tenant.findFirst({ where: { slug, isActive: true }, select: { id: true } })
      : null;
    if (!tenant) throw new NotFoundException({ error: 'TENANT_NOT_FOUND', message: 'Unknown tenant' });

    const from = normalizeEmail(input.from);
    if (!from) return { received: true, ignored: 'invalid-sender', documents: [] };
    // A diferencia de la bandeja de consultas, acá no se descartan los remitentes automáticos
    // (no-reply, Auto-Submitted, Precedence): los proveedores mandan la factura digital desde
    // ellos. Solo se procesan PDF y lo que el lector no reconoce va a revisión.

    const attachments = input.attachments
      .map((a) => ({ fileName: a.filename, content: Buffer.from(a.contentBase64, 'base64') }))
      .filter((a) => a.content.length > 0 && a.content.length <= MAX_ATTACHMENT_BYTES && isPdf(a.content));

    return this.cls.run({ ifNested: 'override' }, async () => {
      this.tenantContext.setTenantId(tenant.id);
      const documents: IntakeResult['document'][] = [];
      if (attachments.length === 0) {
        const { document } = await this.intake.intakeWithoutAttachment({
          channel: BillChannel.Mail,
          origin: from,
          messageKey: `${tenant.id}:${input.messageId}`,
          subject: input.subject ?? null,
        });
        documents.push(document);
      }
      for (const attachment of attachments) {
        const { document } = await this.intake.intake(
          { channel: BillChannel.Mail, origin: from, fileName: attachment.fileName, content: attachment.content },
          input.receivedAt ?? new Date(),
        );
        documents.push(document);
      }
      return { received: true as const, documents };
    });
  }
}
