import { test, expect, type Page } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_IMAGE = path.join(__dirname, 'fixtures', 'test-yard.jpg');

/**
 * Detect whether the location component rendered in Places mode or fallback mode.
 */
async function detectLocationMode(page: Page): Promise<'places' | 'fallback'> {
  const placesContainer = page.locator('[data-testid="location-search-places"]');
  const fallbackHint = page.getByText('Suggestions are unavailable');

  return Promise.race([
    placesContainer.waitFor({ timeout: 10_000 }).then(() => 'places' as const),
    fallbackHint.waitFor({ timeout: 10_000 }).then(() => 'fallback' as const),
  ]);
}

/**
 * In Places mode, dispatch a synthetic gmp-select event to simulate picking a place.
 * The component's real event handler runs against our mock fetchFields response.
 */
async function selectPlaceSynthetic(page: Page, name: string): Promise<void> {
  await page.evaluate((placeName) => {
    const container = document.querySelector('[data-testid="location-search-places"]');
    const pac = container?.firstElementChild;
    if (!pac) throw new Error('PlaceAutocompleteElement not found');

    const event = new Event('gmp-select', { bubbles: true });
    Object.defineProperty(event, 'place', {
      value: {
        displayName: placeName,
        fetchFields: () =>
          Promise.resolve({
            place: {
              location: null,
              formattedAddress: placeName,
              displayName: placeName,
            },
          }),
      },
    });
    pac.dispatchEvent(event);
  }, name);
}

test.describe('Analyze Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/analyze');
  });

  test('renders form elements', async ({ page }) => {
    await expect(page.getByText('Analyze Your Yard')).toBeVisible();

    await expect(page.getByRole('button', { name: /upload photo/i })).toBeVisible();

    const mode = await detectLocationMode(page);
    if (mode === 'places') {
      await expect(page.locator('[data-testid="location-search-places"]')).toBeVisible();
    } else {
      await expect(page.getByLabel('Location')).toBeVisible();
    }

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

    const mode = await detectLocationMode(page);

    // Remove photo, add location only → still disabled
    await page.getByRole('button', { name: /remove photo/i }).click();
    if (mode === 'fallback') {
      const locationInput = page.getByLabel('Location');
      await locationInput.fill('Charlotte, North Carolina');
      await locationInput.blur();
    } else {
      await selectPlaceSynthetic(page, 'Charlotte, North Carolina');
      await expect(page.locator('#location-confirmed')).toBeVisible();
    }
    await expect(submitButton).toBeDisabled();

    // Both photo and location → enabled
    await fileInput.setInputFiles(TEST_IMAGE);
    await expect(submitButton).toBeEnabled();
  });

  test('Google Places autocomplete renders when API key is present', async ({ page }) => {
    const mode = await detectLocationMode(page);
    test.skip(mode === 'fallback', 'No Google Places API key in build');

    // Places mode rendered — verify the custom element was mounted inside the container
    const placesContainer = page.locator('[data-testid="location-search-places"]');
    await expect(placesContainer).toBeVisible();
    const childCount = await placesContainer.evaluate((el) => el.children.length);
    expect(childCount).toBeGreaterThan(0);
  });

  test('location fallback works without Google Places', async ({ page }) => {
    const mode = await detectLocationMode(page);
    test.skip(mode === 'places', 'Google Places API is available — fallback not rendered');

    const locationInput = page.getByLabel('Location');
    await locationInput.fill('Charlotte, North Carolina');
    await locationInput.blur();

    // Confirmation text should appear with the location name
    const confirmation = page.locator('#location-confirmed');
    await expect(confirmation).toBeVisible();
    await expect(confirmation).toContainText('Charlotte, North Carolina');
  });
});
