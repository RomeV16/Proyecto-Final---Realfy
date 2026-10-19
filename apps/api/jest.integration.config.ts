import type { Config } from 'jest';
import base from './jest.config';

/**
 * Pruebas de contrato contra BCRA e INDEC reales (docs/calidad/07-integracion-externa.md).
 * Necesitan salida a Internet; no miden cobertura.
 */
const config: Config = {
  ...base,
  testRegex: ['test/integration/.*\\.real\\.spec\\.ts$'],
  testTimeout: 60_000,
  collectCoverage: false,
  coverageThreshold: undefined,
};

export default config;
