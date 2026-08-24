import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [svelte()],
  test: {
    // tools/ is included because the graph linter gates CI (§8.4) and its
    // scheduler decides whether a cause is solvable at all.
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts', 'tools/**/*.test.ts'],
    environment: 'node',
  },
});
