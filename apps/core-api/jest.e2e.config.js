/** @type {import('jest').Config} */
module.exports = {
  displayName: 'core-api:e2e',
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  testMatch: ['<rootDir>/test/**/*.e2e-spec.ts'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.json' }],
  },
  // MongoMemoryServer + NestJS bootstrap needs time
  testTimeout: 60000,
};
