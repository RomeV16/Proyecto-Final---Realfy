#!/usr/bin/env node
/**
 * CP-60 — Smoke sobre un despliegue (docs/calidad/02-plan-de-pruebas.md, nivel "smoke").
 *
 * Verifica que una instancia recién desplegada arranca, conecta a la base,
 * autentica y sirve el módulo de índices. Sin dependencias: Node ≥ 20 con fetch.
 *
 *   node apps/api/test/smoke/smoke.mjs --url https://api.ejemplo.com
 *   pnpm --filter @realfy/api test:smoke -- --url http://localhost:3001
 *
 * Sale con 0 si todos los pasos pasan y con 1 ante el primer fallo.
 */
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  }),
);
const BASE = (args.url ?? process.env.SMOKE_URL ?? 'http://localhost:3001').replace(/\/$/, '');
const TIMEOUT_MS = Number(args.timeout ?? 15_000);

const results = [];
let token = null;

async function call(method, path, { body, auth } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE}${path}`, {
      method,
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        ...(auth && token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* respuesta no JSON */ }
    return { status: res.status, json, text };
  } finally {
    clearTimeout(timer);
  }
}

async function step(name, fn) {
  const started = Date.now();
  try {
    const detail = await fn();
    results.push({ name, ok: true, ms: Date.now() - started, detail });
    console.log(`✔ ${name} (${Date.now() - started} ms)${detail ? ` — ${detail}` : ''}`);
  } catch (err) {
    results.push({ name, ok: false, ms: Date.now() - started, detail: String(err.message ?? err) });
    console.error(`✖ ${name} — ${err.message ?? err}`);
    throw err;
  }
}

function expect(cond, message) {
  if (!cond) throw new Error(message);
}

const stamp = Date.now();

try {
  await step('GET /api/health responde ok con base conectada', async () => {
    const { status, json } = await call('GET', '/api/health');
    expect(status === 200, `HTTP ${status}`);
    expect(json?.status === 'ok', `status=${json?.status}`);
    expect(json?.db === 'connected', `db=${json?.db}`);
    return `db=${json.db}`;
  });

  await step('POST /api/auth/register crea una inmobiliaria y devuelve tokens', async () => {
    const { status, json } = await call('POST', '/api/auth/register', {
      body: {
        email: `smoke-${stamp}@realfy.test`,
        password: `Smoke${stamp}!a`,
        firstName: 'Smoke',
        lastName: 'Test',
      },
    });
    expect(status === 201, `HTTP ${status}: ${JSON.stringify(json).slice(0, 200)}`);
    expect(typeof json?.tokens?.accessToken === 'string', 'sin accessToken');
    token = json.tokens.accessToken;
    return `tenant=${json.user?.tenantId}`;
  });

  await step('GET /api/index-data lista paginado para la inmobiliaria nueva', async () => {
    const { status, json } = await call('GET', '/api/index-data?limit=5', { auth: true });
    expect(status === 200, `HTTP ${status}`);
    expect(Array.isArray(json?.items), 'items no es lista');
    expect(json.page === 1 && json.limit === 5, `page=${json.page} limit=${json.limit}`);
    return `total=${json.total}`;
  });

  await step('POST /api/index-data acepta una carga manual (RF-14)', async () => {
    const { status, json } = await call('POST', '/api/index-data', {
      auth: true,
      body: { indexType: 'ICL', period: '2026-01-01T00:00:00.000Z', value: '36.94', source: 'smoke' },
    });
    expect(status === 201, `HTTP ${status}: ${JSON.stringify(json).slice(0, 200)}`);
    expect(json?.indexType === 'ICL', 'indexType inesperado');
    return `id=${json.id}`;
  });

  await step('GET /api/index-data/latest devuelve el valor recién cargado', async () => {
    const { status, json } = await call('GET', '/api/index-data/latest', { auth: true });
    expect(status === 200, `HTTP ${status}`);
    const icl = Array.isArray(json) ? json.find((r) => r.indexType === 'ICL') : null;
    expect(icl && Number(icl.latest?.value) === 36.94, 'el ICL cargado no aparece como último valor');
    return 'ICL=36.94';
  });

  await step('GET /api/index-data sin token responde 401', async () => {
    const { status } = await call('GET', '/api/index-data');
    expect(status === 401, `HTTP ${status}`);
  });
} catch {
  // el paso ya quedó registrado
}

const failed = results.filter((r) => !r.ok).length;
const summary = {
  url: BASE,
  at: new Date().toISOString(),
  passed: results.length - failed,
  failed,
  steps: results,
};
console.log(`\nSmoke ${BASE}: ${summary.passed} pasos ok, ${failed} fallidos`);
if (args.json) {
  const { writeFileSync } = await import('node:fs');
  writeFileSync(String(args.json), JSON.stringify(summary, null, 2));
}
process.exit(failed ? 1 : 0);
