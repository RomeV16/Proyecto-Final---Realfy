import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

// El middleware de idioma no es lo que se prueba acá.
vi.mock('next-intl/middleware', () => ({ default: () => () => NextResponse.next() }));

import middleware from './middleware';

function request(path: string, host: string, headers: Record<string, string> = {}) {
  return new NextRequest(`http://${host}${path}`, { headers: { host, ...headers } });
}

describe('middleware: dominio propio del micrositio', () => {
  beforeEach(() => {
    vi.stubEnv('MICROSITE_HOST_MAP', JSON.stringify({ 'www.inmobiliariademo.com.ar': 'inmobiliaria-demo' }));
  });
  afterEach(() => vi.unstubAllEnvs());

  it('reescribe la raíz y las fichas hacia el portal de esa inmobiliaria sin cambiar la dirección', () => {
    const home = middleware(request('/', 'www.inmobiliariademo.com.ar'));
    expect(home.headers.get('x-middleware-rewrite')).toBe('http://www.inmobiliariademo.com.ar/es/p/inmobiliaria-demo');

    const detail = middleware(request('/propiedades/abc', 'www.inmobiliariademo.com.ar'));
    expect(detail.headers.get('x-middleware-rewrite')).toContain('/es/p/inmobiliaria-demo/propiedades/abc');
  });

  it('respeta el host que manda el proxy', () => {
    const res = middleware(request('/', 'interno:3000', { 'x-forwarded-host': 'www.inmobiliariademo.com.ar' }));
    expect(res.headers.get('x-middleware-rewrite')).toContain('/es/p/inmobiliaria-demo');
  });

  it('deja pasar sin reescribir las rutas del portal ya resueltas', () => {
    const res = middleware(request('/es/p/inmobiliaria-demo/propiedades/abc', 'www.inmobiliariademo.com.ar'));
    expect(res.headers.get('x-middleware-rewrite')).toBeNull();
    expect(res.status).toBe(200);
  });

  it('el panel no se alcanza por el dominio del micrositio', () => {
    const res = middleware(request('/es/dashboard', 'www.inmobiliariademo.com.ar'));
    expect(res.headers.get('x-middleware-rewrite')).toContain('/es/p/inmobiliaria-demo/es/dashboard');
  });

  it('en el dominio de la aplicación se sigue pidiendo sesión para el panel y no para el portal', () => {
    const panel = middleware(request('/es/dashboard', 'app.realfy.test'));
    expect(panel.status).toBe(307);
    expect(panel.headers.get('location')).toContain('/es/auth/login');

    const portal = middleware(request('/es/p/inmobiliaria-demo', 'app.realfy.test'));
    expect(portal.status).toBe(200);
    expect(portal.headers.get('x-middleware-rewrite')).toBeNull();
  });
});
