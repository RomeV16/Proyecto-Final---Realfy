import { ArgumentsHost, BadRequestException, ConflictException, NotFoundException, UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { AllExceptionsFilter, ErrorResponseBody } from './all-exceptions.filter';
import { TenantIsolationError } from '../tenant/tenant-isolation.error';

/** Build a minimal mock ArgumentsHost for HTTP context. */
function buildHost(method = 'GET', url = '/api/test'): {
  host: ArgumentsHost;
  json: jest.Mock;
  status: jest.Mock;
  getHeader: jest.Mock;
  setHeader: jest.Mock;
} {
  const json = jest.fn();
  const setHeader = jest.fn();
  const getHeader = jest.fn().mockReturnValue(undefined);
  const status = jest.fn().mockReturnValue({ json });

  const host = {
    switchToHttp: () => ({
      getRequest: () => ({
        method,
        url,
        headers: {},
      }),
      getResponse: () => ({
        status,
        getHeader,
        setHeader,
      }),
    }),
  } as unknown as ArgumentsHost;

  return { host, json, status, getHeader, setHeader };
}

describe('AllExceptionsFilter', () => {
  let filter: AllExceptionsFilter;

  beforeEach(() => {
    filter = new AllExceptionsFilter();
  });

  it('maps NotFoundException → 404 with errorCode NOT_FOUND and correlationId shape', () => {
    const { host, status, json } = buildHost('GET', '/api/properties/unknown-id');
    filter.catch(new NotFoundException('Property not found'), host);

    expect(status).toHaveBeenCalledWith(404);
    const body: ErrorResponseBody = json.mock.calls[0][0];
    expect(body.statusCode).toBe(404);
    expect(body.errorCode).toBe('NOT_FOUND');
    expect(body.message).toContain('Property not found');
    expect(body.timestamp).toBeDefined();
  });

  it('maps BadRequestException with validation messages → 400 with array message', () => {
    const { host, status, json } = buildHost('POST', '/api/persons');
    const err = new BadRequestException({ message: ['name must be a string', 'email must be an email'] });
    filter.catch(err, host);

    expect(status).toHaveBeenCalledWith(400);
    const body: ErrorResponseBody = json.mock.calls[0][0];
    expect(body.statusCode).toBe(400);
    expect(body.errorCode).toBe('VALIDATION_ERROR');
    expect(Array.isArray(body.message)).toBe(true);
    expect(body.message).toContain('name must be a string');
  });

  it('maps UnauthorizedException → 401', () => {
    const { host, status, json } = buildHost();
    filter.catch(new UnauthorizedException('Invalid token'), host);

    expect(status).toHaveBeenCalledWith(401);
    const body: ErrorResponseBody = json.mock.calls[0][0];
    expect(body.errorCode).toBe('UNAUTHORIZED');
  });

  it('maps ForbiddenException → 403', () => {
    const { host, status, json } = buildHost();
    filter.catch(new ForbiddenException(), host);

    expect(status).toHaveBeenCalledWith(403);
    const body: ErrorResponseBody = json.mock.calls[0][0];
    expect(body.errorCode).toBe('FORBIDDEN');
  });

  it('maps Prisma P2002 → 409 CONFLICT', () => {
    const { host, status, json } = buildHost('POST', '/api/users');
    const prismaErr = Object.assign(new Error('unique'), { code: 'P2002' });
    filter.catch(prismaErr, host);

    expect(status).toHaveBeenCalledWith(409);
    const body: ErrorResponseBody = json.mock.calls[0][0];
    expect(body.errorCode).toBe('CONFLICT');
  });

  it('maps Prisma P2025 → 404 NOT_FOUND', () => {
    const { host, status, json } = buildHost('DELETE', '/api/users/gone');
    const prismaErr = Object.assign(new Error('not found'), { code: 'P2025' });
    filter.catch(prismaErr, host);

    expect(status).toHaveBeenCalledWith(404);
    const body: ErrorResponseBody = json.mock.calls[0][0];
    expect(body.errorCode).toBe('NOT_FOUND');
  });

  it('maps unknown errors → 500 with sanitized message (no stack leak)', () => {
    const { host, status, json } = buildHost();
    filter.catch(new Error('DB_PASSWORD=secret internal crash'), host);

    expect(status).toHaveBeenCalledWith(500);
    const body: ErrorResponseBody = json.mock.calls[0][0];
    expect(body.statusCode).toBe(500);
    expect(body.errorCode).toBe('INTERNAL_ERROR');
    // Must NOT leak internal details
    expect(body.message).not.toContain('DB_PASSWORD');
    expect(body.message).not.toContain('secret');
  });

  it('keeps the domain error code the service threw, under both field names', () => {
    const { host, status, json } = buildHost('POST', '/api/auth/register');
    filter.catch(
      new ConflictException({
        error: 'EMAIL_EXISTS',
        message: 'An account with this email already exists',
      }),
      host,
    );

    expect(status).toHaveBeenCalledWith(409);
    const body: ErrorResponseBody = json.mock.calls[0][0];
    expect(body.error).toBe('EMAIL_EXISTS');
    expect(body.errorCode).toBe('EMAIL_EXISTS');
    expect(body.message).toBe('An account with this email already exists');
  });

  it('keeps the domain error code even when the status maps to a generic one', () => {
    const { host, json } = buildHost('GET', '/api/public/desconocida');
    filter.catch(
      new NotFoundException({
        error: 'TENANT_NOT_FOUND',
        message: 'Inmobiliaria not found',
      }),
      host,
    );

    const body: ErrorResponseBody = json.mock.calls[0][0];
    expect(body.errorCode).toBe('TENANT_NOT_FOUND');
  });

  it('keeps the context the service attached to the error', () => {
    const { host, json } = buildHost('POST', '/api/liquidaciones/x/transition');
    filter.catch(
      new BadRequestException({
        error: 'INVALID_TRANSITION',
        message: 'Cannot go from Borrador to Pagada',
        validTransitions: ['Revision', 'Anulada'],
      }),
      host,
    );

    const body: ErrorResponseBody = json.mock.calls[0][0];
    expect(body.errorCode).toBe('INVALID_TRANSITION');
    expect(body.validTransitions).toEqual(['Revision', 'Anulada']);
  });

  it('does not attach any context to an unexpected error', () => {
    const { host, json } = buildHost();
    filter.catch(Object.assign(new Error('boom'), { query: 'SELECT secret' }), host);

    const body: ErrorResponseBody = json.mock.calls[0][0];
    expect(body.query).toBeUndefined();
  });

  it('maps a tenant isolation violation → 500 without naming the model or the operation', () => {
    const { host, status, json } = buildHost('GET', '/api/liquidaciones');
    filter.catch(new TenantIsolationError('Liquidacion', 'findMany'), host);

    expect(status).toHaveBeenCalledWith(500);
    const body: ErrorResponseBody = json.mock.calls[0][0];
    expect(body.errorCode).toBe('INTERNAL_ERROR');
    expect(body.message).not.toContain('Liquidacion');
    expect(body.message).not.toContain('findMany');
  });

  it('includes correlationId from response header when present', () => {
    const { host, status, json, getHeader } = buildHost();
    getHeader.mockReturnValue('test-correlation-123');
    filter.catch(new NotFoundException('not found'), host);

    const body: ErrorResponseBody = json.mock.calls[0][0];
    expect(body.correlationId).toBe('test-correlation-123');
  });
});
