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
  testEnvironment: 'node',
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    'pdfmake/src/printer': '<rootDir>/test/mocks/pdfmake-printer.js',
    'pdfmake/build/vfs_fonts/(.*)': '<rootDir>/test/mocks/pdfmake-font.js',
  },
};

export default config;
