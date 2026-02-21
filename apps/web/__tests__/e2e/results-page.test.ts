import { test, expect } from '@playwright/test';

test.describe('Results Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/analyze/nonexistent-id');

    // The API should return 404 for a nonexistent analysis, rendering
    // "This analysis has expired". If the API backend isn't available
    // (e.g. no DynamoDB), it returns 500 and shows a generic error instead.
    const expired = page.getByText('This analysis has expired');
    const genericError = page.getByText(/failed to load analysis/i);

    const result = await Promise.race([
      expired.waitFor({ timeout: 10_000 }).then(() => 'expired' as const),
      genericError.waitFor({ timeout: 10_000 }).then(() => 'error' as const),
    ]);

    test.skip(result === 'error', 'API backend not available — skipping results page tests');
  });

  test('invalid analysis ID shows expired state', async ({ page }) => {
    await expect(page.getByText('This analysis has expired')).toBeVisible();
  });

  test('expired page has link to analyze another yard', async ({ page }) => {
    await expect(page.getByText('This analysis has expired')).toBeVisible();

    const analyzeLink = page.getByRole('link', {
      name: /analyze a new yard/i,
    });
    await expect(analyzeLink).toBeVisible();
    await expect(analyzeLink).toHaveAttribute('href', '/analyze');
  });
});
