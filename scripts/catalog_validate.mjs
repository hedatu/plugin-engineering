import { readFile } from 'node:fs/promises';
import path from 'node:path';

const repoRoot = process.cwd();

function fail(message) {
  console.error(message);
  process.exit(1);
}

const contractPath = path.join(repoRoot, 'docs', '161_product_catalog_contract.json');
const contract = JSON.parse(await readFile(contractPath, 'utf8'));

if (!Array.isArray(contract.activeProducts) || contract.activeProducts.length !== 1) {
  fail('catalog: expected exactly one active product in docs/161_product_catalog_contract.json');
}

const [product] = contract.activeProducts;

if (product.productKey !== 'leadfill-one-profile') {
  fail('catalog: active productKey must be leadfill-one-profile');
}

if (product.slug !== 'leadfill-one-profile') {
  fail('catalog: active slug must be leadfill-one-profile');
}

if (product.pricingPath !== '/products/leadfill-one-profile/pricing') {
  fail('catalog: pricingPath must point to /products/leadfill-one-profile/pricing');
}

if (product.checkoutStartPath !== '/checkout/start') {
  fail('catalog: checkoutStartPath must be /checkout/start');
}

const activeSourceFiles = [
  path.join(repoRoot, 'apps', 'web', 'src', 'App.tsx'),
  path.join(repoRoot, 'apps', 'web', 'src', 'pages', 'ProductsPage.tsx'),
  path.join(repoRoot, 'apps', 'web', 'src', 'pages', 'ProductPage.tsx'),
  path.join(repoRoot, 'apps', 'web', 'src', 'pages', 'PricingPage.tsx'),
  path.join(repoRoot, 'extensions', 'main-extension', 'src', 'popup', 'App.tsx'),
  path.join(repoRoot, 'extensions', 'main-extension', 'src', 'options', 'App.tsx'),
];

for (const filePath of activeSourceFiles) {
  const text = await readFile(filePath, 'utf8');
  if (text.includes('chatgpt2obsidian')) {
    fail(`catalog: legacy string chatgpt2obsidian still present in active source: ${path.relative(repoRoot, filePath)}`);
  }
}

console.log(JSON.stringify({
  validated: true,
  activeProductKey: product.productKey,
  activeSlug: product.slug,
}, null, 2));
