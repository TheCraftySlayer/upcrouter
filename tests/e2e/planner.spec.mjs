import { test, expect, button, buildRoute, download, importBackup, mapZoom, openedUrls, LAYER_ID, UPCS, MISSING_UPC, parcelCenter } from './fixtures.mjs';

test('loads with no console errors', async ({ app }) => {
  await expect(app.page.getByRole('heading', { name: 'Property Route Planner' })).toBeVisible();
  await expect(button(app.page, 'Build route')).toBeVisible();
  expect(app.errors).toEqual([]);
});

test('builds a route and reports lookup exceptions', async ({ app }) => {
  const { page } = app;
  await buildRoute(page);
  const results = page.getByLabel('Lookup results');
  await expect(results).toContainText('Found7');
  await expect(results).toContainText('Not found1');
  await expect(results).toContainText('Invalid1');
  await expect(results).toContainText('Duplicates1');
  await expect(page.getByText(`Showing ${UPCS.length} of ${UPCS.length} stops.`)).toBeVisible();
  expect(app.services.calls.gis.flat()).toContain(MISSING_UPC);
  expect(app.errors).toEqual([]);
});

test('CSV export keeps coordinates numeric', async ({ app }) => {
  const { page } = app;
  await buildRoute(page);
  const csv = await download(page, 'Export results CSV');
  const [header, first] = csv.replace(/^﻿/, '').split(/\r?\n/).map(line => line.split('","').map(cell => cell.replace(/^"|"$/g, '')));
  for (const column of ['Latitude', 'Longitude', 'Parcel Center Latitude', 'Parcel Center Longitude']) {
    const value = first[header.indexOf(column)];
    expect(value, column).toMatch(/^-?\d+\.\d+$/);
  }
});

test('CSV export still escapes formula-like text', async ({ app }) => {
  const { page } = app;
  await buildRoute(page);
  await page.getByPlaceholder('Optional notes').first().fill('=HYPERLINK("x")');
  const csv = await download(page, 'Export results CSV');
  expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
});

test('backup export and import round-trips navigation points', async ({ app }) => {
  const { page } = app;
  await buildRoute(page, { snap: true });
  await button(page, 'Confirm point').click();
  await expect(page.getByText('Navigation point confirmed').first()).toBeVisible();
  const before = JSON.parse(await download(page, 'Download route backup'));

  await importBackup(page, before);

  const after = JSON.parse(await download(page, 'Download route backup'));
  const pick = stop => [stop.upc, stop.lat, stop.lng, stop.snapped, stop.manualPoint, stop.navConfirmed];
  expect(after.locations.map(pick)).toEqual(before.locations.map(pick));
  expect(before.locations.some(stop => stop.snapped)).toBe(true);
});

test('import drops a stale snapped point and its confirmation', async ({ app }) => {
  const { page } = app;
  await buildRoute(page, { snap: true });
  await button(page, 'Confirm point').click();
  const backup = JSON.parse(await download(page, 'Download route backup'));
  const stale = backup.locations[0];
  stale.lng -= 0.01; // ~900 m: beyond the default 500 m snap limit
  stale.navConfirmed = true;

  await importBackup(page, backup);

  const restored = JSON.parse(await download(page, 'Download route backup')).locations.find(stop => stop.upc === stale.upc);
  expect(restored.lng).toBeCloseTo(restored.centroidLng, 9);
  expect(restored.snapped).toBe(false);
  expect(restored.navConfirmed).toBe(false);
});

test('selecting and confirming a stop keeps the map view without new routing calls', async ({ app }) => {
  const { page, services } = app;
  await buildRoute(page);
  await page.locator('.leaflet-control-zoom-in').click();
  await page.locator('.leaflet-control-zoom-in').click();
  await expect.poll(() => mapZoom(page)).toBeGreaterThan(12);
  const zoom = await mapZoom(page);
  const routeCalls = services.calls.osrm.filter(s => s === 'route').length;

  await page.getByRole('button', { name: 'Select on map' }).first().click();
  await expect(page.locator('.selected-parcel-panel')).toContainText(UPCS[1]);
  await button(page, 'Confirm point').click();
  await expect(page.getByText('Navigation point confirmed').first()).toBeVisible();
  await expect(page.locator('.leaflet-container[data-map-ready="true"]')).toBeVisible();

  expect(await mapZoom(page)).toBe(zoom);
  expect(services.calls.osrm.filter(s => s === 'route').length).toBe(routeCalls);
});

test('adjust mode zooms in so drags are precise', async ({ app }) => {
  const { page } = app;
  await buildRoute(page);
  await button(page, 'Adjust point on map').click();
  await expect.poll(() => mapZoom(page)).toBeGreaterThanOrEqual(17);
  const marker = page.locator('.leaflet-marker-draggable').first();
  await marker.scrollIntoViewIfNeeded();
  const box = await marker.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2 + 30, { steps: 10 });
  await page.mouse.up();
  await expect(page.getByText('Navigation point adjusted and confirmed').first()).toBeVisible();
  const distance = await page.locator('.selected-parcel-metrics').innerText();
  expect(distance).toMatch(/\d+ ft/); // feet, not miles
});

test('Assessor Map link selects the parcel by UPC and zooms to it', async ({ app }) => {
  const { page } = app;
  await buildRoute(page);
  await button(page, 'Open parcel in Assessor Map').click();
  const [url] = (await openedUrls(page)).map(decodeURIComponent);
  expect(url).toContain(`#data_s=where:${LAYER_ID}:UPC='${UPCS[0]}'`);
  expect(url).toContain('zoom_to_selection=true');
});

test('navigation links cover the route', async ({ app }) => {
  const { page } = app;
  await buildRoute(page);
  const params = url => new URL(url).searchParams;

  await page.getByRole('button', { name: /Route 1 of 2/ }).click();
  const [first] = await openedUrls(page);
  expect(params(first).get('origin')).toBe('35.08302237882336,-106.65286131510351');
  expect(params(first).get('waypoints').split('|')).toHaveLength(3);

  await button(page, 'Navigate from current location').click();
  const [single] = await openedUrls(page);
  expect(params(single).get('origin')).toBeNull();
  expect(params(single).get('dir_action')).toBe('navigate');
  const { lat, lng } = parcelCenter(0);
  expect(params(single).get('destination')).toMatch(new RegExp(`^${lat.toFixed(2)}\\d*,${lng.toFixed(2)}`));
});

test('status changes, undo, and reload persistence', async ({ app }) => {
  const { page } = app;
  await buildRoute(page);
  await button(page, 'Mark completed').click();
  await expect(page.getByText('Stop 1 marked completed').first()).toBeVisible();
  await button(page, 'Mark for revisit').click();
  await expect(page.getByText('Stop 2 marked revisit').first()).toBeVisible();
  await button(page, 'Undo last status').click();
  await expect(page.getByText('Restored stop 2 to pending').first()).toBeVisible();

  await page.reload();
  await expect(page.getByText(/Restored 7 properties and their field progress/).first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByLabel(/of 7 stops handled/)).toHaveAttribute('aria-label', '1 of 7 stops handled');
  expect(app.errors).toEqual([]);
});


test('resuming from current location explains how many stops were opened', async ({ app }) => {
  const { page } = app;
  await buildRoute(page);
  await button(page, 'Resume from current location').click();
  const [url] = await openedUrls(page);
  expect(new URL(url).searchParams.get('origin')).toBeNull();
  await expect(page.getByText('Stops 1–4 from your current location').first()).toBeVisible();
  await expect(page.getByText(/3 more stops follow/).first()).toBeVisible();

  await button(page, 'Mark for revisit').click();
  await button(page, 'Resume revisit from current location').click();
  await expect(page.getByText(/^Stop 7 from your current location, then back to the office\.$/).first()).toBeVisible();
});
