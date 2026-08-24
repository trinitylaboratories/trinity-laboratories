import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    preserveSymlinks: true,
  },
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts'],
    restoreMocks: true,
    testTimeout: 10_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'html'],
      reportsDirectory: process.env.TRINITY_PROJECT_ROOT ? '.tools/coverage' : 'coverage',
      // Gate the pure policy/helper modules. The command-line entry points are
      // exercised through fixture-driven tests and the integration workflow.
      include: [
        'scripts/lib/deployment-policy.mjs',
        'scripts/lib/filesystem.mjs',
        'scripts/lib/local-build-stage.mjs',
        'scripts/lib/site-contract.mjs',
        'src/lib/local-protocol.ts',
      ],
      thresholds: {
        branches: 70,
        functions: 75,
        lines: 80,
        statements: 80,
      },
    },
  },
});
