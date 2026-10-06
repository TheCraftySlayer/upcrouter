import { test, expect, button, buildRoute, openedUrls, LAYER_ID, UPCS } from './fixtures.mjs';

const WEB_MAP = LAYER_ID.slice(0, 32);

async function assessorLayerInLink(page) {
  await buildRoute(page);
  await button(page, 'Open parcel in Assessor Map').click();
  const [url] = (await openedUrls(page)).map(decodeURIComponent);
  expect(url).toContain(`:UPC='${UPCS[0]}'`);
  return /data_s=where:([^:]+):/.exec(url)[1];
}

test('keeps the built-in layer while the web map still has it', async ({ app }) => {
  expect(await assessorLayerInLink(app.page)).toBe(LAYER_ID);
  expect(app.services.calls.webMap).toBe(1);
});

test.describe('after the county re-adds the parcel layer', () => {
  test.use({ webMapLayers: ['1a2b3c4d5e6-layer-9'] });
  test('follows the new layer ID', async ({ app }) => {
    expect(await assessorLayerInLink(app.page)).toBe(`${WEB_MAP}-1a2b3c4d5e6-layer-9-1`);
  });
});

test.describe('when two layers could be the replacement', () => {
  test.use({ webMapLayers: ['1a2b3c4d5e6-layer-9', '1f00000000a-layer-9'] });
  test('keeps the built-in layer', async ({ app }) => {
    expect(await assessorLayerInLink(app.page)).toBe(LAYER_ID);
  });
});

test.describe('when the web map cannot be read', () => {
  test.beforeEach(({ services }) => { services.state.webMapStatus = 500; });
  test('keeps the built-in layer', async ({ app }) => {
    expect(await assessorLayerInLink(app.page)).toBe(LAYER_ID);
  });
});
