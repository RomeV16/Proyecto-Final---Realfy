import { createHmac } from 'node:crypto';
import { safeEqual, verifyMetaSignature, verifySvixSignature } from './webhook-signatures';

const body = Buffer.from('{"object":"whatsapp_business_account","entry":[]}');

describe('firma de Meta (X-Hub-Signature-256)', () => {
  const secret = 'secreto-de-la-app';
  const good = `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;

  it('acepta la firma del cuerpo crudo con el secreto de la app', () => {
    expect(verifyMetaSignature(body, good, secret)).toBe(true);
    expect(verifyMetaSignature(body, good.toUpperCase().replace('SHA256=', 'sha256='), secret)).toBe(true);
  });

  it('rechaza otra firma, otro cuerpo, otro secreto o la falta de cualquiera', () => {
    expect(verifyMetaSignature(body, `sha256=${'0'.repeat(64)}`, secret)).toBe(false);
    expect(verifyMetaSignature(Buffer.from('{}'), good, secret)).toBe(false);
    expect(verifyMetaSignature(body, good, 'otro')).toBe(false);
    expect(verifyMetaSignature(undefined, good, secret)).toBe(false);
    expect(verifyMetaSignature(body, undefined, secret)).toBe(false);
    expect(verifyMetaSignature(body, good, undefined)).toBe(false);
  });
});

describe('firma de Resend (svix)', () => {
  const key = Buffer.from('clave-de-prueba-de-32-bytes!!!!!');
  const secret = `whsec_${key.toString('base64')}`;
  const now = new Date('2026-11-02T15:00:00Z');
  const ts = String(Math.floor(now.getTime() / 1000));
  const sign = (id: string, t: string, b: Buffer) =>
    createHmac('sha256', key).update(`${id}.${t}.`).update(b).digest('base64');

  it('acepta una firma v1 válida entre varias', () => {
    const headers = { id: 'msg_1', timestamp: ts, signature: `v1,${'x'.repeat(44)} v1,${sign('msg_1', ts, body)}` };
    expect(verifySvixSignature(body, headers, secret, now)).toBe(true);
  });

  it('rechaza una firma de otro id, de otro cuerpo o de otra versión', () => {
    expect(verifySvixSignature(body, { id: 'msg_2', timestamp: ts, signature: `v1,${sign('msg_1', ts, body)}` }, secret, now)).toBe(false);
    expect(verifySvixSignature(Buffer.from('{}'), { id: 'msg_1', timestamp: ts, signature: `v1,${sign('msg_1', ts, body)}` }, secret, now)).toBe(false);
    expect(verifySvixSignature(body, { id: 'msg_1', timestamp: ts, signature: `v2,${sign('msg_1', ts, body)}` }, secret, now)).toBe(false);
  });

  it('rechaza un pedido de hace más de cinco minutos (reenvío) o con fecha inválida', () => {
    const old = String(Math.floor(now.getTime() / 1000) - 301);
    expect(verifySvixSignature(body, { id: 'msg_1', timestamp: old, signature: `v1,${sign('msg_1', old, body)}` }, secret, now)).toBe(false);
    expect(verifySvixSignature(body, { id: 'msg_1', timestamp: 'ayer', signature: 'v1,x' }, secret, now)).toBe(false);
  });

  it('sin secreto o sin encabezados rechaza todo (falla cerrado)', () => {
    const headers = { id: 'msg_1', timestamp: ts, signature: `v1,${sign('msg_1', ts, body)}` };
    expect(verifySvixSignature(body, headers, undefined, now)).toBe(false);
    expect(verifySvixSignature(body, { ...headers, signature: undefined }, secret, now)).toBe(false);
    expect(verifySvixSignature(undefined, headers, secret, now)).toBe(false);
  });

  it('acepta el secreto sin el prefijo whsec_', () => {
    const headers = { id: 'msg_1', timestamp: ts, signature: `v1,${sign('msg_1', ts, body)}` };
    expect(verifySvixSignature(body, headers, key.toString('base64'), now)).toBe(true);
  });
});

describe('comparación en tiempo constante', () => {
  it('compara textos de cualquier largo sin lanzar', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
  });
});
