import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ApiRequestError,
  createApiClient,
  filenameFromDisposition,
} from './create-api-client';

const fetchMock = vi.fn();

function json(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

let location: { href: string; pathname: string };

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  location = { href: '', pathname: '/en/contracts' };
  vi.stubGlobal('window', { location });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ApiRequestError', () => {
  it('separa el contexto del servicio del envoltorio y expone correlationId', () => {
    const err = new ApiRequestError(409, 'X', 'msg', {
      statusCode: 409,
      message: 'msg',
      error: 'X',
      correlationId: 'abc',
      timestamp: 't',
      validTransitions: ['A'],
    });
    expect(err.status).toBe(409);
    expect(err.statusCode).toBe(409);
    expect(err.correlationId).toBe('abc');
    expect(err.details).toEqual({ validTransitions: ['A'] });
  });

  it('sin cuerpo no tiene detalles', () => {
    const err = new ApiRequestError(500, 'E', 'm');
    expect(err.details).toEqual({});
    expect(err.correlationId).toBeUndefined();
  });
});

describe('createApiClient.request', () => {
  const make = (extra = {}) =>
    createApiClient({ baseUrl: '/api', loginPath: '/auth/login', ...extra });

  it('devuelve el JSON y arma la URL con el base', async () => {
    fetchMock.mockResolvedValue(json(200, { ok: 1 }));
    await expect(make().request('/x')).resolves.toEqual({ ok: 1 });
    expect(fetchMock.mock.calls[0][0]).toBe('/api/x');
  });

  it('devuelve undefined en 204', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    await expect(make().request('/x', { method: 'DELETE' })).resolves.toBeUndefined();
  });

  it('envía el token Bearer y las credenciales configuradas', async () => {
    fetchMock.mockResolvedValue(json(200, {}));
    await make({ getToken: () => 'tok', credentials: 'include' }).request('/x');
    const init = fetchMock.mock.calls[0][1];
    expect(init.headers.Authorization).toBe('Bearer tok');
    expect(init.credentials).toBe('include');
  });

  it('no fuerza Content-Type JSON con FormData', async () => {
    fetchMock.mockResolvedValue(json(200, {}));
    await make().request('/x', { method: 'POST', body: new FormData() });
    expect(fetchMock.mock.calls[0][1].headers['Content-Type']).toBeUndefined();
  });

  it('normaliza el error con código, mensaje y correlationId del cuerpo', async () => {
    fetchMock.mockResolvedValue(
      json(400, { error: 'BAD', message: 'No va', correlationId: 'c-1', problems: [1] }),
    );
    const err = await make().request('/x').catch((e) => e);
    expect(err).toBeInstanceOf(ApiRequestError);
    expect(err).toMatchObject({
      status: 400,
      errorCode: 'BAD',
      message: 'No va',
      correlationId: 'c-1',
      details: { problems: [1] },
    });
  });

  it('une los mensajes de validación en uno solo', async () => {
    fetchMock.mockResolvedValue(json(400, { message: ['a', 'b'] }));
    const err = await make().request('/x').catch((e) => e);
    expect(err.message).toBe('a, b');
    expect(err.errorCode).toBe('UNKNOWN_ERROR');
  });

  it('toma el correlationId del header si el cuerpo no es JSON', async () => {
    fetchMock.mockResolvedValue(
      new Response('<html>', { status: 502, statusText: 'Bad Gateway', headers: { 'x-request-id': 'h-9' } }),
    );
    const err = await make().request('/x').catch((e) => e);
    expect(err).toMatchObject({
      status: 502,
      errorCode: 'UNKNOWN_ERROR',
      message: 'Bad Gateway',
      correlationId: 'h-9',
    });
  });

  it('ante 401 renueva y reintenta una vez', async () => {
    const refresh = vi.fn().mockResolvedValue(true);
    fetchMock
      .mockResolvedValueOnce(json(401, {}))
      .mockResolvedValueOnce(json(200, { ok: true }));
    await expect(make({ refresh }).request('/x')).resolves.toEqual({ ok: true });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('si el reintento vuelve a fallar con 401 lanza el error normalizado', async () => {
    const refresh = vi.fn().mockResolvedValue(true);
    fetchMock.mockResolvedValue(json(401, { error: 'UNAUTHORIZED', message: 'no' }));
    const err = await make({ refresh }).request('/x').catch((e) => e);
    expect(err.status).toBe(401);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('si no se puede renovar limpia la sesión y redirige con el locale actual', async () => {
    const onUnauthorized = vi.fn();
    fetchMock.mockResolvedValue(json(401, {}));
    const err = await make({ refresh: async () => false, onUnauthorized })
      .request('/x')
      .catch((e) => e);
    expect(err).toMatchObject({ status: 401, errorCode: 'UNAUTHORIZED' });
    expect(onUnauthorized).toHaveBeenCalled();
    expect(location.href).toBe('/en/auth/login');
  });

  it('sin función de renovación redirige directo', async () => {
    fetchMock.mockResolvedValue(json(401, {}));
    await make().request('/x').catch(() => undefined);
    expect(location.href).toBe('/en/auth/login');
  });

  it('las renovaciones concurrentes comparten una sola llamada', async () => {
    let calls = 0;
    const refresh = vi.fn(async () => {
      calls += 1;
      return true;
    });
    fetchMock.mockImplementation(async () =>
      fetchMock.mock.calls.length <= 3 ? json(401, {}) : json(200, { ok: true }),
    );
    const client = make({ refresh });
    await Promise.all([client.request('/a'), client.request('/b'), client.request('/c')]);
    expect(calls).toBe(1);
  });

  it('una renovación que lanza cuenta como fallida', async () => {
    fetchMock.mockResolvedValue(json(401, {}));
    const err = await make({ refresh: () => Promise.reject(new Error('x')) })
      .request('/x')
      .catch((e) => e);
    expect(err.errorCode).toBe('UNAUTHORIZED');
  });

  it('sin window (servidor) no intenta redirigir', async () => {
    vi.unstubAllGlobals();
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockResolvedValue(json(401, {}));
    const err = await make().request('/x').catch((e) => e);
    expect(err.status).toBe(401);
  });
});

describe('createApiClient.blob', () => {
  const make = () => createApiClient({ baseUrl: '/api', loginPath: '/auth/login' });

  it('devuelve el blob y el nombre de Content-Disposition', async () => {
    fetchMock.mockResolvedValue(
      new Response('pdf', {
        status: 200,
        headers: { 'Content-Disposition': 'attachment; filename="factura-1.pdf"' },
      }),
    );
    const { blob, filename } = await make().blob('/invoices/1/pdf');
    expect(await blob.text()).toBe('pdf');
    expect(filename).toBe('factura-1.pdf');
  });

  it('propaga el error normalizado', async () => {
    fetchMock.mockResolvedValue(json(404, { error: 'NOT_FOUND', message: 'nada', correlationId: 'z' }));
    const err = await make().blob('/x').catch((e) => e);
    expect(err).toMatchObject({ status: 404, errorCode: 'NOT_FOUND', correlationId: 'z' });
  });
});

describe('filenameFromDisposition', () => {
  it('lee comillas, sin comillas y filename*', () => {
    expect(filenameFromDisposition('attachment; filename="a b.pdf"')).toBe('a b.pdf');
    expect(filenameFromDisposition('attachment; filename=a.pdf')).toBe('a.pdf');
    expect(filenameFromDisposition("attachment; filename*=UTF-8''caf%C3%A9.pdf")).toBe('café.pdf');
  });

  it('filename* inválido cae al nombre simple', () => {
    expect(filenameFromDisposition('attachment; filename*=UTF-8\'\'%E0%A4%A; filename="b.pdf"')).toBe('b.pdf');
  });

  it('devuelve null sin header o sin nombre', () => {
    expect(filenameFromDisposition(null)).toBeNull();
    expect(filenameFromDisposition('inline')).toBeNull();
  });
});
