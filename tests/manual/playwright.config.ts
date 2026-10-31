import { defineConfig } from '@playwright/test'
// Manual runs against the real `claude` CLI (costs real usage). Run: npx playwright test -c tests/manual
export default defineConfig({ testDir: '.', timeout: 900000, workers: 1, reporter: 'list' })
