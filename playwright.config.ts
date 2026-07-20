import { defineConfig, devices } from '@playwright/test';

/**
 * E2E — cible une instance déployée (prod/preview) ou un dev server local.
 *   E2E_BASE_URL   : URL cible (défaut: http://localhost:3000, lance `npm run dev` avant)
 *   E2E_EMAIL      : compte de test (scénarios authentifiés — skippés sinon)
 *   E2E_PASSWORD
 *   E2E_EMAIL_ORG2 / E2E_PASSWORD_ORG2 : second tenant pour le test d'isolation
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
