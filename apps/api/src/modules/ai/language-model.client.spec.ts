import { ConfigService } from '@nestjs/config';
import { LanguageModelClient } from './language-model.client';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const MESSAGES = [{ role: 'user' as const, content: 'Ordená estos pendientes' }];

function buildClient(env: Record<string, string>) {
  const config = {
    get: (key: string) => env[key],
  } as unknown as ConfigService;
  return new LanguageModelClient(config);
}

function okResponse(body: unknown) {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => body,
  } as unknown as Response;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('LanguageModelClient', () => {
  const fetchMock = jest.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  describe('sin credencial', () => {
    it('queda deshabilitado', () => {
      expect(buildClient({}).isEnabled).toBe(false);
      expect(buildClient({ AI_API_KEY: '   ' }).isEnabled).toBe(false);
    });

    it('devuelve null sin salir a la red', async () => {
      const client = buildClient({});

      await expect(client.complete(MESSAGES)).resolves.toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('igual expone el modelo configurado', () => {
      expect(buildClient({}).model).toBe('MiniMax-M3');
      expect(buildClient({ AI_MODEL: 'otro-modelo' }).model).toBe('otro-modelo');
    });
  });

  describe('con credencial', () => {
    const ENV = { AI_API_KEY: 'k-de-prueba', AI_BASE_URL: 'https://modelo.example/v1/' };

    it('llama al endpoint compatible con el protocolo de chat', async () => {
      fetchMock.mockResolvedValue(
        okResponse({ model: 'MiniMax-M3', choices: [{ message: { content: '{"ok":true}' } }] }),
      );
      const client = buildClient(ENV);

      const result = await client.complete(MESSAGES, { json: true });

      expect(result).toEqual({ text: '{"ok":true}', model: 'MiniMax-M3' });

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('https://modelo.example/v1/chat/completions');
      expect(init.method).toBe('POST');
      expect(init.headers.Authorization).toBe('Bearer k-de-prueba');

      const body = JSON.parse(init.body as string);
      expect(body.model).toBe('MiniMax-M3');
      expect(body.messages).toEqual(MESSAGES);
      expect(body.response_format).toEqual({ type: 'json_object' });
    });

    it('no pide formato JSON si no se lo piden', async () => {
      fetchMock.mockResolvedValue(
        okResponse({ choices: [{ message: { content: 'texto libre' } }] }),
      );

      await buildClient(ENV).complete(MESSAGES);

      const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
      expect(body.response_format).toBeUndefined();
    });

    it('devuelve null cuando el proveedor responde con error', async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 429,
        statusText: 'Too Many Requests',
      } as unknown as Response);

      await expect(buildClient(ENV).complete(MESSAGES)).resolves.toBeNull();
    });

    it('devuelve null cuando la respuesta no trae contenido', async () => {
      fetchMock.mockResolvedValue(okResponse({ choices: [{ message: { content: '  ' } }] }));

      await expect(buildClient(ENV).complete(MESSAGES)).resolves.toBeNull();
    });

    it('devuelve null cuando la llamada se corta por tiempo', async () => {
      const aborted = new Error('The operation was aborted');
      aborted.name = 'AbortError';
      fetchMock.mockRejectedValue(aborted);

      await expect(
        buildClient({ ...ENV, AI_TIMEOUT_MS: '5' }).complete(MESSAGES),
      ).resolves.toBeNull();
    });

    it('devuelve null cuando la red falla', async () => {
      fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));

      await expect(buildClient(ENV).complete(MESSAGES)).resolves.toBeNull();
    });

    it('usa el modelo configurado como respaldo si el proveedor no lo informa', async () => {
      fetchMock.mockResolvedValue(okResponse({ choices: [{ message: { content: 'listo' } }] }));

      const result = await buildClient({ ...ENV, AI_MODEL: 'modelo-x' }).complete(MESSAGES);

      expect(result?.model).toBe('modelo-x');
    });
  });
});
