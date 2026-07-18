import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const controller = await readFile(new URL('../../app/controllers/Vortex.scala', import.meta.url), 'utf8');
const assetHelper = await readFile(
  new URL('../../modules/web/src/main/helper/AssetFullHelper.scala', import.meta.url),
  'utf8',
);
const policy = await readFile(
  new URL('../../modules/web/src/main/ContentSecurityPolicy.scala', import.meta.url),
  'utf8',
);

test('uses one validated Vortex public origin for runtime config and page CSP', () => {
  assert.match(controller, /VortexPublicOrigin\.configured\(\)/);
  assert.doesNotMatch(controller, /sys\.env\.get\("VORTEX_PUBLIC_URL"\)/);
  assert.match(assetHelper, /VortexPublicOrigin\.configured\(\)\.toOption\.flatten/);
  assert.match(policy, /connectSrc = [^\n]+ ::: vortexSrc/);
  assert.match(policy, /scriptSrc = [^\n]+ ::: vortexSrc/);
});
