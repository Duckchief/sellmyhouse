import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/*.test.ts'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^@paralleldrive/cuid2$': '<rootDir>/tests/mocks/cuid2.ts',
    '^otplib$': '<rootDir>/tests/mocks/otplib.ts',
  },
  testPathIgnorePatterns: [
    '/node_modules/',
    'src/domains/transaction/__tests__/transaction.repository.test.ts',
  ],
  clearMocks: true,
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/server.ts',
    '!src/**/*.types.ts',
  ],
};

export default config;
