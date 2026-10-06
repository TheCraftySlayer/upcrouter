// Shared test fixture: every external service the planner talks to is mocked here,
// so tests are deterministic and never send coordinates or UPCs off the machine.
import { test as base, expect } from '@playwright/test';

export const LAYER_ID = 'f0093002972e4f1e823c0368ea06cf75-19e83adb259-layer-9-1';
export const WEB_MAP_ITEM = LAYER_ID.slice(0, 32);
export const UPCS = Array.from({ length: 7 }, (_, i) => '1014057' + String(10000000000 + i * 1111));
export const MISSING_UPC = '101405700000000999';
export const OBJECT_ID_BASE = 1000;

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
const JSON_CORS = { 'access-control-allow-origin': '*', 'content-type': 'application/json' };

// Parcel k is a ~100 m square, stepped northwest from Albuquerque so routes have distinct points.
export function parcelCenter(k) {
  return { lat: 35.05 + k * 0.01, lng: -106.62 - k * 0.01 };
}

function parcelFeature(upc) {
  const k = UPCS.indexOf(upc);
  const { lat, lng } = parcelCenter(k);
  const d = 0.0005;
  return {
    type: 'Feature',
    id: OBJECT_ID_BASE + k,
    properties: { OBJECTID: OBJECT_ID_BASE + k, UPC: upc, SITUSADD: `${100 + k} TEST ST NW`, SITUSCITY: 'ALBUQUERQUE' },
    geometry: { type: 'Polygon', coordinates: [[[lng - d, lat - d], [lng + d, lat - d], [lng + d, lat + d], [lng - d, lat + d], [lng - d, lat - d]]] },
  };
}

// Minimal web map: the parcel layer is operational layer `<timestamp>-layer-9`, sublayer 1.
export function webMap(...operationalIds) {
  const ids = operationalIds.length ? operationalIds : [LAYER_ID.split('-').slice(1, 4).join('-')];
  return {
    operationalLayers: [
      { id: '19e83ad0000-layer-3', title: 'Roads', layerType: 'ArcGISFeatureLayer' },
      ...ids.map(id => ({ id, title: 'Parcels', layerType: 'ArcGISMapServiceLayer', layers: [{ id: 1, name: 'Parcels' }] })),
    ],
  };
}

export const test = base.extend({
  services: async ({ context }, use) => {
    const calls = { gis: [], osrm: [], webMap: 0, external: [] };
    const state = { webMap: webMap(), webMapStatus: 200 };

    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.hostname === 'localhost') return route.continue();

      if (url.hostname === 'assessormap.bernco.gov' && url.pathname.endsWith('/MapServer/0/query')) {
        const upcs = [...(url.searchParams.get('where') || '').matchAll(/'(\d{18})'/g)].map(m => m[1]);
        calls.gis.push(upcs);
        const features = upcs.filter(upc => UPCS.includes(upc)).map(parcelFeature);
        return route.fulfill({ headers: JSON_CORS, body: JSON.stringify({ type: 'FeatureCollection', features }) });
      }

      if (url.hostname === 'assessormap.bernco.gov' && url.pathname.endsWith(`/content/items/${WEB_MAP_ITEM}/data`)) {
        calls.webMap += 1;
        return route.fulfill({ status: state.webMapStatus, headers: JSON_CORS, body: JSON.stringify(state.webMap) });
      }

      if (url.hostname === 'router.project-osrm.org') {
        const service = url.pathname.split('/')[1];
        calls.osrm.push(service);
        const coords = url.pathname.split('/').pop().split(';').map(c => c.split(',').map(Number));
        const body =
          service === 'table' ? { code: 'Ok', durations: coords.map(a => coords.map(b => Math.hypot(a[0] - b[0], a[1] - b[1]) * 60000)) } :
          service === 'route' ? { code: 'Ok', routes: [{ geometry: { coordinates: coords }, distance: 1000 * coords.length, duration: 60 * coords.length }] } :
          { code: 'Ok', waypoints: [{ location: [coords[0][0] + 0.0001, coords[0][1]], distance: 10 }] };
        return route.fulfill({ headers: JSON_CORS, body: JSON.stringify(body) });
      }

      if (url.hostname === 'tile.openstreetmap.org') {
        return route.fulfill({ headers: { 'content-type': 'image/png' }, body: PNG });
      }

      calls.external.push(url.toString());
      return route.fulfill({ status: 204 });
    });

    await use({ calls, state });
  },

  // Loaded planner page that records navigation it would open in a new tab instead of opening it.
  webMapLayers: [[], { option: true }],
  app: async ({ page, services, webMapLayers }, use) => {
    if (webMapLayers.length) services.state.webMap = webMap(...webMapLayers);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.addInitScript(() => {
      window.__opened = [];
      const click = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = function () {
        if (this.target === '_blank') return void window.__opened.push(this.href);
        return click.call(this);
      };
      window.open = url => { window.__opened.push(String(url)); return null; };
    });
    await page.goto('/index.html');
    await use({ page, services, errors });
  },
});

export { expect };

export const button = (page, name) => page.getByRole('button', { name, exact: true }).first();

export async function openedUrls(page) {
  return page.evaluate(() => window.__opened.splice(0));
}

export async function buildRoute(page, { upcs = [...UPCS, UPCS[0], MISSING_UPC, '12345'], snap = false } = {}) {
  await page.fill('#upc-input', upcs.join('\n'));
  await page.click('#external-consent');
  if (snap) await page.click('#snap-roads');
  await button(page, 'Build route').click();
  await expect(page.getByText('Route ready').first()).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('.leaflet-container[data-map-ready="true"]')).toBeVisible({ timeout: 20_000 });
}

// Confirms the in-page "Download …?" dialog and returns the downloaded file's text.
export async function download(page, menuLabel) {
  const menuItem = page.getByRole('button', { name: menuLabel }).first();
  await expect(async () => {
    if (!(await menuItem.isVisible())) await button(page, 'Route tools').click();
    await expect(menuItem).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 10_000 });
  await menuItem.click();
  const [file] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('alertdialog').getByRole('button').last().click(),
  ]);
  const stream = await file.createReadStream();
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

export async function mapZoom(page) {
  return page.evaluate(() => {
    const zooms = [...document.querySelectorAll('.leaflet-tile')].map(img => Number(img.src.match(/\/(\d+)\/\d+\/\d+\.png/)?.[1])).filter(Number.isFinite);
    return zooms.length ? Math.max(...zooms) : null;
  });
}

// Imports a backup object, confirming the "Replace the active route?" dialog when a route is open.
export async function importBackup(page, backup) {
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), button(page, 'Import').click()]);
  await chooser.setFiles({ name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) });
  const replace = page.getByRole('alertdialog').getByRole('button', { name: 'Import and replace' });
  const imported = page.getByText('Imported order · GIS revalidated').first();
  await expect(replace.or(imported).first()).toBeVisible({ timeout: 20_000 });
  if (await replace.isVisible()) await replace.click();
  await expect(imported).toBeVisible({ timeout: 20_000 });
}
