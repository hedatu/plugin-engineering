import fs from "node:fs/promises";
import path from "node:path";
import { ensureDir, nowIso, writeJson, writeText } from "../utils/io.mjs";

export const SITE_LOCALES = [
  { code: "en", label: "English", htmlLang: "en", dir: "" },
  { code: "zh-cn", label: "\u7b80\u4f53\u4e2d\u6587", htmlLang: "zh-CN", dir: "zh-cn" },
  { code: "ja", label: "\u65e5\u672c\u8a9e", htmlLang: "ja", dir: "ja" },
  { code: "es", label: "Espa\u00f1ol", htmlLang: "es", dir: "es" }
];

const LOCALIZED_PAGE_PATHS = [
  "index.html",
  "product.html",
  "pricing.html",
  "account.html",
  "entitlement.html",
  "refund.html",
  "privacy.html",
  "terms.html",
  "checkout/success.html",
  "checkout/cancel.html"
];

function localeDefinition(code = "en") {
  return SITE_LOCALES.find((locale) => locale.code === code) ?? SITE_LOCALES[0];
}

function localizedProductDir(outputDir, localeCode = "en") {
  const locale = localeDefinition(localeCode);
  return locale.dir ? path.join(outputDir, locale.dir) : outputDir;
}

function relativeLink(fromDir, toAbsolutePath) {
  return path.relative(fromDir, toAbsolutePath).replaceAll("\\", "/") || ".";
}

export function renderLocaleSwitcher({ outputDir, localeCode = "en", pageRelativePath = "index.html" }) {
  const locale = localeDefinition(localeCode);
  const currentLocaleDir = localizedProductDir(outputDir, localeCode);
  const currentPageDir = path.join(currentLocaleDir, path.dirname(pageRelativePath));
  const links = SITE_LOCALES.map((item) => {
    const target = relativeLink(currentPageDir, path.join(localizedProductDir(outputDir, item.code), pageRelativePath));
    const activeClass = item.code === locale.code ? " active" : "";
    return `<a class="locale-link${activeClass}" href="${target}" lang="${item.htmlLang}">${item.label}</a>`;
  }).join("");
  return `<div class="locale-switcher" aria-label="Language switcher">${links}</div>`;
}

function rootPrefixForLocalizedPage(pageRelativePath) {
  const dirName = path.dirname(pageRelativePath);
  const nestedDepth = dirName === "." ? 0 : dirName.split(/[\\/]/).length;
  return "../".repeat(nestedDepth + 1);
}

function replaceAllExact(source, from, to) {
  return source.includes(from) ? source.split(from).join(to) : source;
}

function applyReplacements(html, replacements) {
  return replacements.reduce((memo, [from, to]) => replaceAllExact(memo, from, to), html);
}

function localizedPageKey(pageRelativePath) {
  if (pageRelativePath === "checkout/success.html") return "success";
  if (pageRelativePath === "checkout/cancel.html") return "cancel";
  return pageRelativePath.replace(/\.html$/i, "").replaceAll("/", "_");
}

function rewriteLocalizedPaths(html, pageRelativePath) {
  const rootPrefix = rootPrefixForLocalizedPage(pageRelativePath);
  return html
    .replace(/href="styles\.css"/g, `href="${rootPrefix}styles.css"`)
    .replace(/href="\.\.\/styles\.css"/g, `href="${rootPrefix}styles.css"`)
    .replace(/src="assets\//g, `src="${rootPrefix}assets/`)
    .replace(/href="assets\//g, `href="${rootPrefix}assets/`);
}

function sharedLabels(localeCode) {
  const labels = {
    "zh-cn": {
      home: "\u9996\u9875",
      product: "\u4ea7\u54c1",
      pricing: "\u4ef7\u683c",
      account: "\u8d26\u6237",
      unlock: "\u89e3\u9501\u7ec8\u8eab\u7248",
      refund: "\u9000\u6b3e",
      privacy: "\u9690\u79c1",
      terms: "\u6761\u6b3e",
      addToChrome: "\u6dfb\u52a0\u5230 Chrome",
      seeHow: "\u4f7f\u7528\u65b9\u5f0f",
      viewPricing: "\u67e5\u770b\u4ef7\u683c",
      details: "\u4ea7\u54c1\u8be6\u60c5"
    },
    "ja": {
      home: "\u30db\u30fc\u30e0",
      product: "\u88fd\u54c1",
      pricing: "\u6599\u91d1",
      account: "\u30a2\u30ab\u30a6\u30f3\u30c8",
      unlock: "\u8cb7\u3044\u5207\u308a\u3092\u89e3\u9664",
      refund: "\u8fd4\u91d1",
      privacy: "\u30d7\u30e9\u30a4\u30d0\u30b7\u30fc",
      terms: "\u5229\u7528\u898f\u7d04",
      addToChrome: "Chrome \u306b\u8ffd\u52a0",
      seeHow: "\u4f7f\u3044\u65b9",
      viewPricing: "\u6599\u91d1",
      details: "\u8a73\u7d30"
    },
    "es": {
      home: "Inicio",
      product: "Producto",
      pricing: "Precios",
      account: "Cuenta",
      unlock: "Desbloquear de por vida",
      refund: "Reembolsos",
      privacy: "Privacidad",
      terms: "T\u00e9rminos",
      addToChrome: "A\u00f1adir a Chrome",
      seeHow: "C\u00f3mo funciona",
      viewPricing: "Ver precios",
      details: "Detalles"
    }
  }[localeCode] ?? {};

  return [
    [">Home<", `>${labels.home}<`],
    [">Product<", `>${labels.product}<`],
    [">Pricing<", `>${labels.pricing}<`],
    [">Account<", `>${labels.account}<`],
    [">Unlock Lifetime<", `>${labels.unlock}<`],
    [">Refund<", `>${labels.refund}<`],
    [">Privacy<", `>${labels.privacy}<`],
    [">Terms<", `>${labels.terms}<`],
    [">Add to Chrome<", `>${labels.addToChrome}<`],
    [">See how it works<", `>${labels.seeHow}<`],
    [">View pricing<", `>${labels.viewPricing}<`],
    [">See product details<", `>${labels.details}<`]
  ];
}

function sharedMarketingCopy(localeCode) {
  const labels = {
    "zh-cn": {
      localOnly: "\u672c\u5730\u4f7f\u7528",
      noUpload: "\u4e0d\u4e0a\u4f20",
      noCloudSync: "\u4e0d\u505a\u4e91\u540c\u6b65",
      noSubscription: "\u4e0d\u662f\u8ba2\u9605",
      unlimited: "\u65e0\u9650 fills",
      advanced: "\u66f4\u5b8c\u6574\u7684\u5b57\u6bb5\u652f\u6301",
      faq: "\u5e38\u89c1\u95ee\u9898",
      howItWorks: "\u4f7f\u7528\u65b9\u5f0f",
      freeVsLifetime: "\u514d\u8d39\u7248 vs \u7ec8\u8eab\u7248",
      testModeFootnote: "\u5f53\u524d\u4ecd\u662f test-mode \u652f\u4ed8\u96c6\u6210\u3002production payment \u4ecd\u672a\u9a8c\u8bc1\u3002"
    },
    "ja": {
      localOnly: "\u30ed\u30fc\u30ab\u30eb\u306e\u307f",
      noUpload: "\u30a2\u30c3\u30d7\u30ed\u30fc\u30c9\u306a\u3057",
      noCloudSync: "\u30af\u30e9\u30a6\u30c9\u540c\u671f\u306a\u3057",
      noSubscription: "\u30b5\u30d6\u30b9\u30af\u306a\u3057",
      unlimited: "\u56de\u6570\u7121\u5236\u9650",
      advanced: "\u3088\u308a\u5e45\u5e83\u3044\u30d5\u30a3\u30fc\u30eb\u30c9\u5bfe\u5fdc",
      faq: "FAQ",
      howItWorks: "\u4f7f\u3044\u65b9",
      freeVsLifetime: "\u7121\u6599\u7248 vs Lifetime",
      testModeFootnote: "\u73fe\u5728\u306f test-mode \u306e\u6c7a\u6e08\u7d4c\u8def\u3067\u3059\u3002production payment \u306f\u307e\u3060\u691c\u8a3c\u3055\u308c\u3066\u3044\u307e\u305b\u3093\u3002"
    },
    "es": {
      localOnly: "Solo local",
      noUpload: "Sin subida",
      noCloudSync: "Sin sincronizaci\u00f3n en la nube",
      noSubscription: "Sin suscripci\u00f3n",
      unlimited: "Usos ilimitados",
      advanced: "Soporte avanzado de campos",
      faq: "Preguntas frecuentes",
      howItWorks: "C\u00f3mo funciona",
      freeVsLifetime: "Gratis vs Lifetime",
      testModeFootnote: "La integraci\u00f3n de pago sigue en modo test. El production payment todav\u00eda no est\u00e1 verificado."
    }
  }[localeCode] ?? {};

  return [
    [">Local-only<", `>${labels.localOnly}<`],
    [">No upload<", `>${labels.noUpload}<`],
    [">No cloud sync<", `>${labels.noCloudSync}<`],
    [">No subscription<", `>${labels.noSubscription}<`],
    [">Unlimited fills<", `>${labels.unlimited}<`],
    [">Advanced field support<", `>${labels.advanced}<`],
    [">FAQ<", `>${labels.faq}<`],
    [">How it works<", `>${labels.howItWorks}<`],
    [">Free vs Lifetime<", `>${labels.freeVsLifetime}<`],
    ["Test-mode payment integration remains active. Production payment is not verified.", labels.testModeFootnote]
  ];
}

function pageSpecificReplacements({ localeCode, pageRelativePath, state }) {
  const product = state?.product ?? {};
  const freeLimit = product.freeLimit ?? 10;
  const priceLabel = product.priceLabel ?? "$19 lifetime";
  const page = pageRelativePath.replaceAll("\\", "/");

  const perLocale = {
    "zh-cn": {
      index: [
        ["Local lead form filling without sync clutter", "\u672c\u5730\u8868\u5355\u586b\u5199\uff0c\u4e0d\u5e26\u540c\u6b65\u8d1f\u62c5"],
        ["Why it feels productized", "\u4e3a\u4ec0\u4e48\u73b0\u5728\u66f4\u50cf\u4ea7\u54c1\u5b98\u7f51"],
        ["Core benefits", "\u6838\u5fc3\u4ef7\u503c"],
        ["Ready to try it?", "\u51c6\u5907\u597d\u5f00\u59cb\u4e86\u5417\uff1f"],
        ["Account & membership", "\u8d26\u6237\u4e0e\u4f1a\u5458"],
        [`>${freeLimit} free fills<`, `>${freeLimit} free fills<`],
        [priceLabel, "$19 lifetime"]
      ],
      product: [
        ["Product details", "\u4ea7\u54c1\u8be6\u60c5"],
        ["What LeadFill actually helps with.", "LeadFill \u771f\u6b63\u5728\u5e2e\u4ec0\u4e48\u3002"],
        ["Best fit", "\u9002\u5408\u4eba\u7fa4"],
        ["Feature breakdown", "\u529f\u80fd\u62c6\u89e3"],
        ["Real screenshots", "\u771f\u5b9e\u622a\u56fe"],
        ["Next step", "\u4e0b\u4e00\u6b65"]
      ],
      pricing: [
        ["Simple pricing for one clear product.", "\u4e3a\u4e00\u4e2a\u805a\u7126\u4ea7\u54c1\u63d0\u4f9b\u7b80\u5355\u4ef7\u683c\u3002"],
        ["How payment works", "\u652f\u4ed8\u5982\u4f55\u751f\u6548"],
        ["How membership refresh works", "\u4f1a\u5458\u5237\u65b0\u5982\u4f55\u8fd0\u4f5c"],
        ["Secure external checkout", "\u5b89\u5168\u7684\u5916\u90e8 checkout"],
        ["Webhook-confirmed membership", "Webhook \u786e\u8ba4\u7684\u4f1a\u5458\u751f\u6548"],
        ["Current mode", "\u5f53\u524d\u6a21\u5f0f"]
      ],
      account: [
        ["Account & membership", "\u8d26\u6237\u4e0e\u4f1a\u5458"],
        ["Plan", "\u5957\u9910"],
        ["Usage", "\u4f7f\u7528\u91cf"],
        ["Membership refresh", "\u4f1a\u5458\u5237\u65b0"],
        ["Orders & restore", "\u8ba2\u5355\u4e0e\u6062\u590d"],
        ["Current environment", "\u5f53\u524d\u73af\u5883"],
        ["Membership flow status", "\u4f1a\u5458\u6d41\u7a0b\u72b6\u6001"],
        ["Support", "\u652f\u6301"]
      ],
      refund: [["Refund Policy", "\u9000\u6b3e\u653f\u7b56"]],
      privacy: [["Privacy Summary", "\u9690\u79c1\u6982\u8981"]],
      terms: [["Payment And Membership", "\u652f\u4ed8\u4e0e\u4f1a\u5458"]],
      success: [["Payment received", "\u5df2\u6536\u5230\u4ed8\u6b3e"], ["Checkout success", "\u652f\u4ed8\u6210\u529f"]],
      cancel: [["Checkout not completed", "\u652f\u4ed8\u672a\u5b8c\u6210"], ["Checkout cancelled", "\u652f\u4ed8\u5df2\u53d6\u6d88"]]
    },
    "ja": {
      index: [
        ["Local lead form filling without sync clutter", "\u540c\u671f\u306e\u6563\u3089\u304b\u308a\u3092\u5897\u3084\u3055\u306a\u3044\u3001\u30ed\u30fc\u30ab\u30eb\u306a\u30d5\u30a9\u30fc\u30e0\u5165\u529b"],
        ["Why it feels productized", "\u306a\u305c\u88fd\u54c1\u30b5\u30a4\u30c8\u306b\u898b\u3048\u308b\u306e\u304b"],
        ["Core benefits", "\u4e3b\u306a\u4fa1\u5024"],
        ["Ready to try it?", "\u8a66\u3057\u3066\u307f\u307e\u3059\u304b\uff1f"],
        ["Account & membership", "\u30a2\u30ab\u30a6\u30f3\u30c8\u3068\u30e1\u30f3\u30d0\u30fc\u30b7\u30c3\u30d7"]
      ],
      product: [
        ["Product details", "\u88fd\u54c1\u8a73\u7d30"],
        ["Best fit", "\u5411\u3044\u3066\u3044\u308b\u4eba"],
        ["Feature breakdown", "\u6a5f\u80fd\u306e\u5185\u8a33"],
        ["Real screenshots", "\u5b9f\u969b\u306e\u30b9\u30af\u30ea\u30fc\u30f3\u30b7\u30e7\u30c3\u30c8"]
      ],
      pricing: [
        ["How payment works", "\u6c7a\u6e08\u306e\u6d41\u308c"],
        ["How membership refresh works", "\u30e1\u30f3\u30d0\u30fc\u30b7\u30c3\u30d7\u66f4\u65b0\u306e\u6d41\u308c"],
        ["Secure external checkout", "\u5b89\u5168\u306a\u5916\u90e8 checkout"]
      ],
      account: [["Support", "\u30b5\u30dd\u30fc\u30c8"]],
      refund: [["Refund Policy", "\u8fd4\u91d1\u30dd\u30ea\u30b7\u30fc"]],
      privacy: [["Privacy Summary", "\u30d7\u30e9\u30a4\u30d0\u30b7\u30fc\u6982\u8981"]],
      terms: [["Payment And Membership", "\u6c7a\u6e08\u3068\u30e1\u30f3\u30d0\u30fc\u30b7\u30c3\u30d7"]],
      success: [["Payment received", "\u6c7a\u6e08\u3092\u53d7\u4fe1\u3057\u307e\u3057\u305f"]],
      cancel: [["Checkout not completed", "Checkout \u306f\u5b8c\u4e86\u3057\u307e\u305b\u3093\u3067\u3057\u305f"]]
    },
    "es": {
      index: [
        ["Local lead form filling without sync clutter", "Relleno local de formularios sin ruido de sincronizaci\u00f3n"],
        ["Why it feels productized", "Por qu\u00e9 ahora parece una web de producto"],
        ["Core benefits", "Beneficios clave"],
        ["Ready to try it?", "\u00bfListo para probarlo?"],
        ["Account & membership", "Cuenta y membres\u00eda"]
      ],
      product: [
        ["Product details", "Detalles del producto"],
        ["Feature breakdown", "Desglose de funciones"],
        ["Real screenshots", "Capturas reales"]
      ],
      pricing: [
        ["How payment works", "C\u00f3mo funciona el pago"],
        ["How membership refresh works", "C\u00f3mo se actualiza la membres\u00eda"],
        ["Secure external checkout", "Checkout externo seguro"]
      ],
      account: [["Support", "Soporte"]],
      refund: [["Refund Policy", "Pol\u00edtica de reembolso"]],
      privacy: [["Privacy Summary", "Resumen de privacidad"]],
      terms: [["Payment And Membership", "Pago y membres\u00eda"]],
      success: [["Payment received", "Pago recibido"]],
      cancel: [["Checkout not completed", "Checkout no completado"]]
    }
  }[localeCode] ?? {};

  if (page === "account.html" || page === "entitlement.html") {
    return perLocale.account ?? [];
  }
  if (page === "checkout/success.html") return perLocale.success ?? [];
  if (page === "checkout/cancel.html") return perLocale.cancel ?? [];
  if (page === "refund.html") return perLocale.refund ?? [];
  if (page === "privacy.html") return perLocale.privacy ?? [];
  if (page === "terms.html") return perLocale.terms ?? [];
  return perLocale[path.basename(page, ".html")] ?? [];
}

function localizeHtml({ html, localeCode, outputDir, pageRelativePath, state }) {
  const locale = localeDefinition(localeCode);
  let localized = html.replace(/<html lang="en">/g, `<html lang="${locale.htmlLang}">`);
  localized = rewriteLocalizedPaths(localized, pageRelativePath);
  localized = localized.replace(
    /<div class="locale-switcher" aria-label="Language switcher">[\s\S]*?<\/div>/,
    renderLocaleSwitcher({ outputDir, localeCode, pageRelativePath })
  );
  localized = applyReplacements(localized, sharedLabels(localeCode));
  localized = applyReplacements(localized, sharedMarketingCopy(localeCode));
  localized = applyReplacements(localized, pageSpecificReplacements({
    localeCode,
    pageRelativePath,
    state
  }));
  return localized;
}

export async function generateLocalizedSitePages({ state, outputDir }) {
  const localizedPages = {};

  for (const locale of SITE_LOCALES.filter((item) => item.code !== "en")) {
    const localeRoot = localizedProductDir(outputDir, locale.code);
    await ensureDir(localeRoot);
    localizedPages[locale.code] = {};

    for (const pageRelativePath of LOCALIZED_PAGE_PATHS) {
      const sourcePath = path.join(outputDir, pageRelativePath);
      const targetPath = path.join(localeRoot, pageRelativePath);
      const sourceHtml = await fs.readFile(sourcePath, "utf8");
      const localizedHtml = localizeHtml({
        html: sourceHtml,
        localeCode: locale.code,
        outputDir,
        pageRelativePath,
        state
      });
      await writeText(targetPath, localizedHtml);
      localizedPages[locale.code][localizedPageKey(pageRelativePath)] = path.relative(state.projectRoot, targetPath).replaceAll("\\", "/");
    }
  }

  const manifest = {
    stage: "MULTILINGUAL_SITE_PAGES",
    status: "passed",
    generated_at: nowIso(),
    default_locale: "en",
    supported_locales: SITE_LOCALES.map(({ code, label, htmlLang }) => ({
      code,
      label,
      html_lang: htmlLang
    })),
    localized_pages: localizedPages,
    notes: [
      "English remains the default source-of-truth version.",
      "Localized pages mirror the product-first information architecture.",
      "Human language review is still recommended before public launch."
    ]
  };

  await writeJson(path.join(outputDir, "locales.json"), manifest);
  return manifest;
}
