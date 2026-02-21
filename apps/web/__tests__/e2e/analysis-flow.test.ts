import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_IMAGE = path.join(__dirname, 'fixtures', 'test-yard.jpg');

test.describe('Full Analysis Flow', () => {
  test.skip(
    !process.env['RUN_FULL_E2E'],
    'Skipped: set RUN_FULL_E2E=1 to run this test (requires full stack + Claude API key)',
  );

  test('upload photo → enter location → submit → see results', async ({ page }) => {
    test.setTimeout(120_000);

    await page.goto('/analyze');

    // Upload photo
    const fileInput = page.locator('[data-testid="photo-input"]');
    await fileInput.setInputFiles(TEST_IMAGE);
    await expect(page.getByAltText('Yard photo preview')).toBeVisible();

    // Enter location via fallback
    const locationInput = page.getByLabel('Location');
    await locationInput.fill('Charlotte, North Carolina');
    await locationInput.blur();
    await expect(page.locator('#location-confirmed')).toBeVisible();

    // Submit
    const submitButton = page.getByRole('button', {
      name: /analyze my yard/i,
    });
    await expect(submitButton).toBeEnabled();
    await submitButton.click();

    // Should navigate to results page and show analysis
    await expect(page).toHaveURL(/\/analyze\/.+/, {
      timeout: 15_000,
    });

    // Wait for analysis to complete (polling)
    await expect(page.getByRole('heading', { name: /your yard analysis/i })).toBeVisible({
      timeout: 120_000,
    });

    // Verify key results sections
    await expect(page.getByText('Plant Recommendations')).toBeVisible();
  });
});
