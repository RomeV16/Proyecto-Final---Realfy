import { ConsentStatus, MESSAGE_TEMPLATES, MessageChannel, requiresOptIn, type MessageTemplateKey } from '@realfy/shared';

/** Cliente de Prisma (con la extensión de inmobiliaria) o una transacción. */
export type Db = any;

export interface ConsentRow {
  id: string;
  status: ConsentStatus;
  at: Date;
}

/** Por qué no se puede mandar un mensaje según el consentimiento. */
export type ConsentBlock = 'OPTED_OUT' | 'NO_OPT_IN';

const NEWEST = [{ at: 'desc' }, { id: 'desc' }];

/**
 * Último registro de consentimiento que aplica a un mensaje: el más reciente
 * entre los de la persona y los de la dirección en ese canal (una baja por
 * WhatsApp de un número llega por la dirección aunque no sepamos de quién es).
 */
export async function latestConsent(
  db: Db,
  q: { channel: MessageChannel; personId?: string | null; address?: string | null },
): Promise<ConsentRow | null> {
  const select = { id: true, status: true, at: true };
  const [byPerson, byAddress] = await Promise.all([
    q.personId
      ? db.contactConsent.findFirst({ where: { personId: q.personId, channel: q.channel }, orderBy: NEWEST, select })
      : null,
    q.address
      ? db.contactConsent.findFirst({ where: { address: q.address, channel: q.channel }, orderBy: NEWEST, select })
      : null,
  ]);
  const rows = [byPerson, byAddress].filter(Boolean) as ConsentRow[];
  return rows.reduce<ConsentRow | null>((a, b) => (a && a.at.getTime() >= b.at.getTime() ? a : b), null);
}

/**
 * Regla de consentimiento (Ley 25.326, ADR-0013): una baja se respeta siempre;
 * WhatsApp a la cartera necesita un alta explícita; el mail a la cartera sale
 * mientras no haya baja (va a la dirección que la persona dio para su
 * contrato). Los mensajes al personal no dependen del consentimiento.
 */
export function consentBlock(
  latest: Pick<ConsentRow, 'status'> | null,
  channel: MessageChannel,
  templateKey: string,
): ConsentBlock | null {
  if (MESSAGE_TEMPLATES[templateKey as MessageTemplateKey]?.audience === 'staff') return null;
  if (latest?.status === ConsentStatus.OptOut) return 'OPTED_OUT';
  if (requiresOptIn(channel, templateKey) && latest?.status !== ConsentStatus.OptIn) return 'NO_OPT_IN';
  return null;
}
