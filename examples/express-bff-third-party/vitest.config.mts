import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: ['test/**/*.e2e-spec.ts'],
    // The app's own instrumentation first, so it patches modules before the app loads them.
    // ← flow recording: its runner integration goes right after it.
    setupFiles: ['src/instrumentation.ts', 'flow-recording/vitest'],
  },
});
