import { test, expect, button, buildRoute, UPCS } from './fixtures.mjs';

// The query string forces a full page load; a hash-only change on the same page would not.
const linkTo = upcs => `/index.html?from=link#upcs=${upcs.join(',')}`;
const CONSENT_KEY = 'bernco-property-route-external-consent-v3';

test('a link asks once, then allows public routing and builds the route', async ({ app }) => {
  const { page, services } = app;
  const linked = UPCS.slice(0, 3);
  await page.goto(linkTo(linked));

  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toContainText('Build a route for 3 UPCs?');
  await expect(page.locator('#upc-input')).toHaveValue(linked.join('\n'));
  expect(new URL(page.url()).hash).toBe('');
  expect(services.calls.gis).toEqual([]);
  expect(services.calls.osrm).toEqual([]);

  await dialog.getByRole('button', { name: 'Allow and build route' }).click();
  await expect(page.getByText('Route ready').first()).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('.leaflet-container[data-map-ready="true"]')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByLabel('Lookup results')).toContainText('Found3');
  await expect(page.locator('#external-consent')).toBeChecked();
  await expect.poll(() => page.locator('.leaflet-tile').count()).toBeGreaterThan(0);
  expect(services.calls.osrm.length).toBeGreaterThan(0);
  expect(app.errors).toEqual([]);
});

test('a link builds right away when public routing is already allowed this session', async ({ app }) => {
  const { page, services } = app;
  await page.evaluate(key => sessionStorage.setItem(key, 'yes'), CONSENT_KEY);
  await page.goto(linkTo(UPCS.slice(0, 4)));

  await expect(page.getByText('Route ready').first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  await expect(page.getByLabel('Lookup results')).toContainText('Found4');
  expect(services.calls.osrm.length).toBeGreaterThan(0);
  expect(app.errors).toEqual([]);
});

test('cancelling keeps the UPCs in the box without looking anything up', async ({ app }) => {
  const { page, services } = app;
  const linked = UPCS.slice(0, 2);
  await page.goto(linkTo(linked));
  await page.getByRole('alertdialog').getByRole('button', { name: 'Cancel' }).click();

  await expect(page.locator('#upc-input')).toHaveValue(linked.join('\n'));
  await expect(page.locator('#external-consent')).not.toBeChecked();
  await page.waitForTimeout(500);
  expect(services.calls.gis).toEqual([]);
  expect(services.calls.osrm).toEqual([]);
});

test('a link does not replace a saved route until Build route is confirmed', async ({ app }) => {
  const { page, services } = app;
  await buildRoute(page);
  await expect(page.getByText(`Showing ${UPCS.length} of ${UPCS.length} stops.`)).toBeVisible();
  const gisCalls = services.calls.gis.length;

  const linked = UPCS.slice(0, 2);
  await page.goto(linkTo(linked));

  await expect(page.locator('#upc-input')).toHaveValue(linked.join('\n'));
  await expect(page.getByText(`your saved ${UPCS.length}-property route stays open`)).toBeVisible();
  await expect(page.getByText(`Showing ${UPCS.length} of ${UPCS.length} stops.`)).toBeVisible();
  await expect(page.getByRole('alertdialog')).toHaveCount(0);

  await button(page, 'Build route').click();
  await expect(page.getByRole('alertdialog')).toContainText('Replace the active route?');
  expect(app.errors).toEqual([]);
});

test('a refresh after opening a link does not re-import it', async ({ app }) => {
  const { page } = app;
  await page.goto(linkTo(UPCS.slice(0, 2)));
  await page.getByRole('alertdialog').getByRole('button', { name: 'Cancel' }).click();
  await page.locator('#upc-input').fill('');

  await page.reload();
  await expect(page.locator('#upc-input')).toHaveValue('');
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  await expect(page.getByText('Opened from a link')).toHaveCount(0);
});
