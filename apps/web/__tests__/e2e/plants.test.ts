import { test, expect } from '@playwright/test';

test.describe('Plants Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/plants');

    // Skip all tests if the API backend isn't returning plant data
    const plantsLoaded = page.getByText(/plants? found/);
    const apiError = page.getByText(/failed to load/i);
    const noPlants = page.getByText(/no plants match/i);

    const result = await Promise.race([
      plantsLoaded.waitFor({ timeout: 10_000 }).then(() => 'loaded' as const),
      apiError.waitFor({ timeout: 10_000 }).then(() => 'error' as const),
      noPlants.waitFor({ timeout: 10_000 }).then(() => 'empty' as const),
    ]);

    test.skip(result === 'error', 'API backend not available — skipping plant tests');
  });

  test('plant list loads with cards', async ({ page }) => {
    await expect(page.getByText(/plants? found/)).toBeVisible();

    // Verify at least one plant card heading exists
    const plantCards = page.locator('a[href^="/plants/"]');
    await expect(plantCards.first()).toBeVisible();
  });

  test('filter updates results', async ({ page }) => {
    await expect(page.getByText(/plants? found/)).toBeVisible();

    // Get initial count text
    const initialCount = await page.getByText(/plants? found/).textContent();

    // Toggle a light filter
    await page.getByText('Full Sun').click();

    // URL should update with filter param
    await expect(page).toHaveURL(/light=full_sun/);

    // Wait for results to update
    await expect(page.getByText(/plants? found/)).toBeVisible();

    // Count may have changed (or may not, depending on data)
    const filteredCount = await page.getByText(/plants? found/).textContent();

    // At minimum, the page still shows results
    expect(filteredCount).toBeTruthy();

    // Reset filters should restore original state
    if (initialCount !== filteredCount) {
      await page.getByRole('button', { name: /reset filters/i }).click();
      await expect(page.getByText(/plants? found/)).toBeVisible();
    }
  });

  test('clicking a plant card navigates to detail page', async ({ page }) => {
    await expect(page.getByText(/plants? found/)).toBeVisible();

    // Click the first plant card
    const firstCard = page.locator('a[href^="/plants/"]').first();
    await expect(firstCard).toBeVisible();
    await firstCard.click();

    // Should be on a plant detail page
    await expect(page).toHaveURL(/\/plants\/.+/);
  });

  test('plant detail page shows stats', async ({ page }) => {
    await expect(page.getByText(/plants? found/)).toBeVisible();

    // Navigate to first plant
    await page.locator('a[href^="/plants/"]').first().click();
    await expect(page).toHaveURL(/\/plants\/.+/);

    // Verify detail page elements
    await expect(page.locator('h1')).toBeVisible();
    await expect(page.getByText('Quick Stats')).toBeVisible();
    await expect(page.getByRole('link', { name: /back to browse/i })).toBeVisible();
  });
});
