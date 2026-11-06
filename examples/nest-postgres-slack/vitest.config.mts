import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: ['test/**/*.e2e-spec.ts'],
    fileParallelism: false,
    globalSetup: ['test/support/global-setup.ts'],
    // The app's own instrumentation first, so it patches modules before the app loads them.
    // ← flow recording: its runner integration goes right after it, and only collects
    // what that instrumentation produces.
    setupFiles: ['src/instrumentation.ts', 'flow-recording/vitest', 'test/support/setup.ts'],
  },
});
