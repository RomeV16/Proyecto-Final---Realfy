import { CorrelationIdMiddleware } from './correlation-id.middleware';

describe('CorrelationIdMiddleware', () => {
  const run = (header?: unknown) => {
    const setCorrelationId = jest.fn();
    const mw = new CorrelationIdMiddleware({ setCorrelationId } as any);
    const res = { setHeader: jest.fn() };
    const next = jest.fn();
    mw.use({ headers: { 'x-request-id': header } } as any, res as any, next);
    return { setCorrelationId, res, next };
  };

  it('reutiliza un identificador válido', () => {
    const { setCorrelationId, res, next } = run('abc-123');
    expect(setCorrelationId).toHaveBeenCalledWith('abc-123');
    expect(res.setHeader).toHaveBeenCalledWith('x-request-id', 'abc-123');
    expect(next).toHaveBeenCalled();
  });

  it('genera uno cuando falta o es inválido', () => {
    for (const h of [undefined, 'a b', 'x'.repeat(200)]) {
      const { setCorrelationId } = run(h);
      expect(setCorrelationId.mock.calls[0][0]).toMatch(/^[0-9a-f-]{36}$/);
    }
  });
});
