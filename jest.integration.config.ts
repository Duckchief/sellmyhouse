import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        diagnostics: false,
      },
    ],
  },
  roots: ['<rootDir>/tests/integration', '<rootDir>/src/domains/transaction/__tests__'],
  testMatch: ['**/*.test.ts'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^@paralleldrive/cuid2$': '<rootDir>/tests/mocks/cuid2.ts',
    '^otplib$': '<rootDir>/tests/mocks/otplib.ts',
    '^\\.\\./\\.\\./\\.\\./tests/(.*)$': '<rootDir>/tests/$1',
  },
  globalSetup: '<rootDir>/tests/helpers/setup.ts',
  setupFiles: ['<rootDir>/tests/helpers/set-test-env.ts'],
  clearMocks: true,
  testTimeout: 15000,
  // Run sequentially to prevent connection pool exhaustion
  maxWorkers: 1,
  // Force exit to clean up PgSession connections
  forceExit: true,
};

export default config;
