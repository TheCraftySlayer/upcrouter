import { test, expect, button, download, UPCS } from './fixtures.mjs';

const OWNER = 'DOE JANE & JOHN';
const rows = UPCS.map((upc, k) => [OWNER, `${100 + k} TEST ST NW`, upc, 'ALBUQUERQUE NM 87114']);

test('pasting spreadsheet rows reads only the UPC column', async ({ app }) => {
  const { page } = app;
  const sheet = [['Owner', 'Situs Address', 'UPC', 'Mailing'], ...rows].map(cells => cells.join('\t')).join('\n');
  await page.fill('#upc-input', sheet);
  await expect(page.locator('#input-summary')).toContainText(`${UPCS.length} ready`);
  await expect(page.locator('#input-summary')).toContainText('read from the spreadsheet’s “UPC” column');
  await expect(page.locator('#input-summary')).not.toContainText('invalid');

  await page.click('#external-consent');
  await button(page, 'Build route').click();
  await expect(page.getByText('Route ready').first()).toBeVisible({ timeout: 20_000 });
  const backup = JSON.parse(await download(page, 'Download route backup'));
  expect(backup.locations).toHaveLength(UPCS.length);
  expect(backup.sourceInput).not.toContain(OWNER); // other spreadsheet columns are not saved
});

test('finds the UPC column in a headerless CSV by its contents', async ({ app }) => {
  const { page } = app;
  const csv = rows.map(cells => cells.map(value => `"${value}"`).join(',')).join('\r\n');
  await page.fill('#upc-input', csv);
  await expect(page.locator('#input-summary')).toContainText(`${UPCS.length} ready`);
  await expect(page.locator('#input-summary')).toContainText('read from spreadsheet column 3');
});

test('accepts UPCs written with dashes in a spreadsheet', async ({ app }) => {
  const { page } = app;
  const dashed = upc => upc.replace(/^(\d)(\d{3})(\d{3})(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1-$2-$3-$4-$5-$6-$7');
  const sheet = ['UPC\tOwner', ...UPCS.map(upc => `${dashed(upc)}\t${OWNER}`)].join('\n');
  await page.fill('#upc-input', sheet);
  await expect(page.locator('#input-summary')).toContainText(`${UPCS.length} ready`);
});

test('warns when Excel turned UPCs into scientific notation', async ({ app }) => {
  const { page } = app;
  const sheet = ['UPC\tOwner', `${UPCS[0]}\t${OWNER}`, `1.00806E+17\t${OWNER}`, `1.01406E+17\t${OWNER}`].join('\n');
  await page.fill('#upc-input', sheet);
  await expect(page.locator('#input-summary')).toContainText('1 ready');
  await expect(page.locator('#input-summary')).toContainText('2 shown in scientific notation');
});

test('a plain list with commas and spaces still works', async ({ app }) => {
  const { page } = app;
  await page.fill('#upc-input', `${UPCS[0]}, ${UPCS[1]}; ${UPCS[2]}\n${UPCS[3]} ${UPCS[4]}`);
  await expect(page.locator('#input-summary')).toContainText('5 entries · 5 ready');
  await expect(page.locator('#input-summary')).not.toContainText('spreadsheet');
});

test('Import loads a CSV file into the UPC box', async ({ app }) => {
  const { page } = app;
  const csv = [['UPC', 'Owner'], ...UPCS.map(upc => [upc, OWNER])].map(cells => cells.join(',')).join('\n');
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), button(page, 'Import').click()]);
  await chooser.setFiles({ name: 'county-export.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await expect(page.getByText(`Loaded ${UPCS.length} UPCs from county-export.csv`).first()).toBeVisible();
  await expect(page.locator('#upc-input')).toHaveValue(UPCS.join('\n'));
  expect(app.errors).toEqual([]);
});
