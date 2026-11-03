import 'reflect-metadata';
import { createHmac } from 'node:crypto';
import { ADMIN_ONLY, INBOX_ROLES, MANAGEMENT_ROLES } from '../../common/auth/role-groups';
import { ROLES_KEY } from '../../common/auth/roles.decorator';
import { IS_PUBLIC_KEY } from '../../common/auth/public.decorator';
import { InboxController, InboxEmailController } from './inbox.controller';

const ID = '11111111-1111-4111-8111-111111111111';

function buildController() {
  const service = {
    list: jest.fn().mockResolvedValue('list'),
    summary: jest.fn().mockResolvedValue('summary'),
    getSettings: jest.fn().mockResolvedValue('settings'),
    updateSettings: jest.fn().mockResolvedValue('updated'),
    registerCall: jest.fn().mockResolvedValue('call'),
    get: jest.fn().mockResolvedValue('detail'),
    markRead: jest.fn().mockResolvedValue('read'),
    reply: jest.fn().mockResolvedValue('reply'),
    assign: jest.fn().mockResolvedValue('assign'),
    changeStatus: jest.fn().mockResolvedValue('status'),
    link: jest.fn().mockResolvedValue('link'),
  };
  const sla = { flagTenant: jest.fn().mockResolvedValue(3) };
  const tenantContext = { getTenantId: jest.fn().mockReturnValue('t-1') };
  const controller = new InboxController(service as never, sla as never, tenantContext as never);
  return { controller, service, sla };
}

describe('InboxController', () => {
  it('delega cada ruta en el servicio', async () => {
    const { controller, service } = buildController();
    await expect(controller.list({ open: 'true' })).resolves.toBe('list');
    await expect(controller.summary()).resolves.toBe('summary');
    await expect(controller.getSettings()).resolves.toBe('settings');
    await expect(controller.updateSettings({ a: 1 })).resolves.toBe('updated');
    await expect(controller.registerCall({ b: 1 })).resolves.toBe('call');
    await expect(controller.get(ID)).resolves.toBe('detail');
    await expect(controller.markRead(ID)).resolves.toBe('read');
    await expect(controller.reply(ID, { body: 'x' })).resolves.toBe('reply');
    await expect(controller.assign(ID, { assigneeUserId: null })).resolves.toBe('assign');
    await expect(controller.changeStatus(ID, { status: 'Resuelta' })).resolves.toBe('status');
    await expect(controller.link(ID, { personId: null })).resolves.toBe('link');
    expect(service.list).toHaveBeenCalledWith({ open: 'true' });
    expect(service.reply).toHaveBeenCalledWith(ID, { body: 'x' });
  });

  it('la bandeja es de quien atiende clientes; configurar es de la administración; el control de plazos manual, sólo del Admin', () => {
    expect(Reflect.getMetadata(ROLES_KEY, InboxController)).toEqual([...INBOX_ROLES]);
    const own = (name: keyof InboxController) => Reflect.getMetadata(ROLES_KEY, InboxController.prototype[name]) as string[] | undefined;
    expect(own('list')).toBeUndefined();
    expect(own('reply')).toBeUndefined();
    expect(own('updateSettings')).toEqual([...MANAGEMENT_ROLES]);
    expect(own('runSla')).toEqual([...ADMIN_ONLY]);
  });

  describe('_run-sla', () => {
    const original = { env: process.env.NODE_ENV, mode: process.env.E2E_TEST_MODE };
    afterEach(() => {
      process.env.NODE_ENV = original.env;
      if (original.mode === undefined) delete process.env.E2E_TEST_MODE;
      else process.env.E2E_TEST_MODE = original.mode;
    });

    it('corre una vuelta en el ambiente de prueba', async () => {
      const { controller, sla } = buildController();
      process.env.NODE_ENV = 'test';
      await expect(controller.runSla()).resolves.toEqual({ flagged: 3 });
      expect(sla.flagTenant).toHaveBeenCalledWith('t-1', expect.any(Date));
    });

    it('fuera de pruebas responde 403', async () => {
      const { controller, sla } = buildController();
      process.env.NODE_ENV = 'production';
      delete process.env.E2E_TEST_MODE;
      await expect(controller.runSla()).rejects.toMatchObject({ status: 403 });
      expect(sla.flagTenant).not.toHaveBeenCalled();
    });
  });
});

describe('InboxEmailController', () => {
  const SECRET = 'secreto-de-prueba';
  const raw = Buffer.from(JSON.stringify({ tenantSlug: 'demo', messageId: 'm', from: 'a@b.com', text: 'hola' }));
  const sign = (body: Buffer, secret = SECRET) => `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;

  function build(secret: string | undefined = SECRET) {
    const email = { ingestEmail: jest.fn().mockResolvedValue({ received: true }) };
    const config = { inbox: { emailIngestSecret: secret } };
    return { controller: new InboxEmailController(config as never, email as never), email };
  }

  it('es una ruta pública protegida por la firma', () => {
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, InboxEmailController)).toBe(true);
  });

  it('con firma válida entrega el mail al servicio', async () => {
    const { controller, email } = build();
    const body = JSON.parse(raw.toString());
    await expect(controller.emailIngest({ rawBody: raw } as never, sign(raw), body)).resolves.toEqual({ received: true });
    expect(email.ingestEmail).toHaveBeenCalledWith(body);
  });

  it('rechaza una firma ajena, un cuerpo alterado, una firma ausente y un secreto sin configurar', async () => {
    const { controller, email } = build();
    await expect(controller.emailIngest({ rawBody: raw } as never, sign(raw, 'otro'), {})).rejects.toMatchObject({ status: 401 });
    await expect(controller.emailIngest({ rawBody: Buffer.from('{}') } as never, sign(raw), {})).rejects.toMatchObject({ status: 401 });
    await expect(controller.emailIngest({ rawBody: raw } as never, undefined, {})).rejects.toMatchObject({ status: 401 });
    const sinSecreto = build(null as never);
    await expect(sinSecreto.controller.emailIngest({ rawBody: raw } as never, sign(raw), {})).rejects.toMatchObject({ status: 401 });
    expect(email.ingestEmail).not.toHaveBeenCalled();
    expect(sinSecreto.email.ingestEmail).not.toHaveBeenCalled();
  });
});
