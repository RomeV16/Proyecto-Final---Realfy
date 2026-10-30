import type { Config } from 'jest';

const config: Config = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testRegex: ['src/.*\\.spec\\.ts$', 'test/unit/.*\\.spec\\.ts$'],
  transform: {
    '^.+\\.ts$': 'ts-jest',
  },
  collectCoverageFrom: ['src/**/*.ts'],
  coverageDirectory: './coverage',
  // json-summary alimenta el resumen de cobertura que el pipeline publica en cada ejecución.
  coverageReporters: ['text', 'lcov', 'json-summary'],
  /**
   * Piso de cobertura, no objetivo. Está unos puntos por debajo de lo que las
   * suites cubren hoy, así que la integración continua se pone en rojo cuando la
   * cobertura baja, no cuando alguien no llega a una meta aspiracional.
   * Medición al fijarlo: 42.07 líneas / 43.22 funciones / 31.69 ramas / 42.03 sentencias.
   */
  coverageThreshold: {
    global: {
      lines: 38,
      functions: 38,
      branches: 27,
      statements: 38,
    },
  },
  testEnvironment: 'node',
  // Zona horaria fija (UTC) sin importar la de la máquina.
  globalSetup: '<rootDir>/test/setup/utc.js',
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    'pdfmake/src/printer': '<rootDir>/test/mocks/pdfmake-printer.js',
    'pdfmake/build/vfs_fonts/(.*)': '<rootDir>/test/mocks/pdfmake-font.js',
  },
};

export default config;
