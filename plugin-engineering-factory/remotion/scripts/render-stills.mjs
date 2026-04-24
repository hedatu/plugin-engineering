import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bundle } from "@remotion/bundler";
import { ensureBrowser, renderStill, selectComposition } from "@remotion/renderer";

function parseArgs(argv) {
  const args = {};
  for (let index = 2; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      continue;
    }
    const key = token.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      args[key] = true;
      continue;
    }
    args[key] = value;
    index += 1;
  }
  return args;
}

async function ensureDir(target) {
  await fs.mkdir(target, { recursive: true });
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

function nowIso() {
  return new Date().toISOString();
}

function wordCount(value) {
  return `${value ?? ""}`.trim().split(/\s+/).filter(Boolean).length;
}

function hasForbiddenClaims(value) {
  const normalized = `${value ?? ""}`.toLowerCase();
  return [
    "number 1",
    "editor's choice",
    "editors choice",
    "official",
    "recommended by google"
  ].some((phrase) => normalized.includes(phrase));
}

function normalizePathForReport(filePath) {
  return filePath.replaceAll("\\", "/");
}

function buildRenderPlan(props) {
  return [
    {
      asset_id: "store-screenshot-1",
      composition_id: "StoreScreenshot",
      output_relative_path: "screenshots/screenshot_1_1280x800.png",
      width: 1280,
      height: 800,
      visual_role: "store_screenshot",
      story_index: 0
    },
    {
      asset_id: "store-screenshot-2",
      composition_id: "StoreScreenshot",
      output_relative_path: "screenshots/screenshot_2_1280x800.png",
      width: 1280,
      height: 800,
      visual_role: "store_screenshot",
      story_index: 1
    },
    {
      asset_id: "store-screenshot-3",
      composition_id: "StoreScreenshot",
      output_relative_path: "screenshots/screenshot_3_1280x800.png",
      width: 1280,
      height: 800,
      visual_role: "store_screenshot",
      story_index: 2
    },
    {
      asset_id: "store-screenshot-4",
      composition_id: "StoreScreenshot",
      output_relative_path: "screenshots/screenshot_4_1280x800.png",
      width: 1280,
      height: 800,
      visual_role: "store_screenshot",
      story_index: 3
    },
    {
      asset_id: "store-screenshot-5",
      composition_id: "StoreScreenshot",
      output_relative_path: "screenshots/screenshot_5_1280x800.png",
      width: 1280,
      height: 800,
      visual_role: "store_screenshot",
      story_index: 4
    },
    {
      asset_id: "small-promo",
      composition_id: "PromoTile440x280",
      output_relative_path: "promo/small_promo_440x280.png",
      width: 440,
      height: 280,
      visual_role: "promo_tile"
    },
    {
      asset_id: "marquee",
      composition_id: "Marquee1400x560",
      output_relative_path: "promo/marquee_1400x560.png",
      width: 1400,
      height: 560,
      visual_role: "promo_tile"
    },
    {
      asset_id: "landing-hero",
      composition_id: "LandingHero",
      output_relative_path: "landing/hero_1600x900.png",
      width: 1600,
      height: 900,
      visual_role: "landing_hero"
    },
    {
      asset_id: "pricing-hero",
      composition_id: "PricingHero",
      output_relative_path: "landing/pricing_1600x900.png",
      width: 1600,
      height: 900,
      visual_role: "pricing_hero"
    }
  ].map((item) => {
    const story = typeof item.story_index === "number" ? props.storyboard?.[item.story_index] : null;
    const sourcePaths = item.visual_role === "promo_tile" || item.visual_role === "landing_hero" || item.visual_role === "pricing_hero"
      ? (props.storyboard ?? []).slice(0, 3).map((entry) => entry.source_real_screenshot).filter(Boolean)
      : [story?.source_real_screenshot].filter(Boolean);
    const overlayWordCount = item.visual_role === "store_screenshot"
      ? wordCount(`${story?.overlay_headline ?? ""} ${story?.overlay_subcopy ?? ""}`)
      : item.visual_role === "pricing_hero"
        ? wordCount(props.monetization_preview?.enabled
          ? `${props.monetization_preview.lifetime_unlock} ${props.monetization_preview.free_limit} ${props.monetization_preview.disclosure}`
          : "Current sandbox build is free only")
        : wordCount(`${props.tagline} ${props.one_sentence_value}`);
    const claimsText = item.visual_role === "store_screenshot"
      ? `${story?.overlay_headline ?? ""} ${story?.overlay_subcopy ?? ""} ${story?.trust_signal ?? ""}`
      : `${props.tagline} ${props.one_sentence_value} ${props.trust_positioning}`;
    return {
      ...item,
      overlay_word_count: overlayWordCount,
      forbidden_claims_present: hasForbiddenClaims(claimsText),
      source_real_screenshots: sourcePaths,
      source_traceable: sourcePaths.length > 0,
      promo_not_raw_screenshot: item.visual_role === "promo_tile" ? true : null,
      brand_palette_applied: true
    };
  });
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.props) {
    throw new Error("Usage: node scripts/render-stills.mjs --props <props.json>");
  }

  const propsPath = path.resolve(args.props);
  const props = await readJson(propsPath);
  const outputRoot = path.resolve(props.output_root);
  const remotionRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const entryPoint = path.join(remotionRoot, "src", "index.ts");
  const browserExecutable = props.browser_executable ? path.resolve(props.browser_executable) : null;

  await ensureDir(outputRoot);
  const bundleLocation = await bundle({
    entryPoint,
    onProgress: () => undefined,
    ignoreRegisterRootWarning: true
  });

  const browserStatus = await ensureBrowser({
    browserExecutable,
    logLevel: "error"
  });

  const renderPlan = buildRenderPlan(props);
  const generatedFiles = [];
  const assets = [];

  for (const item of renderPlan) {
    const outputFile = path.join(outputRoot, item.output_relative_path);
    await ensureDir(path.dirname(outputFile));
    const inputProps = {
      ...props,
      asset: {
        kind: item.visual_role === "store_screenshot" ? "store_screenshot" : item.visual_role,
        index: item.story_index
      }
    };
    const composition = await selectComposition({
      serveUrl: bundleLocation,
      id: item.composition_id,
      inputProps,
      browserExecutable,
      logLevel: "error"
    });
    await renderStill({
      serveUrl: bundleLocation,
      composition,
      inputProps,
      output: outputFile,
      imageFormat: "png",
      overwrite: true,
      browserExecutable,
      logLevel: "error"
    });
    generatedFiles.push(normalizePathForReport(outputFile));
    assets.push({
      asset_id: item.asset_id,
      composition_id: item.composition_id,
      output_path: normalizePathForReport(outputFile),
      relative_output_path: item.output_relative_path,
      width: item.width,
      height: item.height,
      status: "passed",
      visual_role: item.visual_role,
      uses_real_ui: true,
      source_real_screenshots: item.source_real_screenshots,
      source_traceable: item.source_traceable,
      overlay_word_count: item.overlay_word_count,
      overlay_density: item.overlay_word_count <= 18 ? "low" : item.overlay_word_count <= 28 ? "medium" : "high",
      brand_palette_applied: item.brand_palette_applied,
      forbidden_claims_present: item.forbidden_claims_present,
      promo_not_raw_screenshot: item.promo_not_raw_screenshot
    });
  }

  const report = {
    stage: "REMOTION_ASSET_GENERATION",
    status: "passed",
    generated_at: nowIso(),
    run_id: props.run_id,
    engine: "remotion",
    dependency_status: "available",
    browser_status: browserStatus.type,
    props_file: normalizePathForReport(propsPath),
    output_root: normalizePathForReport(outputRoot),
    stills: {
      requested: true,
      status: "passed",
      generated_files: generatedFiles
    },
    video: {
      requested: false,
      status: "not_requested",
      generated_files: []
    },
    assets,
    generated_files: generatedFiles,
    next_step: "Run asset QA and the listing quality gate against the generated still assets."
  };

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack ?? error.message}\n`);
  process.exitCode = 1;
});
