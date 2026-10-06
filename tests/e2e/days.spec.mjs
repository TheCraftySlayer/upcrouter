import { test, expect, button, buildRoute, download, importBackup, openedUrls, UPCS } from './fixtures.mjs';

const ALL = { upcs: UPCS };

async function planDays(page, perDay, expectedDays) {
  await expect(async () => {
    if (!(await page.locator('#stops-per-day').isVisible())) await button(page, 'Route tools').click();
    await expect(page.locator('#stops-per-day')).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 10_000 });
  await page.fill('#stops-per-day', String(perDay));
  await button(page, 'Split into days').click();
  // The route method label changes only once the new plan is applied (a previous toast may still be showing).
  await expect(page.getByText(`Planned in ${expectedDays} ${expectedDays === 1 ? 'day' : 'days'}`, { exact: false }).first()).toBeVisible({ timeout: 20_000 });
}

async function savedStops(page) {
  return JSON.parse(await download(page, 'Download route backup')).locations;
}

// Stops of one day must sit together in the list, in day order.
function expectContiguousDays(stops) {
  const sequence = stops.filter(stop => stop.status === 'pending').map(stop => stop.day);
  expect(sequence).toEqual([...sequence].sort((a, b) => a - b));
}

test('splits pending stops into balanced days', async ({ app }) => {
  const { page } = app;
  await buildRoute(page, ALL);
  await planDays(page, 3, 3);

  const stops = await savedStops(page);
  const sizes = [1, 2, 3].map(day => stops.filter(stop => stop.day === day).length);
  expect(sizes).toEqual([3, 2, 2]);
  expectContiguousDays(stops);
  await expect(page.locator('.day-badge')).toHaveCount(UPCS.length);
  await expect(page.locator('.route-category--primary h3')).toHaveText(/^Day 1 · /);
  expect(app.errors).toEqual([]);
});

test('navigation follows the working day', async ({ app }) => {
  const { page } = app;
  await buildRoute(page, ALL);
  await planDays(page, 4, 2);
  const stops = await savedStops(page);
  const dayOne = stops.filter(stop => stop.day === 1).map(stop => `${stop.lat},${stop.lng}`);

  await page.getByRole('button', { name: /Primary Route · Day 1 · Open in Google Maps/ }).first().click();
  const [url] = await openedUrls(page);
  const params = new URL(url).searchParams;
  const visited = [...params.get('waypoints').split('|'), params.get('destination')].filter(point => !point.startsWith('35.0830'));
  expect(visited.sort()).toEqual([...dayOne].sort());

  // Finish day 1: the working day moves to day 2.
  for (let index = 0; index < dayOne.length; index += 1) {
    await button(page, 'Mark completed').click();
    await expect(page.getByText(/marked completed/).first()).toBeVisible();
  }
  await expect(page.locator('.route-category--primary h3')).toHaveText(/^Day 2 · /);
  await button(page, 'Resume from last completed').click();
  const [resume] = await openedUrls(page);
  const dayTwo = stops.filter(stop => stop.day === 2).map(stop => `${stop.lat},${stop.lng}`);
  const resumed = new URL(resume).searchParams;
  const resumeStops = [...(resumed.get('waypoints')?.split('|') ?? []), resumed.get('destination')].filter(point => !point.startsWith('35.0830'));
  expect(resumeStops.every(point => dayTwo.includes(point))).toBe(true);
});

test('picking a day under Show scopes the list and navigation', async ({ app }) => {
  const { page } = app;
  await buildRoute(page, ALL);
  await planDays(page, 3, 3);
  await page.locator('#route-filter').click();
  await page.getByRole('option', { name: 'Day 2 · 2 stops' }).click();
  await expect(page.getByText(/^Showing 2 of 7 stops/)).toBeVisible();
  await expect(page.locator('.route-category--primary h3')).toHaveText(/^Day 2 · /);
});

test('days survive reload, backup import, and appear in the CSV', async ({ app }) => {
  const { page } = app;
  await buildRoute(page, ALL);
  await planDays(page, 3, 3);
  const before = await savedStops(page);

  const csv = await download(page, 'Export results CSV');
  const [header, first] = csv.replace(/^﻿/, '').split(/\r?\n/).map(line => line.split('","').map(cell => cell.replace(/^"|"$/g, '')));
  expect(header[1]).toBe('Day');
  expect(first[1]).toBe(String(before[0].day));

  await page.reload();
  await expect(page.getByText(/Restored 7 properties/).first()).toBeVisible({ timeout: 20_000 });
  expect((await savedStops(page)).map(stop => [stop.upc, stop.day])).toEqual(before.map(stop => [stop.upc, stop.day]));

  await importBackup(page, { schemaVersion: 6, gisValidated: true, locations: before });
  expect((await savedStops(page)).map(stop => [stop.upc, stop.day])).toEqual(before.map(stop => [stop.upc, stop.day]));
});

test('optimizing remaining stops keeps each day together', async ({ app }) => {
  const { page } = app;
  await buildRoute(page, ALL);
  await planDays(page, 3, 3);
  const before = await savedStops(page);
  await button(page, 'Optimize remaining stops').click();
  await expect(page.getByText('Each day and the revisit route optimized separately').first()).toBeVisible({ timeout: 20_000 });
  const after = await savedStops(page);
  expectContiguousDays(after);
  for (const day of [1, 2, 3]) {
    const set = stops => stops.filter(stop => stop.day === day).map(stop => stop.upc).sort();
    expect(set(after)).toEqual(set(before));
  }
});

test('completed stops keep their day when the rest is re-planned', async ({ app }) => {
  const { page } = app;
  await buildRoute(page, ALL);
  await planDays(page, 3, 3);
  await button(page, 'Mark completed').click();
  const done = (await savedStops(page)).find(stop => stop.status === 'completed');
  await planDays(page, 6, 1);
  const after = await savedStops(page);
  expect(after.find(stop => stop.upc === done.upc).day).toBe(done.day);
  expect(after.filter(stop => stop.status === 'pending').every(stop => stop.day === 1)).toBe(true);
});

test('Clear days removes the plan', async ({ app }) => {
  const { page } = app;
  await buildRoute(page, ALL);
  await planDays(page, 3, 3);
  await button(page, 'Clear days').click();
  await expect(page.locator('.day-badge')).toHaveCount(0);
  await expect(page.locator('.route-category--primary h3')).not.toContainText('Day');
  expect((await savedStops(page)).every(stop => stop.day === null)).toBe(true);
});
