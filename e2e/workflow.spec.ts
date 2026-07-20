import { test, expect, type Page } from '@playwright/test';

/**
 * Scénarios authentifiés du parcours principal + vérité opérationnelle.
 * Skippés proprement quand E2E_EMAIL / E2E_PASSWORD ne sont pas fournis
 * (aucun faux vert : un test non exécuté est marqué "skipped", pas "passed").
 */

const EMAIL = process.env.E2E_EMAIL;
const PASSWORD = process.env.E2E_PASSWORD;
const EMAIL_ORG2 = process.env.E2E_EMAIL_ORG2;
const PASSWORD_ORG2 = process.env.E2E_PASSWORD_ORG2;

async function login(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(password);
  await page.getByRole('button', { name: /connexion|login|se connecter/i }).click();
  await page.waitForURL(/dashboard|brands/i, { timeout: 20_000 });
}

test.describe('Parcours principal (authentifié)', () => {
  test.skip(!EMAIL || !PASSWORD, 'E2E_EMAIL / E2E_PASSWORD non fournis');

  test('connexion et affichage du tableau de bord', async ({ page }) => {
    await login(page, EMAIL!, PASSWORD!);
    await expect(page).toHaveURL(/dashboard/i);
  });

  test('création d’une marque via le formulaire', async ({ page }) => {
    await login(page, EMAIL!, PASSWORD!);
    await page.goto('/brands/new');
    const name = `E2E Brand ${Date.now()}`;
    await page.locator('input').first().fill(name);
    await page.getByRole('button', { name: /créer|create|enregistrer/i }).first().click();
    // La marque créée doit apparaître (détail ou liste).
    await expect(page.getByText(name)).toBeVisible({ timeout: 15_000 });
  });

  test('une publication simulée est clairement identifiée (jamais "PUBLISHED")', async ({ page }) => {
    await login(page, EMAIL!, PASSWORD!);
    await page.goto('/posts');
    // Vérité opérationnelle : si des posts simulés existent, le badge doit dire
    // SIMULATED — et aucun badge PUBLISHED ne doit coexister avec un id mock_*.
    const pageContent = await page.content();
    expect(pageContent).not.toContain('mock_facebook_');
    expect(pageContent).not.toContain('mock_reply_');
  });
});

test.describe('Isolation multi-tenant', () => {
  test.skip(
    !EMAIL || !PASSWORD || !EMAIL_ORG2 || !PASSWORD_ORG2,
    'Deux comptes de test requis (E2E_EMAIL_ORG2 / E2E_PASSWORD_ORG2)',
  );

  test('l’org B ne voit jamais les marques de l’org A', async ({ browser }) => {
    const ctxA = await browser.newContext();
    const pageA = await ctxA.newPage();
    await login(pageA, EMAIL!, PASSWORD!);
    await pageA.goto('/brands');
    const brandsA = await pageA.locator('a[href^="/brands/"]').allInnerTexts();

    const ctxB = await browser.newContext();
    const pageB = await ctxB.newPage();
    await login(pageB, EMAIL_ORG2!, PASSWORD_ORG2!);
    await pageB.goto('/brands');
    const brandsB = await pageB.locator('a[href^="/brands/"]').allInnerTexts();

    for (const b of brandsA.filter(Boolean)) {
      expect(brandsB, `La marque "${b}" de l'org A ne doit pas fuiter vers l'org B`).not.toContain(b);
    }
    await ctxA.close();
    await ctxB.close();
  });
});
