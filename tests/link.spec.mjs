import { test, expect, button, buildRoute, UPCS } from './fixtures.mjs';

// The query string forces a full page load; a hash-only change on the same page would not.
const linkTo = upcs => `/index.html?from=link#upcs=${upcs.join(',')}`;

test('a #upcs= link fills the UPC box without looking anything up', async ({ app }) => {
  const { page, services } = app;
  const linked = UPCS.slice(0, 3);
  await page.goto(linkTo(linked));

  await expect(page.locator('#upc-input')).toHaveValue(linked.join('\n'));
  await expect(page.getByText('Opened from a link with 3 UPCs. Review them, then press Build route.')).toBeVisible();
  expect(new URL(page.url()).hash).toBe('');
  expect(services.calls.gis).toEqual([]);
  expect(services.calls.osrm).toEqual([]);

  await page.click('#external-consent');
  await button(page, 'Build route').click();
  await expect(page.getByText('Route ready').first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByLabel('Lookup results')).toContainText('Found3');
  expect(app.errors).toEqual([]);
});

test('a link does not replace a saved route until Build route is confirmed', async ({ app }) => {
  const { page } = app;
  await buildRoute(page);
  await expect(page.getByText(`Showing ${UPCS.length} of ${UPCS.length} stops.`)).toBeVisible();

  const linked = UPCS.slice(0, 2);
  await page.goto(linkTo(linked));

  await expect(page.locator('#upc-input')).toHaveValue(linked.join('\n'));
  await expect(page.getByText(`your saved ${UPCS.length}-property route stays open`)).toBeVisible();
  await expect(page.getByText(`Showing ${UPCS.length} of ${UPCS.length} stops.`)).toBeVisible();

  await button(page, 'Build route').click();
  await expect(page.getByRole('alertdialog')).toContainText('Replace the active route?');
  expect(app.errors).toEqual([]);
});

test('a refresh after opening a link does not re-import it', async ({ app }) => {
  const { page } = app;
  await page.goto(linkTo(UPCS.slice(0, 2)));
  await expect(page.locator('#upc-input')).toHaveValue(UPCS.slice(0, 2).join('\n'));
  await page.locator('#upc-input').fill('');

  await page.reload();
  await expect(page.locator('#upc-input')).toHaveValue('');
  await expect(page.getByText('Opened from a link')).toHaveCount(0);
});
