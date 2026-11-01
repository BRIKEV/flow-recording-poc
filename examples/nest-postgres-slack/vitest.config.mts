import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: ['test/**/*.e2e-spec.ts'],
    fileParallelism: false,
    globalSetup: ['test/support/global-setup.ts'],
    // flow-recording first, so the instrumentations patch modules before the app loads them
    setupFiles: ['test/support/flow-recording.ts', 'test/support/setup.ts'],
  },
});
