import { readFile } from 'node:fs/promises';
import path from 'node:path';

const repoRoot = process.cwd();

function fail(message) {
  console.error(message);
  process.exit(1);
}

async function read(relativePath) {
  return readFile(path.join(repoRoot, relativePath), 'utf8');
}

const appTsx = await read('apps/web/src/App.tsx');
const pricingPage = await read('apps/web/src/pages/PricingPage.tsx');
const checkoutStartPage = await read('apps/web/src/pages/CheckoutStartPage.tsx');
const successPage = await read('apps/web/src/pages/SuccessPage.tsx');
const cancelPage = await read('apps/web/src/pages/CancelPage.tsx');
const accountPage = await read('apps/web/src/pages/AccountPage.tsx');
const popupApp = await read('extensions/main-extension/src/popup/App.tsx');
const optionsApp = await read('extensions/main-extension/src/options/App.tsx');
const runtimeFile = await read('extensions/main-extension/src/shared/runtime.ts');

const requiredRoutes = [
  "path: 'products'",
  "path: 'products/:slug'",
  "path: 'products/:slug/pricing'",
  "path: 'checkout/start'",
];

for (const route of requiredRoutes) {
  if (!appTsx.includes(route)) {
    fail(`site: missing route ${route}`);
  }
}

if (!appTsx.includes('Navigate to={getDefaultPricingPath()}')) {
  fail('site: /pricing redirect is not wired to the default product pricing path');
}

if (!pricingPage.includes('buildCheckoutStartPath({')) {
  fail('site: pricing page is not routing through /checkout/start');
}

if (!checkoutStartPage.includes('createCheckoutSession')) {
  fail('site: /checkout/start is not creating checkout sessions');
}

if (!checkoutStartPage.includes('successUrl') || !checkoutStartPage.includes('cancelUrl')) {
  fail('site: /checkout/start must pass successUrl and cancelUrl');
}

if (!successPage.includes('does not unlock Pro locally') && !successPage.includes('backend verifies')) {
  fail('site: success page copy must state that membership is backend verified, not locally unlocked');
}

if (!cancelPage.includes('Paid') && !cancelPage.includes('verified payment event')) {
  fail('site: cancel page must state that no local activation occurs');
}

if (!accountPage.includes('productKey')) {
  fail('site: account page must remain product-scoped');
}

const requiredPricingPortal = '/products/leadfill-one-profile/pricing';
if (!runtimeFile.includes('/products/${config.productSlug}/pricing?')) {
  fail('site: extension runtime is not building the product pricing URL');
}

if (!popupApp.includes('getProductPricingPortalPath') || !optionsApp.includes('getProductPricingPortalPath')) {
  fail('site: extension upgrade entry is not routed through the product pricing URL');
}

const forbiddenInActiveSource = [
  'chatgpt2obsidian',
  'WAFFO_PRIVATE_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'https://checkout.waffo',
];

for (const [name, text] of Object.entries({
  appTsx,
  pricingPage,
  checkoutStartPage,
  popupApp,
  optionsApp,
  runtimeFile,
})) {
  for (const forbidden of forbiddenInActiveSource) {
    if (text.includes(forbidden)) {
      fail(`site: forbidden string "${forbidden}" found in ${name}`);
    }
  }
}

console.log(JSON.stringify({
  siteSmokePassed: true,
  routesChecked: requiredRoutes.length,
  upgradeUrl: requiredPricingPortal,
}, null, 2));
