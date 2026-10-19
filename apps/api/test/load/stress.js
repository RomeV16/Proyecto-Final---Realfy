/**
 * CP-70 — Stress sobre la consulta de índices.
 *
 * Sube de 0 a 50 usuarios virtuales, los sostiene y baja, en dos minutos.
 * Umbrales (docs/calidad/02-plan-de-pruebas.md, criterio de salida):
 * p95 < 500 ms y errores < 1 %.
 *
 *   K6_URL=http://localhost:3001 k6 run apps/api/test/load/stress.js
 */
import { sleep } from 'k6';
import { setupTenant, browseIndices, THRESHOLDS } from './lib.js';

export const options = {
  scenarios: {
    stress: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 50 },
        { duration: '60s', target: 50 },
        { duration: '30s', target: 0 },
      ],
      gracefulRampDown: '5s',
    },
  },
  thresholds: THRESHOLDS,
  summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};

export function setup() {
  return setupTenant('stress');
}

export default function (data) {
  browseIndices(data.token);
  sleep(0.5);
}
