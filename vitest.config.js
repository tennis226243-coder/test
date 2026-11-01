import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { globals: true, include: ['tests/core/**/*.test.js', 'tests/collector/**/*.test.js'] } });
