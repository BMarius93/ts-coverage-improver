/** @type {import('jest').Config} */
module.exports = {
  rootDir: '.',
  roots: ['<rootDir>/test'],
  testRegex: '\\.spec\\.ts$',
  testPathIgnorePatterns: ['/node_modules/', '/test/e2e/'],
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }] },
  moduleFileExtensions: ['ts', 'js', 'json'],
  testEnvironment: 'node',
  collectCoverageFrom: ['src/**/*.ts', '!src/main.ts', '!src/main.worker.ts'],
  coverageDirectory: 'coverage',
};
