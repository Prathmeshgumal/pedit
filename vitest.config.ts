import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'
export default defineConfig({
  resolve: { alias: { '@shared': resolve(import.meta.dirname, 'src/shared') } },
  test: { include: ['tests/shared/**/*.test.ts', 'tests/main/**/*.test.ts'], passWithNoTests: true, testTimeout: 120000, hookTimeout: 300000 }
})
