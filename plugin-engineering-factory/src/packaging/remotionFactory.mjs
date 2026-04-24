import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileExists, ensureDir, nowIso, writeJson, writeText } from "../utils/io.mjs";
import {
  BRAND_SYSTEM_ARTIFACT,
  PREMIUM_PACKAGING_BRIEF_ARTIFACT,
  SCREENSHOT_STORYBOARD_ARTIFACT,
  loadPremiumPackagingArtifacts,
  remotionAssetsRoot,
  runPremiumPackaging,
  sidecarRootForRun
} from "./premiumPackaging.mjs";
import { readJson } from "../utils/io.mjs";

const execFileAsync = promisify(execFile);

function remotionProjectDir(projectRoot) {
  return path.join(projectRoot, "remotion");
}

function remotionDependencyPaths(projectRoot) {
  const base = remotionProjectDir(projectRoot);
  return [
    path.join(base, "package.json"),
    path.join(base, "node_modules", "remotion", "package.json"),
    path.join(base, "node_modules", "@remotion", "cli", "package.json"),
    path.join(base, "node_modules", "@remotion", "bundler", "package.json"),
    path.join(base, "node_modules", "@remotion", "renderer", "package.json"),
    path.join(base, "node_modules", "react", "package.json"),
    path.join(base, "node_modules", "react-dom", "package.json")
  ];
}

async function remotionDependenciesAvailable(projectRoot) {
  for (const dependencyPath of remotionDependencyPaths(projectRoot)) {
    if (!(await fileExists(dependencyPath))) {
      return false;
    }
  }
  return true;
}

async function writePropsFile({ projectRoot, runId, props }) {
  const propsDir = path.join(remotionAssetsRoot(projectRoot, runId), "props");
  await ensureDir(propsDir);
  const propsPath = path.join(propsDir, `${props.product_slug}.json`);
  await writeJson(propsPath, props);
  return propsPath;
}

async function loadRunContext(runDir, projectRoot) {
  const runContext = await readJson(path.join(runDir, "00_run_context.json"));
  return {
    ...runContext,
    project_root: projectRoot
  };
}

async function pngToDataUrl(filePath) {
  const buffer = await fs.readFile(filePath);
  return `data:image/png;base64,${buffer.toString("base64")}`;
}

async function buildRuntimeProps({ projectRoot, runContext, packaging, screenshotManifest, browserSmoke }) {
  const brief = packaging[PREMIUM_PACKAGING_BRIEF_ARTIFACT];
  const brand = packaging[BRAND_SYSTEM_ARTIFACT];
  const storyboard = packaging[SCREENSHOT_STORYBOARD_ARTIFACT];
  const screenshotEntries = await Promise.all((screenshotManifest.screenshots ?? []).map(async (entry) => ({
    file_name: entry.file_name,
    path: entry.path,
    image_data_url: await pngToDataUrl(entry.path)
  })));
  const screenshotByPath = new Map(screenshotEntries.map((entry) => [entry.path, entry]));
  const hydratedStoryboard = await Promise.all((storyboard.storyboard ?? []).map(async (entry) => ({
    ...entry,
    image_data_url: screenshotByPath.get(entry.source_real_screenshot)?.image_data_url ?? await pngToDataUrl(entry.source_real_screenshot)
  })));
  return {
    run_id: runContext.run_id,
    product_slug: `${brief.product_name}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""),
    product_name: brief.product_name,
    short_name: brand.short_name,
    tagline: brand.tagline,
    one_sentence_value: brief.one_sentence_value,
    trust_positioning: brief.trust_positioning,
    brand: {
      palette: {
        primary: brand.primary_color,
        secondary: brand.secondary_color,
        accent: brand.accent_color,
        background: brand.background_color,
        text: brand.text_color
      },
      typography: brand.typography_recommendation
    },
    claims: {
      local_only: brief.local_only_claim,
      no_login: brief.no_login_claim,
      no_upload: brief.no_upload_claim,
      no_cloud_sync: "No cloud sync.",
      minimal_permissions: "Uses storage, activeTab, and scripting only."
    },
    storyboard: hydratedStoryboard,
    screenshots: screenshotEntries,
    monetization_preview: {
      enabled: false,
      free_limit: "10 free actions",
      lifetime_unlock: "$19 lifetime unlock",
      disclosure: "Pricing preview only. Do not use until monetization is enabled truthfully."
    },
    browser_executable: browserSmoke?.browser?.executable_path ?? null,
    output_root: path.join(sidecarRootForRun(projectRoot, runContext.run_id), "80_remotion_assets")
  };
}

async function writeRenderReport({ projectRoot, runId, report }) {
  const outputRoot = remotionAssetsRoot(projectRoot, runId);
  await ensureDir(outputRoot);
  const reportPath = path.join(outputRoot, "remotion_render_report.json");
  await writeJson(reportPath, report);
  await writeText(path.join(outputRoot, "README.txt"), [
    "This folder stores premium stills and video renders for the sandbox run.",
    "If remotion_render_report.json shows status=skipped, install Remotion deps under ./remotion and rerun the asset command.",
    "These files are sidecar outputs for an immutable sandbox run."
  ].join("\n"));
  return reportPath;
}

async function ensurePackagingArtifacts({ projectRoot, runDir }) {
  let packaging = await loadPremiumPackagingArtifacts({ projectRoot, runDir });
  if (!packaging[PREMIUM_PACKAGING_BRIEF_ARTIFACT]) {
    await runPremiumPackaging({ projectRoot, runDir });
    packaging = await loadPremiumPackagingArtifacts({ projectRoot, runDir });
  }
  return packaging;
}

async function runRemotionStillsScript({ projectRoot, propsPath }) {
  const scriptPath = path.join(remotionProjectDir(projectRoot), "scripts", "render-stills.mjs");
  const { stdout } = await execFileAsync(process.execPath, [scriptPath, "--props", propsPath], {
    cwd: remotionProjectDir(projectRoot),
    maxBuffer: 20 * 1024 * 1024
  });
  const cleanStdout = `${stdout}`.replace(/\u001b\[[0-9;]*m/g, "");
  const reportStart = cleanStdout.lastIndexOf('{\n  "stage"');
  const fallbackStart = cleanStdout.indexOf("{");
  const jsonStart = reportStart >= 0 ? reportStart : fallbackStart;
  if (jsonStart < 0) {
    throw new Error(`Remotion render script did not return JSON. Output was: ${cleanStdout.slice(-400)}`);
  }
  return JSON.parse(cleanStdout.slice(jsonStart).trim());
}

export async function renderRemotionStills({ projectRoot, runDir }) {
  const packaging = await ensurePackagingArtifacts({ projectRoot, runDir });
  const runContext = await loadRunContext(runDir, projectRoot);
  const screenshotManifest = await readJson(path.join(runDir, "70_screenshot_manifest.json"));
  const browserSmoke = await readJson(path.join(runDir, "61_browser_smoke.json"));
  const props = await buildRuntimeProps({
    projectRoot,
    runContext,
    packaging,
    screenshotManifest,
    browserSmoke
  });
  const propsPath = await writePropsFile({
    projectRoot,
    runId: runContext.run_id,
    props
  });

  const dependenciesAvailable = await remotionDependenciesAvailable(projectRoot);
  let report;
  if (!dependenciesAvailable) {
    report = {
      stage: "REMOTION_ASSET_GENERATION",
      status: "skipped",
      generated_at: nowIso(),
      run_id: runContext.run_id,
      engine: "remotion",
      dependency_status: "missing",
      props_file: propsPath,
      output_root: remotionAssetsRoot(projectRoot, runContext.run_id),
      stills: {
        requested: true,
        status: "skipped",
        generated_files: [],
        failure_reason: "Remotion dependencies are not installed under ./remotion."
      },
      video: {
        requested: false,
        status: "not_requested",
        generated_files: []
      },
      generated_files: [],
      next_step: "Install Remotion deps in ./remotion, then rerun assets:remotion:stills."
    };
  } else {
    try {
      report = await runRemotionStillsScript({
        projectRoot,
        propsPath
      });
    } catch (error) {
      report = {
        stage: "REMOTION_ASSET_GENERATION",
        status: "failed",
        generated_at: nowIso(),
        run_id: runContext.run_id,
        engine: "remotion",
        dependency_status: "available",
        props_file: propsPath,
        output_root: remotionAssetsRoot(projectRoot, runContext.run_id),
        stills: {
          requested: true,
          status: "failed",
          generated_files: [],
          failure_reason: `${error.message ?? error}`
        },
        video: {
          requested: false,
          status: "not_requested",
          generated_files: []
        },
        generated_files: [],
        next_step: "Fix the local Remotion render script and rerun assets:remotion:stills."
      };
    }
  }

  const reportPath = await writeRenderReport({
    projectRoot,
    runId: runContext.run_id,
    report
  });
  return {
    runDir,
    runContext,
    report,
    reportPath
  };
}

export async function renderRemotionVideo({ projectRoot, runDir }) {
  const runContext = await loadRunContext(runDir, projectRoot);
  const outputRoot = remotionAssetsRoot(projectRoot, runContext.run_id);
  await ensurePackagingArtifacts({ projectRoot, runDir });
  const dependenciesAvailable = await remotionDependenciesAvailable(projectRoot);
  const existingReportPath = path.join(outputRoot, "remotion_render_report.json");
  let existing = null;
  if (await fileExists(existingReportPath)) {
    existing = await readJson(existingReportPath);
  }
  const report = {
    ...(existing ?? {
      stage: "REMOTION_ASSET_GENERATION",
      generated_at: nowIso(),
      run_id: runContext.run_id,
      engine: "remotion",
      dependency_status: dependenciesAvailable ? "available" : "missing",
      output_root: outputRoot,
      stills: {
        requested: false,
        status: "not_requested",
        generated_files: []
      }
    }),
    status: dependenciesAvailable ? "failed" : "skipped",
    video: {
      requested: true,
      status: dependenciesAvailable ? "failed" : "skipped",
      generated_files: [],
      failure_reason: dependenciesAvailable
        ? "Remotion video render bridge has not been wired yet."
        : "Remotion dependencies are not installed under ./remotion."
    },
    generated_files: existing?.generated_files ?? [],
    next_step: dependenciesAvailable
      ? "Wire the local Remotion video render bridge and rerun the video render."
      : "Install Remotion deps in ./remotion, then rerun assets:remotion:video."
  };
  const reportPath = await writeRenderReport({
    projectRoot,
    runId: runContext.run_id,
    report
  });
  return {
    runDir,
    runContext,
    report,
    reportPath
  };
}

export async function renderRemotionAll({ projectRoot, runDir }) {
  const stills = await renderRemotionStills({ projectRoot, runDir });
  const video = await renderRemotionVideo({ projectRoot, runDir });
  return {
    runDir,
    runContext: stills.runContext,
    report: video.report
  };
}
