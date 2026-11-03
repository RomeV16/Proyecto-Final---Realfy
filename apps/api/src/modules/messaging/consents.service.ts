import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  ConsentSource,
  ConsentStatus,
  MessageChannel,
  SetConsentSchema,
  normalizeAddress,
  type ChannelConsent,
  type PersonConsents,
} from '@realfy/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContextService } from '../../common/tenant/tenant-context.service';
import { parseOrThrow } from '../../common/validation/zod';
import type { Db } from '../../common/messaging/consent-policy';

const CHANNELS = [MessageChannel.Email, MessageChannel.WhatsApp];
const NEWEST: { at?: 'desc'; id?: 'desc' }[] = [{ at: 'desc' }, { id: 'desc' }];

/**
 * Consentimiento por canal (Ley 25.326, ADR-0013). Es un historial: cada
 * cambio agrega un registro con quién, cuándo, de dónde vino y a qué
 * dirección aplicaba; vale el último. Así queda la prueba de cuándo una
 * persona dio el alta o pidió la baja.
 */
@Injectable()
export class ConsentsService {
  private readonly logger = new Logger(ConsentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  async forPerson(personId: string): Promise<PersonConsents> {
    const person = await this.requirePerson(personId);
    const rows: any[] = await this.prisma.client.contactConsent.findMany({
      where: { personId },
      orderBy: NEWEST,
      take: 200,
    });
    const channels: ChannelConsent[] = CHANNELS.map((channel) => {
      const history = rows.filter((r: any) => r.channel === channel);
      const last = history[0];
      return {
        channel,
        status: last?.status ?? null,
        source: last?.source ?? null,
        at: last ? last.at.toISOString() : null,
        note: last?.note ?? null,
        address: normalizeAddress(channel, channel === MessageChannel.Email ? person.email : person.phone),
        history: history.map((r: any) => ({
          status: r.status,
          source: r.source,
          at: r.at.toISOString(),
          note: r.note ?? null,
          address: r.address ?? null,
        })),
      };
    });
    return { personId, channels };
  }

  /** Registra un alta o una baja cargada por el personal (lo que la persona dijo, por escrito o en persona). */
  async set(personId: string, data: unknown): Promise<PersonConsents> {
    const input = parseOrThrow(SetConsentSchema, data, 'Invalid consent');
    const person = await this.requirePerson(personId);
    const address = normalizeAddress(input.channel, input.channel === MessageChannel.Email ? person.email : person.phone);
    // El pedido queda además en la auditoría por el interceptor (PUT /persons/:id/consents).
    await this.prisma.client.contactConsent.create({
      data: {
        tenantId: this.tenantContext.getTenantId()!,
        personId,
        channel: input.channel,
        address,
        status: input.status,
        source: ConsentSource.Manual,
        note: input.note ?? null,
        recordedByUserId: this.tenantContext.getUserId() ?? null,
      },
    });
    this.logger.log(`Consent recorded: personId=${personId} channel=${input.channel} status=${input.status}`);
    return this.forPerson(personId);
  }

  /**
   * Baja pedida desde el canal (respuesta BAJA/STOP o queja de spam). Se guarda
   * para la dirección y, si la dirección es de personas conocidas, para cada
   * una. Corre sin contexto HTTP: la inmobiliaria viene explícita.
   */
  async recordOptOut(
    db: Db,
    q: { tenantId: string; channel: MessageChannel; address: string; source: ConsentSource; personIds: string[] },
  ): Promise<void> {
    const targets: (string | null)[] = q.personIds.length ? q.personIds : [null];
    await db.contactConsent.createMany({
      data: targets.map((personId) => ({
        tenantId: q.tenantId,
        personId,
        channel: q.channel,
        address: q.address,
        status: ConsentStatus.OptOut,
        source: q.source,
        note: q.source === ConsentSource.Complaint ? 'Queja de spam informada por el proveedor' : 'Pidió la baja respondiendo al mensaje',
      })),
    });
    this.logger.log(
      `Opt-out recorded: tenantId=${q.tenantId} channel=${q.channel} persons=${q.personIds.length} source=${q.source}`,
    );
  }

  private async requirePerson(personId: string) {
    const person = await this.prisma.client.person.findFirst({
      where: { id: personId },
      select: { id: true, email: true, phone: true },
    });
    if (!person) {
      throw new NotFoundException({ error: 'PERSON_NOT_FOUND', message: 'Person not found' });
    }
    return person;
  }
}
