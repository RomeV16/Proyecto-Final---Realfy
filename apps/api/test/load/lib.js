/**
 * Utilidades compartidas por los scripts de carga (docs/calidad/10-stress.md).
 * k6 ejecuta ES modules propios: no hay acceso a node_modules.
 */
import http from 'k6/http';
import { check, fail } from 'k6';

export const BASE = (__ENV.K6_URL || 'http://localhost:3001').replace(/\/$/, '');

const JSON_HEADERS = { 'Content-Type': 'application/json' };

/**
 * Registra una inmobiliaria nueva y carga un volumen representativo de
 * índices: dos años de ICL diario y dos de IPC mensual, que es lo que una
 * inmobiliaria real acumula tras dos años de uso con el scraper activo.
 * Devuelve el token que usan todos los usuarios virtuales.
 */
export function setupTenant(label) {
  const stamp = `${label}-${Date.now()}`;
  const register = http.post(
    `${BASE}/api/auth/register`,
    JSON.stringify({
      email: `k6-${stamp}@realfy.test`,
      password: `K6${stamp}!a`,
      firstName: 'Carga',
      lastName: label,
    }),
    { headers: JSON_HEADERS },
  );
  if (register.status !== 201) {
    fail(`registro falló: HTTP ${register.status} ${register.body.slice(0, 200)}`);
  }
  const token = register.json('tokens.accessToken');
  const auth = { headers: { ...JSON_HEADERS, Authorization: `Bearer ${token}` } };

  const rows = [];
  const start = Date.UTC(2024, 9, 1);
  for (let d = 0; d < 730; d++) {
    rows.push({
      indexType: 'ICL',
      period: new Date(start + d * 86_400_000).toISOString(),
      value: (30 + d * 0.01).toFixed(6),
      source: 'k6',
    });
  }
  for (let m = 0; m < 24; m++) {
    rows.push({
      indexType: 'IPC',
      period: new Date(Date.UTC(2024, 9 + m, 1)).toISOString(),
      value: (2 + (m % 5) * 0.3).toFixed(6),
      source: 'k6',
    });
  }
  // En tandas: la carga masiva hace un upsert por fila.
  for (let i = 0; i < rows.length; i += 100) {
    const res = http.post(`${BASE}/api/index-data/bulk`, JSON.stringify(rows.slice(i, i + 100)), auth);
    if (res.status !== 201) fail(`carga masiva falló: HTTP ${res.status}`);
  }

  return { token, rows: rows.length };
}

/** Una iteración de usuario: lista la primera página y el último valor por tipo. */
export function browseIndices(token) {
  const auth = { headers: { Authorization: `Bearer ${token}` }, tags: { name: 'GET /api/index-data' } };

  const list = http.get(`${BASE}/api/index-data?limit=50`, auth);
  check(list, {
    'listado 200': (r) => r.status === 200,
    'listado con items': (r) => r.status === 200 && Array.isArray(r.json('items')),
  });

  const filtered = http.get(`${BASE}/api/index-data?indexType=ICL&page=3&limit=50`, {
    ...auth,
    tags: { name: 'GET /api/index-data?indexType' },
  });
  check(filtered, { 'filtrado 200': (r) => r.status === 200 });

  const latest = http.get(`${BASE}/api/index-data/latest`, {
    ...auth,
    tags: { name: 'GET /api/index-data/latest' },
  });
  check(latest, { 'latest 200': (r) => r.status === 200 });
}

export const THRESHOLDS = {
  http_req_failed: ['rate<0.01'],
  http_req_duration: ['p(95)<500'],
  'http_req_duration{name:GET /api/index-data}': ['p(95)<500'],
  'http_req_duration{name:GET /api/index-data/latest}': ['p(95)<500'],
  checks: ['rate>0.99'],
};
