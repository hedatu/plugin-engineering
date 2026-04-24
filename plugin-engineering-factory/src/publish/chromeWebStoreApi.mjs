import fs from "node:fs/promises";
import { JWT } from "google-auth-library";
import { EnvHttpProxyAgent, ProxyAgent } from "undici";
import { redactSecretLikeText } from "../utils/redaction.mjs";

export const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
export const CHROME_WEB_STORE_SCOPE = "https://www.googleapis.com/auth/chromewebstore";
export const CHROME_WEB_STORE_READONLY_SCOPE = "https://www.googleapis.com/auth/chromewebstore.readonly";

const DEFAULT_TIMEOUT_MS = 15_000;
const HEADER_ALLOWLIST = new Set([
  "alt-svc",
  "cache-control",
  "content-length",
  "content-type",
  "date",
  "server",
  "vary",
  "via",
  "www-authenticate",
  "x-content-type-options",
  "x-envoy-upstream-service-time",
  "x-guploader-uploadid"
]);
const proxyAgentCache = new Map();
let envProxyAgent = null;

class ChromeWebStoreApiError extends Error {
  constructor({
    failurePhase,
    message,
    cause = undefined,
    retryable = false,
    diagnosticHint = null,
    httpStatus = null,
    responseBodySummary = null,
    responseHeadersSummary = null,
    errorDetails = null,
    networkMode = "direct",
    proxyConfigured = false,
    proxySource = null,
    proxyUrlRedacted = null,
    viaProxy = false
  }) {
    super(redactSecretLikeText(message), cause ? { cause } : undefined);
    this.name = "ChromeWebStoreApiError";
    this.failurePhase = failurePhase;
    this.retryable = retryable;
    this.diagnosticHint = diagnosticHint;
    this.httpStatus = httpStatus;
    this.responseBodySummary = responseBodySummary;
    this.responseHeadersSummary = responseHeadersSummary;
    this.errorDetails = errorDetails;
    this.networkMode = networkMode;
    this.proxyConfigured = proxyConfigured;
    this.proxySource = proxySource;
    this.proxyUrlRedacted = proxyUrlRedacted;
    this.viaProxy = viaProxy;
  }
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

function redactProxyUrl(rawProxyUrl) {
  const normalized = normalizeProxyUrl(rawProxyUrl);
  if (!normalized) {
    return null;
  }

  try {
    const parsed = new URL(normalized);
    parsed.username = "";
    parsed.password = "";
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return redactSecretLikeText(normalized);
  }
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
  const entries = parseNoProxyEntries();
  return entries.some((entry) => hostMatchesNoProxyEntry(urlObject.hostname, urlObject.port, entry));
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
      proxy_url_redacted: redactProxyUrl(proxyUrl),
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
    proxy_url_redacted: redactProxyUrl(proxyUrl),
    via_proxy: true,
    dispatcher
  };
}

function buildGaxiosTransportOptions(url, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const urlObject = new URL(url);
  const noProxy = parseNoProxyEntries();
  const { proxyUrl } = resolveProxySelection(urlObject);
  const bypassedByNoProxy = Boolean(proxyUrl) && shouldBypassProxy(urlObject);

  return {
    timeout: timeoutMs,
    retry: false,
    proxy: proxyUrl && !bypassedByNoProxy ? proxyUrl : undefined,
    noProxy: noProxy.length > 0 ? noProxy : undefined
  };
}

export function getChromeWebStoreNetworkSummary(url) {
  const { dispatcher, ...summary } = buildRequestTransport(url);
  return summary;
}

function sanitizeResponseBody(body) {
  if (body === null || body === undefined) {
    return null;
  }
  if (Array.isArray(body)) {
    return body.map((item) => sanitizeResponseBody(item));
  }
  if (typeof body === "string") {
    return redactSecretLikeText(body);
  }
  if (typeof body !== "object") {
    return body;
  }

  const redactedKeys = new Set([
    "access_token",
    "authorization",
    "client_secret",
    "id_token",
    "private_key",
    "refresh_token",
    "token"
  ]);

  return Object.fromEntries(
    Object.entries(body).flatMap(([key, value]) => {
      if (redactedKeys.has(key)) {
        return [];
      }
      return [[key, sanitizeResponseBody(value)]];
    })
  );
}

function summarizeResponseBody(body) {
  const sanitizedBody = sanitizeResponseBody(body);
  if (sanitizedBody === null || sanitizedBody === undefined) {
    return {
      kind: "empty",
      body_keys: [],
      preview: null
    };
  }

  if (Array.isArray(sanitizedBody)) {
    return {
      kind: "array",
      body_keys: [],
      item_count: sanitizedBody.length,
      preview: sanitizedBody.length > 0 ? JSON.stringify(sanitizedBody[0]).slice(0, 200) : null
    };
  }

  if (typeof sanitizedBody === "string") {
    return {
      kind: "text",
      body_keys: [],
      preview: sanitizedBody.slice(0, 200)
    };
  }

  if (typeof sanitizedBody === "object") {
    const keys = Object.keys(sanitizedBody).sort();
    return {
      kind: "object",
      body_keys: keys,
      preview: Object.prototype.hasOwnProperty.call(sanitizedBody, "raw_text")
        ? `${sanitizedBody.raw_text}`.slice(0, 200)
        : JSON.stringify(sanitizedBody).slice(0, 200)
    };
  }

  return {
    kind: typeof sanitizedBody,
    body_keys: [],
    preview: `${sanitizedBody}`.slice(0, 200)
  };
}

function summarizeResponseHeaders(headers) {
  if (!headers) {
    return {
      header_names: [],
      sampled: {}
    };
  }

  const entries = typeof headers.entries === "function"
    ? [...headers.entries()]
    : Object.entries(headers);
  const sampled = {};
  const headerNames = [];
  for (const [name, value] of entries) {
    const lowerName = name.toLowerCase();
    headerNames.push(lowerName);
    if (HEADER_ALLOWLIST.has(lowerName)) {
      const headerValue = Array.isArray(value) ? value.join(", ") : `${value}`;
      sampled[lowerName] = redactSecretLikeText(headerValue).slice(0, 200);
    }
  }

  return {
    header_names: headerNames.sort(),
    sampled
  };
}

function summarizeErrorDetails(error) {
  const cause = error?.cause ?? null;
  return {
    name: error?.name ?? "Error",
    message: redactSecretLikeText(error?.message ?? "Unknown error"),
    code: error?.code ?? null,
    cause_code: cause?.code ?? null,
    cause_errno: cause?.errno ?? null,
    cause_syscall: cause?.syscall ?? null,
    cause_hostname: cause?.hostname ?? null,
    cause_port: cause?.port ?? null
  };
}

function inferRetryable({ errorDetails, httpStatus = null }) {
  if (typeof httpStatus === "number" && [408, 425, 429, 500, 502, 503, 504].includes(httpStatus)) {
    return true;
  }

  const code = errorDetails?.cause_code ?? errorDetails?.code ?? null;
  return [
    "EAI_AGAIN",
    "ECONNREFUSED",
    "ECONNRESET",
    "ETIMEDOUT",
    "UND_ERR_BODY_TIMEOUT",
    "UND_ERR_CONNECT_TIMEOUT",
    "UND_ERR_HEADERS_TIMEOUT"
  ].includes(code);
}

function inferDiagnosticHint({ failurePhase, errorDetails, httpStatus = null, url = "", transport }) {
  const code = errorDetails?.cause_code ?? errorDetails?.code ?? null;
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") {
    return "DNS lookup for the Google endpoint failed.";
  }
  if (code === "ECONNREFUSED") {
    return transport?.via_proxy
      ? "The configured proxy refused the outbound connection."
      : "Outbound connection was refused before the TLS or HTTP handshake completed.";
  }
  if (code === "ECONNRESET") {
    return transport?.via_proxy
      ? "The proxy reset the connection mid-request."
      : "Connection was reset mid-request; proxy interception or unstable network is likely.";
  }
  if (code === "ETIMEDOUT" || code === "UND_ERR_CONNECT_TIMEOUT" || code === "UND_ERR_HEADERS_TIMEOUT" || code === "UND_ERR_BODY_TIMEOUT") {
    return transport?.via_proxy
      ? "The request timed out while using the configured proxy."
      : "Request timed out before a complete response was received.";
  }
  if (code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE" || code === "SELF_SIGNED_CERT_IN_CHAIN") {
    return "TLS certificate verification failed, which often indicates proxy interception or local trust issues.";
  }
  if (httpStatus === 401) {
    return failurePhase === "token_exchange"
      ? "Google rejected the service-account assertion or OAuth exchange."
      : "Chrome Web Store rejected the bearer credential or scope.";
  }
  if (httpStatus === 403) {
    return failurePhase === "token_exchange"
      ? "Google denied the service-account exchange request."
      : "Chrome Web Store denied access; verify publisher membership and sandbox item ownership.";
  }
  if (httpStatus === 404) {
    return "Publisher id or sandbox item id may not match an accessible Chrome Web Store item.";
  }
  if (httpStatus === 429) {
    return "Google rate-limited the request; retry after backoff.";
  }
  if (typeof httpStatus === "number" && httpStatus >= 500) {
    return "Google returned a server-side error; retry later.";
  }
  if (url.includes("oauth2.googleapis.com")) {
    return transport?.via_proxy
      ? "Check outbound access from the proxy to oauth2.googleapis.com and verify proxy allow rules."
      : "Check outbound access to oauth2.googleapis.com and the local service-account file.";
  }
  if (url.includes("chromewebstore.googleapis.com")) {
    return transport?.via_proxy
      ? "Check outbound access from the proxy to chromewebstore.googleapis.com and verify proxy allow rules."
      : "Check outbound access to chromewebstore.googleapis.com, publisher membership, and sandbox item access.";
  }
  return null;
}

function buildApiError({
  failurePhase,
  message,
  error = null,
  httpStatus = null,
  responseBodySummary = null,
  responseHeadersSummary = null,
  url = "",
  transport = buildRequestTransport(url)
}) {
  const errorDetails = summarizeErrorDetails(error ?? new Error(message));
  return new ChromeWebStoreApiError({
    failurePhase,
    message,
    cause: error ?? undefined,
    retryable: inferRetryable({ errorDetails, httpStatus }),
    diagnosticHint: inferDiagnosticHint({ failurePhase, errorDetails, httpStatus, url, transport }),
    httpStatus,
    responseBodySummary,
    responseHeadersSummary,
    errorDetails,
    networkMode: transport.network_mode,
    proxyConfigured: transport.proxy_configured,
    proxySource: transport.proxy_source,
    proxyUrlRedacted: transport.proxy_url_redacted,
    viaProxy: transport.via_proxy
  });
}

function summarizeExternalHttpResponse(response) {
  return {
    httpStatus: response?.status ?? null,
    responseBodySummary: summarizeResponseBody(response?.data ?? null),
    responseHeadersSummary: summarizeResponseHeaders(response?.headers ?? null)
  };
}

async function parseResponse(response) {
  const text = await response.text();
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    return { raw_text: text.slice(0, 500) };
  }
}

async function readServiceAccountConfig() {
  if (process.env.CHROME_WEB_STORE_SERVICE_ACCOUNT_JSON) {
    try {
      return JSON.parse(process.env.CHROME_WEB_STORE_SERVICE_ACCOUNT_JSON);
    } catch (error) {
      throw buildApiError({
        failurePhase: "credentials_file_read",
        message: "Inline service-account JSON could not be parsed.",
        error,
        url: "env:CHROME_WEB_STORE_SERVICE_ACCOUNT_JSON"
      });
    }
  }

  const filePath = process.env.CHROME_WEB_STORE_SERVICE_ACCOUNT_FILE ?? process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!filePath) {
    return null;
  }

  let raw;
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch (error) {
    throw buildApiError({
      failurePhase: "credentials_file_read",
      message: "Service-account credentials file could not be read.",
      error,
      url: filePath
    });
  }

  try {
    return JSON.parse(raw);
  } catch (error) {
    throw buildApiError({
      failurePhase: "credentials_file_read",
      message: "Service-account credentials file is not valid JSON.",
      error,
      url: filePath
    });
  }
}

export async function readChromeWebStoreServiceAccountSummary() {
  const filePath = process.env.CHROME_WEB_STORE_SERVICE_ACCOUNT_FILE ?? process.env.GOOGLE_APPLICATION_CREDENTIALS ?? null;
  const usesInlineJson = Boolean(process.env.CHROME_WEB_STORE_SERVICE_ACCOUNT_JSON);
  const summary = {
    source: usesInlineJson
      ? "service_account_inline_json"
      : filePath
        ? "service_account_file"
        : "unconfigured",
    credential_file_path: usesInlineJson ? null : filePath,
    credential_file_exists: usesInlineJson ? null : false,
    client_email_present: false,
    client_email: null,
    private_key_id_present: false,
    private_key_id: null,
    key_material_present: false,
    error_details: null
  };

  if (!usesInlineJson && filePath) {
    try {
      await fs.access(filePath);
      summary.credential_file_exists = true;
    } catch (error) {
      summary.error_details = summarizeErrorDetails(error);
      return summary;
    }
  }

  try {
    const config = await readServiceAccountConfig();
    summary.client_email_present = Boolean(config?.client_email);
    summary.client_email = config?.client_email ?? null;
    summary.private_key_id_present = Boolean(config?.private_key_id);
    summary.private_key_id = config?.private_key_id ?? null;
    summary.key_material_present = Boolean(config?.private_key);
    return summary;
  } catch (error) {
    summary.error_details = normalizeChromeWebStoreError(error, "credentials_file_read").error_details;
    return summary;
  }
}

async function exchangeServiceAccountToken({ scope = CHROME_WEB_STORE_SCOPE } = {}) {
  const config = await readServiceAccountConfig();
  if (!config?.client_email || !config?.private_key) {
    throw buildApiError({
      failurePhase: "credentials_file_read",
      message: "Service-account credentials are missing required fields.",
      error: new Error("service-account JSON is missing client_email or key material."),
      url: process.env.CHROME_WEB_STORE_SERVICE_ACCOUNT_FILE ?? process.env.GOOGLE_APPLICATION_CREDENTIALS ?? "inline_json"
    });
  }

  const transport = buildRequestTransport(GOOGLE_TOKEN_ENDPOINT);
  try {
    const client = new JWT({
      email: config.client_email,
      key: config.private_key,
      keyId: config.private_key_id,
      scopes: [scope],
      transporterOptions: buildGaxiosTransportOptions(GOOGLE_TOKEN_ENDPOINT)
    });
    const tokens = await client.authorize();

    if (!tokens?.access_token) {
      throw buildApiError({
        failurePhase: "token_exchange",
        message: "Google OAuth exchange completed without an access credential in the response body.",
        url: GOOGLE_TOKEN_ENDPOINT,
        transport
      });
    }

    return {
      accessToken: tokens.access_token,
      tokenMode: "service_account_google_auth_library",
      tokenExpiry: typeof tokens.expiry_date === "number" ? tokens.expiry_date : null,
      network_mode: transport.network_mode,
      proxy_configured: transport.proxy_configured,
      proxy_source: transport.proxy_source,
      proxy_url_redacted: transport.proxy_url_redacted,
      via_proxy: transport.via_proxy
    };
  } catch (error) {
    if (error instanceof ChromeWebStoreApiError) {
      throw error;
    }
    const httpSummary = summarizeExternalHttpResponse(error?.response);
    throw buildApiError({
      failurePhase: "token_exchange",
      message: typeof httpSummary.httpStatus === "number"
        ? `Google OAuth exchange returned HTTP ${httpSummary.httpStatus}.`
        : "Google OAuth exchange failed before an HTTP response was received.",
      error,
      httpStatus: httpSummary.httpStatus,
      responseBodySummary: httpSummary.responseBodySummary,
      responseHeadersSummary: httpSummary.responseHeadersSummary,
      url: GOOGLE_TOKEN_ENDPOINT,
      transport
    });
  }
}

async function exchangeRefreshToken() {
  const clientId = process.env.CHROME_WEB_STORE_CLIENT_ID ?? "";
  const clientSecret = process.env.CHROME_WEB_STORE_CLIENT_SECRET ?? "";
  const refreshToken = process.env.CHROME_WEB_STORE_REFRESH_TOKEN ?? "";

  if (!clientId || !clientSecret || !refreshToken) {
    throw buildApiError({
      failurePhase: "env_preflight",
      message: "Refresh-token OAuth configuration is incomplete.",
      error: new Error("OAuth env is missing client id, client secret, or refresh credential.")
    });
  }

  const response = await executeRequest({
    failurePhase: "token_exchange",
    method: "POST",
    url: GOOGLE_TOKEN_ENDPOINT,
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token"
    })
  });

  if (!response.ok) {
    throw buildApiError({
      failurePhase: "token_exchange",
      message: `OAuth refresh exchange returned HTTP ${response.status_code}.`,
      httpStatus: response.status_code,
      responseBodySummary: response.response_body_summary,
      responseHeadersSummary: response.response_headers_summary,
      url: GOOGLE_TOKEN_ENDPOINT,
      transport: response.transport
    });
  }

  if (!response.raw_body?.access_token) {
    throw buildApiError({
      failurePhase: "token_exchange",
      message: "OAuth refresh exchange completed without an access credential in the response body.",
      httpStatus: response.status_code,
      responseBodySummary: response.response_body_summary,
      responseHeadersSummary: response.response_headers_summary,
      url: GOOGLE_TOKEN_ENDPOINT,
      transport: response.transport
    });
  }

  return {
    accessToken: response.raw_body.access_token,
    tokenMode: "oauth_refresh",
    network_mode: response.network_mode,
    proxy_configured: response.proxy_configured,
    proxy_source: response.proxy_source,
    proxy_url_redacted: response.proxy_url_redacted,
    via_proxy: response.via_proxy
  };
}

export async function getChromeWebStoreAccessToken(credentialsMode, { scope = CHROME_WEB_STORE_SCOPE } = {}) {
  if (credentialsMode === "service_account" || credentialsMode === "service_account_file" || credentialsMode === "service_account_json") {
    return exchangeServiceAccountToken({ scope });
  }
  if (credentialsMode === "oauth_refresh" || credentialsMode === "oauth_refresh_token") {
    return exchangeRefreshToken();
  }
  throw buildApiError({
    failurePhase: "env_preflight",
    message: `Unsupported Chrome Web Store credential mode: ${credentialsMode}.`
  });
}

export async function runChromeWebStoreTokenSelfTest({ scope = CHROME_WEB_STORE_READONLY_SCOPE } = {}) {
  const serviceAccountSummary = await readChromeWebStoreServiceAccountSummary();
  const result = {
    credential_file_exists: serviceAccountSummary.credential_file_exists === null
      ? serviceAccountSummary.source === "service_account_inline_json"
      : Boolean(serviceAccountSummary.credential_file_exists),
    client_email: serviceAccountSummary.client_email ?? null,
    private_key_id: serviceAccountSummary.private_key_id ?? null,
    token_exchange_status: "skipped",
    token_present: false,
    token_expiry: null,
    failure_reason: null,
    redacted_error_details: null
  };

  if (serviceAccountSummary.error_details) {
    result.token_exchange_status = "failed";
    result.failure_reason = serviceAccountSummary.error_details.message;
    result.redacted_error_details = serviceAccountSummary.error_details;
    return result;
  }
  if (!serviceAccountSummary.client_email_present || !serviceAccountSummary.key_material_present) {
    result.token_exchange_status = "failed";
    result.failure_reason = "Service-account credentials are missing client_email or private_key.";
    result.redacted_error_details = {
      name: "Error",
      message: result.failure_reason,
      code: null,
      cause_code: null,
      cause_errno: null,
      cause_syscall: null,
      cause_hostname: null,
      cause_port: null
    };
    return result;
  }

  try {
    const tokenResult = await exchangeServiceAccountToken({ scope });
    result.token_exchange_status = "passed";
    result.token_present = Boolean(tokenResult.accessToken);
    result.token_expiry = tokenResult.tokenExpiry
      ? new Date(tokenResult.tokenExpiry).toISOString()
      : null;
    return result;
  } catch (error) {
    const normalized = normalizeChromeWebStoreError(error, "token_exchange");
    result.token_exchange_status = "failed";
    result.failure_reason = normalized.message;
    result.redacted_error_details = normalized.error_details;
    return result;
  }
}

async function executeRequest({
  failurePhase,
  method,
  url,
  accessToken = null,
  headers = {},
  body = undefined,
  timeoutMs = DEFAULT_TIMEOUT_MS
}) {
  const transport = buildRequestTransport(url);

  let response;
  try {
    response = await fetch(url, {
      method,
      headers: {
        ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
        ...headers
      },
      body,
      dispatcher: transport.dispatcher ?? undefined,
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch (error) {
    throw buildApiError({
      failurePhase,
      message: `Request to ${url} failed before an HTTP response was received.`,
      error,
      url,
      transport
    });
  }

  const parsedBody = await parseResponse(response);
  return {
    ok: response.ok,
    status_code: response.status,
    http_status: response.status,
    body: sanitizeResponseBody(parsedBody),
    raw_body: parsedBody,
    response_body_summary: summarizeResponseBody(parsedBody),
    response_headers_summary: summarizeResponseHeaders(response.headers),
    network_mode: transport.network_mode,
    proxy_configured: transport.proxy_configured,
    proxy_source: transport.proxy_source,
    proxy_url_redacted: transport.proxy_url_redacted,
    via_proxy: transport.via_proxy,
    transport
  };
}

export function normalizeChromeWebStoreError(error, fallbackFailurePhase = "network_preflight") {
  if (error instanceof ChromeWebStoreApiError) {
    return {
      failure_phase: error.failurePhase ?? fallbackFailurePhase,
      message: redactSecretLikeText(error.message),
      retryable: Boolean(error.retryable),
      diagnostic_hint: error.diagnosticHint ?? null,
      error_details: error.errorDetails ?? summarizeErrorDetails(error),
      http_status: error.httpStatus ?? null,
      response_body_summary: error.responseBodySummary ?? null,
      response_headers_summary: error.responseHeadersSummary ?? null,
      network_mode: error.networkMode ?? "direct",
      proxy_configured: Boolean(error.proxyConfigured),
      proxy_source: error.proxySource ?? null,
      proxy_url_redacted: error.proxyUrlRedacted ?? null,
      via_proxy: Boolean(error.viaProxy)
    };
  }

  const errorDetails = summarizeErrorDetails(error);
  return {
    failure_phase: fallbackFailurePhase,
    message: redactSecretLikeText(error?.message ?? "Unknown error"),
    retryable: inferRetryable({ errorDetails }),
    diagnostic_hint: inferDiagnosticHint({ failurePhase: fallbackFailurePhase, errorDetails }),
    error_details: errorDetails,
    http_status: null,
    response_body_summary: null,
    response_headers_summary: null,
    network_mode: "direct",
    proxy_configured: false,
    proxy_source: null,
    proxy_url_redacted: null,
    via_proxy: false
  };
}

export async function probeChromeWebStoreEndpoint({ url, label }) {
  const probe = {
    label,
    url,
    attempted: true,
    reachable: false,
    ok: null,
    http_status: null,
    diagnostic_hint: null,
    retryable: false,
    error_details: null,
    response_body_summary: null,
    response_headers_summary: null,
    ...getChromeWebStoreNetworkSummary(url)
  };

  try {
    const response = await executeRequest({
      failurePhase: "network_preflight",
      method: "GET",
      url,
      headers: {
        accept: "application/json,text/plain,*/*"
      },
      timeoutMs: 10_000
    });
    return {
      ...probe,
      reachable: true,
      ok: response.ok,
      http_status: response.http_status,
      response_body_summary: response.response_body_summary,
      response_headers_summary: response.response_headers_summary,
      network_mode: response.network_mode,
      proxy_configured: response.proxy_configured,
      proxy_source: response.proxy_source,
      proxy_url_redacted: response.proxy_url_redacted,
      via_proxy: response.via_proxy
    };
  } catch (error) {
    const normalized = normalizeChromeWebStoreError(error, "network_preflight");
    return {
      ...probe,
      diagnostic_hint: normalized.diagnostic_hint,
      retryable: normalized.retryable,
      error_details: normalized.error_details,
      http_status: normalized.http_status,
      response_body_summary: normalized.response_body_summary,
      response_headers_summary: normalized.response_headers_summary,
      network_mode: normalized.network_mode,
      proxy_configured: normalized.proxy_configured,
      proxy_source: normalized.proxy_source,
      proxy_url_redacted: normalized.proxy_url_redacted,
      via_proxy: normalized.via_proxy
    };
  }
}

function finalizeResponse(response) {
  delete response.raw_body;
  delete response.transport;
  return response;
}

export async function fetchChromeWebStoreStatus({ publisherId, itemId, accessToken }) {
  const url = `https://chromewebstore.googleapis.com/v2/publishers/${publisherId}/items/${itemId}:fetchStatus`;
  const response = await executeRequest({
    failurePhase: "chrome_webstore_fetch_status",
    method: "GET",
    url,
    accessToken
  });
  return finalizeResponse(response);
}

export async function uploadChromeWebStorePackage({ publisherId, itemId, accessToken, packagePath }) {
  const packageBuffer = await fs.readFile(packagePath);
  const url = `https://chromewebstore.googleapis.com/upload/v2/publishers/${publisherId}/items/${itemId}:upload`;
  const response = await executeRequest({
    failurePhase: "chrome_webstore_upload",
    method: "POST",
    url,
    accessToken,
    headers: {
      "content-type": "application/zip",
      "x-goog-api-client": "chrome-extension-opportunity-factory"
    },
    body: packageBuffer
  });
  return finalizeResponse(response);
}

export async function publishChromeWebStoreItem({ publisherId, itemId, accessToken, publishType }) {
  const url = `https://chromewebstore.googleapis.com/v2/publishers/${publisherId}/items/${itemId}:publish`;
  const response = await executeRequest({
    failurePhase: "chrome_webstore_publish",
    method: "POST",
    url,
    accessToken,
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      publishType
    })
  });
  return finalizeResponse(response);
}
