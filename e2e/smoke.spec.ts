import { test, expect } from '@playwright/test';

/**
 * Smoke — aucun compte requis. Vérifie que l'app répond, que les assets
 * publics existent (fini les 404 favicon/robots) et que l'accès non
 * authentifié est bien redirigé.
 */

test('la page d’accueil répond', async ({ page }) => {
  const res = await page.goto('/');
  expect(res?.status()).toBeLessThan(400);
});

test('les assets publics existent (favicon, robots, manifest)', async ({ request }) => {
  for (const path of ['/favicon.ico', '/robots.txt', '/manifest.webmanifest', '/icon.svg']) {
    const res = await request.get(path);
    expect(res.status(), path).toBe(200);
  }
});

test('le dashboard exige une authentification', async ({ page }) => {
  await page.goto('/dashboard');
  // Redirection vers login (NextAuth) — jamais de données tenant sans session.
  await expect(page).toHaveURL(/login|signin|auth/i);
});

test('l’API tenant refuse les requêtes anonymes', async ({ request }) => {
  for (const path of ['/api/capabilities', '/api/dashboard/next-action']) {
    const res = await request.get(path);
    expect([401, 403, 307, 302]).toContain(res.status());
  }
});
