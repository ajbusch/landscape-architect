import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_IMAGE = path.join(__dirname, 'fixtures', 'test-yard.jpg');

test.describe('Analyze Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/analyze');
  });

  test('renders form elements', async ({ page }) => {
    await expect(page.getByText('Analyze Your Yard')).toBeVisible();

    await expect(page.getByRole('button', { name: /upload photo/i })).toBeVisible();

    await expect(page.getByLabel('Location')).toBeVisible();

    const submitButton = page.getByRole('button', {
      name: /analyze my yard/i,
    });
    await expect(submitButton).toBeVisible();
    await expect(submitButton).toBeDisabled();
  });

  test('photo upload shows preview and remove clears it', async ({ page }) => {
    const fileInput = page.locator('[data-testid="photo-input"]');
    await fileInput.setInputFiles(TEST_IMAGE);

    // Preview should appear
    const preview = page.getByAltText('Yard photo preview');
    await expect(preview).toBeVisible();

    // Remove photo
    await page.getByRole('button', { name: /remove photo/i }).click();

    // Preview should be gone, dropzone back
    await expect(preview).not.toBeVisible();
    await expect(page.getByRole('button', { name: /upload photo/i })).toBeVisible();
  });

  test('submit button disabled without both inputs', async ({ page }) => {
    const submitButton = page.getByRole('button', {
      name: /analyze my yard/i,
    });

    // Initially disabled
    await expect(submitButton).toBeDisabled();

    // Photo only → still disabled
    const fileInput = page.locator('[data-testid="photo-input"]');
    await fileInput.setInputFiles(TEST_IMAGE);
    await expect(submitButton).toBeDisabled();

    // Remove photo, add location only → still disabled
    await page.getByRole('button', { name: /remove photo/i }).click();
    const locationInput = page.getByLabel('Location');
    await locationInput.fill('Charlotte, North Carolina');
    await locationInput.blur();
    await expect(submitButton).toBeDisabled();

    // Both photo and location → enabled
    await fileInput.setInputFiles(TEST_IMAGE);
    await expect(submitButton).toBeEnabled();
  });

  test('location fallback works without Google Places', async ({ page }) => {
    const locationInput = page.getByLabel('Location');
    await locationInput.fill('Charlotte, North Carolina');
    await locationInput.blur();

    // Confirmation text should appear with the location name
    const confirmation = page.locator('#location-confirmed');
    await expect(confirmation).toBeVisible();
    await expect(confirmation).toContainText('Charlotte, North Carolina');
  });
});
