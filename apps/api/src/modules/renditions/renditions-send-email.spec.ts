import { UnprocessableEntityException } from '@nestjs/common';
import { RenditionsService } from './renditions.service';

/**
 * DEF-24: enviar una rendición sin mail configurado (o sin email del locador)
 * la marcaba igual como enviada. Sin envío real no se guarda sentAt y la API
 * responde un error de dominio para que la pantalla no muestre "enviada".
 */
describe('RenditionsService.sendEmail sin envío real (DEF-24)', () => {
  const rendicion = { id: 'ren-1', ownerId: 'own-1', owner: { email: 'locador@ejemplo.test' } };

  function build(emailResult: unknown, owner = rendicion.owner) {
    const update = jest.fn();
    const prisma = {
      client: {
        tenant: { findFirst: jest.fn().mockResolvedValue({ name: 'Inmobiliaria de prueba' }) },
        ownerRendicion: { update },
      },
    };
    const tenantContext = { getTenantId: () => 'tenant-1' };
    const pdf = { generateRenditionPdf: jest.fn().mockResolvedValue(Buffer.from('pdf')) };
    const email = { sendRendicionEmail: jest.fn().mockResolvedValue(emailResult) };
    const service = new RenditionsService(prisma as any, tenantContext as any, pdf as any, email as any);
    jest.spyOn(service, 'findOne').mockResolvedValue({ ...rendicion, owner } as any);
    return { service, update, email };
  }

  it('CP-266: con el mail sin configurar responde EMAIL_NOT_CONFIGURED y no marca enviada', async () => {
    const { service, update } = build({ status: 'skipped' });
    const err = await service.sendEmail('ren-1').catch((e) => e);
    expect(err).toBeInstanceOf(UnprocessableEntityException);
    expect(err.getResponse()).toMatchObject({ error: 'EMAIL_NOT_CONFIGURED' });
    expect(update).not.toHaveBeenCalled();
  });

  it('CP-267: sin email del locador responde OWNER_EMAIL_MISSING y no intenta enviar', async () => {
    const { service, update, email } = build({ status: 'sent', id: 'x' }, { email: null } as any);
    const err = await service.sendEmail('ren-1').catch((e) => e);
    expect(err).toBeInstanceOf(UnprocessableEntityException);
    expect(err.getResponse()).toMatchObject({ error: 'OWNER_EMAIL_MISSING' });
    expect(email.sendRendicionEmail).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it('con envío real guarda sentAt y responde sent: true', async () => {
    const { service, update } = build({ status: 'sent', id: 'msg-1' });
    await expect(service.sendEmail('ren-1')).resolves.toMatchObject({ sent: true });
    expect(update).toHaveBeenCalledTimes(1);
  });
});
