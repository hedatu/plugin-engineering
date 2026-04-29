import { readFile } from "node:fs/promises";
import path from "node:path";

const repoRoot = process.cwd();
const siteRoot = path.join(
  repoRoot,
  "plugin-engineering-factory",
  "generated",
  "plugin-pages",
  "leadfill-one-profile"
);

function fail(message) {
  console.error(message);
  process.exit(1);
}

async function read(relativePath) {
  return readFile(path.join(siteRoot, relativePath), "utf8");
}

const requiredPages = [
  "index.html",
  "zh-cn/index.html",
  "products/index.html",
  "zh-cn/products/index.html",
  "leadfill.html",
  "zh-cn/leadfill.html",
  "chatgpt-obsidian-local-exporter.html",
  "zh-cn/chatgpt-obsidian-local-exporter.html",
  "chatgpt-obsidian-local-exporter-pricing.html",
  "zh-cn/chatgpt-obsidian-local-exporter-pricing.html",
  "account.html",
  "zh-cn/account.html",
  "privacy.html",
  "zh-cn/privacy.html",
  "terms.html",
  "zh-cn/terms.html"
];

const pages = Object.fromEntries(
  await Promise.all(requiredPages.map(async (page) => [page, await read(page)]))
);

for (const [page, html] of Object.entries(pages)) {
  if (!html.includes("G-V93ET05FSR")) {
    fail(`site: GA4 tag missing from ${page}`);
  }
  if (html.includes("/assets/index-")) {
    fail(`site: apps/web SPA asset found in ${page}`);
  }
  if (html.includes("chatgpt2obsidian")) {
    fail(`site: legacy chatgpt2obsidian string found in ${page}`);
  }
  const forbiddenTokenFragments = [
    ["WAFFO", "PRIVATE", "KEY"],
    ["SUPABASE", "SERVICE", "ROLE", "KEY"],
    ["SMTP", "PASSWORD"],
    ["RESEND", "API", "KEY"],
    ["CF", "API", "TOKEN"]
  ];
  for (const parts of forbiddenTokenFragments) {
    const secretToken = parts.join("_");
    if (html.includes(secretToken)) {
      fail(`site: forbidden secret token marker found in ${page}`);
    }
  }
}

if (!pages["index.html"].includes("HWH Extensions | Chrome Extension Marketplace")) {
  fail("site: English home is not the HWH Extensions marketplace");
}

if (!pages["zh-cn/index.html"].includes("HWH 插件商城 | Chrome 插件商城")) {
  fail("site: Chinese home is not the HWH 插件商城 marketplace");
}

if (!pages["index.html"].includes("ChatGPT Obsidian Local Exporter")) {
  fail("site: marketplace home must include ChatGPT Obsidian Local Exporter");
}

if (!pages["chatgpt-obsidian-local-exporter.html"].includes("Pending launch")
  || !pages["chatgpt-obsidian-local-exporter-pricing.html"].includes("Pending launch")) {
  fail("site: Obsidian exporter English pages must stay pending until Google review approval");
}

if (!pages["zh-cn/chatgpt-obsidian-local-exporter.html"].includes("待上线")
  || !pages["zh-cn/chatgpt-obsidian-local-exporter-pricing.html"].includes("待上线")) {
  fail("site: Obsidian exporter Chinese pages must stay 待上线 until Google review approval");
}

if (!pages["chatgpt-obsidian-local-exporter-pricing.html"].includes("data-plan-href=\"#pending-review\"")) {
  fail("site: Obsidian exporter pricing must not open checkout while review is pending");
}

if (!pages["leadfill.html"].includes("chromewebstore.google.com")) {
  fail("site: LeadFill published page must keep its Chrome Web Store install link");
}

console.log(JSON.stringify({
  siteSmokePassed: true,
  source: "plugin-engineering-factory/generated/plugin-pages/leadfill-one-profile",
  pagesChecked: requiredPages.length,
  ga4: "G-V93ET05FSR",
  currentProductionPresentation: "static bilingual HWH Extensions marketplace"
}, null, 2));
