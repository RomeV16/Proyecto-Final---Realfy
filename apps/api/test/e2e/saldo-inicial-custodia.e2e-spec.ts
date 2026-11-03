import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { setupTestApp, cleanDatabase, teardownTestApp, registerUser, createUserDirect, loginUser } from '../helpers/test-utils';
import { PrismaService } from '../../src/common/prisma/prisma.service';
import { UserRole } from '@realfy/shared';

const PASSWORD = 'Password123!';

/** Saldo inicial de una cuenta de caja, banco o custodia (paso M10 de la migración, ADR-0012). */
describe('Saldo inicial de cuentas (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    const setup = await setupTestApp();
    app = setup.app;
    prisma = setup.prisma;
  });
  afterAll(async () => {
    await cleanDatabase(prisma);
    await teardownTestApp();
  });
  beforeEach(async () => {
    await cleanDatabase(prisma);
  });

  const http = () => request(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const get = (token: string, path: string) => http().get(`/api${path}`).set(auth(token));
  const post = (token: string, path: string, body: object = {}) => http().post(`/api${path}`).set(auth(token)).send(body);

  async function agency(tag: string) {
    const admin = await registerUser(app, { email: `admin@${tag}.test`, password: PASSWORD, firstName: 'Admin', lastName: 'Prueba' });
    const tokens = { [UserRole.Admin]: admin.accessToken } as Record<UserRole, string>;
    for (const role of [UserRole.Gerente, UserRole.Liquidaciones, UserRole.Lectura]) {
      const email = `${role.toLowerCase()}@${tag}.test`;
      await createUserDirect(prisma, admin.user.tenantId, { email, password: PASSWORD, role });
      tokens[role] = (await loginUser(app, email, PASSWORD)).accessToken;
    }
    return { tenantId: admin.user.tenantId as string, tokens, token: tokens[UserRole.Admin] };
  }

  async function custody(token: string, currency: string) {
    const owner = (await post(token, '/persons', { firstName: 'Ana', lastName: 'Locadora' }).expect(201)).body.id;
    const account = (
      await post(token, '/financial-accounts', { kind: 'Custodia', name: `Custodia Ana ${currency}`, currency, ownerPersonId: owner }).expect(201)
    ).body;
    return { owner, account };
  }

  const balanceOf = async (token: string, id: string) =>
    (await get(token, '/financial-accounts?includeInactive=true').expect(200)).body.items.find((a: any) => a.id === id).balance;

  it('CP-1100 — RBAC: sólo Admin y Gerente cargan el saldo inicial', async () => {
    const { token, tokens } = await agency('so-1');
    const { account } = await custody(token, 'USD');
    const body = { amount: '800', date: '2026-10-31', reason: 'Custodia al corte' };
    await post(tokens[UserRole.Liquidaciones], `/financial-accounts/${account.id}/opening-balance`, body).expect(403);
    await post(tokens[UserRole.Lectura], `/financial-accounts/${account.id}/opening-balance`, body).expect(403);
    await http().post(`/api/financial-accounts/${account.id}/opening-balance`).send(body).expect(401);
    await post(tokens[UserRole.Gerente], `/financial-accounts/${account.id}/opening-balance`, body).expect(200);
  });

  it('CP-1101 — custodia en USD y EUR: un asiento por cuenta, en su moneda, que aparece en saldos y totales', async () => {
    const { token } = await agency('so-2');
    const usd = await custody(token, 'USD');
    const eur = (
      await post(token, '/financial-accounts', { kind: 'Custodia', name: 'Custodia EUR', currency: 'EUR', ownerPersonId: usd.owner }).expect(201)
    ).body;
    const caja = (await post(token, '/financial-accounts', { kind: 'Caja', name: 'Caja ARS', currency: 'ARS' }).expect(201)).body;
    const res = await post(token, `/financial-accounts/${usd.account.id}/opening-balance`, { amount: '800.50', date: '2026-10-31', reason: 'Custodia al corte' }).expect(200);
    expect(res.body).toMatchObject({ changed: true, balance: '800.50', currency: 'USD' });
    expect(res.body.movement).toMatchObject({ category: 'SaldoInicial', direction: 'In', currency: 'USD' });
    expect(Number(res.body.movement.amount)).toBe(800.5);
    await post(token, `/financial-accounts/${eur.id}/opening-balance`, { amount: '300', reason: 'Custodia en euros' }).expect(200);
    await post(token, `/financial-accounts/${caja.id}/opening-balance`, { amount: '-50', date: '2026-10-31', reason: 'Descubierto de caja' }).expect(200);

    const list = (await get(token, '/financial-accounts').expect(200)).body;
    const byId = Object.fromEntries(list.items.map((a: any) => [a.id, a.balance]));
    expect(byId).toMatchObject({ [usd.account.id]: '800.50', [eur.id]: '300.00', [caja.id]: '-50.00' });
    expect(list.totals.find((t: any) => t.currency === 'USD')).toMatchObject({ custody: '800.50', agency: '0.00' });
    expect(list.totals.find((t: any) => t.currency === 'EUR')).toMatchObject({ custody: '300.00' });
    const book = (await get(token, `/cash-movements?accountId=${usd.account.id}&category=SaldoInicial`).expect(200)).body;
    expect(book.items.map((m: any) => [m.amount, m.currency, m.account.kind])).toEqual([['800.50', 'USD', 'Custodia']]);
  });

  it('CP-1102 — idempotente: reenviar lo mismo no cambia nada; un importe distinto corrige el mismo asiento, con auditoría', async () => {
    const { token, tenantId } = await agency('so-3');
    const { account } = await custody(token, 'USD');
    const path = `/financial-accounts/${account.id}/opening-balance`;
    const body = { amount: '800', date: '2026-10-31', reason: 'Custodia al corte' };
    const first = (await post(token, path, body).expect(200)).body;
    const again = (await post(token, path, body).expect(200)).body;
    expect(again).toMatchObject({ changed: false, balance: '800.00' });
    expect(again.movement.id).toBe(first.movement.id);
    const fixed = (await post(token, path, { ...body, amount: '950', reason: 'Corrección del conteo' }).expect(200)).body;
    expect(fixed).toMatchObject({ changed: true, balance: '950.00' });
    expect(fixed.movement.id).toBe(first.movement.id);
    expect(await prisma.baseClient.cashMovement.count({ where: { accountId: account.id, category: 'SaldoInicial' } })).toBe(1);
    const audits = await prisma.baseClient.auditLog.findMany({ where: { tenantId, entity: 'CashMovement' }, orderBy: { createdAt: 'asc' } });
    expect(audits.map((x) => [x.action, (x.changes as any).reason])).toEqual([
      ['CREATE', 'Custodia al corte'],
      ['UPDATE', 'Corrección del conteo'],
    ]);
    await post(token, path, { ...body, amount: '0', reason: 'Se anula la apertura' }).expect(200);
    expect(await balanceOf(token, account.id)).toBe('0.00');
  });

  it('CP-1103 — la custodia cargada se puede entregar y la entrega baja el saldo; no toca la cuenta corriente por sí sola', async () => {
    const { token } = await agency('so-4');
    const { owner, account } = await custody(token, 'USD');
    await post(token, `/financial-accounts/${account.id}/opening-balance`, { amount: '800', date: '2026-10-31', reason: 'Custodia al corte' }).expect(200);
    expect((await get(token, `/owners/${owner}/ledger?currency=USD`).expect(200)).body.items).toEqual([]);
    const res = await post(token, `/custody/${account.id}/deliver`, { amount: '300', date: '2026-11-02' }).expect(200);
    expect(res.body.balance).toBe('500.00');
  });

  it('CP-1104 — validaciones: motivo obligatorio, 2 decimales, campos de más, custodia no negativa, cuenta inactiva', async () => {
    const { token } = await agency('so-5');
    const { account } = await custody(token, 'USD');
    const path = `/financial-accounts/${account.id}/opening-balance`;
    await post(token, path, { amount: '10' }).expect(400);
    await post(token, path, { amount: '10', reason: 'ab' }).expect(400);
    await post(token, path, { amount: '10.123', reason: 'Motivo válido' }).expect(400);
    await post(token, path, { amount: '10', reason: 'Motivo válido', currency: 'EUR' }).expect(400);
    const neg = await post(token, path, { amount: '-10', reason: 'Motivo válido' });
    expect(neg.status).toBe(400);
    expect(neg.body.error).toBe('CUSTODY_OPENING_NEGATIVE');
    await http().patch(`/api/financial-accounts/${account.id}`).set(auth(token)).send({ isActive: false }).expect(200);
    const inactive = await post(token, path, { amount: '10', reason: 'Motivo válido' });
    expect(inactive.status).toBe(409);
    expect(inactive.body.error).toBe('ACCOUNT_INACTIVE');
    await post(token, '/financial-accounts/00000000-0000-4000-8000-000000000000/opening-balance', { amount: '1', reason: 'Motivo válido' }).expect(404);
  });

  it('CP-1105 — aislamiento: otra inmobiliaria no ve ni carga el saldo inicial de la cuenta', async () => {
    const one = await agency('so-6');
    const two = await agency('so-7');
    const { account } = await custody(one.token, 'USD');
    await post(one.token, `/financial-accounts/${account.id}/opening-balance`, { amount: '800', reason: 'Custodia al corte' }).expect(200);
    await post(two.token, `/financial-accounts/${account.id}/opening-balance`, { amount: '1', reason: 'Intrusión' }).expect(404);
    expect((await get(two.token, '/financial-accounts').expect(200)).body.items).toEqual([]);
    expect((await get(two.token, '/cash-movements?category=SaldoInicial').expect(200)).body.total).toBe(0);
    expect(await balanceOf(one.token, account.id)).toBe('800.00');
  });
});
