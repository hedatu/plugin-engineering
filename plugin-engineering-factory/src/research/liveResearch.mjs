import { spawn } from "node:child_process";
import path from "node:path";
import { EnvHttpProxyAgent, ProxyAgent } from "undici";
import { assertMatchesSchema } from "../utils/schema.mjs";
import { nowIso, readJson, writeJson } from "../utils/io.mjs";

const DEFAULT_USER_AGENT = "Mozilla/5.0 Codex Chrome Extension Opportunity Factory";
const ALLOWED_HOSTS = new Set([
  "chromewebstore.google.com",
  "github.com",
  "api.github.com"
]);
const BLOCKED_EXTERNAL_HOSTS = [
  "google.com",
  "gstatic.com",
  "googleapis.com",
  "withgoogle.com",
  "developer.chrome.com",
  "googletagmanager.com",
  "google-analytics.com",
  "sentry.io",
  "accounts.google.com",
  "support.google.com",
  "lh3.googleusercontent.com"
];
const MAX_SUPPORT_TOPICS = 10;
const SUSPICIOUS_TLDS = new Set([
  "js",
  "css",
  "png",
  "jpg",
  "jpeg",
  "webp",
  "gif",
  "svg",
  "ico",
  "json",
  "map",
  "woff",
  "woff2",
  "ttf",
  "eot",
  "mjs",
  "ts",
  "tsx",
  "jsx"
]);
const ASSET_PATH_PATTERN = /\.(?:css|js|mjs|map|png|jpe?g|webp|gif|svg|ico|json|woff2?|ttf|eot)(?:$|[?#])/i;
const proxyAgentCache = new Map();
let envProxyAgent = null;

function unique(values) {
  return [...new Set(values)];
}

function normalizeProxyUrl(rawProxyUrl) {
  if (!rawProxyUrl) {
    return null;
  }
  const trimmed = `${rawProxyUrl}`.trim();
  if (!trimmed) {
    return null;
  }
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }
  return `http://${trimmed}`;
}

function parseNoProxyEntries() {
  return `${process.env.NO_PROXY ?? process.env.no_proxy ?? ""}`
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

function stripIpv6Brackets(hostname) {
  return hostname.replace(/^\[(.*)\]$/, "$1");
}

function hostMatchesNoProxyEntry(hostname, port, entry) {
  if (!entry) {
    return false;
  }
  if (entry === "*") {
    return true;
  }

  const normalizedHostname = stripIpv6Brackets(hostname.toLowerCase());
  const [entryHostRaw, entryPort = null] = entry.split(":");
  const entryHost = stripIpv6Brackets(entryHostRaw.toLowerCase());

  if (entryPort && `${port ?? ""}` !== entryPort) {
    return false;
  }
  if (entryHost.startsWith(".")) {
    return normalizedHostname.endsWith(entryHost) || normalizedHostname === entryHost.slice(1);
  }
  return normalizedHostname === entryHost || normalizedHostname.endsWith(`.${entryHost}`);
}

function shouldBypassProxy(urlObject) {
  return parseNoProxyEntries().some((entry) => hostMatchesNoProxyEntry(urlObject.hostname, urlObject.port, entry));
}

function resolveProxySelection(urlObject) {
  const isHttps = urlObject.protocol === "https:";
  const orderedCandidates = isHttps
    ? [
        ["CWS_HTTPS_PROXY", process.env.CWS_HTTPS_PROXY],
        ["CWS_HTTP_PROXY", process.env.CWS_HTTP_PROXY],
        ["HTTPS_PROXY", process.env.HTTPS_PROXY],
        ["HTTP_PROXY", process.env.HTTP_PROXY]
      ]
    : [
        ["CWS_HTTP_PROXY", process.env.CWS_HTTP_PROXY],
        ["CWS_HTTPS_PROXY", process.env.CWS_HTTPS_PROXY],
        ["HTTP_PROXY", process.env.HTTP_PROXY],
        ["HTTPS_PROXY", process.env.HTTPS_PROXY]
      ];

  for (const [source, value] of orderedCandidates) {
    const proxyUrl = normalizeProxyUrl(value);
    if (proxyUrl) {
      return { proxyUrl, proxySource: source };
    }
  }

  return { proxyUrl: null, proxySource: null };
}

function getProxyDispatcher(proxyUrl) {
  if (!proxyAgentCache.has(proxyUrl)) {
    proxyAgentCache.set(proxyUrl, new ProxyAgent(proxyUrl));
  }
  return proxyAgentCache.get(proxyUrl);
}

function getEnvProxyDispatcher() {
  if (!envProxyAgent) {
    envProxyAgent = new EnvHttpProxyAgent();
  }
  return envProxyAgent;
}

function buildRequestTransport(url) {
  const urlObject = new URL(url);
  const { proxyUrl, proxySource } = resolveProxySelection(urlObject);
  const proxyConfigured = Boolean(proxyUrl);
  const bypassedByNoProxy = proxyConfigured && shouldBypassProxy(urlObject);

  if (!proxyConfigured || bypassedByNoProxy) {
    return {
      network_mode: "direct",
      proxy_configured: proxyConfigured,
      proxy_source: proxySource,
      via_proxy: false,
      dispatcher: null
    };
  }

  const dispatcher = proxySource?.startsWith("CWS_")
    ? getProxyDispatcher(proxyUrl)
    : getEnvProxyDispatcher();

  return {
    network_mode: "proxy",
    proxy_configured: true,
    proxy_source: proxySource,
    via_proxy: true,
    dispatcher
  };
}

function defaultSearchQueries(allowedFamilies) {
  const queries = [];
  if (allowedFamilies.includes("gmail_snippet")) {
    queries.push("gmail snippet", "email template", "canned replies");
  }
  if (allowedFamilies.includes("single_profile_form_fill")) {
    queries.push("form filler", "autofill form", "lead form");
  }
  if (allowedFamilies.includes("tab_csv_window_export")) {
    queries.push("tab export", "export tabs", "tab csv");
  }
  return unique(queries);
}

function escapePowerShellSingleQuoted(value) {
  return value.replaceAll("'", "''");
}

function hasBlockedHost(hostname) {
  return BLOCKED_EXTERNAL_HOSTS.some((blocked) => hostname === blocked || hostname.endsWith(`.${blocked}`));
}

function isAllowedUrl(url, additionalHosts = []) {
  try {
    const parsed = new URL(url);
    const allowed = new Set([...ALLOWED_HOSTS, ...additionalHosts]);
    return parsed.protocol === "https:" && allowed.has(parsed.hostname);
  } catch {
    return false;
  }
}

async function fetchTextWithNode(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const transport = buildRequestTransport(url);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      dispatcher: transport.dispatcher,
      headers: {
        "user-agent": DEFAULT_USER_AGENT,
        "accept": "text/html,application/xhtml+xml,application/xml,text/plain;q=0.9,*/*;q=0.8"
      }
    });
    const text = await response.text();
    return {
      ok: response.ok,
      status: response.status,
      text,
      proxy_configured: transport.proxy_configured,
      proxy_source: transport.proxy_source,
      via_proxy: transport.via_proxy
    };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchTextWithPowerShell(url, timeoutMs) {
  const timeoutSeconds = Math.max(3, Math.ceil(timeoutMs / 1000));
  const escapedUrl = escapePowerShellSingleQuoted(url);
  const escapedUserAgent = escapePowerShellSingleQuoted(DEFAULT_USER_AGENT);
  const command = [
    "$ProgressPreference='SilentlyContinue';",
    `[Console]::OutputEncoding=[System.Text.Encoding]::UTF8;`,
    `$r=Invoke-WebRequest -UseBasicParsing -TimeoutSec ${timeoutSeconds} -Uri '${escapedUrl}' -Headers @{ 'User-Agent'='${escapedUserAgent}' };`,
    "Write-Output $r.StatusCode;",
    "Write-Output '---BODY---';",
    "Write-Output $r.Content;"
  ].join(" ");

  return new Promise((resolve, reject) => {
    const child = spawn("powershell.exe", ["-NoProfile", "-Command", command], {
      windowsHide: true
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`PowerShell request timed out after ${timeoutSeconds}s`));
    }, timeoutMs + 2000);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(stderr || `PowerShell request exited with code ${code}`));
        return;
      }
      const marker = "---BODY---";
      const markerIndex = stdout.indexOf(marker);
      if (markerIndex === -1) {
        reject(new Error("PowerShell response did not include body marker."));
        return;
      }
      const statusText = stdout.slice(0, markerIndex).trim().split(/\r?\n/).at(-1);
      const status = Number.parseInt(statusText, 10);
      const text = stdout.slice(markerIndex + marker.length).trimStart();
      resolve({ ok: status >= 200 && status < 300, status, text });
    });
  });
}

export async function fetchAllowedText(url, options = {}) {
  const timeoutMs = options.timeoutMs ?? 15000;
  const additionalHosts = options.additionalHosts ?? [];
  if (!isAllowedUrl(url, additionalHosts)) {
    throw new Error(`URL is outside the live research allowlist: ${url}`);
  }

  try {
    return await fetchTextWithNode(url, timeoutMs);
  } catch (nodeError) {
    if (process.platform !== "win32") {
      throw nodeError;
    }
    const response = await fetchTextWithPowerShell(url, timeoutMs);
    response.node_fallback_reason = nodeError.message;
    return response;
  }
}

async function fetchAllowedJson(url, options = {}) {
  const response = await fetchAllowedText(url, options);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${url}`);
  }
  return JSON.parse(response.text);
}

async function validateLiveResearchReport(projectRoot, report) {
  await assertMatchesSchema({
    data: report,
    schemaPath: path.join(projectRoot, "schemas", "live_research_report.schema.json"),
    label: "09_live_research_report.json"
  });
}

function decodeXmlEntities(value) {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", "\"")
    .replaceAll("&#39;", "'");
}

function normalizeEscapedText(value) {
  return decodeXmlEntities(value)
    .replaceAll("\\/", "/")
    .replaceAll("\\u003d", "=")
    .replaceAll("\\x3d", "=")
    .replaceAll("\\u0026", "&")
    .replaceAll("\\x26", "&");
}

function cleanExtractedUrl(value) {
  return normalizeEscapedText(value)
    .replace(/[,.;)]+$/g, "")
    .trim();
}

function normalizeUrlCandidate(value) {
  const cleaned = cleanExtractedUrl(value);
  if (!cleaned) {
    return "";
  }

  let normalized = cleaned;
  if (normalized.startsWith("//")) {
    normalized = `https:${normalized}`;
  }
  if (normalized.startsWith("github.com/")) {
    normalized = `https://${normalized}`;
  }
  if (!normalized.startsWith("https://")) {
    return "";
  }

  try {
    const parsed = new URL(normalized);
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return "";
  }
}

function safeHostname(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

function isValidPublicHostname(hostname) {
  if (!hostname || !hostname.includes(".")) {
    return false;
  }

  const labels = hostname.toLowerCase().split(".");
  if (labels.some((label) => !label || label.length > 63 || !/^[a-z0-9-]+$/.test(label) || label.startsWith("-") || label.endsWith("-"))) {
    return false;
  }

  return !SUSPICIOUS_TLDS.has(labels.at(-1));
}

function isCandidateExternalUrl(url) {
  const hostname = safeHostname(url);
  if (!hostname || hasBlockedHost(hostname)) {
    return false;
  }

  if (!isValidPublicHostname(hostname)) {
    return false;
  }

  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") {
      return false;
    }
    if (ASSET_PATH_PATTERN.test(parsed.pathname)) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

function buildUrlCandidates(html) {
  const urls = new Map();
  const anchorMatches = [...html.matchAll(/<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)];
  const explicitUrlMatches = [...normalizeEscapedText(html).matchAll(/https?:\/\/[^\s"'<>\\]+/g)];
  const githubMatches = [...normalizeEscapedText(html).matchAll(/\bgithub\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:[^\s"'<>]*)?/g)];

  const ensureUrl = (rawUrl, label = "") => {
    const url = normalizeUrlCandidate(rawUrl);
    if (!url || !isCandidateExternalUrl(url)) {
      return;
    }
    if (!urls.has(url)) {
      urls.set(url, new Set());
    }
    if (label) {
      urls.get(url).add(label.toLowerCase());
    }
  };

  for (const match of anchorMatches) {
    ensureUrl(match[1], stripHtml(match[2]));
  }
  for (const match of explicitUrlMatches) {
    ensureUrl(match[0]);
  }
  for (const match of githubMatches) {
    ensureUrl(match[0]);
  }

  return [...urls.entries()].map(([url, labels]) => ({
    url,
    labels: [...labels]
  }));
}

function scoreSupportUrl(candidate) {
  const hostname = safeHostname(candidate.url);
  if (!hostname || hasBlockedHost(hostname)) {
    return -100;
  }
  const lower = candidate.url.toLowerCase();
  const labelText = candidate.labels.join(" ");
  let score = 0;
  if (/\/faq\/?|questions|troubleshoot|known-issues|docs|guide|help/i.test(lower)) score += 80;
  if (/support|contact|issues\/new|bug_report/i.test(lower)) score += 60;
  if (/\bsupport\b|\bfaq\b|\bhelp\b|\bdocumentation\b/i.test(labelText)) score += 120;
  if (/\bwebsite\b/i.test(labelText)) score -= 30;
  if (/privacy|policy/i.test(lower)) score -= 20;
  if (/terms|login|signin|signup|account/i.test(lower)) score -= 35;
  if (lower.includes("github.com/")) score += 25;
  return score;
}

function scoreWebsiteUrl(candidate) {
  const hostname = safeHostname(candidate.url);
  if (!hostname || hasBlockedHost(hostname)) {
    return -100;
  }
  const lower = candidate.url.toLowerCase();
  if (/\.(png|jpg|jpeg|webp|css|js)(?:[?#].*)?$/i.test(lower)) {
    return -100;
  }
  let score = 20;
  const pathName = new URL(candidate.url).pathname;
  const labelText = candidate.labels.join(" ");
  if (pathName === "/" || pathName === "") score += 50;
  if (/\bwebsite\b|\bhomepage\b|\bhome page\b/i.test(labelText)) score += 120;
  if (/\bsupport\b|\bfaq\b|\bhelp\b/i.test(labelText)) score -= 80;
  if (/privacy|policy|terms|login|signin|signup|account|support|faq|help/i.test(lower)) score -= 25;
  if (lower.includes("github.com/")) score -= 10;
  return score;
}

function pickBestUrl(candidates, scorer) {
  return candidates
    .map((candidate) => ({ candidate, score: scorer(candidate) }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score || left.candidate.url.length - right.candidate.url.length)[0]?.candidate.url ?? "";
}

function extractLocs(xml) {
  return [...xml.matchAll(/<loc>([\s\S]*?)<\/loc>/g)]
    .map((match) => decodeXmlEntities(match[1].trim()));
}

export function extractDetailUrlsFromSearchHtml(html) {
  const normalized = normalizeEscapedText(html);
  const detailMatches = [...normalized.matchAll(/detail\/[^\s"'<>]{10,200}/g)];
  return unique(detailMatches
    .map((match) => cleanExtractedUrl(match[0]))
    .map((value) => value.replace(/^\/+/, ""))
    .map((value) => `https://chromewebstore.google.com/${value}`));
}

function extractMeta(html, property) {
  const propertyRegex = property.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`<meta[^>]+property=["']${propertyRegex}["'][^>]+content=["']([^"']+)["']`, "i"),
    new RegExp(`<meta[^>]+name=["']${propertyRegex}["'][^>]+content=["']([^"']+)["']`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${propertyRegex}["']`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+name=["']${propertyRegex}["']`, "i")
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) {
      return decodeXmlEntities(match[1].trim());
    }
  }
  return "";
}

function stripHtml(value) {
  return decodeXmlEntities(value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}

function parseCount(value) {
  if (!value) {
    return 0;
  }
  const normalized = value.toLowerCase().replaceAll(",", "").trim();
  const match = normalized.match(/([\d.]+)\s*([kmb])?/);
  if (!match) {
    return 0;
  }
  const number = Number.parseFloat(match[1]);
  const suffix = match[2];
  if (suffix === "k") return Math.round(number * 1000);
  if (suffix === "m") return Math.round(number * 1000000);
  if (suffix === "b") return Math.round(number * 1000000000);
  return Math.round(number);
}

function inferWedgeFamily(text, allowedFamilies) {
  const lower = text.toLowerCase();
  const candidates = [
    ["gmail_snippet", ["gmail", "snippet", "template", "compose", "reply"]],
    ["single_profile_form_fill", ["form", "fill", "profile", "lead", "intake"]],
    ["tab_csv_window_export", ["tab", "tabs", "csv", "export", "window"]]
  ];
  for (const [family, keywords] of candidates) {
    if (!allowedFamilies.includes(family)) {
      continue;
    }
    if (keywords.some((keyword) => lower.includes(keyword))) {
      return family;
    }
  }
  return allowedFamilies[0] ?? "unsupported_research_only";
}

export function parseChromeListing(url, html, allowedFamilies) {
  const titleFromMeta = extractMeta(html, "og:title");
  const titleMatch = html.match(/<title>([\s\S]*?)<\/title>/i);
  const rawTitle = titleFromMeta || (titleMatch ? stripHtml(titleMatch[1]) : "Unknown Chrome Extension");
  const name = rawTitle
    .replace(/\s*-\s*Chrome Web Store\s*$/i, "")
    .replace(/\s*-\s*Chrome.*$/i, "")
    .trim() || "Unknown Chrome Extension";
  const description = extractMeta(html, "og:description") || extractMeta(html, "description") || "";
  const text = stripHtml(html);

  const rating = Number.parseFloat((text.match(/(?:Rated|rating)[^\d]{0,20}(\d(?:\.\d)?)/i) ?? [])[1] ?? "4.1");
  const users = parseCount((text.match(/([\d.,]+\s*[kmb]?)\s+users/i) ?? [])[1]) || 0;
  const reviews = parseCount((text.match(/([\d.,]+\s*[kmb]?)\s+(?:ratings|reviews)/i) ?? [])[1]) || 0;
  const urls = buildUrlCandidates(html);
  const githubUrl = urls.find((candidate) => candidate.url.includes("github.com/"))?.url;
  const githubMatch = githubUrl?.match(/github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)/);
  const supportUrl = pickBestUrl(urls, scoreSupportUrl);
  const websiteUrl = pickBestUrl(urls, scoreWebsiteUrl) || (supportUrl ? new URL("/", supportUrl).toString() : "");
  const wedgeFamily = inferWedgeFamily(`${name} ${description} ${text.slice(0, 2000)}`, allowedFamilies);
  const extensionId = (url.match(/\/([a-p]{32})(?:[/?#]|$)/i) ?? [])[1] ?? "";

  return {
    candidate_id: extensionId ? `cws-${extensionId}` : `cws-${Buffer.from(url).toString("base64url").slice(0, 16)}`,
    name,
    store_url: url,
    category: "Productivity",
    users,
    rating: Number.isFinite(rating) ? rating : 4.1,
    reviews,
    updated: "",
    website_url: websiteUrl,
    support_url: supportUrl,
    github_repo: githubMatch ? githubMatch[1].replace(/\.git$/, "") : "",
    wedge_family: wedgeFamily,
    signals: [wedgeFamily],
    portfolio_overlap_score: 10,
    live_summary: description,
    source_mode: "live_cws"
  };
}

function evidenceFromListing(candidate) {
  const evidence = [];
  if (candidate.live_summary) {
    evidence.push({
      source_type: "chrome_web_store_listing",
      url: candidate.store_url,
      captured_at: nowIso(),
      issue_type: "missing_feature",
      topic: "listing-derived opportunity hypothesis",
      quote: candidate.live_summary.slice(0, 220),
      sentiment: "weak_signal"
    });
  }
  return evidence;
}

function extractSupportTopics(html) {
  const headingMatches = [...html.matchAll(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi)]
    .map((match) => stripHtml(match[1]))
    .map((item) => item.replace(/\s+/g, " ").trim())
    .filter((item) => item.length >= 8 && item.length <= 140)
    .filter((item) => !/^(frequently asked questions|support|help|documentation|faq)$/i.test(item));

  if (headingMatches.length > 0) {
    return unique(headingMatches).slice(0, MAX_SUPPORT_TOPICS);
  }

  return stripHtml(html)
    .split(/[.!?]\s+/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 20 && item.length <= 180)
    .slice(0, MAX_SUPPORT_TOPICS);
}

function classifySupportTopic(topic) {
  const lower = topic.toLowerCase();
  if (/privacy|permission|data|security|sync/i.test(lower)) {
    return "privacy_concern";
  }
  if (/error|troubleshoot|failed|broken|issue|problem|doesn'?t trigger|does not trigger/i.test(lower)) {
    return "stability";
  }
  if (/template|snippet|shortcut|fill|export|insert|reply|compose|form/i.test(lower)) {
    return "missing_feature";
  }
  return "ux_friction";
}

async function evidenceFromSupportSite(candidate, report, options) {
  const supportUrl = candidate.support_url || candidate.website_url;
  if (!supportUrl) {
    return [];
  }

  let hostname = "";
  try {
    hostname = new URL(supportUrl).hostname;
  } catch {
    return [];
  }
  if (hasBlockedHost(hostname)) {
    return [];
  }

  try {
    const response = await fetchAllowedText(supportUrl, {
      timeoutMs: options.timeoutMs ?? 15000,
      additionalHosts: [hostname]
    });
    report.support_requests.push({
      candidate_id: candidate.candidate_id,
      url: supportUrl,
      status: response.status,
      ok: response.ok
    });
    if (!response.ok) {
      return [];
    }
    return extractSupportTopics(response.text).map((topic) => ({
      source_type: "support_page",
      url: supportUrl,
      captured_at: nowIso(),
      issue_type: classifySupportTopic(topic),
      topic,
      quote: topic,
      sentiment: "weak_signal"
    }));
  } catch (error) {
    report.support_requests.push({
      candidate_id: candidate.candidate_id,
      url: supportUrl,
      status: "failed",
      ok: false,
      error: error.message
    });
    return [];
  }
}

async function evidenceFromGithubIssues(candidate, report, options) {
  if (!candidate.github_repo) {
    return [];
  }
  const url = `https://api.github.com/repos/${candidate.github_repo}/issues?state=open&per_page=${options.maxGithubIssues ?? 5}`;
  try {
    const issues = await fetchAllowedJson(url, { timeoutMs: options.timeoutMs ?? 15000 });
    report.github_issue_requests.push({
      candidate_id: candidate.candidate_id,
      repo: candidate.github_repo,
      status: "passed",
      issue_count: Array.isArray(issues) ? issues.length : 0
    });
    return (Array.isArray(issues) ? issues : [])
      .filter((issue) => !issue.pull_request)
      .map((issue) => ({
        source_type: "github_issue",
        url: issue.html_url,
        captured_at: nowIso(),
        issue_type: "stability",
        topic: issue.title,
        quote: `${issue.title}${issue.body ? ` - ${issue.body.slice(0, 180)}` : ""}`,
        sentiment: "negative"
      }));
  } catch (error) {
    report.github_issue_requests.push({
      candidate_id: candidate.candidate_id,
      repo: candidate.github_repo,
      status: "failed",
      error: error.message
    });
    return [];
  }
}

export async function collectLiveCandidates({ projectRoot, runDir, runContext }) {
  const research = runContext.research ?? {};
  const report = {
    stage: "LIVE_DISCOVERY_ADAPTER",
    status: "skipped",
    generated_at: nowIso(),
    requested_mode: research.mode ?? "fixture",
    resolved_mode: research.mode === "live" ? "live" : "fixture",
    source_mode: research.mode === "live" ? "live" : "fixture",
    sitemap_requests: [],
    search_requests: [],
    listing_requests: [],
    support_requests: [],
    github_issue_requests: [],
    fallback_to_fixture: false,
    fallback_used: false,
    fallback_reason: null,
    fallback_reason_type: null,
    candidates: []
  };

  if (research.mode !== "live") {
    await validateLiveResearchReport(projectRoot, report);
    await writeJson(path.join(runDir, "09_live_research_report.json"), report);
    return { candidates: null, report };
  }

  report.status = "running";
  const options = {
    timeoutMs: research.timeout_ms ?? 15000,
    maxShards: research.max_sitemap_shards ?? 1,
    maxListingPages: research.max_listing_pages ?? 8,
    searchQueries: research.search_queries?.length ? research.search_queries : defaultSearchQueries(runContext.builder.allow_families)
  };

  try {
    const sitemapIndexUrl = "https://chromewebstore.google.com/sitemap";
    const sitemapIndexResponse = await fetchAllowedText(sitemapIndexUrl, { timeoutMs: options.timeoutMs });
    report.sitemap_requests.push({
      url: sitemapIndexUrl,
      status: sitemapIndexResponse.status,
      ok: sitemapIndexResponse.ok,
      node_fallback_reason: sitemapIndexResponse.node_fallback_reason ?? ""
    });
    if (!sitemapIndexResponse.ok) {
      throw new Error(`Chrome Web Store sitemap returned HTTP ${sitemapIndexResponse.status}`);
    }

    const shardUrls = extractLocs(sitemapIndexResponse.text).slice(0, options.maxShards);
    const sitemapListingUrls = [];
    const searchListingUrls = [];
    for (const shardUrl of shardUrls) {
      const shardResponse = await fetchAllowedText(shardUrl, { timeoutMs: options.timeoutMs });
      report.sitemap_requests.push({
        url: shardUrl,
        status: shardResponse.status,
        ok: shardResponse.ok,
        node_fallback_reason: shardResponse.node_fallback_reason ?? ""
      });
      if (!shardResponse.ok) {
        continue;
      }
      sitemapListingUrls.push(...extractLocs(shardResponse.text));
    }

    for (const query of options.searchQueries) {
      const searchUrl = `https://chromewebstore.google.com/search/${encodeURIComponent(query)}`;
      try {
        const searchResponse = await fetchAllowedText(searchUrl, { timeoutMs: options.timeoutMs });
        const detailUrls = searchResponse.ok ? extractDetailUrlsFromSearchHtml(searchResponse.text) : [];
        report.search_requests.push({
          query,
          url: searchUrl,
          status: searchResponse.status,
          ok: searchResponse.ok,
          result_count: detailUrls.length,
          node_fallback_reason: searchResponse.node_fallback_reason ?? ""
        });
        if (searchResponse.ok) {
          searchListingUrls.push(...detailUrls);
        }
      } catch (error) {
        report.search_requests.push({
          query,
          url: searchUrl,
          status: "failed",
          ok: false,
          error: error.message
        });
      }
    }

    const uniqueListingUrls = unique([...searchListingUrls, ...sitemapListingUrls])
      .filter((url) => url.includes("chromewebstore.google.com/detail/"))
      .slice(0, options.maxListingPages);

    for (const listingUrl of uniqueListingUrls) {
      try {
        const listingResponse = await fetchAllowedText(listingUrl, { timeoutMs: options.timeoutMs });
        report.listing_requests.push({
          url: listingUrl,
          status: listingResponse.status,
          ok: listingResponse.ok,
          node_fallback_reason: listingResponse.node_fallback_reason ?? ""
        });
        if (listingResponse.ok) {
          report.candidates.push(parseChromeListing(listingUrl, listingResponse.text, runContext.builder.allow_families));
        }
      } catch (error) {
        report.listing_requests.push({
          url: listingUrl,
          status: "failed",
          ok: false,
          error: error.message
        });
      }
    }

    if (report.candidates.length === 0) {
      throw new Error("Live discovery produced zero parseable listing candidates.");
    }

    report.status = "passed";
    report.resolved_mode = "live";
    report.source_mode = "live";
    await validateLiveResearchReport(projectRoot, report);
    await writeJson(path.join(runDir, "09_live_research_report.json"), report);
    return { candidates: report.candidates, report };
  } catch (error) {
    report.status = "failed";
    report.fallback_to_fixture = research.fallback_to_fixture !== false;
    report.fallback_reason = error.message;
    report.fallback_reason_type = "live_source_failure";
    if (!report.fallback_to_fixture) {
      await validateLiveResearchReport(projectRoot, report);
      await writeJson(path.join(runDir, "09_live_research_report.json"), report);
      throw error;
    }
    const fixture = await readJson(path.join(projectRoot, "fixtures", "discovery", "candidates.json"));
    report.fallback_used = true;
    report.resolved_mode = "explicit_fixture_fallback_after_live_failure";
    report.source_mode = "explicit_fixture_fallback_after_live_failure";
    report.candidates = fixture.candidates.map((candidate) => ({
      ...candidate,
      source_mode: "explicit_fixture_fallback_after_live_failure"
    }));
    await validateLiveResearchReport(projectRoot, report);
    await writeJson(path.join(runDir, "09_live_research_report.json"), report);
    return { candidates: report.candidates, report };
  }
}

export async function collectLiveEvidenceForCandidate(candidate, options = {}) {
  const report = {
    support_requests: [],
    github_issue_requests: []
  };
  const listingEvidence = evidenceFromListing(candidate);
  const supportEvidence = await evidenceFromSupportSite(candidate, report, options);
  const githubEvidence = await evidenceFromGithubIssues(candidate, report, options);
  return {
    evidence: [
      ...listingEvidence,
      ...supportEvidence,
      ...githubEvidence
    ],
    provenance: report
  };
}

export async function enrichLiveEvidence({ runDir, runContext, candidateReport }) {
  const research = runContext.research ?? {};
  const reportPath = path.join(runDir, "09_live_research_report.json");
  const report = await readJson(reportPath);
  const evidenceByCandidate = {};

  if (research.mode !== "live" || report.fallback_to_fixture) {
    return null;
  }

  for (const candidate of candidateReport.candidates) {
    const evidence = evidenceFromListing(candidate);
    evidence.push(...(await evidenceFromSupportSite(candidate, report, {
      timeoutMs: research.timeout_ms ?? 15000
    })));
    evidence.push(...(await evidenceFromGithubIssues(candidate, report, {
      timeoutMs: research.timeout_ms ?? 15000,
      maxGithubIssues: research.max_github_issues ?? 5
    })));
    evidenceByCandidate[candidate.candidate_id] = evidence.map((item) => ({
      ...item,
      candidate_id: candidate.candidate_id
    }));
  }

  report.github_enrichment_completed_at = nowIso();
  await writeJson(reportPath, report);
  return evidenceByCandidate;
}
