module.exports = {
  rootDir: '..',
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests', '<rootDir>/src'],
  testMatch: ['**/tests/**/*.test.ts', '**/?(*.)+(spec|test).ts'],
  testPathIgnorePatterns: ['/node_modules/', '/tests/e2e/'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],

  // TypeScript Compilation
  transform: {
    '^.+\\.(ts|tsx)$': ['ts-jest', { tsconfig: '<rootDir>/configs/tsconfig.test.json' }],
  },

  // Coverage
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/types.ts',
    '!**/node_modules/**',
  ],
  coverageDirectory: '<rootDir>/output/coverage',
  coveragePathIgnorePatterns: ['/node_modules/', '/output/dist/', 'types.ts'],
  coverageThreshold: {
    global: {
      branches: 64,
      functions: 78,
      lines: 78,
      statements: 74,
    },
  },

  // Module Aliases (für schöne Imports)
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^@tests/(.*)$': '<rootDir>/tests/$1',
  },

  // Setup Files
  setupFilesAfterEnv: ['<rootDir>/tests/setup.ts'],

  // Verbose Output
  verbose: true,

  // Timeouts
  testTimeout: 10000,

  // Parallel Execution
  maxWorkers: '50%',
};
