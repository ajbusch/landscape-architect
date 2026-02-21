import { test, expect } from '@playwright/test';

test.describe('Navigation', () => {
  test('landing page renders with CTA linking to /analyze', async ({ page }) => {
    await page.goto('/');

    await expect(
      page.getByRole('heading', {
        name: /transform your yard/i,
        level: 1,
      }),
    ).toBeVisible();

    const ctaLink = page.getByRole('link', { name: /analyze your yard/i });
    await expect(ctaLink).toBeVisible();
    await expect(ctaLink).toHaveAttribute('href', '/analyze');
  });

  test('header nav links navigate correctly', async ({ page }) => {
    await page.goto('/');

    const header = page.getByRole('banner');

    // Navigate to Analyze
    await header.getByRole('link', { name: 'Analyze' }).click();
    await expect(page).toHaveURL(/\/analyze$/);

    // Navigate to Browse Plants
    await header.getByRole('link', { name: 'Browse Plants' }).click();
    await expect(page).toHaveURL(/\/plants$/);

    // Navigate home via logo
    await header.getByRole('link', { name: 'Landscape Architect' }).click();
    await expect(page).toHaveURL(/\/$/);
  });

  test('unknown route does not crash the app', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await page.goto('/nonexistent-route');

    // Page should load without JS errors
    expect(errors).toHaveLength(0);

    // Should still be able to navigate to a valid route
    await page.goto('/');
    await expect(
      page.getByRole('heading', {
        name: /transform your yard/i,
        level: 1,
      }),
    ).toBeVisible();
  });
});
